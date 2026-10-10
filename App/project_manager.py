"""
Project Manager - persistence for saved cross-stitch designs.

Each project is a single JSON document under /data/projects/<id>.json. When the
optional auth system is enabled a project records its owner and access is
restricted to that owner (or an admin); when auth is disabled every project is
owner-less and freely accessible (single-user mode). IDs are validated against a
strict pattern before ever touching the filesystem to prevent path traversal.
"""

import os
import re
import json
import math
import uuid
import logging
import tempfile
import threading
from datetime import datetime

import palette_manager

logger = logging.getLogger(__name__)

PROJECTS_DIR = os.environ.get('PROJECTS_DIR', '/data/projects')
MAX_PROJECTS = int(os.environ.get('MAX_PROJECTS', '200'))
MAX_GRID_SIZE = 500
# Free-text notes are stored per project; cap them so one project cannot bloat
# the store or the local project list.
MAX_NOTES_LENGTH = 4000
# An imported chart printed across several sheets keeps one entry per sheet.
MAX_PAGES = 60
_PAGE_ROTS = (0, 90, 180, 270)
# Stitch-type layers (fractional-stitch flags, backstitch edges) are stored
# run-length encoded, which keeps a sparse outline tiny. The cap is generous
# enough for a genuinely dense 500x500 chart and small enough that a hand-edited
# document cannot bloat the store or the local project list.
MAX_LAYER_RUNS_LENGTH = 200000
# The grid ceiling squared, times the four edges per cell: the largest a
# backstitch layer can legitimately be once decoded.
MAX_LAYER_BYTES = MAX_GRID_SIZE * MAX_GRID_SIZE * 4
# Annotations and per-cell notes are the stitcher's own reminders. They are
# small, but they are still user input, so they get the same shape checks and
# caps as everything else. These match the renderer's constants.
MAX_ANNOTATIONS = 200
MAX_CELL_NOTES = 500
MAX_NOTE_LENGTH = 200
_ANNOT_KINDS = ('arrow', 'ellipse', 'rect', 'text')

_ID_RE = re.compile(r'^[a-f0-9]{32}$')
_write_lock = threading.Lock()


def _ensure_dir():
    os.makedirs(PROJECTS_DIR, exist_ok=True)


def _is_safe_id(project_id):
    return bool(project_id) and isinstance(project_id, str) and bool(_ID_RE.match(project_id))


def _project_path(project_id):
    if not _is_safe_id(project_id):
        raise ValueError('Invalid project id')
    return os.path.join(PROJECTS_DIR, f'{project_id}.json')


def _atomic_write_json(path, data):
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix='.tmp_', suffix='.json', dir=directory)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _sanitize_grid(grid):
    """Validate and coerce a grid into a rectangular list-of-lists of ints."""
    if not isinstance(grid, list) or not grid:
        raise ValueError('Design grid is empty')
    height = len(grid)
    if height > MAX_GRID_SIZE:
        raise ValueError('Design is too tall')
    width = len(grid[0]) if isinstance(grid[0], list) else 0
    if width == 0 or width > MAX_GRID_SIZE:
        raise ValueError('Design width is invalid')

    palette_max = palette_manager.palette_size()
    clean = []
    for row in grid:
        if not isinstance(row, list) or len(row) != width:
            raise ValueError('Design grid rows are not uniform')
        clean_row = []
        for cell in row:
            try:
                value = int(cell)
            except (TypeError, ValueError):
                value = -1
            if value < 0 or value >= palette_max:
                value = -1
            clean_row.append(value)
        clean.append(clean_row)
    return clean, width, height


def _legend_for_grid(grid):
    counts = {}
    for row in grid:
        for idx in row:
            if idx >= 0:
                counts[idx] = counts.get(idx, 0) + 1
    return palette_manager.build_legend(counts)


