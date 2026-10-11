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
import re

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

# ============================================================ palettes =======
# A palette index is only meaningful within its own palette, so every document
# pairs its indices with the palette id that owns them:
#
#   'yarn'  curated craft-yarn palette (DEFAULT_PALETTE, indices 0..n-1)
#   'dmc'   full real DMC floss library (built from the floss table)
#
# Kept as separate index spaces rather than one merged array: the yarn palette
# guarantees a distinct print glyph per colour (`SYMBOL_COUNT >= palette_size()`),
# which 65 glyphs cannot do for 500+ colours -- so DMC repeats glyphs instead.
PALETTE_YARN = 'yarn'
PALETTE_DMC = 'dmc'
PALETTE_PANTONE = 'pantone'
DEFAULT_PALETTE_ID = PALETTE_YARN

# The Pantone palette comes from the local, NON-COMMITTED colour database at
# data/color_conversions.ndjson (proprietary reference data, so it is never
# shipped). Absent is normal: the palette is then simply not offered.
COLOR_DB_PATH = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), os.pardir, 'data',
    'color_conversions.ndjson'))

# Pantone collection slugs -> human family labels for the palette panel.
_PANTONE_FAMILIES = {
    'coated': 'Pantone Coated',
    'uncoated': 'Pantone Uncoated',
    'metallic': 'Pantone Metallic',
    'pastels-neons': 'Pantone Pastels & Neons',
    'skin': 'Pantone Skin',
    'color-of-year': 'Pantone Color of the Year',
}

# Symbol glyph assignment. The glyph GEOMETRY lives in App/static/symbols.js
# (it has to be drawable by the canvas, SVG and PDF backends), while this module
# owns only the palette-entry -> glyph-index mapping. Every entry gets its own
# distinct glyph so any two colours in a chart stay tellable apart when the
# chart is printed in greyscale.
SYMBOL_COUNT = 65  # keep in sync with the SYMBOLS table in App/static/symbols.js

for _i, _entry in enumerate(DEFAULT_PALETTE):
    # Modulo keeps this safe if the palette ever outgrows the glyph table.
    _entry['symbol'] = _i % SYMBOL_COUNT
    _entry['palette'] = PALETTE_YARN

_palette_rgb = None   # (P, 3) float
_palette_lab = None   # (P, 3) float

# The DMC palette is derived from the floss table, so it is built lazily and
# invalidated whenever that table reloads.
_dmc_palette = None   # list of palette-entry dicts
_dmc_lab = None       # (N, 3) float

# The Pantone palette is derived from the local colour database, loaded lazily.
_pantone_palette = None   # list of palette-entry dicts
_pantone_lab = None       # (N, 3) float
_pantone_loaded = False

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


def _family_for_code(code):
    """Coarse family for a floss code when the table does not name one.

    Light Effects codes are "E" + digits; everything else is stranded cotton.
    The digit is required because the stranded code "Ecru" also starts with E.
    """
    return 'Light Effects' if re.match(r'^E\d', code or '', re.IGNORECASE) else 'Stranded Cotton'


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
    global _floss_by_code, _preferred, _dmc_palette, _dmc_lab
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
                'family': str(row.get('family') or _family_for_code(code)).strip(),
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
    _dmc_palette = None    # invalidate the derived DMC palette
    _dmc_lab = None
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


def _ensure_dmc_palette():
    """Build (and cache) the DMC palette from the floss table.

    Each floss row becomes a paintable palette entry whose ``dmc`` block is the
    floss itself, so a DMC-painted chart's legend and shopping list are exact
    rather than 'nearest'. An empty floss table yields an empty palette, never
    an exception -- a corrupt file must not take the app down.
    """
    global _dmc_palette, _dmc_lab
    if _dmc_palette is not None:
        return _dmc_palette
    _ensure_floss_cache()
    entries = []
    for i, floss in enumerate(_floss_entries):
        entry = {
            'code': floss['code'],
            'name': floss['name'],
            'hex': floss['hex'],
            'family': floss.get('family') or _family_for_code(floss['code']),
            'index': i,
            'palette': PALETTE_DMC,
            # Glyphs necessarily repeat across a 500-colour library; the yarn
            # palette is where the distinct-glyph guarantee lives (see above).
            'symbol': i % SYMBOL_COUNT,
            'dmc': {
                'code': floss['code'],
                'name': floss['name'],
                'hex': floss['hex'],
                'lab_distance': 0.0,
            },
        }
        entries.append(entry)
    if entries:
        _dmc_lab = rgb_to_lab(
            np.array([hex_to_rgb(e['hex']) for e in entries], dtype=np.float64))
    else:
        _dmc_lab = np.zeros((0, 3))
    _dmc_palette = entries
    return _dmc_palette


