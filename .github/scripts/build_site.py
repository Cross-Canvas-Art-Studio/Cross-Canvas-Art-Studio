#!/usr/bin/env python3
"""
build_site.py - generates the static GitHub Pages site from the live Flask app.

What it does
------------
1. Reads App/templates/index.html and strips all Flask template syntax.
2. Removes the AI Design tab and auth-related script tags.
3. Injects static-adapter.js (client-side API shim) before canvas-renderer.js.
4. Copies the required static assets into _site/.

The resulting _site/ directory is a fully self-contained static site:
  - No Python / Flask required.
  - No accounts; localStorage is used for project storage.
  - No AI features.
  - Image upload works client-side via the Canvas API.
  - Google Analytics (GA4) is injected into the <head> when GA_MEASUREMENT_ID is set.
  - Cloudflare Web Analytics is injected into the <head> when CF_ANALYTICS_TOKEN is set.
  - SEO meta (title, description, canonical, OG/Twitter, JSON-LD) comes from App/config.json.
  - The three local scripts are bundled into a single app.bundle.js.
  - robots.txt and sitemap.xml are generated (see App/seo_files.py) so every
    crawler, including Google-Extended and the AI crawlers, is explicitly
    allowed. GitHub Pages emits neither on its own.
  - A CNAME file pins the stitchee.ca custom domain for GitHub Pages.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import time

# Print box-drawing / arrow chars safely even when stdout is piped (Windows
# default cp1252 cannot encode them and would crash the build mid-way).
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC_STATIC   = os.path.join(ROOT, 'App', 'static')
SRC_TEMPLATE = os.path.join(ROOT, 'App', 'templates', 'index.html')
CONFIG_PATH  = os.path.join(ROOT, 'App', 'config.json')
OUT_DIR      = os.path.join(ROOT, '_site')
TEMPLATES_DIR = os.path.join(ROOT, 'App', 'templates')

# The build renders the same Jinja templates Flask does (every page extends
# base.html), so it needs jinja2 and the shared page_context module. App/ holds
# the sibling modules (palette_manager, page_context, seo_files) - put it on the
# path once, up front.
sys.path.insert(0, os.path.join(ROOT, 'App'))

from jinja2 import Environment, FileSystemLoader, select_autoescape  # noqa: E402
from page_context import TOOLS, page_context as build_page_context  # noqa: E402


def _url_for(endpoint, **values):
    """Stand-in for Flask's url_for: the templates only use endpoint='static'."""
    if endpoint == 'static':
        return values.get('filename', '')
    return ''


def _make_template_env():
    env = Environment(
        loader=FileSystemLoader(TEMPLATES_DIR),
        autoescape=select_autoescape(['html', 'xml']),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )
    env.globals['url_for'] = _url_for
    return env


# One environment for the whole build.
TEMPLATE_ENV = _make_template_env()


def render_page(template, key):
    """Render one page template through Jinja, exactly as Flask renders it.

    The static site has no accounts and no AI, so the flags the old string
    substitution hard-coded are passed here: require_auth=False, ai_enabled=False.
    """
    html = TEMPLATE_ENV.get_template(template).render(
        **build_page_context(FULL_CONFIG, key, require_auth=False, ai_enabled=False)
    )
    if '{{' in html or '{%' in html:
        raise SystemExit(
            f'ERROR: unresolved template markers remain in {template}. '
            f'The static build renders Jinja now; a stray tag would ship raw.'
        )
    return html

# ── Google Analytics (GA4) ──────────────────────────────────────────────
# ⬇⬇  ADD YOUR MEASUREMENT ID HERE  ⬇⬇
# Paste the "G-XXXXXXXXXX" tag from Google Analytics → Admin → Data Streams.
# Leave as-is to build the site WITHOUT analytics (tag stays commented out).
# You can also set it via the GA_MEASUREMENT_ID env var (e.g. in CI).
GA_MEASUREMENT_ID = os.environ.get('GA_MEASUREMENT_ID', 'G-2962YBBV7F')