def _finite_number(value):
    """True for a real (non-bool, finite) number."""
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _sanitize_source(source):
    """Validate an imported-chart source DESCRIPTOR.

    Only metadata is stored server-side: the image bytes live in the browser's
    IndexedDB and are referenced by id, so this is a small defensive shape check
    rather than a blob store.
    """
    if not isinstance(source, dict):
        return None
    out = {}
    for key in ('id', 'name', 'mime'):
        value = source.get(key)
        if isinstance(value, str) and value.strip():
            out[key] = value.strip()[:200]
    for key in ('w', 'h'):
        value = source.get(key)
        if _finite_number(value) and value > 0:
            out[key] = int(value)
    return out or None


def _sanitize_fit(fit):
    """Validate the source-to-chart alignment transform."""
    if not isinstance(fit, dict):
        return None
    out = {}
    mode = fit.get('fit')
    if mode in ('contain', 'cover', 'stretch'):
        out['fit'] = mode
    for key in ('scaleX', 'scaleY', 'offsetX', 'offsetY'):
        value = fit.get(key)
        if _finite_number(value):
            out[key] = float(value)
    return out or None


def _sanitize_crop(crop):
    """Validate a page's crop window (fractions of the source image)."""
    if not isinstance(crop, dict):
        return None
    out = {}
    for key in ('x', 'y', 'w', 'h'):
        value = crop.get(key)
        if _finite_number(value):
            out[key] = float(value)
    # A zero-sized crop would draw nothing at all, so treat it as no crop.
    if out.get('w', 0) <= 0 or out.get('h', 0) <= 0:
        return None
    return out or None


def _sanitize_pages(pages):
    """Validate an imported chart's page list.

    A chart printed across several sheets is stored as one page per sheet: each
    entry records where that sheet sits on the seamless grid (``col``/``row``,
    in stitches) and how many stitches it covers (``cols``/``rows``). Only that
    geometry is stored — the image bytes live in the browser's IndexedDB and are
    referenced by id — so this is a defensive shape check, not a blob store.
    """
    if not isinstance(pages, list):
        return None
    out = []
    for page in pages[:MAX_PAGES]:
        if not isinstance(page, dict):
            continue
        # _sanitize_source already validates id/name/mime/w/h for us.
        entry = _sanitize_source(page)
        if not entry or not entry.get('id'):
            continue
        geom = {}
        for key in ('col', 'row', 'cols', 'rows'):
            value = page.get(key)
            if _finite_number(value):
                geom[key] = float(value)
        if geom.get('cols', 0) <= 0 or geom.get('rows', 0) <= 0:
            continue
        rot = page.get('rot')
        entry['rot'] = int(rot) if _finite_number(rot) and int(rot) in _PAGE_ROTS else 0
        entry.update(geom)
        crop = _sanitize_crop(page.get('crop'))
        if crop:
            entry['crop'] = crop
        out.append(entry)
    return out or None


def _sanitize_layer_runs(value, max_bytes):
    """Validate a run-length encoded stitch-type layer.

    Layers are stored as "value:count,value:count" strings rather than as a grid
    of numbers: a backstitch outline touches a small fraction of the borders on a
    chart, so the encoded form is a few hundred characters where the raw array
    would be a megabyte. The shape is checked here and the DECODE (against the
    real grid size) happens in the browser, because only that side knows how many
    bytes the layer should hold.
    """
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if len(text) > MAX_LAYER_RUNS_LENGTH:
        raise ValueError('Stitch-type layer is too large')
    total = 0
    for part in text.split(','):
        bits = part.split(':')
        if len(bits) != 2:
            raise ValueError('Stitch-type layer is malformed')
        try:
            val = int(bits[0])
            count = int(bits[1])
        except ValueError:
            raise ValueError('Stitch-type layer is malformed')
        if val < 0 or val > 255 or count <= 0:
            raise ValueError('Stitch-type layer is out of range')
        total += count
        if total > max_bytes:
            raise ValueError('Stitch-type layer is too large')
    return text