def _load_color_db_rows():
    """Read the local colour database (NDJSON), or [] when it is absent."""
    rows = []
    try:
        with open(COLOR_DB_PATH, 'r', encoding='utf-8') as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    continue
    except OSError:
        return []
    return rows


def _ensure_pantone_palette():
    """Build (and cache) the Pantone palette from the local colour database.

    Each Pantone row becomes a paintable entry whose ``dmc`` block carries the
    pre-computed nearest DMC floss, so painting with "Pantone 186 C" still puts a
    buyable DMC code on the legend. An absent or corrupt database yields an empty
    palette, never an exception -- the app simply has no Pantone option.
    """
    global _pantone_palette, _pantone_lab, _pantone_loaded
    if _pantone_loaded:
        return _pantone_palette
    _pantone_loaded = True
    entries = []
    for row in _load_color_db_rows():
        if row.get('system') != 'pantone':
            continue
        code = str(row.get('code') or '').strip()
        hex_value = str(row.get('hex') or '').strip()
        if not code or not hex_value:
            continue
        try:
            hex_to_rgb(hex_value)
        except ValueError:
            continue
        collection = str(row.get('collection') or '').strip()
        entry = {
            'code': code,
            'name': str(row.get('name') or code).strip(),
            'hex': hex_value,
            'family': _PANTONE_FAMILIES.get(
                collection, 'Pantone ' + (collection or 'Other').title()),
            'index': len(entries),
            'palette': PALETTE_PANTONE,
            'symbol': len(entries) % SYMBOL_COUNT,
        }
        dmc_code = row.get('dmc')
        if dmc_code:
            entry['dmc'] = {
                'code': str(dmc_code),
                'name': str(row.get('dmc_name') or dmc_code),
                'hex': str(row.get('dmc_hex') or ''),
                'lab_distance': float(row.get('delta_e') or 0.0),
            }
        entries.append(entry)
    _pantone_lab = (rgb_to_lab(
        np.array([hex_to_rgb(e['hex']) for e in entries], dtype=np.float64))
        if entries else np.zeros((0, 3)))
    _pantone_palette = entries
    return _pantone_palette


def _yarn_entries():
    """The curated yarn palette, each entry carrying its nearest DMC floss."""
    _ensure_floss_map()
    out = []
    for i, entry in enumerate(_PALETTE):
        item = dict(entry, index=i)
        dmc = _palette_floss.get(i)
        if dmc:
            item['dmc'] = dict(dmc)
        out.append(item)
    return out


def _yarn_lab():
    _ensure_cache()
    return _palette_lab


def _dmc_lab_ref():
    _ensure_dmc_palette()
    return _dmc_lab


def _pantone_lab_ref():
    _ensure_pantone_palette()
    return _pantone_lab


# ====================================================== palette sources ======
# Every palette the app can offer, in one table: the id the client stores, the
# label the UI shows, the colour-count ceiling for a generated pattern, and
# loaders for its entries and LAB reference table. Everything else reads this
# instead of branching on the id, so adding a brand is a loader plus one row.
_PALETTE_SOURCES = (
    {'id': PALETTE_YARN, 'label': 'Yarn', 'max_colors': 52,
     'entries': _yarn_entries, 'lab': _yarn_lab},
    {'id': PALETTE_DMC, 'label': 'DMC floss', 'max_colors': 128,
     'entries': _ensure_dmc_palette, 'lab': _dmc_lab_ref},
    {'id': PALETTE_PANTONE, 'label': 'Pantone', 'max_colors': 128,
     'entries': _ensure_pantone_palette, 'lab': _pantone_lab_ref},
)


def _source(palette_id):
    """The registry row for an id, falling back to the default palette."""
    for row in _PALETTE_SOURCES:
        if row['id'] == palette_id:
            return row
    return _PALETTE_SOURCES[0]


def palette_catalog():
    """The available palettes as [{id,label,size,default,max_colors}].

    Derived from the one registry above, so the UI and the matcher can never
    disagree about which palettes exist. A source with no data (no floss table,
    no local Pantone database) is simply not offered.
    """
    catalog = []
    for row in _PALETTE_SOURCES:
        entries = row['entries']()
        if not entries:
            continue
        catalog.append({
            'id': row['id'],
            'label': row['label'],
            'size': len(entries),
            'default': row['id'] == DEFAULT_PALETTE_ID,
            'max_colors': row['max_colors'],
        })
    return catalog