def ga_snippet(ga_id):
    """Standard GA4 gtag.js snippet. The tag only activates once a real ID is set."""
    placeholder = 'G-XXXXXXXXXX'
    if not ga_id or ga_id.strip() == placeholder or ga_id.strip().lower() in ('none', 'false', ''):
        return (
            '\n'
            '    <!-- ════════════════════════════════════════════════════════ -->\n'
            '    <!-- GOOGLE ANALYTICS (GA4) — not enabled                   -->\n'
            '    <!-- To enable, replace G-XXXXXXXXXX with your Measurement ID  -->\n'
            '    <!-- (Google Analytics → Admin → Data Streams) and rebuild.   -->\n'
            '    <!-- ════════════════════════════════════════════════════════ -->\n'
        )
    return (
        '\n'
        '    <!-- ════════════════════════════════════════════════════════ -->\n'
        '    <!-- GOOGLE ANALYTICS (GA4)                                    -->\n'
        '    <!-- Tag: ' + ga_id + '                                         -->\n'
        '    <!-- ════════════════════════════════════════════════════════ -->\n'
        '    <script async src="https://www.googletagmanager.com/gtag/js?id=' + ga_id + '"></script>\n'
        '    <script>\n'
        '      window.dataLayer = window.dataLayer || [];\n'
        '      function gtag(){dataLayer.push(arguments);}\n'
        "      gtag('js', new Date());\n"
        "      gtag('config', '" + ga_id + "');\n"
        '    </script>\n'
    )


# ── Cloudflare Web Analytics ───────────────────────────────────────────
# ⬇⬇  ADD YOUR WEB ANALYTICS TOKEN HERE  ⬇⬇
# Paste the site token from Cloudflare → Analytics & Logs → Web Analytics.
# Leave empty to build the site WITHOUT the Cloudflare beacon (tag stays
# commented out). You can also set it via the CF_ANALYTICS_TOKEN env var.
CF_ANALYTICS_TOKEN = os.environ.get('CF_ANALYTICS_TOKEN', '')


def cf_snippet(token):
    """Cloudflare Web Analytics beacon. Only activates once a token is set."""
    if not token or token.strip().lower() in ('none', 'false', 'placeholder', ''):
        return (
            '\n'
            '    <!-- ════════════════════════════════════════════════════════ -->\n'
            '    <!-- CLOUDFLARE WEB ANALYTICS — not enabled               -->\n'
            '    <!-- Set CF_ANALYTICS_TOKEN (Cloudflare → Web Analytics)  -->\n'
            '    <!-- and rebuild.                                           -->\n'
            '    <!-- ════════════════════════════════════════════════════════ -->\n'
        )
    return (
        '\n'
        '    <!-- ════════════════════════════════════════════════════════ -->\n'
        '    <!-- CLOUDFLARE WEB ANALYTICS                                  -->\n'
        '    <!-- ════════════════════════════════════════════════════════ -->\n'
        "    <script defer src='https://static.cloudflareinsights.com/beacon.min.js' "
        "data-cf-beacon='{\"token\": \"" + token + "\"}'></script>\n"
    )


# ── SEO meta (title, description, canonical, social) ──────────────────
# Read from App/config.json so the Flask app and the static site stay in
# sync. Values are substituted into the <head> of the generated index.html.
def load_seo():
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f).get('seo', {})
    except Exception:
        return {}


SEO = load_seo()
SEO_TITLE       = SEO.get('title', 'Stitchee \u2014 Free Cross-Stitch Pattern Maker and Yarn Canvas Designer')
SEO_DESCRIPTION = SEO.get('description', '')
SEO_URL         = SEO.get('url', 'https://stitchee.ca/')
SEO_IMAGE       = SEO.get('image', 'https://stitchee.ca/og-image.png')
SEO_SITE_NAME   = SEO.get('site_name', 'Stitchee')


def load_full_config():
    """Read App/config.json once (app, seo, and per-tool config)."""
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


FULL_CONFIG = load_full_config()



def rewrite_static_links(html):
    """Rewrite header app-switcher links for the flat static site layout.

    Each /<tool> route becomes <tool>.html and / becomes ./.
    """
    for route, template, _key, _script in TOOLS:
        html = html.replace('href="/' + route + '"', 'href="' + template + '"')
    return html.replace('href="/"', 'href="./"')


def transform_tool(route, template, key, script):
    """Render a client-side tool template into a static page.

    The template extends base.html, so it is rendered through Jinja exactly as
    Flask renders it; the post-processing (link rewriting, cache-busting,
    analytics) is unchanged.
    """
    h = render_page(template, key)
    h = rewrite_static_links(h)
    h = h.replace('href="style.css"', 'href="style.css?v=' + VERSION + '"')
    # Cache-bust any local script references (the standalone tool script).
    h = re.sub(
        r'src="([^"]+\.js)"',
        lambda m: 'src="' + m.group(1) + '?v=' + VERSION + '"',
        h,
    )
    h = h.replace(
        '</head>',
        ga_snippet(GA_MEASUREMENT_ID) + cf_snippet(CF_ANALYTICS_TOKEN) + '\n</head>',
        1,
    )
    return h

os.makedirs(OUT_DIR, exist_ok=True)


