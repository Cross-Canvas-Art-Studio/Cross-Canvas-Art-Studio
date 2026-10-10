"""
Page context - the single source of truth for what each template renders.

Both the Flask app (``App/app.py``) and the static build
(``.github/scripts/build_site.py``) render the same five templates, and every
page now extends ``base.html``. Keeping the per-page context in one place means
a page added, a title changed, or a subtitle edited cannot make the two builds
disagree -- the same drift the palette injection already guards against.

The templates read these names directly, so rename them only together with the
templates.
"""

# Per-page display strings that are not sourced from config.json. Keep in sync
# with base.html (which reads ``brand_suffix``, ``brand_subtitle``,
# ``jsonld_name``, ``footer_blurb``, ``nav_active`` and ``is_designer``).
_PAGE_META = {
    'index': {
        'nav_active': 'stitchee',
        'brand_suffix': 'Free cross-stitch pattern maker and yarn canvas designer',
        'brand_subtitle': 'Cross-stitch yarn canvas designer',
        'jsonld_suffix': '',            # -> "<site name>" with no suffix
        'footer_blurb': (
            'Stitchee \u00b7 Cross Canvas Art Studio \u2014 turn photos and ideas '
            'into printable cross-stitch yarn canvas patterns, free and straight '
            'in your browser.'
        ),
        'is_designer': True,
    },
    'pixelator': {
        'nav_active': 'pixelator',
        'brand_suffix': 'Free online image pixelizer and AI-free de-pixelator',
        'brand_subtitle': 'Pixel art & mosaic image tool',
        'jsonld_suffix': 'Pixelator',
        'footer_blurb': (
            'Pixelator by Cross Canvas Art Studio \u2014 pixelate or enhance photos '
            'and images in your browser without uploading them.'
        ),
        'is_designer': False,
    },
    'resizer': {
        'nav_active': 'resizer',
        'brand_suffix': 'Free online image resizer and compressor',
        'brand_subtitle': 'Resize, compress & convert images',
        'jsonld_suffix': 'Resizer',
        'footer_blurb': (
            'Resizer by Cross Canvas Art Studio \u2014 resize, compress and convert '
            'images to PNG, JPEG or WEBP, free and straight in your browser.'
        ),
        'is_designer': False,
    },
    'palette': {
        'nav_active': 'palette',
        'brand_suffix': 'Free color palette extractor from images',
        'brand_subtitle': 'Extract colour palettes from images',
        'jsonld_suffix': 'Palette',
        'footer_blurb': (
            'Palette by Cross Canvas Art Studio \u2014 extract the dominant colours '
            'from any image, copy hex codes and export CSS or JSON, free and '
            'straight in your browser.'
        ),
        'is_designer': False,
    },
    'ascii': {
        'nav_active': 'ascii',
        'brand_suffix': 'Free ASCII art generator from images',
        'brand_subtitle': 'Turn images into ASCII art',
        'jsonld_suffix': 'ASCII Art',
        'footer_blurb': (
            'ASCII Art by Cross Canvas Art Studio \u2014 convert any photo into '
            'retro ASCII art, copy it or download it as text or colored HTML, '
            'free and straight in your browser.'
        ),
        'is_designer': False,
    },
}

# The single source of truth for the four client-side tool pages, in nav order:
# (route, template, config key, standalone script). Everything derives from this
# - the Flask routes (app.py), the static build's render/copy list
# (build_site.py) and the sitemap (seo_files.py) - so a tool cannot be added to
# one build and forgotten in another.
TOOLS = (
    ('pixelator', 'pixelator.html', 'pixelator', 'pixelator.js'),
    ('resizer',   'resizer.html',   'resizer',   'resizer.js'),
    ('palette',   'palette.html',   'palette',   'palette.js'),
    ('ascii',     'ascii.html',     'ascii',     'ascii.js'),
)
TOOL_KEYS = tuple(t[2] for t in TOOLS)


def page_context(config, key, *, require_auth=False, ai_enabled=False):
    """Return the full Jinja render context for one page key.

    ``key`` is ``'index'`` or one of :data:`TOOL_KEYS`. ``config`` is the parsed
    ``App/config.json``. The same dict feeds ``render_template`` in Flask and the
    Jinja environment in the static build.
    """
    meta = _PAGE_META[key]
    seo = config.get('seo', {}) or {}
    site_name = seo.get('site_name', 'Stitchee')

    if key == 'index':
        app_cfg = config.get('app', {}) or {}
        app_title = app_cfg.get('title', 'Stitchee')
        seo_title = seo.get(
            'title',
            'Stitchee \u2014 Free Cross-Stitch Pattern Maker and Yarn Canvas Designer',
        )
        seo_description = seo.get(
            'description',
            'Turn photos and ideas into cross-stitch yarn canvas patterns.',
        )
        seo_url = seo.get('url', '')
        seo_image = seo.get('image', '')
    else:
        tool = config.get(key, {}) or {}
        app_title = tool.get('title', key.title())
        seo_title = tool.get('seo_title', '')
        seo_description = tool.get('seo_description', '')
        seo_url = tool.get('seo_url') or (seo.get('url', '').rstrip('/') + '/' + key)
        seo_image = seo.get('image', '')

    jsonld_suffix = meta['jsonld_suffix']
    jsonld_name = (site_name + ' ' + jsonld_suffix).strip() if jsonld_suffix else site_name

    return {
        'app_title': app_title,
        'seo_title': seo_title,
        'seo_description': seo_description,
        'seo_url': seo_url,
        'seo_image': seo_image,
        'seo_site_name': site_name,
        'jsonld_name': jsonld_name,
        'nav_active': meta['nav_active'],
        'brand_suffix': meta['brand_suffix'],
        'brand_subtitle': meta['brand_subtitle'],
        'footer_blurb': meta['footer_blurb'],
        'is_designer': meta['is_designer'],
        'require_auth': require_auth,
        'ai_enabled': ai_enabled,
    }