def _sanitize_annots(annots):
    """Validate the freehand annotation layer.

    Annotations are vector marks in CELL units (fractional allowed) so they stay
    anchored to the stitches at any zoom. They are on-screen only — no exporter
    sees them — but they belong to the document, so they are stored and checked.
    """
    if not isinstance(annots, list):
        return None
    out = []
    for a in annots[:MAX_ANNOTATIONS]:
        if not isinstance(a, dict):
            continue
        kind = a.get('k')
        if kind not in _ANNOT_KINDS:
            continue
        a0 = a.get('a')
        b0 = a.get('b')
        if not isinstance(a0, list) or len(a0) != 2:
            continue
        if not isinstance(b0, list) or len(b0) != 2:
            continue
        nums = [_finite_number(v) for v in (a0[0], a0[1], b0[0], b0[1])]
        if not all(nums):
            continue
        entry = {
            'k': kind,
            'a': [float(a0[0]), float(a0[1])],
            'b': [float(b0[0]), float(b0[1])],
            't': str(a.get('t') or '')[:MAX_NOTE_LENGTH],
        }
        colour = a.get('colour')
        if _finite_number(colour) and colour >= 0:
            entry['colour'] = int(colour)
        out.append(entry)
    return out or None


def _sanitize_cell_notes(notes):
    """Validate the per-cell note map ("row,col" -> text).

    Sparse on purpose: most cells have no note, so an empty map is stored as
    nothing at all rather than as a grid of blanks.
    """
    if not isinstance(notes, dict):
        return None
    out = {}
    for key, value in notes.items():
        if len(out) >= MAX_CELL_NOTES:
            break
        if not isinstance(key, str):
            continue
        bits = key.split(',')
        if len(bits) != 2:
            continue
        try:
            row, col = int(bits[0]), int(bits[1])
        except ValueError:
            continue
        if row < 0 or col < 0 or row >= MAX_GRID_SIZE or col >= MAX_GRID_SIZE:
            continue
        text = str(value or '').strip()[:MAX_NOTE_LENGTH]
        if not text:
            continue
        out['%d,%d' % (row, col)] = text
    return out or None


def count_projects():
    _ensure_dir()
    return len([f for f in os.listdir(PROJECTS_DIR) if f.endswith('.json')])


def create_project(title, grid, owner=None, description='', notes='',
                   kind='pattern', source=None, fit=None, pages=None,
                   frac=None, back=None, blend=None, annots=None, cell_notes=None):
    """Persist a new project. Returns the saved metadata dict. Raises ValueError."""
    clean_grid, width, height = _sanitize_grid(grid)
    if count_projects() >= MAX_PROJECTS:
        raise ValueError('Project storage is full; delete an old project first')
    clean_frac = _sanitize_layer_runs(frac, width * height)
    clean_back = _sanitize_layer_runs(back, width * height * 4)
    clean_blend = _sanitize_layer_runs(blend, width * height)

    project_id = uuid.uuid4().hex
    now = datetime.utcnow().isoformat() + 'Z'
    legend = _legend_for_grid(clean_grid)
    document = {
        'id': project_id,
        'title': (title or 'Untitled Design').strip()[:120],
        'description': (description or '').strip()[:500],
        'notes': str(notes or '').strip()[:MAX_NOTES_LENGTH],
        # 'chart' = an imported chart marked up over its own artwork; 'pattern'
        # = a design generated inside Stitchee. ``source``/``fit`` describe a
        # single-page imported artwork; ``pages`` is the multi-page form
        # (``source`` is then just a mirror of the first page, for old readers).
        'kind': 'chart' if kind == 'chart' else 'pattern',
        'source': _sanitize_source(source),
        'fit': _sanitize_fit(fit),
        'pages': _sanitize_pages(pages),
        # STITCH TYPES. A cell's COLOUR is in ``grid``; these describe the MARK
        # (a half/quarter stitch, a blended thread) and the outlines on the cell
        # borders, so a chart keeps its backstitch, fractional stitches and
        # blends across a save.
        'frac': clean_frac,
        'back': clean_back,
        'blend': clean_blend,
        # The stitcher's own reminders: never printed, but part of the document.
        'annots': _sanitize_annots(annots),
        'cellNotes': _sanitize_cell_notes(cell_notes),
        'width': width,
        'height': height,
        'grid': clean_grid,
        'legend': legend,
        'owner': owner,
        'created_at': now,
        'updated_at': now,
    }
    with _write_lock:
        _atomic_write_json(_project_path(project_id), document)
    logger.info('Saved project %s (%dx%d, owner=%s)', project_id, width, height, owner)
    return _metadata(document)