# ── Per-build version stamp ──
# GitHub Pages serves assets with max-age=14400 (4h) and asset filenames never
# change, so returning visitors keep a stale stylesheet/script after each deploy.
# The stamp is appended to every CSS/JS URL so each deploy gets a fresh asset
# URL, and it is baked into sw.js so the service worker is never byte-identical
# to the previous deploy (see the STATIC_FILES loop below for why that matters).
def build_version():
    try:
        sha = subprocess.check_output(
            ['git', 'rev-parse', '--short', 'HEAD'],
            cwd=ROOT, stderr=subprocess.DEVNULL,
        ).decode().strip()
        if sha:
            return sha
    except Exception:
        pass
    return time.strftime('%Y%m%d%H%M%S')


VERSION = build_version()

# ── 1. Copy required static assets ──
STATIC_FILES = [
    'style.css',
    'tool-common.js',
    'apple-touch-icon.png',
    'og-image.png',
    'stitchee-logo.webp',
    'stitchee-logo-dark.webp',
    # --- PWA (served from the site root so the service worker scope is '/') ---
    'manifest.webmanifest',
    'sw.js',
    'pwa.js',
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
]
for fname in STATIC_FILES:
    src = os.path.join(SRC_STATIC, fname)
    if not os.path.exists(src):
        raise FileNotFoundError(f'Missing: {src}')
    if fname == 'sw.js':
        # A browser only installs a new service worker when the SCRIPT BYTES
        # change - fetching an identical sw.js is reported as "no update"
        # however often it happens. Without this stamp an installed app would
        # never learn about a deploy (its worker is network-first, so content
        # stays fresh, but the page already running in memory does not).
        with open(src, encoding='utf-8') as fh:
            worker = fh.read()
        if '__BUILD__' not in worker:
            raise SystemExit('ERROR: sw.js no longer carries the __BUILD__ ' +
                             'token, so the static worker would be byte-' +
                             'identical to the last deploy and an installed ' +
                             'app would never see an update.')
        worker = worker.replace('__BUILD__', VERSION)
        with open(os.path.join(OUT_DIR, fname), 'w', encoding='utf-8') as fh:
            fh.write(worker)
        print(f'  wrote   {fname} (build {VERSION})')
        continue
    shutil.copy(src, os.path.join(OUT_DIR, fname))
    print(f'  copied  {fname}')

# ── 2. Render the designer page ──
# The templates share a base via {% extends %}, so the build renders them
# through Jinja exactly as Flask does rather than string-substituting raw
# files. Everything below (auth-script stripping, script bundling,
# cache-busting, link rewriting, analytics) is unchanged.
html = render_page('index.html', 'index')

# Remove api-manager.js and auth-widget.js script tags (not needed in static build)
html = re.sub(
    r'\s*<script[^>]*(?:api-manager|auth-widget)\.js[^>]*></script>',
    '',
    html,
)

# ── 2b. Bundle the local scripts into a single app.bundle.js ──
# Order matters: static-adapter.js (API shim) first, then canvas-renderer.js
# (defines CrossStitchCanvas), then app.js (UI controller). All are IIFEs, so
# concatenation is safe.
#
# BUNDLE_SCRIPTS is the single source of truth for four things: the concat
# order, the stale-file cleanup, the <script>-tag rewrite, and (below) the
# "did the rewrite actually happen?" assertion. Add a new designer script HERE
# and nowhere else.
BUNDLE_SCRIPTS = ('symbols.js', 'pdf-writer.js', 'skein.js', 'grid-detect.js', 'static-adapter.js', 'canvas-renderer.js', 'image-store.js', 'app.js')

bundle_parts = []
for fname in BUNDLE_SCRIPTS:
    with open(os.path.join(SRC_STATIC, fname), 'r', encoding='utf-8') as f:
        bundle_parts.append(f.read())
bundle = '\n'.join(bundle_parts)

# Prepend the palette generated from palette_manager.py so static-adapter.js
# does not have to carry (and slowly diverge from) a hand-written copy. This is
# prepended rather than added as a file because it guarantees the globals exist
# before any bundled script runs, and keeps it out of the artifact allow-lists.
# Falls back to the adapter's inline table if the import is unavailable.
sys.path.insert(0, os.path.join(ROOT, 'App'))
try:
    import palette_manager  # noqa: E402  (path is set up immediately above)
    bundle = palette_manager.palette_js_source() + bundle
    print(f'  injected palette ({palette_manager.palette_size()} colours, '
          f'{palette_manager.floss_size()} floss entries)')
except Exception as exc:  # pragma: no cover - build-time guard
    print(f'  WARNING: could not generate the palette ({exc}); '
          f'static-adapter.js will use its inline fallback table')

with open(os.path.join(OUT_DIR, 'app.bundle.js'), 'w', encoding='utf-8') as f:
    f.write(bundle)
