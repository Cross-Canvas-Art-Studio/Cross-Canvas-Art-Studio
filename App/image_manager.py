"""
Image Manager - converts an uploaded image into a cross-stitch grid.

The pipeline is: decode -> (EXIF-orient) -> resize to the requested stitch grid
-> map every cell to the nearest yarn colour in CIELAB space -> optionally
reduce the number of distinct yarns to keep the legend practical. Fully
transparent cells become empty (-1) so logos / cut-outs stay unstitched.
"""

import io
import logging

import numpy as np
from PIL import Image, ImageOps

import palette_manager

logger = logging.getLogger(__name__)

# Guard against decompression-bomb images (independent of the stitch grid size).
Image.MAX_IMAGE_PIXELS = 64_000_000

RESAMPLE_MODES = {
    'smooth': Image.LANCZOS,
    'blocky': Image.NEAREST,
    'balanced': Image.BILINEAR,
}


def _clamp(value, low, high, default):
    try:
        value = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, value))


def analyze(image_bytes, width, height, max_colors=16, alpha_threshold=128,
            resample='smooth', min_size=5, max_size=200, palette_max=None):
    """Return a design dict {width, height, grid, legend, stats} for an image.

    grid is a list of `height` rows, each a list of `width` ints where each int
    is a global palette index or -1 for an empty (unstitched) cell.
    """
    width = _clamp(width, min_size, max_size, 60)
    height = _clamp(height, min_size, max_size, 80)
    if palette_max is None:
        palette_max = palette_manager.palette_size()
    max_colors = _clamp(max_colors, 2, palette_max, 16)
    alpha_threshold = _clamp(alpha_threshold, 0, 255, 128)
    resample_filter = RESAMPLE_MODES.get(resample, Image.LANCZOS)

    try:
        image = Image.open(io.BytesIO(image_bytes))
        image = ImageOps.exif_transpose(image)
        image = image.convert('RGBA')
    except Exception as exc:  # noqa: BLE001 - surface a clean error to the caller
        raise ValueError(f'Could not read image: {exc}')

    resized = image.resize((width, height), resample_filter)
    arr = np.asarray(resized, dtype=np.uint8).reshape(-1, 4)
    rgb = arr[:, :3].astype(np.float64)
    alpha = arr[:, 3]

    empty_mask = alpha < alpha_threshold
    idx = np.full(rgb.shape[0], -1, dtype=np.int64)
    if not empty_mask.all():
        idx[~empty_mask] = palette_manager.nearest_indices(rgb[~empty_mask]).astype(np.int64)

    idx = _reduce_colors(idx, rgb, empty_mask, max_colors)

    counts = _count_indices(idx)
    grid = idx.reshape(height, width).tolist()
    legend = palette_manager.build_legend(counts)

    total_cells = width * height
    stitch_count = int((idx >= 0).sum())
    stats = {
        'total_cells': total_cells,
        'stitched_cells': stitch_count,
        'empty_cells': total_cells - stitch_count,
        'color_count': len(legend),
    }
    return {
        'width': width,
        'height': height,
        'grid': grid,
        'legend': legend,
        'stats': stats,
    }


def _reduce_colors(idx, rgb, empty_mask, max_colors):
    """Limit the number of distinct yarns to max_colors, remapping the rest."""
    valid = idx[~empty_mask]
    if valid.size == 0:
        return idx
    unique, counts = np.unique(valid, return_counts=True)
    if unique.size <= max_colors:
        return idx

    order = np.argsort(-counts)
    keep = unique[order[:max_colors]]
    keep_set = set(int(k) for k in keep)

    drop_mask = (~empty_mask) & (~np.isin(idx, list(keep_set)))
    if drop_mask.any():
        remapped = palette_manager.nearest_indices(rgb[drop_mask], allowed=sorted(keep_set))
        idx = idx.copy()
        idx[drop_mask] = remapped
    return idx


def _count_indices(idx):
    valid = idx[idx >= 0]
    if valid.size == 0:
        return {}
    unique, counts = np.unique(valid, return_counts=True)
    return {int(u): int(c) for u, c in zip(unique, counts)}