def update_project(project_id, title, grid, owner=None, is_admin=False,
                   description=None, notes=None, kind=None, source=None, fit=None,
                   pages=None, frac=None, back=None, blend=None, annots=None,
                   cell_notes=None):
    """Overwrite an existing project the caller may access. Raises ValueError."""
    existing = get_project(project_id)
    if existing is None:
        raise ValueError('Project not found')
    if not can_access(existing, owner, is_admin):
        raise PermissionError('You do not have access to this project')

    clean_grid, width, height = _sanitize_grid(grid)
    now = datetime.utcnow().isoformat() + 'Z'
    existing.update({
        'title': (title or existing.get('title') or 'Untitled Design').strip()[:120],
        'width': width,
        'height': height,
        'grid': clean_grid,
        'legend': _legend_for_grid(clean_grid),
        'updated_at': now,
    })
    if description is not None:
        existing['description'] = str(description).strip()[:500]
    if notes is not None:
        existing['notes'] = str(notes).strip()[:MAX_NOTES_LENGTH]
    if kind is not None:
        existing['kind'] = 'chart' if kind == 'chart' else 'pattern'
    if source is not None:
        existing['source'] = _sanitize_source(source)
    if fit is not None:
        existing['fit'] = _sanitize_fit(fit)
    if pages is not None:
        existing['pages'] = _sanitize_pages(pages)
    # An omitted layer on an update must NOT wipe it (matching notes/kind), but an
    # explicit empty string clears it, which is what "removed all the backstitch"
    # has to be able to do.
    if frac is not None:
        existing['frac'] = _sanitize_layer_runs(frac, width * height)
    if back is not None:
        existing['back'] = _sanitize_layer_runs(back, width * height * 4)
    if blend is not None:
        existing['blend'] = _sanitize_layer_runs(blend, width * height)
    # Same rule as the other layers: an omitted layer keeps what is stored, and
    # an explicit empty list/map clears it.
    if annots is not None:
        existing['annots'] = _sanitize_annots(annots)
    if cell_notes is not None:
        existing['cellNotes'] = _sanitize_cell_notes(cell_notes)
    with _write_lock:
        _atomic_write_json(_project_path(project_id), existing)
    return _metadata(existing)


def get_project(project_id):
    """Load a full project document, or None if it does not exist."""
    try:
        path = _project_path(project_id)
    except ValueError:
        return None
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (ValueError, OSError):
        return None


def list_projects(owner=None, is_admin=False):
    """Return metadata for every project the caller may access, newest first."""
    _ensure_dir()
    items = []
    for filename in os.listdir(PROJECTS_DIR):
        if not filename.endswith('.json'):
            continue
        project = get_project(filename[:-5])
        if project is None:
            continue
        if can_access(project, owner, is_admin):
            items.append(_metadata(project))
    items.sort(key=lambda p: p.get('updated_at', ''), reverse=True)
    return items


def delete_project(project_id, owner=None, is_admin=False):
    project = get_project(project_id)
    if project is None:
        return False
    if not can_access(project, owner, is_admin):
        raise PermissionError('You do not have access to this project')
    path = _project_path(project_id)
    with _write_lock:
        if os.path.exists(path):
            os.remove(path)
    return True


def can_access(project, owner, is_admin=False):
    """Owner-less projects are public (single-user); otherwise owner or admin only."""
    project_owner = (project or {}).get('owner')
    if project_owner is None:
        return True
    if is_admin:
        return True
    return owner is not None and owner == project_owner


def _metadata(document):
    return {
        'id': document.get('id'),
        'title': document.get('title'),
        'description': document.get('description', ''),
        'kind': document.get('kind', 'pattern'),
        'width': document.get('width'),
        'height': document.get('height'),
        'color_count': len(document.get('legend', [])),
        'owner': document.get('owner'),
        'created_at': document.get('created_at'),
        'updated_at': document.get('updated_at'),
    }