print(f'  wrote   app.bundle.js ({len(bundle)} bytes)')

# Remove any stale copies of the individual scripts from a previous build
for stale in BUNDLE_SCRIPTS:
    stale_path = os.path.join(OUT_DIR, stale)
    if os.path.exists(stale_path):
        os.remove(stale_path)

# Replace the individual <script> tags with the single bundle tag.
# This used to be an exact-string .replace(), which silently did nothing the
# moment a new script tag was inserted between the two it matched — and because
# the individual files are deleted from OUT_DIR above, that shipped a site with
# NO scripts at all. Match a whole run of bundled script tags instead
# (any indentation, optional ?v= cache-buster) and hard-fail if the swap
# didn't happen exactly once.
_bundle_tag_re = re.compile(
    r'(?:[ \t]*<script[^>]*\bsrc="(?:%s)(?:\?[^"]*)?"[^>]*>\s*</script>[ \t]*\r?\n?)+'
    % '|'.join(re.escape(n) for n in BUNDLE_SCRIPTS)
)
html, _swaps = _bundle_tag_re.subn('<script src="app.bundle.js"></script>\n', html)
if _swaps != 1:
    raise SystemExit(
        f'ERROR: expected exactly 1 bundled-<script> replacement, got {_swaps}. '
        f'The individual script tags in the template no longer match '
        f'{BUNDLE_SCRIPTS} — the static build would ship with no scripts.'
    )
print(f'  bundled {len(BUNDLE_SCRIPTS)} scripts into 1 tag')

# Inject Google Analytics (GA4) and Cloudflare Web Analytics into <head> —
# static site only, not the server app.
html = html.replace(
    '</head>',
    ga_snippet(GA_MEASUREMENT_ID) + cf_snippet(CF_ANALYTICS_TOKEN) + '\n</head>',
    1,
)

# ── 2c. Cache-busting ───────────────────────────────────────────────
# VERSION is computed before the static-asset copy so sw.js can carry it too.
html = html.replace('href="style.css"', 'href="style.css?v=' + VERSION + '"')
html = html.replace('src="app.bundle.js"', 'src="app.bundle.js?v=' + VERSION + '"')
# tool-common.js is NOT bundled (the four tool pages load it standalone), so the
# designer's copy needs its own cache-buster.
html = html.replace('src="tool-common.js"', 'src="tool-common.js?v=' + VERSION + '"')
html = html.replace('src="pwa.js"', 'src="pwa.js?v=' + VERSION + '"')
print(f'  cache-bust v{VERSION}')

# Rewrite the header app-switcher links for the flat static site layout.
# (each /<tool> route -> <tool>.html, / -> ./)
html = rewrite_static_links(html)

# ── 3. Write the generated index.html ──
out_html = os.path.join(OUT_DIR, 'index.html')
with open(out_html, 'w', encoding='utf-8') as f:
    f.write(html)
print(f'  wrote   index.html')

# ── 3b. Client-side tool pages (Pixelator / Resizer / Palette / ASCII) ──
# Each tool is fully client-side, so its standalone script is copied as-is.
for route, template, key, script in TOOLS:
    out_tool = os.path.join(OUT_DIR, template)
    with open(out_tool, 'w', encoding='utf-8') as f:
        f.write(transform_tool(route, template, key, script))
    print(f'  wrote   {template}')
    shutil.copy(os.path.join(SRC_STATIC, script), os.path.join(OUT_DIR, script))
    print(f'  copied  {script}')

# ── 3c. Crawler files: robots.txt + sitemap.xml ──
# Generated from config.json rather than copied as plain files, so the sitemap
# can only ever list pages this build actually wrote. App/seo_files.py is the
# same generator app.py serves, so the two builds cannot drift apart.
#
# GitHub Pages adds no robots.txt of its own (a missing file is a 404, which
# crawlers read as "allow all"), so both files have to be emitted here.
from seo_files import crawler_files  # noqa: E402  (App/ is on sys.path above)

for _crawler_name, _crawler_text in crawler_files(
        FULL_CONFIG, lastmod=time.strftime('%Y-%m-%d')).items():
    with open(os.path.join(OUT_DIR, _crawler_name), 'w', encoding='utf-8') as f:
        f.write(_crawler_text)
    print(f'  wrote   {_crawler_name}')

# ── 4. Custom domain file for GitHub Pages (pins the stitchee.ca domain) ──
with open(os.path.join(OUT_DIR, 'CNAME'), 'w', encoding='utf-8') as f:
    f.write('stitchee.ca\n')
print('  wrote   CNAME')

print(f'\nSite built → {OUT_DIR}')
