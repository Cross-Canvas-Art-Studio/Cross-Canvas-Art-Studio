"""
Palette Manager - the curated worsted-weight yarn colour palette plus fast
nearest-colour matching in CIELAB space.

The palette defined here is the single source of truth for the whole app. Both
the image analyser and the LLM design generator map colours onto these entries,
and the frontend renders the legend from the same list (delivered via
/api/config). Colours are approximations of common craft yarn shades and are
brand-neutral.
"""

import json
import logging
import os

import numpy as np

logger = logging.getLogger(__name__)

# Curated DMC floss reference table (see the file itself for its caveats).
FLOSS_TABLE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'floss_dmc.json')

# code, name, hex, family
DEFAULT_PALETTE = [
    # Neutrals
    {"code": "WHT", "name": "White", "hex": "#FFFFFF", "family": "Neutral"},
    {"code": "SNW", "name": "Snow", "hex": "#F7F4EC", "family": "Neutral"},
    {"code": "ARN", "name": "Aran", "hex": "#EFE6CE", "family": "Neutral"},
    {"code": "CRM", "name": "Cream", "hex": "#F3E7C0", "family": "Neutral"},
    {"code": "BUF", "name": "Buff", "hex": "#E4D5A8", "family": "Neutral"},
    {"code": "OAT", "name": "Oatmeal", "hex": "#D8CBB0", "family": "Neutral"},
    {"code": "SLV", "name": "Silver", "hex": "#C9CDD2", "family": "Neutral"},
    {"code": "LGY", "name": "Light Grey", "hex": "#AAB0B6", "family": "Neutral"},
    {"code": "GRY", "name": "Grey", "hex": "#8A9099", "family": "Neutral"},
    {"code": "STL", "name": "Steel", "hex": "#6E747C", "family": "Neutral"},
    {"code": "CHL", "name": "Charcoal", "hex": "#3E4247", "family": "Neutral"},
    {"code": "BLK", "name": "Black", "hex": "#1A1A1A", "family": "Neutral"},
    # Reds & Pinks
    {"code": "CHY", "name": "Cherry", "hex": "#C1272D", "family": "Red / Pink"},
    {"code": "RED", "name": "Red", "hex": "#E01B22", "family": "Red / Pink"},
    {"code": "BRG", "name": "Burgundy", "hex": "#6E1E2A", "family": "Red / Pink"},
    {"code": "COR", "name": "Coral", "hex": "#F2664F", "family": "Red / Pink"},
    {"code": "WML", "name": "Watermelon", "hex": "#F04E6E", "family": "Red / Pink"},
    {"code": "ROS", "name": "Rose", "hex": "#E68FA6", "family": "Red / Pink"},
    {"code": "PNK", "name": "Pink", "hex": "#F6C6D4", "family": "Red / Pink"},
    {"code": "HPK", "name": "Hot Pink", "hex": "#E93E97", "family": "Red / Pink"},
    {"code": "ORC", "name": "Orchid", "hex": "#C86FB0", "family": "Red / Pink"},
    # Oranges, Yellows & Browns
    {"code": "PMP", "name": "Pumpkin", "hex": "#E8722A", "family": "Orange / Yellow / Brown"},
    {"code": "ORG", "name": "Orange", "hex": "#F5921B", "family": "Orange / Yellow / Brown"},
    {"code": "GLD", "name": "Gold", "hex": "#F2B705", "family": "Orange / Yellow / Brown"},
    {"code": "YEL", "name": "Yellow", "hex": "#F6D915", "family": "Orange / Yellow / Brown"},
    {"code": "CRN", "name": "Cornsilk", "hex": "#F3E79A", "family": "Orange / Yellow / Brown"},
    {"code": "CML", "name": "Camel", "hex": "#C79A5B", "family": "Orange / Yellow / Brown"},
    {"code": "BRN", "name": "Brown", "hex": "#8A5A2B", "family": "Orange / Yellow / Brown"},
    {"code": "COF", "name": "Coffee", "hex": "#5A3B22", "family": "Orange / Yellow / Brown"},
    {"code": "CHO", "name": "Chocolate", "hex": "#3B2A20", "family": "Orange / Yellow / Brown"},
    # Greens
    {"code": "LIM", "name": "Lime", "hex": "#8DC63F", "family": "Green"},
    {"code": "SPR", "name": "Spring Green", "hex": "#4FB24A", "family": "Green"},
    {"code": "KEL", "name": "Kelly Green", "hex": "#2E9E4B", "family": "Green"},
    {"code": "HUN", "name": "Hunter", "hex": "#1E6B3A", "family": "Green"},
    {"code": "FOR", "name": "Forest", "hex": "#14532B", "family": "Green"},
    {"code": "SAG", "name": "Sage", "hex": "#A6B98C", "family": "Green"},
    {"code": "OLV", "name": "Olive", "hex": "#7A7B2E", "family": "Green"},
    {"code": "MNT", "name": "Mint", "hex": "#B7E4C7", "family": "Green"},
    {"code": "TEA", "name": "Teal", "hex": "#1E8A7A", "family": "Green"},
    # Blues
    {"code": "AQU", "name": "Aqua", "hex": "#4FC3C7", "family": "Blue"},
    {"code": "TRQ", "name": "Turquoise", "hex": "#17A2B8", "family": "Blue"},
    {"code": "SKY", "name": "Sky", "hex": "#7EC8E3", "family": "Blue"},
    {"code": "LBL", "name": "Light Blue", "hex": "#A9CCE3", "family": "Blue"},
    {"code": "CFL", "name": "Cornflower", "hex": "#5B8DEF", "family": "Blue"},
    {"code": "BLU", "name": "Blue", "hex": "#2E6FDA", "family": "Blue"},
    {"code": "ROY", "name": "Royal", "hex": "#1E3FA0", "family": "Blue"},
    {"code": "NVY", "name": "Navy", "hex": "#15224B", "family": "Blue"},
    {"code": "DEN", "name": "Denim", "hex": "#3E5C76", "family": "Blue"},
    # Purples
    {"code": "LAV", "name": "Lavender", "hex": "#C8A2D6", "family": "Purple"},
    {"code": "AMY", "name": "Amethyst", "hex": "#9B59B6", "family": "Purple"},
    {"code": "PUR", "name": "Purple", "hex": "#7A3EA1", "family": "Purple"},
    {"code": "PLM", "name": "Plum", "hex": "#5E2B69", "family": "Purple"},
    {"code": "GRP", "name": "Grape", "hex": "#3F1D5A", "family": "Purple"},
]

