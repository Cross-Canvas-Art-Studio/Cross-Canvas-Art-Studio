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


def count_projects():
    _ensure_dir()
    return len([f for f in os.listdir(PROJECTS_DIR) if f.endswith('.json')])


def create_project(title, grid, owner=None, description=''):
    """Persist a new project. Returns the saved metadata dict. Raises ValueError."""
    clean_grid, width, height = _sanitize_grid(grid)
    if count_projects() >= MAX_PROJECTS:
        raise ValueError('Project storage is full; delete an old project first')

    project_id = uuid.uuid4().hex
    now = datetime.utcnow().isoformat() + 'Z'
    legend = _legend_for_grid(clean_grid)
    document = {
        'id': project_id,
        'title': (title or 'Untitled Design').strip()[:120],
        'description': (description or '').strip()[:500],
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


def update_project(project_id, title, grid, owner=None, is_admin=False, description=None):
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
        'width': document.get('width'),
        'height': document.get('height'),
        'color_count': len(document.get('legend', [])),
        'owner': document.get('owner'),
        'created_at': document.get('created_at'),
        'updated_at': document.get('updated_at'),
    }