def palette_label(palette_id):
    for item in palette_catalog():
        if item['id'] == palette_id:
            return item['label']
    return palette_id


def is_palette_id(palette_id):
    return any(item['id'] == palette_id for item in palette_catalog())


def get_palette(palette_id=DEFAULT_PALETTE_ID):
    """Return a palette as a list of dicts, each with 'index'.

    ``palette_id='yarn'`` (default) is the curated yarn palette, each entry
    carrying a 'dmc' block naming its nearest real-world floss. ``'dmc'`` is the
    full floss library and ``'pantone'`` the local Pantone deck, where each
    entry's 'dmc' block is the closest buyable floss. An unknown id falls back
    to the default palette.
    """
    return [dict(e) for e in _source(palette_id)['entries']()]


def palette_size(palette_id=DEFAULT_PALETTE_ID):
    return len(_source(palette_id)['entries']())


def get_entry(index, palette_id=DEFAULT_PALETTE_ID):
    entries = get_palette(palette_id)
    if 0 <= index < len(entries):
        return entries[index]
    return None


def code_to_index(palette_id=DEFAULT_PALETTE_ID):
    return {entry['code']: entry['index'] for entry in get_palette(palette_id)}


def nearest_index_for_hex(value, palette_id=DEFAULT_PALETTE_ID):
    """Return the palette index closest to a single hex colour."""
    rgb = np.array([hex_to_rgb(value)], dtype=np.float64)
    return int(nearest_indices(rgb, palette_id=palette_id)[0])


def nearest_indices(rgb, allowed=None, palette_id=DEFAULT_PALETTE_ID):
    """Map an (N, 3) array of RGB colours to nearest palette indices in LAB space.

    allowed: optional iterable of palette indices to restrict the match to.
    palette_id: which palette's index space the result is expressed in.

    Uses a memory-light loop over the (small) palette rather than a big
    broadcast, so it stays cheap even for a 200x200 grid.
    """
    _ensure_cache()
    rgb_arr = np.asarray(rgb, dtype=np.float64)
    if rgb_arr.size == 0:
        return np.array([], dtype=np.int64)

    unique_rgb, inverse_indices = np.unique(rgb_arr, axis=0, return_inverse=True)

    lab = rgb_to_lab(unique_rgb)
    ref_lab = _source(palette_id)['lab']()
    candidates = list(allowed) if allowed is not None else None
    best_idx, _ = _nearest_in(lab, ref_lab, candidates)
    return best_idx[inverse_indices]


def palette_js_source():
    """Return JavaScript that publishes the palette to the static (Pages) build.

    The static build has no server, so its client-side shim would otherwise need
    a hand-maintained copy of the palette -- which had already drifted from this
    module before this function existed. build_site.py injects the result into
    app.bundle.js, making Python the single source of truth for both builds.
    """
    palette = get_palette(PALETTE_YARN)
    meta = floss_meta() or {}
    floss = {
        'enabled': any('dmc' in entry for entry in palette),
        'brand': meta.get('brand') or 'DMC',
        'verified': bool(meta.get('verified')),
        'size': floss_size(),
    }
    palettes = {}
    for row in _PALETTE_SOURCES:
        entries = get_palette(row['id'])
        if entries:
            palettes[row['id']] = entries
    catalog = palette_catalog()
    dump = lambda obj: json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
    return (
        '/* Generated from App/palette_manager.py by build_site.py. Do not edit. */\n'
        # StitchPalette stays the yarn palette so existing readers keep working;
        # StitchPalettes is the full id -> entries map the palette switch needs.
        'window.StitchPalette = ' + dump(palette) + ';\n'
        'window.StitchPalettes = ' + dump(palettes) + ';\n'
        'window.StitchPaletteCatalog = ' + dump(catalog) + ';\n'
        'window.StitchFloss = ' + dump(floss) + ';\n'
    )


def build_legend(index_counts, palette_id=DEFAULT_PALETTE_ID):
    """Given {palette_index: count}, return a sorted legend list (most used first)."""
    entries = get_palette(palette_id)
    legend = []
    for idx, count in index_counts.items():
        try:
            idx = int(idx)
        except (TypeError, ValueError):
            continue
        if idx < 0 or idx >= len(entries) or count <= 0:
            continue
        entry = entries[idx]
        row = {
            'index': idx,
            'code': entry['code'],
            'name': entry['name'],
            'hex': entry['hex'],
            'family': entry.get('family', ''),
            'count': int(count),
        }
        if 'dmc' in entry:
            row['dmc'] = dict(entry['dmc'])
        legend.append(row)
    legend.sort(key=lambda e: e['count'], reverse=True)
    return legend