_PALETTE = DEFAULT_PALETTE

# Symbol glyph assignment. The glyph GEOMETRY lives in App/static/symbols.js
# (it has to be drawable by the canvas, SVG and PDF backends), while this module
# owns only the palette-entry -> glyph-index mapping. Every entry gets its own
# distinct glyph so any two colours in a chart stay tellable apart when the
# chart is printed in greyscale.
SYMBOL_COUNT = 65  # keep in sync with the SYMBOLS table in App/static/symbols.js

for _i, _entry in enumerate(DEFAULT_PALETTE):
    # Modulo keeps this safe if the palette ever outgrows the glyph table.
    _entry['symbol'] = _i % SYMBOL_COUNT

_palette_rgb = None   # (P, 3) float
_palette_lab = None   # (P, 3) float

# Floss tables are loaded lazily so a missing/corrupt file never breaks startup.
_floss_entries = None  # list of {'code','name','hex','index'}
_floss_lab = None      # (F, 3) float
_floss_meta = None     # dict of table metadata
_floss_by_code = {}    # {'310': entry}
_preferred = {}        # palette code -> floss code (semantic overrides)
_palette_floss = None  # {palette_index: {'code','name','hex','lab_distance'}}


def hex_to_rgb(value):
    """Convert '#RRGGBB' (or 'RRGGBB') to an (r, g, b) tuple of ints 0-255."""
    value = (value or '').strip().lstrip('#')
    if len(value) == 3:
        value = ''.join(c * 2 for c in value)
    if len(value) != 6:
        raise ValueError(f'Invalid hex colour: {value!r}')
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def _srgb_to_linear(channel):
    c = channel / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def rgb_to_lab(rgb):
    """Vectorised sRGB (D65) -> CIELAB. Accepts any array shaped (..., 3)."""
    rgb = np.asarray(rgb, dtype=np.float64)
    r = _srgb_to_linear(rgb[..., 0])
    g = _srgb_to_linear(rgb[..., 1])
    b = _srgb_to_linear(rgb[..., 2])

    x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
    y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
    z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041

    x = x / 0.95047
    y = y / 1.00000
    z = z / 1.08883

    delta = 6.0 / 29.0

    def f(t):
        return np.where(t > delta ** 3, np.cbrt(t), t / (3 * delta * delta) + 4.0 / 29.0)

    fx, fy, fz = f(x), f(y), f(z)
    lab_l = 116.0 * fy - 16.0
    lab_a = 500.0 * (fx - fy)
    lab_b = 200.0 * (fy - fz)
    return np.stack([lab_l, lab_a, lab_b], axis=-1)


