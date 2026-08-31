"""
Design Manager - turns a natural-language description into a cross-stitch chart
using an LLM.

The model is asked to "paint" a small grid using yarn colour codes from the
shared palette (one code per stitch, "." for an empty cell). Working at chart
scale (<= max_llm_size) keeps the response small and reliable; the user can then
enlarge or hand-edit the result in the canvas. The parser is deliberately
forgiving so slightly malformed model output still yields a usable design.
"""

import json
import logging
import re

import palette_manager
from llm_manager import LLMManager

logger = logging.getLogger(__name__)

MAX_LLM_SIZE = 48


def _clamp(value, low, high, default):
    try:
        value = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, value))


def build_palette_reference():
    """Compact grouped palette: one line per colour family, codes only."""
    groups: dict = {}
    order: list = []
    for entry in palette_manager.get_palette():
        fam = entry['family']
        if fam not in groups:
            groups[fam] = []
            order.append(fam)
        groups[fam].append(entry['code'])
    return '\n'.join(f"{fam}: {' '.join(codes)}" for fam, codes in
                     ((f, groups[f]) for f in order))


def build_messages(description, width, height, max_colors):
    palette_ref = build_palette_reference()

    # A concrete cross design example is the single most effective way to
    # prevent the model from misunderstanding the format or using one colour.
    example = (
        '{\n'
        '  "title": "White Cross",\n'
        '  "description": "White cross centered on navy blue.",\n'
        '  "rows": [\n'
        '    "NVY NVY WHT NVY NVY",\n'
        '    "NVY NVY WHT NVY NVY",\n'
        '    "WHT WHT WHT WHT WHT",\n'
        '    "NVY NVY WHT NVY NVY",\n'
        '    "NVY NVY WHT NVY NVY"\n'
        '  ]\n'
        '}'
    )
    system_prompt = (
        "You are a cross-stitch yarn chart designer.\n"
        "Output ONLY a valid JSON object "
        "\u2014 no explanation, no preamble, no markdown.\n\n"
        f"EXAMPLE \u2014 a 5\u00d75 white cross on navy (follow this format exactly):\n"
        f"{example}\n\n"
        f"YOUR CHART: {width}\u00d7{height} stitches.\n"
        "RULES:\n"
        f"1. \"rows\" must have EXACTLY {height} strings.\n"
        f"2. Every string must have EXACTLY {width} space-separated tokens.\n"
        "3. Each token is one code from the list below, or \".\" for empty.\n"
        f"4. Use AT LEAST 2 and AT MOST {max_colors} distinct yarn colours.\n"
        "5. Create a RECOGNISABLE DESIGN "
        "\u2014 do NOT fill the entire grid with one colour.\n"
        "6. Pick a background colour for most cells; use "
        "other colours for the main shape or figure.\n\n"
        "YARN CODES (use ONLY these exact codes):\n"
        f"{palette_ref}"
    )
    user_prompt = (
        f"{description.strip()}\n\n"
        "Output ONLY the JSON object, nothing else."
    )
    return [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': user_prompt},
    ]


_THINK_RE = re.compile(r'<think>.*?</think>', re.DOTALL | re.IGNORECASE)
_FENCE_RE = re.compile(r'```[a-zA-Z]*\s*(\{.*?\})\s*```', re.DOTALL)
_TRAILING_COMMA_RE = re.compile(r',(\s*[}\]])')


def _repair_json(text):
    """Fix the most common JSON issues produced by model output."""
    return _TRAILING_COMMA_RE.sub(r'\1', text)


def _json_candidates(text):
    """Yield balanced { } substrings from text, largest first."""
    candidates = []
    depth = 0
    start = None
    for i, ch in enumerate(text):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start is not None:
                candidates.append((start, i + 1))
    candidates.sort(key=lambda x: x[1] - x[0], reverse=True)
    for s, e in candidates:
        yield text[s:e]


