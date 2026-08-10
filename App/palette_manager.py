"""
Palette Manager - the curated worsted-weight yarn colour palette plus fast
nearest-colour matching in CIELAB space.

The palette defined here is the single source of truth for the whole app. Both
the image analyser and the LLM design generator map colours onto these entries,
and the frontend renders the legend from the same list (delivered via
/api/config). Colours are approximations of common craft yarn shades and are
brand-neutral.
"""

import logging

import numpy as np

logger = logging.getLogger(__name__)

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
_palette_rgb = None   # (P, 3) float
_palette_lab = None   # (P, 3) float


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


def get_palette():
    """Return the palette as a list of dicts, each with an added 'index'."""
    return [dict(entry, index=i) for i, entry in enumerate(_PALETTE)]


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

    # Optimization (Bolt): Deduplicate RGB values to drastically reduce the number
    # of CIELAB conversions and expensive loop-based distance comparisons.
    unique_rgb, inverse_indices = np.unique(rgb_arr, axis=0, return_inverse=True)

    lab = rgb_to_lab(unique_rgb)
    n = lab.shape[0]
    candidates = list(allowed) if allowed is not None else range(len(_PALETTE))

    best_dist = np.full(n, np.inf)
    best_idx = np.zeros(n, dtype=np.int64)
    for i in candidates:
        pl = _palette_lab[i]
        diff = lab - pl
        dist = np.einsum('ij,ij->i', diff, diff)
        mask = dist < best_dist
        best_dist[mask] = dist[mask]
        best_idx[mask] = i
    return best_idx[inverse_indices]


def build_legend(index_counts):
    """Given {palette_index: count}, return a sorted legend list (most used first)."""
    legend = []
    for idx, count in index_counts.items():
        if idx < 0 or idx >= len(_PALETTE) or count <= 0:
            continue
        entry = _PALETTE[idx]
        legend.append({
            'index': idx,
            'code': entry['code'],
            'name': entry['name'],
            'hex': entry['hex'],
            'family': entry['family'],
            'count': int(count),
        })
    legend.sort(key=lambda e: e['count'], reverse=True)
    return legend
