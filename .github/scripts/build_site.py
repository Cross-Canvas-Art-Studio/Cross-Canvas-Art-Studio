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
"""

import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC_STATIC   = os.path.join(ROOT, 'App', 'static')
SRC_TEMPLATE = os.path.join(ROOT, 'App', 'templates', 'index.html')
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

os.makedirs(OUT_DIR, exist_ok=True)

# ── 1. Copy required static assets ──
STATIC_FILES = [
    'style.css',
    'canvas-renderer.js',
    'app.js',
    'static-adapter.js',
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

# Inject static-adapter.js before canvas-renderer.js
html = html.replace(
    '<script src="canvas-renderer.js"></script>',
    '<script src="static-adapter.js"></script>\n    <script src="canvas-renderer.js"></script>',
)

# Inject Google Analytics (GA4) into <head> — static site only, not the server app
html = html.replace('</head>', ga_snippet(GA_MEASUREMENT_ID) + '\n</head>', 1)

# ── 3. Write the generated index.html ──
out_html = os.path.join(OUT_DIR, 'index.html')
with open(out_html, 'w', encoding='utf-8') as f:
    f.write(html)
print(f'  wrote   index.html')

print(f'\nSite built → {OUT_DIR}')