def _close_truncated_json(text):
    """Append missing closing brackets to a JSON object truncated mid-output.

    Many local models stop generating before finishing the grid array. This
    closes any unclosed strings, arrays and objects so json.loads has a chance.
    """
    stack = []
    in_string = False
    escape = False
    for ch in text:
        if escape:
            escape = False
            continue
        if ch == '\\' and in_string:
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if not in_string:
            if ch in ('{', '['):
                stack.append(ch)
            elif ch == '}' and stack and stack[-1] == '{':
                stack.pop()
            elif ch == ']' and stack and stack[-1] == '[':
                stack.pop()
    if not stack and not in_string:
        return text  # already balanced
    suffix = '"' if in_string else ''
    while stack:
        suffix += ']' if stack.pop() == '[' else '}'
    return text.rstrip(',\n\r ') + suffix


def _extract_json(text):
    """Extract a parsed JSON dict from a (possibly messy) model response."""
    if not text:
        raise ValueError('Empty response from model')

    # 1. Strip reasoning/thinking tags (DeepSeek-R1, Qwen3, etc.).
    text = _THINK_RE.sub('', text).strip()
    if not text:
        raise ValueError('Response was empty after stripping thinking tags')

    # 2. Prefer JSON inside a ``` fence.
    fence_match = _FENCE_RE.search(text)
    if fence_match:
        try:
            return json.loads(fence_match.group(1))
        except json.JSONDecodeError:
            pass

    # 3. Try every balanced { } region, with and without trailing-comma repair.
    for candidate in _json_candidates(text):
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
        repaired = _repair_json(candidate)
        if repaired != candidate:
            try:
                return json.loads(repaired)
            except json.JSONDecodeError:
                pass

    # 4. The JSON may be truncated (model ran out of tokens mid-grid).
    #    Find the first '{' and try to close what follows.
    start = text.find('{')
    if start != -1:
        truncated = text[start:]
        for attempt in (truncated, _repair_json(truncated)):
            closed = _close_truncated_json(attempt)
            if closed != attempt:
                try:
                    return json.loads(closed)
                except json.JSONDecodeError:
                    pass

    raise ValueError('No valid JSON object found in model response')