def _ensure_cache():
    global _palette_rgb, _palette_lab
    if _palette_rgb is None or _palette_lab is None:
        rgb = np.array([hex_to_rgb(c['hex']) for c in _PALETTE], dtype=np.float64)
        _palette_rgb = rgb
        _palette_lab = rgb_to_lab(rgb)


def _nearest_in(lab, ref_lab, candidates=None):
    """Nearest row of `ref_lab` for every row of `lab`, in squared LAB distance.

    Returns (best_idx, best_dist) as parallel arrays. Ties keep the lowest
    reference index because the comparison is strictly '<'. The loop (rather
    than a big broadcast) keeps memory flat, which matters for large grids.
    """
    n = lab.shape[0]
    best_dist = np.full(n, np.inf)
    best_idx = np.zeros(n, dtype=np.int64)
    for i in (range(ref_lab.shape[0]) if candidates is None else candidates):
        diff = lab - ref_lab[i]
        dist = np.einsum('ij,ij->i', diff, diff)
        mask = dist < best_dist
        best_dist[mask] = dist[mask]
        best_idx[mask] = i
    return best_idx, best_dist


def _ensure_floss_cache():
    if _floss_entries is None:
        load_floss_table()


def load_floss_table(path=None):
    """Load the floss reference table. Returns the entry count (0 on failure).

    A missing or malformed file is a warning, never a crash: the app simply
    runs without DMC annotations, exactly as it did before this existed.
    """
    global _floss_entries, _floss_lab, _floss_meta, _palette_floss
    global _floss_by_code, _preferred
    target = path or FLOSS_TABLE_PATH
    entries = []
    meta = {}
    preferred = {}
    try:
        with open(target, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
    except (OSError, ValueError) as exc:
        logger.warning('Floss table unavailable (%s): %s', target, exc)
    else:
        rows = data.get('colours') or []
        for row in rows:
            code = str(row.get('code', '')).strip()
            hex_value = str(row.get('hex', '')).strip()
            if not code or not hex_value:
                continue
            try:
                hex_to_rgb(hex_value)
            except ValueError:
                logger.warning('Skipping floss entry with bad hex: %r', row)
                continue
            entries.append({
                'code': code,
                'name': str(row.get('name') or code).strip(),
                'hex': hex_value,
                'index': len(entries),
            })
        meta = {k: data.get(k) for k in
                ('brand', 'version', 'verified', 'strands_per_skein', 'skein_metres')}
        raw_preferred = data.get('preferred') or {}
        if isinstance(raw_preferred, dict):
            preferred = {str(k): str(v) for k, v in raw_preferred.items()}
        if not entries:
            logger.warning('Floss table contained no usable entries: %s', target)

    _floss_entries = entries
    _floss_meta = meta
    _preferred = preferred
    _floss_by_code = {e['code']: e for e in entries}
    _floss_lab = (rgb_to_lab(np.array([hex_to_rgb(e['hex']) for e in entries], dtype=np.float64))
                  if entries else np.zeros((0, 3)))
    _palette_floss = None  # invalidate the derived palette mapping
    return len(entries)


def floss_size():
    _ensure_floss_cache()
    return len(_floss_entries)


def get_floss():
    """Return the floss table as a list of dicts, or [] when unavailable."""
    _ensure_floss_cache()
    return [dict(e) for e in _floss_entries]


def floss_meta():
    """Return table metadata (brand, verification state, skein defaults)."""
    _ensure_floss_cache()
    return dict(_floss_meta or {})


def _ensure_floss_map():
    """Cache the palette -> nearest-floss mapping (empty when no table)."""
    global _palette_floss
    if _palette_floss is not None:
        return
    _ensure_cache()
    _ensure_floss_cache()
    if not _floss_entries:
        _palette_floss = {}
        return
    best_idx, best_dist = _nearest_in(_palette_lab, _floss_lab)
    # Apply reviewed semantic overrides, keeping the reported distance honest
    # by recomputing it against the pinned floss entry.
    for i, entry in enumerate(_PALETTE):
        forced = _preferred.get(entry['code'])
        if forced and forced in _floss_by_code:
            j = _floss_by_code[forced]['index']
            best_idx[i] = j
            best_dist[i] = float(np.sum((_palette_lab[i] - _floss_lab[j]) ** 2))
    mapping = {}
    for i in range(len(_PALETTE)):
        floss = _floss_entries[int(best_idx[i])]
        mapping[i] = {
            'code': floss['code'],
            'name': floss['name'],
            'hex': floss['hex'],
            'lab_distance': round(float(np.sqrt(best_dist[i])), 2),
        }
    _palette_floss = mapping


def nearest_floss_for_hex(value):
    """Return the closest floss entry for one hex colour, or None."""
    _ensure_floss_cache()
    if not _floss_entries:
        return None
    lab = rgb_to_lab(np.array([hex_to_rgb(value)], dtype=np.float64))
    best_idx, best_dist = _nearest_in(lab, _floss_lab)
    floss = _floss_entries[int(best_idx[0])]
    return {
        'code': floss['code'],
        'name': floss['name'],
        'hex': floss['hex'],
        'index': floss['index'],
        'lab_distance': round(float(np.sqrt(best_dist[0])), 2),
    }


def get_palette():
    """Return the palette as a list of dicts, each with 'index' and, when a
    floss table is loaded, a 'dmc' block naming the nearest real-world floss."""
    _ensure_floss_map()
    palette = []
    for i, entry in enumerate(_PALETTE):
        item = dict(entry, index=i)
        dmc = _palette_floss.get(i)
        if dmc:
            item['dmc'] = dict(dmc)
        palette.append(item)
    return palette


def palette_size():
    return len(_PALETTE)


def get_entry(index):
    if 0 <= index < len(_PALETTE):
        return _PALETTE[index]
    return None


def code_to_index():
    return {entry['code']: i for i, entry in enumerate(_PALETTE)}


def nearest_index_for_hex(value):
    """Return the palette index closest to a single hex colour."""
    rgb = np.array([hex_to_rgb(value)], dtype=np.float64)
    return int(nearest_indices(rgb)[0])


def nearest_indices(rgb, allowed=None):
    """Map an (N, 3) array of RGB colours to nearest palette indices in LAB space.

    allowed: optional iterable of palette indices to restrict the match to.
    Uses a memory-light loop over the (small) palette rather than a big
    broadcast, so it stays cheap even for a 200x200 grid.
    """
    _ensure_cache()
    rgb_arr = np.asarray(rgb, dtype=np.float64)
    if rgb_arr.size == 0:
        return np.array([], dtype=np.int64)

    unique_rgb, inverse_indices = np.unique(rgb_arr, axis=0, return_inverse=True)

    lab = rgb_to_lab(unique_rgb)
    candidates = list(allowed) if allowed is not None else None
    best_idx, _ = _nearest_in(lab, _palette_lab, candidates)
    return best_idx[inverse_indices]


def palette_js_source():
    """Return JavaScript that publishes the palette to the static (Pages) build.

    The static build has no server, so its client-side shim would otherwise need
    a hand-maintained copy of the palette -- which had already drifted from this
    module before this function existed. build_site.py injects the result into
    app.bundle.js, making Python the single source of truth for both builds.
    """
    palette = get_palette()
    meta = floss_meta() or {}
    floss = {
        'enabled': any('dmc' in entry for entry in palette),
        'brand': meta.get('brand') or 'DMC',
        'verified': bool(meta.get('verified')),
        'size': floss_size(),
    }
    dump = lambda obj: json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
    return (
        '/* Generated from App/palette_manager.py by build_site.py. Do not edit. */\n'
        'window.StitchPalette = ' + dump(palette) + ';\n'
        'window.StitchFloss = ' + dump(floss) + ';\n'
    )


def build_legend(index_counts):
    """Given {palette_index: count}, return a sorted legend list (most used first)."""
    _ensure_floss_map()
    legend = []
    for idx, count in index_counts.items():
        if idx < 0 or idx >= len(_PALETTE) or count <= 0:
            continue
        entry = _PALETTE[idx]
        row = {
            'index': idx,
            'code': entry['code'],
            'name': entry['name'],
            'hex': entry['hex'],
            'family': entry['family'],
            'count': int(count),
        }
        dmc = _palette_floss.get(idx)
        if dmc:
            row['dmc'] = dict(dmc)
        legend.append(row)
    legend.sort(key=lambda e: e['count'], reverse=True)
    return legend
