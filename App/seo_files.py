"""
seo_files.py - robots.txt and sitemap.xml for Stitchee, generated from config.

Both the Flask app (app.py) and the static GitHub Pages build
(.github/scripts/build_site.py) serve these two files from the SITE ROOT, so a
crawler sees the same thing whichever build answers. They are generated instead
of hand-written so the sitemap can never drift from the pages that exist.


Why the site appeared to have "no" robots.txt
---------------------------------------------
GitHub Pages does not add a robots.txt of its own: with no such file in the
repo, https://stitchee.ca/robots.txt answered 404 - and a 404 is treated by
crawlers as "everything here is allowed", so it was never a blocker either.

What a visitor actually received was Cloudflare's *managed* robots.txt (its
Content Signals Policy). Cloudflare sits in front of GitHub Pages and replaces
the origin file, and that default contains only comments - no Allow or Disallow
lines - so it did not block anything either. Publishing a real file here, and
turning Cloudflare's managed robots.txt off so this one is served, makes the
permission explicit and verifiable.


About Google-Extended
---------------------
Google-Extended is NOT a crawler. It never appears in server logs and will never
show up in analytics: it is a robots.txt token that Googlebot consults when
deciding whether this site's content may be used to train or ground Gemini and
Vertex AI. Naming it below is the explicit "yes" Google looks for; the wildcard
group already allows it, but an explicit group is what the token is designed to
read.
"""

import datetime
import xml.sax.saxutils as _xml

# Standalone tool pages, as used by the header app-switcher. Derived from the
# single tool registry (App/page_context.py) that the Flask routes and the static
# build also consume, so a tool can never appear in one place and not another.
from page_context import TOOL_KEYS as TOOL_PATHS

# Files this module generates, in build order. app.py serves both and
# build_site.py writes both.
CRAWLER_FILES = ('robots.txt', 'sitemap.xml')

# Crawlers worth naming explicitly. The `User-agent: *` group below already
# allows all of them - listing these documents the intent, and the AI crawlers
# look for a group bearing their own name before treating a site as opted in.
NAMED_BOTS = (
    # Google
    'Googlebot',
    'Googlebot-Image',
    'Google-Extended',
    # Other search engines
    'Bingbot',
    'DuckDuckBot',
    'Slurp',
    'Applebot',
    'Applebot-Extended',
    # AI / LLM crawlers
    'GPTBot',
    'OAI-SearchBot',
    'ChatGPT-User',
    'ClaudeBot',
    'Claude-User',
    'anthropic-ai',
    'PerplexityBot',
    'Perplexity-User',
    'Google-CloudVertexBot',
    'Amazonbot',
    'Meta-ExternalAgent',
    'CCBot',
)


def site_root(config):
    """The site's base URL, always with a trailing slash."""
    seo = config.get('seo', {}) or {}
    base = (seo.get('url') or '').strip() or 'https://stitchee.ca/'
    return base if base.endswith('/') else base + '/'


def page_urls(config):
    """[(path, absolute URL)] for the designer plus every tool page.

    The home page's path is '' so callers can tell it apart from the tools.
    Tool URLs come from each tool's `seo_url` in config.json (which is also what
    its <link rel="canonical"> uses), falling back to root + route.
    """
    root = site_root(config)
    pages = [('', root)]
    for path in TOOL_PATHS:
        tool = config.get(path, {}) or {}
        url = (tool.get('seo_url') or '').strip() or (root + path)
        pages.append((path, url))
    return pages


def robots_txt(config):
    """A permissive robots.txt: everything public, nothing disallowed."""
    root = site_root(config)
    lines = [
        '# robots.txt for Stitchee - ' + root,
        '#',
        '# Everything on this site is public and is meant to be crawled and',
        '# indexed, including by AI / LLM crawlers. Nothing is disallowed.',
        '#',
        '# Google-Extended is not a crawler of its own - it is the robots.txt',
        '# token Googlebot reads to decide whether this content may be used to',
        '# train or ground Gemini / Vertex AI. It is named below so that',
        '# question is answered with an explicit yes.',
        '',
        'User-agent: *',
        'Allow: /',
        'Content-Signal: search=yes, ai-input=yes, ai-train=yes',
    ]
    for bot in NAMED_BOTS:
        lines += ['', 'User-agent: ' + bot, 'Allow: /']
    lines += [
        '',
        'Sitemap: ' + root + 'sitemap.xml',
        '',
    ]
    return '\n'.join(lines)


def sitemap_xml(config, lastmod=None):
    """A sitemap listing the designer and every tool page."""
    lastmod = lastmod or datetime.date.today().isoformat()
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for _path, url in page_urls(config):
        lines += [
            '  <url>',
            '    <loc>' + _xml.escape(url) + '</loc>',
            '    <lastmod>' + _xml.escape(lastmod) + '</lastmod>',
            '  </url>',
        ]
    lines += ['</urlset>', '']
    return '\n'.join(lines)


def crawler_files(config, lastmod=None):
    """{'robots.txt': text, 'sitemap.xml': text} - what build_site.py writes."""
    return {
        'robots.txt': robots_txt(config),
        'sitemap.xml': sitemap_xml(config, lastmod),
    }
