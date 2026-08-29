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
  - A CNAME file pins the stitchee.ca custom domain for GitHub Pages.
"""

import json
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC_STATIC   = os.path.join(ROOT, 'App', 'static')
SRC_TEMPLATE = os.path.join(ROOT, 'App', 'templates', 'index.html')
CONFIG_PATH  = os.path.join(ROOT, 'App', 'config.json')
OUT_DIR      = os.path.join(ROOT, '_site')

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

os.makedirs(OUT_DIR, exist_ok=True)

# ── 1. Copy required static assets ──
STATIC_FILES = [
    'style.css',
    'apple-touch-icon.png',
    'og-image.png',
]
for fname in STATIC_FILES:
    src = os.path.join(SRC_STATIC, fname)
    if not os.path.exists(src):
        raise FileNotFoundError(f'Missing: {src}')
    shutil.copy(src, os.path.join(OUT_DIR, fname))
    print(f'  copied  {fname}')

# ── 2. Transform HTML template ──
with open(SRC_TEMPLATE, 'r', encoding='utf-8') as f:
    html = f.read()

APP_TITLE = 'Stitchee'

# Replace Jinja template variables
html = html.replace("{{ app_title }}", APP_TITLE)
html = html.replace("{{ 'true' if require_auth else 'false' }}", "false")
html = html.replace("{{ 'true' if ai_enabled else 'false' }}",   "false")

# Replace SEO Jinja variables (title, description, canonical, social)
html = html.replace("{{ seo_title }}", SEO_TITLE)
html = html.replace("{{ seo_description }}", SEO_DESCRIPTION)
html = html.replace("{{ seo_url }}", SEO_URL)
html = html.replace("{{ seo_image }}", SEO_IMAGE)
html = html.replace("{{ seo_site_name }}", SEO_SITE_NAME)

# Replace url_for() with plain relative paths
html = re.sub(
    r"\{\{ url_for\('static', filename='([^']+)'\) \}\}",
    lambda m: m.group(1),
    html,
)

# Remove api-manager.js and auth-widget.js script tags (not needed in static build)
html = re.sub(
    r'\s*<script[^>]*(?:api-manager|auth-widget)\.js[^>]*></script>',
    '',
    html,
)

# ── 2b. Bundle the local scripts into a single app.bundle.js ──
# Order matters: static-adapter.js (API shim) first, then canvas-renderer.js
# (defines CrossStitchCanvas), then app.js (UI controller). All three are
# IIFEs, so concatenation is safe.
bundle_parts = []
for fname in ('static-adapter.js', 'canvas-renderer.js', 'app.js'):
    with open(os.path.join(SRC_STATIC, fname), 'r', encoding='utf-8') as f:
        bundle_parts.append(f.read())
bundle = '\n'.join(bundle_parts)
with open(os.path.join(OUT_DIR, 'app.bundle.js'), 'w', encoding='utf-8') as f:
    f.write(bundle)
print(f'  wrote   app.bundle.js ({len(bundle)} bytes)')

# Remove any stale copies of the individual scripts from a previous build
for stale in ('static-adapter.js', 'canvas-renderer.js', 'app.js'):
    stale_path = os.path.join(OUT_DIR, stale)
    if os.path.exists(stale_path):
        os.remove(stale_path)

# Replace the individual <script> tags (canvas-renderer.js + app.js, the
# static-adapter.js tag is added by this build) with the single bundle tag
html = html.replace(
    '<script src="canvas-renderer.js"></script>\n    <script src="app.js"></script>',
    '<script src="app.bundle.js"></script>',
)

# Inject Google Analytics (GA4) and Cloudflare Web Analytics into <head> —
# static site only, not the server app.
html = html.replace(
    '</head>',
    ga_snippet(GA_MEASUREMENT_ID) + cf_snippet(CF_ANALYTICS_TOKEN) + '\n</head>',
    1,
)

# ── 3. Write the generated index.html ──
out_html = os.path.join(OUT_DIR, 'index.html')
with open(out_html, 'w', encoding='utf-8') as f:
    f.write(html)
print(f'  wrote   index.html')

# ── 4. Custom domain file for GitHub Pages (pins the stitchee.ca domain) ──
with open(os.path.join(OUT_DIR, 'CNAME'), 'w', encoding='utf-8') as f:
    f.write('stitchee.ca\n')
print('  wrote   CNAME')

print(f'\nSite built → {OUT_DIR}')