def _extract_rows_from_text(text, width):
    """
    Last-resort row extraction: scan lines for sequences of yarn codes.
    Returns a list of token-lists, or None if nothing plausible was found.
    """
    code_set = {c.upper() for c in palette_manager.code_to_index()}
    row_candidates = []
    for line in text.split('\n'):
        line = line.strip().strip('"\'')
        if not line:
            continue
        tokens = [t.strip().upper() for t in re.split(r'[\s,|;]+', line) if t.strip()]
        if not tokens:
            continue
        valid = sum(1 for t in tokens if t in code_set or t == '.')
        # Accept line as a row if at least half its tokens are recognisable codes
        # and the token count is within ±33% of the requested width.
        if valid >= max(2, len(tokens) // 2) and abs(len(tokens) - width) <= max(2, width // 3):
            row_candidates.append(tokens)
    return row_candidates if row_candidates else None


def _rows_from_data(data):
    """Return a list of token-lists from 'rows', 'grid', or similar keys."""
    for key in ('rows', 'grid', 'chart', 'pattern', 'stitches'):
        val = data.get(key)
        if not isinstance(val, list):
            continue
        out = []
        for row in val:
            if isinstance(row, str):
                out.append(re.split(r'[,|\s]+', row.strip()))
            elif isinstance(row, list):
                out.append([str(t) for t in row])
        if out:
            return out
    raise ValueError("Model response is missing a 'rows' array")


def _build_code_maps():
    """Return (exact_map, name_map) for forgiving token resolution."""
    exact = {code.upper(): idx for code, idx in palette_manager.code_to_index().items()}
    name_map = {entry['name'].upper(): entry['index'] for entry in palette_manager.get_palette()}
    return exact, name_map


def _resolve_token(token, code_map, name_map):
    """Resolve a token to a palette index, with fallback fuzzy matching."""
    t = token.strip().upper()
    if t in ('.', '', 'NONE', 'NULL', '-1', 'X', 'EMPTY'):
        return -1
    if t in code_map:
        return code_map[t]
    if t in name_map:
        return name_map[t]
    # Prefix-only match (longest wins) — avoids infix false-positives.
    best = None
    best_len = 0
    for code, idx in code_map.items():
        if t.startswith(code) and len(code) > best_len:
            best, best_len = idx, len(code)
    if best is not None:
        return best
    return -1


def _maybe_reshape(token_rows, width, height):
    """
    Detect when the model returned a flat list (one code per element instead of
    one full row per element) and reshape it into proper width-column rows.

    Trigger: total tokens == width × height AND the row count != height.
    (If row count == height and column count == width, the grid is already correct.)
    """
    if not token_rows:
        return token_rows
    flat = [t for row in token_rows for t in row if t and t != '']
    total = len(flat)
    already_correct = (len(token_rows) == height and
                       all(len(r) == width for r in token_rows))
    if total == width * height and not already_correct:
        logger.debug('Reshaping flat list (%d tokens) into %dx%d grid', total, width, height)
        return [flat[i * width:(i + 1) * width] for i in range(height)]
    return token_rows


def parse_design(text, width, height):
    """Parse a model response into {title, description, width, height, grid, legend}."""
    data = None
    token_rows = None
    try:
        data = _extract_json(text)
        token_rows = _rows_from_data(data)
    except ValueError:
        # Try raw line-by-line extraction as a last resort.
        token_rows = _extract_rows_from_text(text, width)
        if not token_rows:
            raise ValueError(
                'Could not extract a design grid from the model response. '
                'Try a different model or simplify the description.'
            )
        data = {}

    token_rows = _maybe_reshape(token_rows, width, height)
    code_map, name_map = _build_code_maps()

    grid = []
    for r in range(height):
        source = token_rows[r] if r < len(token_rows) else []
        row_indices = []
        for c in range(width):
            raw = source[c] if c < len(source) else '.'
            # Direct numeric index (legacy / edge-case)
            if isinstance(raw, int):
                idx = raw if 0 <= raw < palette_manager.palette_size() else -1
            else:
                idx = _resolve_token(str(raw), code_map, name_map)
            row_indices.append(idx)
        grid.append(row_indices)

    counts = {}
    for row in grid:
        for idx in row:
            if idx >= 0:
                counts[idx] = counts.get(idx, 0) + 1

    legend = palette_manager.build_legend(counts)
    title = str(data.get('title') or 'AI Design').strip()[:80]
    description = str(data.get('description') or '').strip()[:500]
    stitched = sum(1 for row in grid for idx in row if idx >= 0)
    return {
        'title': title,
        'description': description,
        'width': width,
        'height': height,
        'grid': grid,
        'legend': legend,
        'raw_palette': data.get('palette', []),
        'stats': {
            'total_cells': width * height,
            'stitched_cells': stitched,
            'empty_cells': width * height - stitched,
            'color_count': len(legend),
        },
    }


def generate(description, width, height, provider, model, api_key=None,
             custom_config=None, max_colors=12, max_size=None):
    """Generate a cross-stitch design from a text description.

    Asks the LLM to output a compact hex-palette + integer-grid JSON (like a GIF
    colour table). The model picks hex colours it already knows well, and the
    server maps each hex to the nearest yarn code via CIELAB matching. This is
    far more reliable than either a full pixel grid or an abstract shapes list.
    """
    description = (description or '').strip()
    if not description:
        return None, 'A design description is required'

    # 16×16 keeps output to ~300 tokens even on slow models while still being
    # recognisable. The user can scale the canvas to any size afterward.
    width = _clamp(width, 5, 500, 16)
    height = _clamp(height, 5, 500, 16)
    max_colors = _clamp(max_colors, 2, min(palette_manager.palette_size(), 8), 6)

    messages = build_color_grid_messages(description, width, height, max_colors)
    result = LLMManager.chat(
        provider, messages, model, api_key=api_key, custom_config=custom_config,
        temperature=0.5, max_tokens=2048,
    )
    if not result.get('success'):
        return None, result.get('error', 'LLM request failed')

    content = result.get('content', '')
    logger.info('LLM color-grid response: %.400s', content)

    try:
        design = parse_color_grid_response(content, width, height)
    except ValueError as exc:
        return None, str(exc)

    # Check if the palette has enough distinct hex colours, even if they map to
    # the same yarn indices (which can happen with similar hex values).
    # Only fail if the model truly used just one colour or the palette is empty.
    distinct_hexes = len(set(
        str(h).lower() for h in (design.get('raw_palette') or []) if h
    ))
    
    if design['stats']['color_count'] < 1 or (
        distinct_hexes < 2 and design['stats']['color_count'] < 2
    ):
        return None, (
            'The model did not produce a usable design. '
            'Try a more specific description like "Donkey Kong brown gorilla with '
            'red tie on blue background" or use a more capable model.'
        )
    return design, None


# ---------------------------------------------------------------------------
# Colour-grid design approach  (hex palette + integer grid → yarn CIELAB match)
# ---------------------------------------------------------------------------

def build_color_grid_messages(description, width, height, max_colors):
    """Build LLM messages for the hex-palette + integer-grid approach.

    The LLM outputs:
      • "palette": a list of 2-8 hex colour strings (what it uses naturally)
      • "grid":    a 2D array of palette indices, WIDTH × HEIGHT

    The server converts each hex to the nearest yarn code via CIELAB, so the
    model never needs to know yarn codes at all.
    """
    system_prompt = (
        "You are a pixel-art cross-stitch sprite designer.\n"
        "Output ONLY a valid JSON object \u2014 no explanation, no preamble, no markdown.\n\n"
        "APPROACH:\n"
        "1. Choose 2\u20138 hex colours for your design. "
        "List them as \"palette\". palette[0] = background colour.\n"
        "2. Output \"grid\": a 2D array, "
        f"EXACTLY {width} columns wide and {height} rows tall.\n"
        "   Each cell is a number indexing into your palette (0 = palette[0], 1 = palette[1], \u2026).\n"
        "The server auto-maps your hex colours to the closest available yarn colours.\n\n"
        "EXAMPLE \u2014 white cross on navy (6\u00d75):\n"
        "{\n"
        '  "title": "White Cross",\n'
        '  "palette": ["#1B3070", "#FFFFFF"],\n'
        '  "grid": [\n'
        '    [0,0,1,0,0,0],\n'
        '    [0,0,1,0,0,0],\n'
        '    [1,1,1,1,1,1],\n'
        '    [0,0,1,0,0,0],\n'
        '    [0,0,1,0,0,0]\n'
        '  ]\n'
        "}\n\n"
        "PIXEL-ART DESIGN TIPS:\n"
        "\u2022 Use the subject\u2019s ACTUAL colours (Donkey Kong = #8B4513 brown fur, "
        "#DC143C red tie, #222 dark face; Mario = red hat, blue overalls, skin tone face).\n"
        "\u2022 Think row by row from top to bottom like a sprite sheet.\n"
        "\u2022 palette[0] fills the background; build the figure on top with other indices.\n"
        "\u2022 Strong silhouette > fine detail at small sizes.\n"
        "\u2022 Characters: wide head near top, body/torso in the middle, "
        "arms out to the sides, legs at the bottom.\n\n"
        f"Grid must be EXACTLY {width} columns wide and {height} rows tall. "
        f"Every row must have EXACTLY {width} numbers. "
        f"Use at most {max_colors} distinct palette entries."
    )
    user_prompt = (
        f"Subject: {description.strip()}\n\n"
        "Design a recognisable pixel-art cross-stitch sprite. "
        "Use the subject\u2019s actual colours. "
        "Output ONLY the JSON object, nothing else."
    )
    return [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user',   'content': user_prompt},
    ]


def _hex_to_yarn_index(hex_color):
    """Map a hex colour string to the nearest yarn palette index via CIELAB."""
    try:
        return palette_manager.nearest_index_for_hex(hex_color)
    except Exception:  # noqa: BLE001
        return -1


def parse_color_grid_response(text, width, height):
    """Parse a hex-palette + integer-grid response and map hex → yarn codes.

    Also handles the sparse stitch-list format {"stitches":[{"x","y","color"}...]}
    in case the model uses that variant, and a last-resort number-extraction path
    for when the model outputs numbers but not valid JSON.
    """
    # Try JSON extraction first (includes truncation-repair).
    try:
        data = _extract_json(text)
    except ValueError:
        # Last resort: pull hex colours + integer rows directly out of the text.
        data = _extract_color_data_from_text(text)
        if data is None:
            logger.warning('Color-grid parse failed. Raw response: %.500s', text)
            raise ValueError(
                'Could not parse a colour grid from the model response. '
                'Try a different model or simplify the description.'
            )

    # ---- sparse stitch-list fallback ----
    stitches = data.get('stitches') or data.get('pixels') or []
    if isinstance(stitches, list) and stitches and isinstance(stitches[0], dict):
        return _parse_stitch_list(stitches, data, width, height)

    # ---- preferred: palette + grid ----
    raw_palette = (
        data.get('palette') or data.get('colors') or
        data.get('colour_palette') or data.get('color_palette') or []
    )
    raw_grid = (
        data.get('grid') or data.get('pixels') or
        data.get('rows') or data.get('pattern') or []
    )

    if not isinstance(raw_palette, list) or not raw_palette:
        raise ValueError("Response is missing a 'palette' array of hex colours")
    if not isinstance(raw_grid, list) or not raw_grid:
        raise ValueError("Response is missing a 'grid' array")

    # Map each hex colour to nearest yarn index.
    yarn_map = [_hex_to_yarn_index(str(h)) for h in raw_palette]

    # Flatten 1D grid if needed.
    if raw_grid and not isinstance(raw_grid[0], list):
        flat = [int(v) for v in raw_grid if str(v).strip().lstrip('-').isdigit()]
        if len(flat) == width * height:
            raw_grid = [flat[r * width:(r + 1) * width] for r in range(height)]
        elif len(flat) >= height:
            raw_grid = [[flat[r]] for r in range(height)]

    bg_yarn = yarn_map[0] if yarn_map else -1
    grid = []
    for r in range(height):
        src = raw_grid[r] if r < len(raw_grid) else []
        row = []
        for c in range(width):
            try:
                pal_idx = int(src[c]) if c < len(src) else 0
                yarn_idx = yarn_map[pal_idx] if 0 <= pal_idx < len(yarn_map) else bg_yarn
            except (ValueError, TypeError):
                yarn_idx = bg_yarn
            row.append(yarn_idx)
        grid.append(row)

    return _finish_design(grid, data, width, height)


def _extract_color_data_from_text(text):
    """Last-resort: pull hex colours and integer rows out of raw (non-JSON) text."""
    hexes = re.findall(r'#[0-9A-Fa-f]{3,6}', text)
    if not hexes:
        return None
    palette = list(dict.fromkeys(hexes[:8]))  # unique, preserve order, max 8

    # Extract bracket-enclosed integer sequences as rows.
    rows_raw = re.findall(r'\[([\s\d,]+)\]', text)
    grid = []
    for raw in rows_raw:
        nums = [int(n) for n in re.findall(r'\d+', raw)]
        if nums:
            grid.append(nums)
    if not grid:
        return None
    return {'palette': palette, 'grid': grid, 'title': 'AI Design'}


def _parse_stitch_list(stitches, data, width, height):
    """Parse [{"x","y","color"}] stitch list into a grid."""
    bg_yarn = _hex_to_yarn_index('#FFFFFF')
    grid = [[bg_yarn] * width for _ in range(height)]
    for s in stitches:
        if not isinstance(s, dict):
            continue
        try:
            x, y = int(s.get('x', 0)), int(s.get('y', 0))
            color = str(s.get('color', '#FFFFFF'))
            if 0 <= x < width and 0 <= y < height:
                grid[y][x] = _hex_to_yarn_index(color)
        except (ValueError, TypeError):
            continue
    return _finish_design(grid, data, width, height)


def _finish_design(grid, data, width, height):
    """Compute counts/legend and return the standard design dict."""
    counts: dict = {}
    for row in grid:
        for idx in row:
            if idx >= 0:
                counts[idx] = counts.get(idx, 0) + 1
    legend = palette_manager.build_legend(counts)
    title = str(data.get('title') or 'AI Design').strip()[:80]
    description = str(data.get('description') or '').strip()[:500]
    stitched = sum(counts.values())
    return {
        'title': title,
        'description': description,
        'width': width,
        'height': height,
        'grid': grid,
        'legend': legend,
        'raw_palette': data.get('palette', []),
        'stats': {
            'total_cells': width * height,
            'stitched_cells': stitched,
            'empty_cells': width * height - stitched,
            'color_count': len(legend),
        },
    }
# ---------------------------------------------------------------------------

def build_shapes_messages(description, width, height, max_colors):
    """Build LLM messages asking for a shapes-based design description.

    The LLM outputs a compact JSON with geometric layer descriptors. The server
    renders the grid from those descriptors — no pixel-grid generation required.
    Output is ~10-20 lines regardless of canvas size, making it reliable for
    any local model.
    """
    palette_ref = build_palette_reference()

    cross_example = (
        '{\n'
        '  "title": "White Cross",\n'
        '  "description": "Bold white cross on navy blue.",\n'
        '  "background": "NVY",\n'
        '  "layers": [\n'
        '    {"type": "rect",   "color": "WHT", "l": 0,  "t": 35, "r": 100, "b": 65},\n'
        '    {"type": "rect",   "color": "WHT", "l": 35, "t": 0,  "r": 65,  "b": 100}\n'
        '  ]\n'
        '}'
    )
    face_example = (
        '{\n'
        '  "title": "Smiley Face",\n'
        '  "description": "Yellow smiley face on blue.",\n'
        '  "background": "BLU",\n'
        '  "layers": [\n'
        '    {"type": "circle", "color": "YEL",  "cx": 50, "cy": 45, "rx": 35, "ry": 38},\n'
        '    {"type": "circle", "color": "BLK",  "cx": 35, "cy": 38, "rx": 5,  "ry": 5 },\n'
        '    {"type": "circle", "color": "BLK",  "cx": 65, "cy": 38, "rx": 5,  "ry": 5 },\n'
        '    {"type": "rect",   "color": "BLK",  "l": 35,  "t": 54,  "r": 65,  "b": 60 }\n'
        '  ]\n'
        '}'
    )
    gorilla_example = (
        '{\n'
        '  "title": "Gorilla",\n'
        '  "description": "Brown gorilla with dark face and red tie.",\n'
        '  "background": "SKY",\n'
        '  "layers": [\n'
        '    {"type": "rect",   "color": "BRN",  "l": 30, "t": 40, "r": 70, "b": 85},\n'
        '    {"type": "circle", "color": "BRN",  "cx": 50, "cy": 32, "rx": 22, "ry": 24},\n'
        '    {"type": "circle", "color": "CHL",  "cx": 50, "cy": 38, "rx": 14, "ry": 12},\n'
        '    {"type": "circle", "color": "WHT",  "cx": 38, "cy": 30, "rx": 5,  "ry": 5 },\n'
        '    {"type": "circle", "color": "WHT",  "cx": 62, "cy": 30, "rx": 5,  "ry": 5 },\n'
        '    {"type": "circle", "color": "BLK",  "cx": 38, "cy": 30, "rx": 2,  "ry": 2 },\n'
        '    {"type": "circle", "color": "BLK",  "cx": 62, "cy": 30, "rx": 2,  "ry": 2 },\n'
        '    {"type": "rect",   "color": "RED",  "l": 44, "t": 53, "r": 56,  "b": 68 }\n'
        '  ]\n'
        '}'
    )
    shapes_ref = (
        'rect     {"type":"rect",    "color":"CODE","l":left%,"t":top%,"r":right%,"b":bottom%}\n'
        'circle   {"type":"circle",  "color":"CODE","cx":center_x%,"cy":center_y%,"rx":half_w%,"ry":half_h%}\n'
        'diamond  {"type":"diamond", "color":"CODE","cx":center_x%,"cy":center_y%,"rx":half_w%,"ry":half_h%}\n'
        'triangle {"type":"triangle","color":"CODE","x1":%,"y1":%,"x2":%,"y2":%,"x3":%,"y3":%}\n'
        'border   {"type":"border",  "color":"CODE","thickness":percent%}'
    )
    system_prompt = (
        "You are a cross-stitch yarn chart designer who turns any subject into a "
        "bold, simplified pixel-art icon using geometric shapes.\n"
        "Output ONLY a valid JSON object \u2014 no explanation, no preamble, no markdown.\n\n"
        "All positions are PERCENTAGES of the canvas (0=left/top, 100=right/bottom).\n\n"
        f"AVAILABLE SHAPES:\n{shapes_ref}\n\n"
        "DESIGN APPROACH FOR CHARACTERS & SUBJECTS:\n"
        "1. Think of the subject's most iconic colours and silhouette.\n"
        "2. Build from background to foreground: background \u2192 body \u2192 clothing \u2192 face \u2192 details.\n"
        "3. Head = large circle at top (cy: 20\u201340). Body = rectangle below (t: 50\u201360). "
        "Arms = side rectangles. Eyes = small circles (rx: 3\u20136). Mouth = small rect.\n"
        "4. Use the subject's ACTUAL colours (e.g. Donkey Kong = brown fur, red tie, "
        "dark face; Mario = red hat, blue overalls, skin face; sun = yellow circle on blue).\n"
        f"5. Use AT LEAST 2 and AT MOST {max_colors} distinct yarn colours. "
        "Background counts as one colour.\n\n"
        "EXAMPLES:\n\n"
        f"Cross:\n{cross_example}\n\n"
        f"Face:\n{face_example}\n\n"
        f"Gorilla character:\n{gorilla_example}\n\n"
        "YARN CODES (use ONLY these exact codes):\n"
        f"{palette_ref}"
    )
    user_prompt = (
        f"Subject: {description.strip()}\n\n"
        "Create a cross-stitch sprite/icon showing the most recognisable features "
        "and ACTUAL colours of this subject. "
        "Use at least 4 layers so the design has clear body, face, and detail shapes. "
        "Output ONLY the JSON object, nothing else."
    )
    return [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': user_prompt},
    ]


def _render_shapes(background_code, layers, width, height, code_map, name_map):
    """Render a shapes description onto a WxH grid of palette indices."""

    def resolve_code(val):
        t = str(val or '').strip().upper()
        if not t:
            return -1
        if t in code_map:
            return code_map[t]
        if t in name_map:
            return name_map[t]
        best, best_len = -1, 0
        for code, idx in code_map.items():
            if t.startswith(code) and len(code) > best_len:
                best, best_len = idx, len(code)
        return best

    def pc(p, size):
        """Percentage to integer cell coordinate."""
        return max(0, min(size - 1, int(round(float(p) / 100.0 * (size - 1)))))

    bg_idx = resolve_code(background_code) if background_code else -1
    grid = [[bg_idx] * width for _ in range(height)]

    for layer in (layers or []):
        if not isinstance(layer, dict):
            continue
        shape = str(layer.get('type', '')).lower().strip()
        color_idx = resolve_code(layer.get('color', layer.get('colour', '')))

        if shape == 'rect':
            l = pc(layer.get('l', layer.get('left',   0)), width)
            t = pc(layer.get('t', layer.get('top',    0)), height)
            r = pc(layer.get('r', layer.get('right',  100)), width)
            b = pc(layer.get('b', layer.get('bottom', 100)), height)
            for row in range(t, b + 1):
                for col in range(l, r + 1):
                    grid[row][col] = color_idx

        elif shape in ('circle', 'ellipse', 'oval'):
            cx = float(layer.get('cx', layer.get('x', 50)))
            cy = float(layer.get('cy', layer.get('y', 50)))
            rx = max(0.1, float(layer.get('rx', layer.get('r', 25))))
            ry = max(0.1, float(layer.get('ry', layer.get('r', 25))))
            for row in range(height):
                row_pct = row / max(1, height - 1) * 100.0
                for col in range(width):
                    col_pct = col / max(1, width - 1) * 100.0
                    if ((col_pct - cx) / rx) ** 2 + ((row_pct - cy) / ry) ** 2 <= 1.0:
                        grid[row][col] = color_idx

        elif shape in ('diamond', 'rhombus'):
            cx = float(layer.get('cx', 50))
            cy = float(layer.get('cy', 50))
            rx = max(0.1, float(layer.get('rx', 25)))
            ry = max(0.1, float(layer.get('ry', 25)))
            for row in range(height):
                row_pct = row / max(1, height - 1) * 100.0
                for col in range(width):
                    col_pct = col / max(1, width - 1) * 100.0
                    if abs(col_pct - cx) / rx + abs(row_pct - cy) / ry <= 1.0:
                        grid[row][col] = color_idx

        elif shape == 'triangle':
            x1, y1 = float(layer.get('x1', 50)), float(layer.get('y1', 0))
            x2, y2 = float(layer.get('x2', 0)),  float(layer.get('y2', 100))
            x3, y3 = float(layer.get('x3', 100)), float(layer.get('y3', 100))
            for row in range(height):
                py = row / max(1, height - 1) * 100.0
                for col in range(width):
                    px = col / max(1, width - 1) * 100.0
                    d1 = (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2)
                    d2 = (px - x3) * (y2 - y3) - (x2 - x3) * (py - y3)
                    d3 = (px - x1) * (y3 - y1) - (x3 - x1) * (py - y1)
                    neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
                    pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
                    if not (neg and pos):
                        grid[row][col] = color_idx

        elif shape in ('border', 'frame'):
            thick = max(1, float(layer.get('thickness', 10)))
            tc = max(1, int(round(thick / 100.0 * width)))
            tr = max(1, int(round(thick / 100.0 * height)))
            for row in range(height):
                for col in range(width):
                    if row < tr or row >= height - tr or col < tc or col >= width - tc:
                        grid[row][col] = color_idx

    return grid


def parse_shapes_response(text, width, height):
    """Parse a shapes-based LLM response and render it to a design dict."""
    data = _extract_json(text)

    background = (
        data.get('background') or data.get('bg') or
        data.get('background_color') or ''
    )
    layers = (
        data.get('layers') or data.get('shapes') or
        data.get('layer') or []
    )
    if not isinstance(layers, list):
        layers = []

    code_map, name_map = _build_code_maps()
    grid = _render_shapes(background, layers, width, height, code_map, name_map)

    counts: dict = {}
    for row in grid:
        for idx in row:
            if idx >= 0:
                counts[idx] = counts.get(idx, 0) + 1

    legend = palette_manager.build_legend(counts)
    title = str(data.get('title') or 'AI Design').strip()[:80]
    desc = str(data.get('description') or '').strip()[:500]
    stitched = sum(counts.values())

    return {
        'title': title,
        'description': desc,
        'width': width,
        'height': height,
        'grid': grid,
        'legend': legend,
        'stats': {
            'total_cells': width * height,
            'stitched_cells': stitched,
            'empty_cells': width * height - stitched,
            'color_count': len(legend),
        },
    }
