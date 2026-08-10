#!/usr/bin/env python3
"""
build_demo.py - generates the static GitHub Pages demo from the live Flask app.

What it does
------------
1. Reads App/templates/index.html and strips all Flask template syntax.
2. Removes the AI Design tab and auth-related script tags.
3. Injects demo-adapter.js (static API shim) before canvas-renderer.js.
4. Copies the required static assets into _demo/.

The resulting _demo/ directory is a fully self-contained static site:
  - No Python / Flask required.
  - No accounts; localStorage is used for project storage.
  - No AI features.
  - Image upload works client-side via the Canvas API.
"""

import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC_STATIC   = os.path.join(ROOT, 'App', 'static')
SRC_TEMPLATE = os.path.join(ROOT, 'App', 'templates', 'index.html')
OUT_DIR      = os.path.join(ROOT, '_demo')

os.makedirs(OUT_DIR, exist_ok=True)

# ── 1. Copy required static assets ──
STATIC_FILES = [
    'style.css',
    'canvas-renderer.js',
    'app.js',
    'demo-adapter.js',
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

APP_TITLE = 'Cross Canvas Art Studio'

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

# Remove api-manager.js and auth-widget.js script tags (not needed in demo)
html = re.sub(
    r'\s*<script[^>]*(?:api-manager|auth-widget)\.js[^>]*></script>',
    '',
    html,
)

# Inject demo-adapter.js before canvas-renderer.js
html = html.replace(
    '<script src="canvas-renderer.js"></script>',
    '<script src="demo-adapter.js"></script>\n    <script src="canvas-renderer.js"></script>',
)

# ── 3. Write the generated index.html ──
out_html = os.path.join(OUT_DIR, 'index.html')
with open(out_html, 'w', encoding='utf-8') as f:
    f.write(html)
print(f'  wrote   index.html')

print(f'\nDemo built → {OUT_DIR}')
