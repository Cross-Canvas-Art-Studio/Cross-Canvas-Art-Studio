/**
 * CrossStitchCanvas - renders a yarn cross-stitch chart on an HTML5 canvas and
 * handles interactive painting.
 *
 * The grid is a flat Int16Array of palette indices (-1 = empty). Each filled
 * cell is drawn as an "X" cross-stitch (two diagonal strands, the under-strand
 * slightly darkened for depth) sitting on a plastic-canvas mesh. A canvas is
 * used instead of DOM cells because a 500x500 chart is 250,000 cells. Single
 * cells are repainted during drag for smooth interaction; full re-renders only
 * happen on load, zoom, or toggles.
 */
(function () {
  "use strict";

  var MESH = "#20242e";
  var GRID_LINE = "rgba(255,255,255,0.06)";
  var GRID_LINE_MID = "rgba(255,255,255,0.14)";
  var GRID_LINE_MAJOR = "rgba(255,255,255,0.26)";
  // Darker grid shades for exports, which sit on white paper.
  var PAPER_GRID = "rgba(0,0,0,0.12)";
  var PAPER_GRID_MID = "rgba(0,0,0,0.30)";
  var PAPER_GRID_MAJOR = "rgba(0,0,0,0.55)";
  var MAJOR_EVERY = 10;
  var MID_EVERY = 5;

  // Progress-tracker overlay. Drawn directly on the on-screen canvas AFTER
  // drawChart(), never through an adapter, which is what guarantees it can
  // never leak into the PNG, SVG or PDF exports.
  //
  // DIRECTION MATTERS ON A DARK CANVAS. The wash over a finished stitch is LIGHT,
  // not dark: a dark wash made completed work read as holes punched in the chart,
  // which is the one thing you must not misread while stitching. Finished
  // stitches now go to a soft grey, so "done" is unmistakably not "empty".
  var PROGRESS_DONE = "rgba(203,213,225,0.66)"; // already-stitched cells
  var PROGRESS_TICK = "rgba(15,17,23,0.5)"; // the tick on each finished stitch
  var PROGRESS_BAND = "rgba(251,191,36,0.16)"; // the unit being worked on
  var PROGRESS_BAND_EDGE = "rgba(251,191,36,0.9)"; // its leading edge line
  // Below this cell size a tick in every stitch is noise, not information.
  var PROGRESS_TICK_MIN_CELL = 14;

  // Locate / Spotlight overlay. Dims every stitch that is NOT a match and rings
  // the ones that are, so "where is colour 666 / symbol #12?" is answered at a
  // glance. Like the progress wash it is drawn directly on the screen canvas
  // after drawChart(), so it can never reach a PNG, SVG or PDF export.
  var SPOTLIGHT_DIM = "rgba(15,17,23,0.72)"; // everything that is NOT a match
  var SPOTLIGHT_RING = "#f59e0b"; // amber ring on each matching stitch

  // Trace-overlay frame. Also drawn outside drawChart, so handles and marquee
  // can never reach an export. The canvas is 1:1 with its CSS size, so these
  // are screen pixels too.
  var OVERLAY_FRAME = "rgba(168,85,247,0.95)";
  var OVERLAY_HANDLE = 9;
  var OVERLAY_MIN_SIZE = 8;
  // Alt turns a drag into a fine drag: one screen pixel of pointer travel moves
  // the edge this fraction of a canvas pixel, so a photo that is a hair too wide
  // can be fitted to the chart's cells instead of jumping a whole stitch.
  var OVERLAY_FINE_DRAG = 0.2;
  // Arrow-key nudge, as a fraction of the chart per press (Shift = x10).
  var OVERLAY_NUDGE = 0.001;
  // A photo is usually a few percent off, not a few hundred, but the range has
  // to cover "this scan is 12% too narrow" and a deliberate extreme.
  var OVERLAY_MIN_SCALE = 0.05;
  var OVERLAY_MAX_SCALE = 8;
  var OVERLAY_MAX_OFFSET = 1.5; // in chart widths / heights

  // "Read the chart": how many samples per cell are inspected (the inkiest one
  // wins) and how much ink a cell needs before it counts as a stitch at all.
  var READ_SUPERSAMPLE = 4;
  var READ_MIN_INK = 34;

  // ====================================================== stitch types ======
  // A cell's COLOUR stays in `cells`. These two layers say what MARK to make in
  // that colour, and which outlines run along the cell borders:
  //
  //   frac[r*w+c]  bit flags: which ARMS of the cross are present
  //   back[(r*w+c)*4 + edge]  backstitch: palette index + 1, or 0 for none
  //
  // Keeping the model LAYERED is what makes Phase 4 affordable: colour counts,
  // the legend, the skein maths, Locate/Spotlight and progress marking all keep
  // working untouched, because none of them care what shape the mark is.
  //
  // A cross is four arms (centre to each corner), so the flags compose exactly:
  //   one corner flag  = a quarter stitch (one arm)
  //   a HALF flag      = a half stitch, drawn as ONE continuous strand
  //   corner + half    = the classic three-quarter stitch (three arms)
  //   0                = a full cross
  var FRAC_NW = 1;
  var FRAC_NE = 2;
  var FRAC_SE = 4;
  var FRAC_SW = 8;
  var FRAC_SLASH = 16; // "/"  - bottom-left to top-right
  var FRAC_BACKSLASH = 32; // "\" - top-left to bottom-right
  var FRAC_ALL = 63;

  // Backstitch edge order, clockwise from the top.
  var BACK_EDGES = 4;
  var BACK_N = 0;
  var BACK_E = 1;
  var BACK_S = 2;
  var BACK_W = 3;
  // Backstitch reads as an outline, so it is a little heavier than a strand and
  // is drawn butt-capped to keep corners crisp where segments meet.
  var BACK_LINE_RATIO = 0.2;

  // BLENDED THREADS: two flosses held together in one stitch, which is how a
  // chart shows a colour you cannot buy — e.g. 1 strand of 310 with 1 of 415.
  // The cell's PRIMARY colour stays in `cells`; `blend` names the partner, so the
  // colour count, the legend and the skein maths keep working and the partner is
  // simply an extra strand. It renders the way a blend is charted: the two legs of
  // the cross are the two flosses, one each.
  var BLEND_NONE = -1;

  // ============ annotations + per-cell notes (Phase 5) ============
  // The stitcher's own reminders about THIS fabric, not part of the chart. Both
  // layers are ON-SCREEN ONLY: they are drawn after drawChart() and never reach
  // an adapter, so an annotation cannot print on a chart you hand to someone
  // else. They do persist with the document, because they are your notes.
  //
  // Annotations are VECTOR marks in CELL units (fractional allowed), so they
  // stay anchored to the stitches at any zoom and follow a page join / re-origin
  // instead of drifting.
  var ANNOT_HALO = "rgba(15,17,23,0.85)"; // dark underlay, so a mark reads on pale stitches
  var NOTE_FLAG = "#f59e0b"; // amber corner flag on a cell that carries a note
  var MAX_ANNOTATIONS = 200;
  var MAX_CELL_NOTES = 500;
  var MAX_NOTE_LENGTH = 200;
  var ANNOT_KINDS = { arrow: 1, ellipse: 1, rect: 1, text: 1 };

  /** The FRAC_* flag a source arm bit maps to, per mirror/rotation. */
  var FRAC_MAPS = {
    // mirror left-right
    h: [FRAC_NE, FRAC_NW, FRAC_SW, FRAC_SE],
    // mirror top-bottom
    v: [FRAC_SW, FRAC_SE, FRAC_NE, FRAC_NW],
    // rotate clockwise
    cw: [FRAC_NE, FRAC_SE, FRAC_SW, FRAC_NW],
    // rotate counter-clockwise
    ccw: [FRAC_SW, FRAC_NW, FRAC_NE, FRAC_SE],
  };
  var FRAC_ORDER = [FRAC_NW, FRAC_NE, FRAC_SE, FRAC_SW];

  /** The edge a source edge becomes, per mirror/rotation (indexed by edge). */
  var BACK_MAPS = {
    h: [BACK_N, BACK_W, BACK_S, BACK_E],
    v: [BACK_S, BACK_E, BACK_N, BACK_W],
    cw: [BACK_E, BACK_S, BACK_W, BACK_N],
    ccw: [BACK_W, BACK_N, BACK_E, BACK_S],
  };

  /**
   * Map a cell's partial-stitch flags through a mirror or rotation.
   *
   * A diagonal is not orientation-free: mirroring "/" gives "\", and a quarter
   * arm moves to the corner its image lands in. Doing this here (rather than in
   * each caller) keeps mirror/rotate of a selection honest for every layer.
   */
  function mapFrac(frac, kind) {
    var map = FRAC_MAPS[kind];
    if (!map || !frac) return frac | 0;
    var out = 0;
    for (var i = 0; i < FRAC_ORDER.length; i++) {
      if (frac & FRAC_ORDER[i]) out |= map[i];
    }
    if (frac & FRAC_SLASH) out |= FRAC_BACKSLASH;
    if (frac & FRAC_BACKSLASH) out |= FRAC_SLASH;
    return out & FRAC_ALL;
  }

  /** Map a backstitch edge through a mirror or rotation. */
  function mapBackEdge(edge, kind) {
    var map = BACK_MAPS[kind];
    return map ? map[edge & 3] : edge & 3;
  }

  /** Short human label for a flag set, for tooltips and the legend. */
  function fracLabel(frac) {
    frac = frac & FRAC_ALL;
    if (!frac) return "full";
    var names = [];
    var corners = [
      [FRAC_NW, "NW"],
      [FRAC_NE, "NE"],
      [FRAC_SE, "SE"],
      [FRAC_SW, "SW"],
    ];
    var arms = 0;
    for (var i = 0; i < corners.length; i++) {
      if (frac & corners[i][0]) {
        arms++;
        names.push(corners[i][1]);
      }
    }
    if (frac & FRAC_SLASH) {
      arms += 2;
      names.push("/");
    }
    if (frac & FRAC_BACKSLASH) {
      arms += 2;
      names.push("\\");
    }
    if (arms === 3) return "three-quarter (" + names.join(" ") + ")";
    if (arms === 1) return "quarter (" + names.join(" ") + ")";
    if (arms === 2 && names.length === 1) return "half (" + names[0] + ")";
    return names.join(" ");
  }

  /** Two decimal places: annotations are stored in cells, so precision is cheap. */
  function _round2(v) {
    return Math.round(v * 100) / 100;
  }

  /** Normalise an annotation into the one shape every consumer expects. */
  function _normAnnot(a) {
    a = a || {};
    var p0 = a.a && a.a.length === 2 ? a.a : [0, 0];
    var p1 = a.b && a.b.length === 2 ? a.b : p0;
    return {
      k: ANNOT_KINDS[a.k] ? a.k : "arrow",
      a: [_round2(_num(p0[0], 0)), _round2(_num(p0[1], 0))],
      b: [_round2(_num(p1[0], 0)), _round2(_num(p1[1], 0))],
      t: typeof a.t === "string" ? a.t.slice(0, MAX_NOTE_LENGTH) : "",
      colour: Math.max(0, Math.round(_num(a.colour, 0))),
    };
  }

  /**
   * How far a point is from an annotation, in CELLS. Used to decide which mark a
   * right-click meant: the box (or the endpoint pair) is what the user sees, so
   * the box is what they aim at.
   */
  function _annotDistance(a, x, y) {
    if (a.k === "text") {
      // Text is drawn from `a` rightwards and roughly one cell tall.
      var w = Math.max(1, (a.t || "").length * 0.6);
      var dx = Math.max(a.a[0] - x, 0, x - (a.a[0] + w));
      var dy = Math.max(a.a[1] - 1 - y, 0, y - (a.a[1] + 1));
      return Math.sqrt(dx * dx + dy * dy);
    }
    var x0 = Math.min(a.a[0], a.b[0]);
    var x1 = Math.max(a.a[0], a.b[0]);
    var y0 = Math.min(a.a[1], a.b[1]);
    var y1 = Math.max(a.a[1], a.b[1]);
    var gx = Math.max(x0 - x, 0, x - x1);
    var gy = Math.max(y0 - y, 0, y - y1);
    return Math.sqrt(gx * gx + gy * gy);
  }

  /** One annotation. Called twice per mark (halo, then ink) for legibility. */
  function drawAnnotShape(ctx, a, x0, y0, x1, y1, s, halo) {
    if (a.k === "arrow") {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      var ang = Math.atan2(y1 - y0, x1 - x0);
      var head = Math.max(7, (halo ? Math.max(3, s * 0.2) : Math.max(2, s * 0.12)) * 3.2);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - head * Math.cos(ang - 0.42), y1 - head * Math.sin(ang - 0.42));
      ctx.lineTo(x1 - head * Math.cos(ang + 0.42), y1 - head * Math.sin(ang + 0.42));
      ctx.closePath();
      ctx.fill();
    } else if (a.k === "ellipse") {
      var cx = (x0 + x1) / 2;
      var cy = (y0 + y1) / 2;
      var rx = Math.max(1, Math.abs(x1 - x0) / 2);
      var ry = Math.max(1, Math.abs(y1 - y0) / 2);
      ctx.beginPath();
      if (typeof ctx.ellipse === "function") ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      else ctx.arc(cx, cy, Math.max(rx, ry), 0, Math.PI * 2);
      ctx.stroke();
    } else if (a.k === "rect") {
      ctx.beginPath();
      ctx.rect(
        Math.min(x0, x1),
        Math.min(y0, y1),
        Math.abs(x1 - x0),
        Math.abs(y1 - y0),
      );
      ctx.stroke();
    } else if (a.k === "text") {
      var size = Math.max(11, s * 0.95);
      ctx.font = "600 " + Math.round(size) + "px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      var label = a.t || "";
      if (!label) return;
      if (halo) {
        // An outline of the glyphs, not a filled box: a filled box would hide
        // the stitches the label is pointing at.
        ctx.lineWidth = Math.max(3, size * 0.22);
        ctx.lineJoin = "round";
        ctx.strokeStyle = ANNOT_HALO;
        ctx.strokeText(label, x0, y0);
      } else {
        ctx.fillText(label, x0, y0);
      }
    }
  }

  /**
   * Run-length encode any byte layer as "value:count,value:count".
   *
   * `progressToRuns` above is deliberately 0/1 only. The stitch-type layers carry
   * real values (which arms, which floss index on each edge), so they need a form
   * that preserves the value, and a sparse layer (a few outlines) collapses to
   * almost nothing — which is what keeps a 250,000-cell backstitch layer out of
   * the localStorage quota and out of the saved project document.
   */
  function bytesToRuns(bytes) {
    if (!bytes || !bytes.length) return "";
    var out = [];
    var i = 0;
    while (i < bytes.length) {
      var v = bytes[i];
      var n = 1;
      while (i + n < bytes.length && bytes[i + n] === v) n++;
      out.push(v + ":" + n);
      i += n;
    }
    return out.join(",");
  }

  /** Inverse of bytesToRuns. Anything short of `length` decodes as zeros. */
  function runsToBytes(str, length) {
    var out = new Uint8Array(Math.max(0, length | 0));
    if (!str) return out;
    var parts = String(str).split(",");
    var i = 0;
    for (var p = 0; p < parts.length && i < out.length; p++) {
      var bits = parts[p].split(":");
      if (bits.length !== 2) continue;
      var v = parseInt(bits[0], 10);
      var n = parseInt(bits[1], 10);
      if (!isFinite(v) || !isFinite(n) || n <= 0) continue;
      if (v < 0) v = 0;
      if (v > 255) v = 255;
      for (var k = 0; k < n && i < out.length; k++, i++) out[i] = v;
    }
    return out;
  }

  // Multi-page charts. A chart printed across several pages is imported one page
  // at a time and each page is placed on ONE seamless grid, so the whole design
  // reads as a single chart. Cap the number of pages so a runaway import cannot
  // exhaust memory, and keep a page at least a stitch wide so a stray drag can
  // never collapse it to nothing.
  var MAX_SUBSTRATE_PAGES = 60;
  var MIN_PAGE_CELLS = 1;

  /**
   * Run-length encode a progress array into "n,n,n" where the first run counts
   * ZEROS. Progress marks come in long contiguous runs (you work a row at a
   * time), so at the 500x500 ceiling this turns 250,000 bytes into a few dozen
   * characters instead of a 250 KB localStorage entry per project.
   */
  function progressToRuns(arr) {
    var out = [];
    var run = 0;
    var cur = 0;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i] ? 1 : 0;
      if (v === cur) {
        run++;
      } else {
        out.push(run);
        cur = v;
        run = 1;
      }
    }
    out.push(run);
    return out.join(",");
  }

  /** Inverse of progressToRuns. Runs always alternate, starting with zeros. */
  function progressFromRuns(str, length) {
    var arr = new Uint8Array(length);
    if (!str) return arr;
    var parts = String(str).split(",");
    var idx = 0;
    var v = 0;
    for (var p = 0; p < parts.length && idx < length; p++) {
      var n = parseInt(parts[p], 10) || 0;
      if (v) {
        var end = Math.min(idx + n, length);
        for (; idx < end; idx++) arr[idx] = 1;
      } else {
        idx += n;
      }
      // Always flip, even for a zero-length run, to keep the alternation in sync.
      v = v ? 0 : 1;
    }
    return arr;
  }

  /** Grid colour for line index i, emphasising every 5th and 10th line. */
  function gridShade(i) {
    return gridShadeFor(i, GRID_LINE, GRID_LINE_MID, GRID_LINE_MAJOR);
  }

  /**
   * Grid colour for a line index. Takes the ABSOLUTE index, so the every-5th /
   * every-10th emphasis stays continuous across tiled PDF pages.
   */
  function gridShadeFor(i, base, mid, major) {
    if (i % MAJOR_EVERY === 0) return major;
    if (i % MID_EVERY === 0) return mid;
    return base;
  }

  function hexToRgb(hex) {
    hex = (hex || "#000000").replace("#", "");
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map(function (c) {
          return c + c;
        })
        .join("");
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  function shade(hex, percent) {
    var c = hexToRgb(hex);
    var t = percent < 0 ? 0 : 255;
    var p = Math.abs(percent) / 100;
    var r = Math.round((t - c.r) * p) + c.r;
    var g = Math.round((t - c.g) * p) + c.g;
    var b = Math.round((t - c.b) * p) + c.b;
    return "rgb(" + r + "," + g + "," + b + ")";
  }
  function luminance(hex) {
    var c = hexToRgb(hex);
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  }

  // Every route into the overlay alignment (sliders, presets, drag handles)
  // clamps through these two, so no caller can produce an unusable transform.
  function _clampOverlayScale(v) {
    if (!isFinite(v)) return 1;
    return Math.max(OVERLAY_MIN_SCALE, Math.min(OVERLAY_MAX_SCALE, v));
  }
  function _clampOverlayOffset(v) {
    if (!isFinite(v)) return 0;
    return Math.max(-OVERLAY_MAX_OFFSET, Math.min(OVERLAY_MAX_OFFSET, v));
  }

  // Multi-page helpers. A page offset/size may be fractional (half-cell nudging
  // is how two pages are joined exactly), so these coerce rather than round.
  function _num(v, fallback) {
    var n = typeof v === "number" ? v : parseFloat(v);
    return isFinite(n) ? n : fallback;
  }
  function _clamp01(v) {
    var n = _num(v, 0);
    return Math.max(0, Math.min(1, n));
  }
  /** Normalise a page rotation to 0 / 90 / 180 / 270. */
  function _pageRotation(v) {
    var n = Math.round(_num(v, 0) / 90) * 90;
    return ((n % 360) + 360) % 360;
  }

  // =========================================================== adapters ======
  // One drawing vocabulary shared by every backend (canvas / SVG / PDF) so a
  // chart renders identically on screen, in a PNG, in an SVG and in a PDF.
  // Colours are '#rrggbb' or 'rgb(r,g,b)'. All coordinates are device pixels.

  function CanvasAdapter(ctx) {
    this.ctx = ctx;
  }
  CanvasAdapter.prototype = {
    line: function (pts, st) {
      if (pts.length < 2) return;
      var c = this.ctx;
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
      c.strokeStyle = st.stroke;
      c.lineWidth = st.lineWidth || 1;
      c.lineCap = st.lineCap || "butt";
      c.lineJoin = st.lineJoin || "miter";
      c.stroke();
    },
    polygon: function (pts, st) {
      if (pts.length < 3) return;
      var c = this.ctx;
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
      c.closePath();
      if (st.fill) {
        c.fillStyle = st.fill;
        c.fill();
      }
      if (st.stroke) {
        c.strokeStyle = st.stroke;
        c.lineWidth = st.lineWidth || 1;
        c.stroke();
      }
    },
    circle: function (cx, cy, r, st) {
      var c = this.ctx;
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      if (st.fill) {
        c.fillStyle = st.fill;
        c.fill();
      }
      if (st.stroke) {
        c.strokeStyle = st.stroke;
        c.lineWidth = st.lineWidth || 1;
        c.stroke();
      }
    },
    rect: function (x, y, w, h, st) {
      var c = this.ctx;
      if (st.fill) {
        c.fillStyle = st.fill;
        c.fillRect(x, y, w, h);
      }
      if (st.stroke) {
        c.strokeStyle = st.stroke;
        c.lineWidth = st.lineWidth || 1;
        c.strokeRect(x, y, w, h);
      }
    },
    text: function (x, y, str, st) {
      var c = this.ctx;
      c.fillStyle = st.fill;
      c.font =
        (st.weight ? st.weight + " " : "") +
        (st.size || 10) +
        "px " +
        (st.family || "sans-serif");
      // Canvas spells centred text "center"; SVG's text-anchor and the PDF
      // adapter both use "middle". Canvas SILENTLY IGNORES an invalid textAlign
      // (it only accepts left|right|center|start|end), so passing "middle"
      // through left text aligned "start" and every cell code rendered from the
      // centre rightwards instead of being centred.
      var anchor = st.anchor || "center";
      c.textAlign = anchor === "middle" ? "center" : anchor;
      c.textBaseline = st.baseline || "middle";
      c.fillText(str, x, y);
    },
  };

  function escXml(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[ch];
    });
  }
  function num(v) {
    return Math.round(v * 100) / 100;
  }

  function SvgAdapter() {
    this.parts = [];
  }
  SvgAdapter.prototype = {
    line: function (pts, st) {
      if (pts.length < 2) return;
      var p = pts
        .map(function (q) {
          return num(q[0]) + "," + num(q[1]);
        })
        .join(" ");
      this.parts.push(
        '<polyline points="' +
          p +
          '" fill="none" stroke="' +
          st.stroke +
          '" stroke-width="' +
          num(st.lineWidth || 1) +
          '" stroke-linecap="' +
          (st.lineCap || "butt") +
          '" stroke-linejoin="' +
          (st.lineJoin || "miter") +
          '"/>',
      );
    },
    polygon: function (pts, st) {
      if (pts.length < 3) return;
      var p = pts
        .map(function (q) {
          return num(q[0]) + "," + num(q[1]);
        })
        .join(" ");
      this.parts.push(
        '<polygon points="' +
          p +
          '" fill="' +
          (st.fill || "none") +
          '"' +
          (st.stroke
            ? ' stroke="' + st.stroke + '" stroke-width="' + num(st.lineWidth || 1) + '"'
            : "") +
          "/>",
      );
    },
    circle: function (cx, cy, r, st) {
      this.parts.push(
        '<circle cx="' +
          num(cx) +
          '" cy="' +
          num(cy) +
          '" r="' +
          num(r) +
          '" fill="' +
          (st.fill || "none") +
          '"' +
          (st.stroke
            ? ' stroke="' + st.stroke + '" stroke-width="' + num(st.lineWidth || 1) + '"'
            : "") +
          "/>",
      );
    },
    rect: function (x, y, w, h, st) {
      this.parts.push(
        '<rect x="' +
          num(x) +
          '" y="' +
          num(y) +
          '" width="' +
          num(w) +
          '" height="' +
          num(h) +
          '" fill="' +
          (st.fill || "none") +
          '"' +
          (st.stroke
            ? ' stroke="' + st.stroke + '" stroke-width="' + num(st.lineWidth || 1) + '"'
            : "") +
          "/>",
      );
    },
    text: function (x, y, str, st) {
      var anchor = st.anchor || "center";
      var dominant =
        st.baseline === "top"
          ? "hanging"
          : st.baseline === "middle"
            ? "central"
            : "auto";
      this.parts.push(
        '<text x="' +
          num(x) +
          '" y="' +
          num(y) +
          '" fill="' +
          st.fill +
          '" font-family="' +
          escXml(st.family || "sans-serif") +
          '" font-size="' +
          num(st.size || 10) +
          '"' +
          (st.weight ? ' font-weight="' + st.weight + '"' : "") +
          ' text-anchor="' +
          anchor +
          '" dominant-baseline="' +
          dominant +
          '">' +
          escXml(str) +
          "</text>",
      );
    },
    toString: function () {
      return this.parts.join("");
    },
  };

  // ====================================================== chart drawing ======
  // The single source of truth for how a chart looks. Called with a CanvasAdapter
  // for the screen and PNG, and with an SvgAdapter for SVG export. The PDF
  // backend implements the same adapter interface, so all four outputs match.

  /**
   * Draw a PARTIAL stitch. The cell's flags describe which arms of the cross are
   * present, so this is the same geometry as the full cross split up:
   *
   *   a quarter stitch is one arm (centre to a corner),
   *   a half stitch is one diagonal, drawn as ONE continuous strand,
   *   a three-quarter stitch is a corner arm plus the diagonal that misses it.
   *
   * Drawing partials here rather than in each exporter is what gives PNG, SVG
   * and PDF fractional stitches with no exporter-specific code at all.
   */
  function drawFractional(ad, x, y, s, hex, frac, hex2) {
    var mid = s / 2;
    var cx = x + mid;
    var cy = y + mid;
    var lw = Math.max(1.2, s * 0.3);
    var inset = s * 0.08;
    // The "/" strand and the NE/SW arms belong to one leg of the cross, the "\"
    // strand and the NW/SE arms to the other — so in a blend each leg keeps its
    // own floss, and a three-quarter stitch stays consistent with the full cross.
    var slashHex = hex2 || hex;
    var bslashHex = hex;
    var stSlash = { stroke: slashHex, lineWidth: lw, lineCap: "round" };
    var stBslash = { stroke: bslashHex, lineWidth: lw, lineCap: "round" };
    // Halves first, so a three-quarter stitch's short arm reads on top of the
    // long strand it belongs to.
    if (frac & FRAC_SLASH) {
      ad.line(
        [
          [x + inset, y + s - inset],
          [x + s - inset, y + inset],
        ],
        stSlash,
      );
    }
    if (frac & FRAC_BACKSLASH) {
      ad.line(
        [
          [x + inset, y + inset],
          [x + s - inset, y + s - inset],
        ],
        stBslash,
      );
    }
    var tip = inset / 2;
    if (frac & FRAC_NW) {
      ad.line(
        [
          [cx, cy],
          [x + tip, y + tip],
        ],
        stBslash,
      );
    }
    if (frac & FRAC_NE) {
      ad.line(
        [
          [cx, cy],
          [x + s - tip, y + tip],
        ],
        stSlash,
      );
    }
    if (frac & FRAC_SE) {
      ad.line(
        [
          [cx, cy],
          [x + s - tip, y + s - tip],
        ],
        stBslash,
      );
    }
    if (frac & FRAC_SW) {
      ad.line(
        [
          [cx, cy],
          [x + tip, y + s - tip],
        ],
        stSlash,
      );
    }
  }

  /**
   * Draw the backstitch outline for a rectangle of cells.
   *
   * Backstitch lives on cell BORDERS, so every interior border is shared by two
   * cells and would be drawn TWICE — doubling its weight and making a thick,
   * smudged outline. The write path (`_canonBack`) stores each border once, on
   * the north/west slot of the cell below/right of it, so this only has to emit
   * N and W for every cell plus the S and E slots that can only ever hold the
   * grid's bottom and right border.
   *
   * `ox`/`oy` are the origin of cell (viewCol0, viewRow0), which lets the
   * paginated PDF export draw a slice without recomputing every coordinate.
   */
  function drawBackEdges(o) {
    var back = o.back;
    if (!back) return;
    var s = o.s;
    var w = o.w;
    var h = o.h;
    var lw = Math.max(1, s * BACK_LINE_RATIO);
    var hexFor = o.hexFor;
    var r0 = Math.max(0, o.r0);
    var r1 = Math.min(h - 1, o.r1);
    var c0 = Math.max(0, o.c0);
    var c1 = Math.min(w - 1, o.c1);
    for (var r = r0; r <= r1; r++) {
      for (var c = c0; c <= c1; c++) {
        var base = (r * w + c) * BACK_EDGES;
        var x = o.ox + (c - o.vc0) * s;
        var y = o.oy + (r - o.vr0) * s;
        var v = back[base + BACK_N];
        if (v) {
          o.ad.line(
            [
              [x, y],
              [x + s, y],
            ],
            { stroke: hexFor(v - 1), lineWidth: lw },
          );
        }
        v = back[base + BACK_W];
        if (v) {
          o.ad.line(
            [
              [x, y],
              [x, y + s],
            ],
            { stroke: hexFor(v - 1), lineWidth: lw },
          );
        }
        // The bottom row and right column own their outer border, because there
        // is no cell below/right to canonicalise it onto.
        if (r === h - 1) {
          v = back[base + BACK_S];
          if (v) {
            o.ad.line(
              [
                [x, y + s],
                [x + s, y + s],
              ],
              { stroke: hexFor(v - 1), lineWidth: lw },
            );
          }
        }
        if (c === w - 1) {
          v = back[base + BACK_E];
          if (v) {
            o.ad.line(
              [
                [x + s, y],
                [x + s, y + s],
              ],
              { stroke: hexFor(v - 1), lineWidth: lw },
            );
          }
        }
      }
    }
  }

  function drawStitchShape(ad, x, y, s, hex, style, hex2) {
    var inset = s * 0.16;
    var x0 = x + inset,
      y0 = y + inset,
      x1 = x + s - inset,
      y1 = y + s - inset;
    var lw = Math.max(1.2, s * 0.3);
    if (style === "slash") {
      ad.line(
        [
          [x0, y1],
          [x1, y0],
        ],
        { stroke: hex, lineWidth: lw, lineCap: "round" },
      );
    } else if (style === "backslash") {
      ad.line(
        [
          [x0, y0],
          [x1, y1],
        ],
        { stroke: hex, lineWidth: lw, lineCap: "round" },
      );
    } else {
      // Full cross: the under-strand is darkened for depth, as on screen. A BLEND
      // replaces that shading with the partner floss, so the two legs of the cross
      // are the two colours — exactly how a blend is charted.
      ad.line(
        [
          [x0, y1],
          [x1, y0],
        ],
        { stroke: hex2 || shade(hex, -22), lineWidth: lw, lineCap: "round" },
      );
      ad.line(
        [
          [x0, y0],
          [x1, y1],
        ],
        { stroke: hex, lineWidth: lw, lineCap: "round" },
      );
    }
  }

  /** Draw a built-in glyph centred in the cell, auto-contrasted on its stitch. */
  function drawGlyph(ad, x, y, s, glyphIndex, hex) {
    var table = window.StitchSymbols;
    if (!table) return;
    var prims = table.primitives(glyphIndex);
    var pad = s * 0.2;
    var k = (s - pad * 2) / 100;
    var ox = x + pad,
      oy = y + pad;
    var color = luminance(hex) > 0.55 ? "#111111" : "#ffffff";
    var lw = Math.max(1, s * table.strokeRatio);
    function m(p) {
      return [ox + p[0] * k, oy + p[1] * k];
    }
    for (var i = 0; i < prims.length; i++) {
      var g = prims[i];
      if (g.k === "line") {
        ad.line(g.p.map(m), {
          stroke: color,
          lineWidth: lw,
          lineCap: "round",
          lineJoin: "round",
        });
      } else if (g.k === "poly") {
        ad.polygon(g.p.map(m), { fill: color });
      } else if (g.k === "circle") {
        var pc = m([g.cx, g.cy]);
        ad.circle(pc[0], pc[1], g.r * k, { stroke: color, lineWidth: lw });
      } else if (g.k === "disc") {
        var pd = m([g.cx, g.cy]);
        ad.circle(pd[0], pd[1], g.r * k, { fill: color });
      }
    }
  }

  function contrastInk(hex) {
    return luminance(hex) > 0.55 ? "#111111" : "#ffffff";
  }

  /**
   * Draw a per-cell label optically centred in its cell.
   *
   * Uses an ALPHABETIC baseline with an explicit offset instead of
   * textBaseline:'middle' / dominant-baseline:'central', because those two are
   * NOT equivalent between canvas and SVG, so the label drifted off-centre.
   * Monospace advance is ~0.6em, so the size is clamped to keep long labels
   * ("White / WHT", "255 255 255") inside the cell.
   */
  function drawCellText(ad, x, y, s, str, ink) {
    str = String(str == null ? "" : str);
    if (!str) return;
    var size = Math.floor(s * 0.34);
    var byWidth = (s * 0.88) / (0.6 * Math.max(1, str.length));
    if (size > byWidth) size = Math.floor(byWidth);
    size = Math.max(5, size);
    // 0.36em below the cell centre puts the cap-height box dead centre.
    ad.text(x + s / 2, y + s / 2 + size * 0.36, str, {
      fill: ink,
      size: size,
      family: "monospace",
      anchor: "middle",
      baseline: "alphabetic",
    });
  }

  /**
   * Draw a whole chart through an adapter.
   *
   * o = {
   *   cells, width, height, cellSize,
   *   frac, back,                     // stitch-type layers (may be null)
   *   hexFor, glyphFor, codeFor,      // index -> value lookups
   *   background,                     // fill colour, or null/undefined to skip
   *   showStitch, stitchStyle, showGrid, showGlyphs, showCodes,
   *   gridColor, midGridColor, majorGridColor, majorEvery, midEvery,
   *   ruler: { gutter, every, fontSize, color, startCol, startRow, contentW, contentH }
   * }
   */
  function drawChart(o) {
    var ad = o.ad;
    var s = o.cellSize;
    var w = o.width;
    var h = o.height;
    var ox = o.offsetX || 0;
    var oy = o.offsetY || 0;
    var r, c, x, y;

    // A view restricts drawing to a rectangle of cells. Paginated PDF export
    // uses it so a 500x500 chart is not redrawn in full on every page. Cell
    // coordinates are made relative to the view, while the grid emphasis keeps
    // using absolute indices so it continues across page boundaries.
    var c0 = o.view ? o.view.col0 : 0;
    var c1 = o.view ? o.view.col1 : w - 1;
    var r0 = o.view ? o.view.row0 : 0;
    var r1 = o.view ? o.view.row1 : h - 1;
    var spanW = (c1 - c0 + 1) * s;
    var spanH = (r1 - r0 + 1) * s;

    if (o.background) {
      ad.rect(0, 0, o.canvasWidth || spanW + ox, o.canvasHeight || spanH + oy, {
        fill: o.background,
      });
    }

    for (r = r0; r <= r1; r++) {
      for (c = c0; c <= c1; c++) {
        var ci = r * w + c;
        var idx = o.cells[ci];
        if (idx < 0) continue;
        x = ox + (c - c0) * s;
        y = oy + (r - r0) * s;
        var hex = o.hexFor(idx);
        // A partial stitch is drawn as its arms instead of a whole cross. The
        // cell still holds its COLOUR, so a half or quarter stitch is counted,
        // legended and skein-estimated exactly like a full one.
        var frac = o.frac ? o.frac[ci] & FRAC_ALL : 0;
        // A BLEND draws the second leg in its partner floss instead of a shaded
        // version of the same colour.
        var bv = o.blend ? o.blend[ci] : 0;
        var hex2 = bv ? o.hexFor(bv - 1) : null;
        if (frac) {
          drawFractional(ad, x, y, s, hex, frac, hex2);
        } else if (o.showStitch && s >= 6) {
          drawStitchShape(ad, x, y, s, hex, o.stitchStyle, hex2);
        } else {
          var inset = Math.max(0.5, s * 0.08);
          ad.rect(x + inset, y + inset, s - inset * 2, s - inset * 2, {
            fill: hex,
          });
        }
        if (s >= 14) {
          if (o.showGlyphs) {
            drawGlyph(ad, x, y, s, o.glyphFor(idx), hex);
          } else if (o.showCodes) {
            drawCellText(ad, x, y, s, o.codeFor(idx), contrastInk(hex));
          }
        }
      }
    }

    // Grid as whole-chart lines rather than per-cell rectangles: visually the
    // same, but O(w+h) instead of O(4*w*h) draw calls, which matters a lot for
    // a 500x500 chart in SVG and PDF.
    if (o.showGrid && s >= 4) {
      var gc = o.gridColor || "rgba(255,255,255,0.06)";
      var mc = o.midGridColor || "rgba(255,255,255,0.14)";
      var xc = o.majorGridColor || "rgba(255,255,255,0.26)";
      var top = oy;
      var bottom = oy + spanH;
      var left = ox;
      var right = ox + spanW;
      for (c = c0; c <= c1 + 1; c++) {
        var lx = ox + (c - c0) * s + 0.5;
        ad.line(
          [
            [lx, top],
            [lx, bottom],
          ],
          { stroke: gridShadeFor(c, gc, mc, xc), lineWidth: 1 },
        );
      }
      for (r = r0; r <= r1 + 1; r++) {
        var ly = oy + (r - r0) * s + 0.5;
        ad.line(
          [
            [left, ly],
            [right, ly],
          ],
          { stroke: gridShadeFor(r, gc, mc, xc), lineWidth: 1 },
        );
      }
    }

    if (o.ruler) drawRulers(ad, o, ox, oy);

    // BACKSTITCH is drawn last: it is an outline laid OVER finished stitching,
    // never a background, so it also sits on top of the grid lines.
    if (o.back) {
      drawBackEdges({
        ad: ad,
        back: o.back,
        w: w,
        h: h,
        s: s,
        ox: ox,
        oy: oy,
        vc0: c0,
        vr0: r0,
        r0: r0,
        r1: r1,
        c0: c0,
        c1: c1,
        hexFor: o.hexFor,
      });
    }
  }

  /** Column numbers across the top and row numbers down the left. */
  function drawRulers(ad, o, ox, oy) {
    var ru = o.ruler;
    var s = o.cellSize;
    var w = o.width;
    var h = o.height;
    var g = ru.gutter;
    var every = ru.every || 10;
    var fs = ru.fontSize || 7;
    var color = ru.color || "#333333";
    // First printed number, so a chart can be numbered from 1 instead of 0.
    var labelBase = ru.startCol || 0;
    var c0 = o.view ? o.view.col0 : 0;
    var c1 = o.view ? o.view.col1 : w - 1;
    var r0 = o.view ? o.view.row0 : 0;
    var r1 = o.view ? o.view.row1 : h - 1;
    var c, r;

    // Labels use ABSOLUTE indices, so numbering continues across tiled pages.
    for (c = c0; c <= c1 + 1; c++) {
      var lx = ox + (c - c0) * s;
      ad.line(
        [
          [lx, oy - g * 0.35],
          [lx, oy],
        ],
        { stroke: color, lineWidth: 0.5 },
      );
      if (c <= c1 && (c + labelBase) % every === 0) {
        ad.text(lx + s / 2, oy - g * 0.55, String(c + labelBase), {
          fill: color,
          size: fs,
          family: "sans-serif",
          anchor: "middle",
          baseline: "alphabetic",
        });
      }
    }
    for (r = r0; r <= r1 + 1; r++) {
      var ly = oy + (r - r0) * s;
      ad.line(
        [
          [ox - g * 0.35, ly],
          [ox, ly],
        ],
        { stroke: color, lineWidth: 0.5 },
      );
      if (r <= r1 && (r + labelBase) % every === 0) {
        ad.text(ox - g * 0.5, ly + s / 2 + fs * 0.36, String(r + labelBase), {
          fill: color,
          size: fs,
          family: "sans-serif",
          anchor: "end",
          baseline: "alphabetic",
        });
      }
    }
  }

  class CrossStitchCanvas {
    constructor(canvas, options) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.opts = options || {};
      this.paletteByIndex = {};
      this.width = 0;
      this.height = 0;
      this.cells = new Int16Array(0);
      this.counts = {};
      this.cellSize = 14;
      this.minCell = 3;
      this.maxCell = 40;
      this.showGrid = true;
      this.showCodes = false; // per-cell text codes (e.g. "NVY")
      this.showGlyphs = false; // per-cell symbol glyphs, for B/W printing
      this.showStitch = true;
      this.stitchStyle = "cross"; // 'cross' | 'slash' | 'backslash'
      // STITCH TYPES. Both layers are allocated LAZILY, so a pattern that uses
      // neither pays nothing for them — neither in memory nor in a saved
      // document — which keeps the ordinary case exactly as cheap as before.
      this.frac = null; // Uint8Array, one FRAC_* flag byte per cell
      this.back = null; // Uint8Array, BACK_EDGES bytes per cell
      // BLENDED THREADS: the partner floss per cell (index + 1, 0 = none).
      this.blend = null;
      this.stitchBlend = BLEND_NONE; // partner the paint tools use
      // What the paint tools lay down: 0 = a full cross, else the FRAC_* flags
      // for one partial stitch.
      this.stitchPart = 0;
      // ANNOTATIONS + PER-CELL NOTES (on-screen only, but saved with the doc).
      this.annots = [];
      this.cellNotes = null; // sparse: "r,c" -> text
      this.annotKind = "arrow"; // 'arrow' | 'ellipse' | 'rect' | 'text'
      this.annotText = ""; // label text for the next 'text' annotation
      this._annotDrag = null; // in-progress drag: {a:[x,y], b:[x,y]}
      this._annotating = false;
      // Progress tracker. `progress` is deliberately SEPARATE from `cells` so
      // marking stitches never touches colour counts or any export.
      this.progress = null; // Uint8Array, 1 = stitched
      this.progressOn = false;
      // CHART-MARKUP MODE: the grid is deliberately EMPTY (the stitches come
      // from the imported chart's own artwork), so every cell must be markable
      // even though `cells[i] < 0`.
      this.allCellsStitchable = false;
      this.progressMode = "row"; // 'row' | 'column' | 'diagonal'
      this._markValue = 1;
      this._curUnit = null;
      // Trace overlay: a reference photo drawn ON TOP of the chart so the user
      // can stitch over it and fade it out to check their work. Painted in
      // render()/_paintCell, i.e. outside drawChart, which is what guarantees
      // it can never reach a PNG, SVG or PDF export.
      this.overlayImage = null;
      this.overlayOn = false;
      // CHART-MARKUP MODE: when true the overlay image is the SUBSTRATE — painted
      // BEFORE the chart, with a transparent chart background — so an imported
      // chart's own artwork shows through under the grid and the progress marks.
      // In pattern mode it stays on top as a tracing aid instead.
      this.overlayUnder = false;
      this.overlayOpacity = 0.5;
      // MULTI-PAGE SUBSTRATE. A chart printed across several pages is imported
      // page by page; each page is an image placed at a cell offset on the ONE
      // seamless grid ({img, col, row, cols, rows, rot, crop}). When any page is
      // present the pages ARE the substrate (overlayUnder), and `activePage` is
      // the page the Align tool edits.
      this.pages = [];
      this.activePage = 0;
      // How the photo is mapped onto the chart, and the user's manual nudge on
      // top of it. Scales are multipliers of the fitted size and offsets are
      // FRACTIONS of the chart's width/height, so none of it has to be redone
      // when the user zooms.
      this.overlayFit = "contain"; // 'contain' | 'cover' | 'stretch'
      this.overlayScaleX = 1;
      this.overlayScaleY = 1;
      this.overlayOffsetX = 0;
      this.overlayOffsetY = 0;
      this._ovDrag = null; // active handle drag: {target, start, rect}
      // Selection marquee + clipboard. The outline is drawn outside drawChart,
      // so a selection can never appear in an export.
      this.sel = null;
      this.clipboard = null;
      this._selDragging = false;
      // Locate / Spotlight: find every stitch of one colour or one symbol.
      // On-screen only, like the progress and selection overlays.
      this.spotlight = null; // {kind:'colour'|'symbol', value}
      this._spotlightSet = null; // Set of palette indices that match
      this._spotCursor = -1; // last cell jumped to (for next-unstitched)
      this.selectedIndex = -1;
      this.mode = "paint";
      this.brushSize = 1;
      this.history = [];
      this.historyIndex = -1;
      this._codeFormatter = null;
      this._ad = new CanvasAdapter(this.ctx); // reused for incremental repaints
      this._painting = false;
      this._paintValue = -1;
      this._lastCell = -1;
      // The last border the Backstitch tool touched, so a drag paints each
      // segment once instead of on every mousemove tick.
      this._lastBackKey = -1;
      // Middle-click drag pans the chart (see _beginPan). The canvas itself
      // never scrolls: its parent, .canvas-wrap, does.
      this._panning = false;
      this._panStart = null;
      this._panOrigin = null;
      this._bindEvents();
    }

    setPalette(paletteArray) {
      this.paletteByIndex = {};
      (paletteArray || []).forEach(
        function (entry) {
          this.paletteByIndex[entry.index] = entry;
        }.bind(this),
      );
    }

    hexFor(index) {
      var e = this.paletteByIndex[index];
      return e ? e.hex : "#888888";
    }
    codeFor(index) {
      var e = this.paletteByIndex[index];
      if (!e) return "";
      if (this._codeFormatter) return this._codeFormatter(e);
      return e.code || "";
    }
    /** Palette entry -> built-in glyph index (see App/static/symbols.js). */
    glyphFor(index) {
      var e = this.paletteByIndex[index];
      if (!e) return 0;
      if (typeof e.symbol === "number") return e.symbol;
      // Hand-maintained client palettes (App/static/static-adapter.js) predate
      // the symbol field. Falling back to the entry index keeps the mapping
      // identical to palette_manager.py's `index % SYMBOL_COUNT`, instead of
      // silently collapsing every colour onto glyph 0.
      return typeof e.index === "number" ? e.index : 0;
    }

    /** Options for the shared drawChart(), with per-context overrides. */
    _chartOpts(ad, s, over) {
      var self = this;
      var o = {
        ad: ad,
        cells: this.cells,
        width: this.width,
        height: this.height,
        cellSize: s,
        background: MESH,
        // STITCH TYPES. Both layers ride along with every render, so the screen,
        // the PNG, the SVG and the PDF all draw them from one code path.
        frac: this.frac,
        back: this.back,
        blend: this.blend,
        hexFor: function (i) {
          return self.hexFor(i);
        },
        glyphFor: function (i) {
          return self.glyphFor(i);
        },
        codeFor: function (i) {
          return self.codeFor(i);
        },
        showStitch: this.showStitch,
        stitchStyle: this.stitchStyle,
        showGrid: this.showGrid,
        showGlyphs: this.showGlyphs,
        showCodes: this.showCodes,
        gridColor: GRID_LINE,
        midGridColor: GRID_LINE_MID,
        majorGridColor: GRID_LINE_MAJOR,
        majorEvery: MAJOR_EVERY,
        midEvery: MID_EVERY,
      };
      if (over) {
        for (var k in over) {
          if (Object.prototype.hasOwnProperty.call(over, k)) o[k] = over[k];
        }
      }
      return o;
    }

    loadGrid(width, height, grid, frac, back, blend) {
      this.width = width;
      this.height = height;
      this.cells = new Int16Array(width * height);
      for (var r = 0; r < height; r++) {
        var row = grid[r] || [];
        for (var c = 0; c < width; c++) {
          var v = row[c];
          this.cells[r * width + c] = typeof v === "number" && v >= 0 ? v : -1;
        }
      }
      // The stitch-type layers arrive alongside the colours: `frac` one flag per
      // cell, `back` one byte per cell EDGE, `blend` the partner floss per cell.
      // Any of them may be absent.
      this.frac = frac && frac.length ? new Uint8Array(frac) : null;
      this.back = back && back.length ? new Uint8Array(back) : null;
      this.blend = blend && blend.length ? new Uint8Array(blend) : null;
      if (this.frac && this.frac.length !== width * height) this.frac = null;
      if (this.blend && this.blend.length !== width * height) this.blend = null;
      if (this.back && this.back.length !== width * height * BACK_EDGES) {
        this.back = null;
      }
      this.progress = new Uint8Array(width * height);
      this._resetSpotlight();
      this._recount();
      this.history = [];
      this.historyIndex = -1;
      this._pushHistory();
      this.fitToView();
    }

    newBlank(width, height) {
      this.width = width;
      this.height = height;
      this.cells = new Int16Array(width * height).fill(-1);
      this.frac = null;
      this.back = null;
      this.blend = null;
      // A fresh canvas has no reminders on it either.
      this.annots = [];
      this.cellNotes = null;
      this.progress = new Uint8Array(width * height);
      this._resetSpotlight();
      this._recount();
      this.history = [];
      this.historyIndex = -1;
      this._pushHistory();
      this.fitToView();
    }

    isEmpty() {
      return !this.width || !this.height;
    }

    _recount() {
      this.counts = {};
      for (var i = 0; i < this.cells.length; i++) {
        var v = this.cells[i];
        if (v >= 0) {
          this.counts[v] = (this.counts[v] || 0) + 1;
        }
      }
    }

    getCounts() {
      return this.counts;
    }

    getDesign() {
      var grid = [];
      for (var r = 0; r < this.height; r++) {
        var row = [];
        for (var c = 0; c < this.width; c++) {
          row.push(this.cells[r * this.width + c]);
        }
        grid.push(row);
      }
      return { width: this.width, height: this.height, grid: grid };
    }

    // ---- stitch-type layers ----
    // Colour lives in `cells`; these two layers describe the MARK. Exposed as
    // plain typed arrays for the renderers plus RLE strings for persistence, so
    // every consumer (draft, project, export, test harness) shares one shape.

    /** One FRAC_* flag byte per cell, or null when there are none. */
    getFrac() {
      return this.frac;
    }
    /** BACK_EDGES bytes per cell (palette index + 1), or null when there are none. */
    getBack() {
      return this.back;
    }
    setFrac(arr) {
      this.frac = arr ? new Uint8Array(arr) : null;
      this.render();
    }
    setBack(arr) {
      this.back = arr ? new Uint8Array(arr) : null;
      this.render();
    }
    /** Replace both layers at once (used when loading a document). */
    setLayers(frac, back, blend) {
      this.frac = frac && frac.length ? new Uint8Array(frac) : null;
      this.back = back && back.length ? new Uint8Array(back) : null;
      this.blend = blend && blend.length ? new Uint8Array(blend) : null;
    }
    /** The whole stitch-type state, ready to persist. Empty layers stay empty. */
    getLayers() {
      return {
        frac: this.frac ? this.frac : null,
        back: this.back ? this.back : null,
        blend: this.blend ? this.blend : null,
      };
    }

    _ensureFrac() {
      if (!this.frac) this.frac = new Uint8Array(this.width * this.height);
      return this.frac;
    }
    _ensureBack() {
      if (!this.back) {
        this.back = new Uint8Array(this.width * this.height * BACK_EDGES);
      }
      return this.back;
    }
    /** Is any cell carrying a partial stitch? */
    hasFractional() {
      if (!this.frac) return false;
      for (var i = 0; i < this.frac.length; i++) {
        if (this.frac[i]) return true;
      }
      return false;
    }
    hasBackstitch() {
      if (!this.back) return false;
      for (var i = 0; i < this.back.length; i++) {
        if (this.back[i]) return true;
      }
      return false;
    }
    /** How many partial stitches there are (for the stats readout). */
    fractionalCount() {
      var n = 0;
      if (this.frac) {
        for (var i = 0; i < this.frac.length; i++) {
          if (this.frac[i]) n++;
        }
      }
      return n;
    }
    /**
     * How long the backstitch outline is, in SEGMENTS. A backstitch length is
     * quoted in stitches on a chart, so counting the segments is the honest
     * number to show next to the stitch count.
     */
    backSegmentCount() {
      var n = 0;
      if (this.back) {
        for (var i = 0; i < this.back.length; i++) {
          if (this.back[i]) n++;
        }
      }
      return n;
    }

    /**
     * Backstitch segments per palette index, for the legend and the shopping
     * list. A colour used ONLY as an outline has no cells, so nothing in
     * `getCounts()` would ever mention it — and a chart outlined in 310 would
     * then ask you to buy everything except the black.
     */
    backCounts() {
      var out = {};
      if (!this.back) return out;
      for (var i = 0; i < this.back.length; i++) {
        var v = this.back[i];
        if (!v) continue;
        var idx = v - 1;
        out[idx] = (out[idx] || 0) + 1;
      }
      return out;
    }

    /** What the paint tools lay down: 0 = a full cross, else FRAC_* flags. */
    setStitchPart(flags) {
      var v = typeof flags === "number" ? flags : 0;
      this.stitchPart = (v & FRAC_ALL) | 0;
    }
    stitchPartFlags() {
      return this.stitchPart;
    }

    // ---- blended threads ----
    // Two flosses held together in one stitch. `cells` keeps the PRIMARY colour;
    // `blend` names the partner, so a blend is an extra strand rather than a
    // synthetic palette entry — which is what keeps the colour count, the legend
    // and the skein maths working.

    /** One byte per cell: partner palette index + 1, 0 when the cell is solid. */
    getBlend() {
      return this.blend;
    }
    setBlend(arr) {
      this.blend = arr ? new Uint8Array(arr) : null;
      this.render();
    }
    _ensureBlend() {
      if (!this.blend) this.blend = new Uint8Array(this.width * this.height);
      return this.blend;
    }
    /** The partner floss on a cell, or -1 when it is a solid colour. */
    blendAt(r, c) {
      if (!this.blend) return BLEND_NONE;
      if (r < 0 || c < 0 || r >= this.height || c >= this.width) return BLEND_NONE;
      var v = this.blend[r * this.width + c];
      return v ? v - 1 : BLEND_NONE;
    }
    /**
     * Set a cell's partner floss. A partner equal to the cell's own colour is not
     * a blend, so it is stored as none — otherwise the legend would grow a row
     * for "A + A" and the skein maths would double-count.
     */
    setBlendAt(r, c, index) {
      if (r < 0 || c < 0 || r >= this.height || c >= this.width) return false;
      var i = r * this.width + c;
      var primary = this.cells[i];
      var want = index >= 0 && index !== primary ? index + 1 : 0;
      var cur = this.blend ? this.blend[i] : 0;
      if (cur === want) return false;
      if (!want && !this.blend) return false;
      this._ensureBlend()[i] = want;
      return true;
    }
    /** Partner the paint tools lay down, or -1 for a solid colour. */
    setBlendPartner(index) {
      var v = _num(index, BLEND_NONE);
      this.stitchBlend = v >= 0 ? Math.round(v) : BLEND_NONE;
    }
    blendPartner() {
      return this.stitchBlend;
    }
    hasBlends() {
      if (!this.blend) return false;
      for (var i = 0; i < this.blend.length; i++) {
        if (this.blend[i]) return true;
      }
      return false;
    }
    blendCount() {
      var n = 0;
      if (this.blend) {
        for (var i = 0; i < this.blend.length; i++) {
          if (this.blend[i]) n++;
        }
      }
      return n;
    }
    /**
     * Blended stitches grouped by PAIR, as "primary,partner" -> count, for the
     * legend. A blend needs BOTH flosses on the shopping list, so the pair is the
     * unit — not either colour on its own.
     */
    blendCounts() {
      var out = {};
      if (!this.blend) return out;
      for (var i = 0; i < this.blend.length; i++) {
        var v = this.blend[i];
        if (!v) continue;
        var primary = this.cells[i];
        if (primary < 0) continue;
        var key = primary + "," + (v - 1);
        out[key] = (out[key] || 0) + 1;
      }
      return out;
    }
    /** The FRAC_* flags placed on a cell (0 = a full cross). */
    fracAt(r, c) {
      if (!this.frac) return 0;
      if (r < 0 || c < 0 || r >= this.height || c >= this.width) return 0;
      return this.frac[r * this.width + c] & FRAC_ALL;
    }
    /** Set a cell's partial stitch outright (0 makes it a full cross again). */
    setFracAt(r, c, flags) {
      if (r < 0 || c < 0 || r >= this.height || c >= this.width) return false;
      var v = (flags | 0) & FRAC_ALL;
      var cur = this.frac ? this.frac[r * this.width + c] : 0;
      if (cur === v) return false;
      if (!v && !this.frac) return false; // nothing to clear and nothing to set
      this._ensureFrac()[r * this.width + c] = v;
      return true;
    }

    /**
     * The canonical slot for a backstitch edge, so a border shared by two cells
     * is stored ONCE: horizontal borders belong to the SOUTH cell's N slot and
     * vertical borders to the EAST cell's W slot. A border on the edge of the
     * grid has no neighbour to own it, so it stays on its own cell.
     *
     * Without this, painting the same border from either side would create two
     * independent segments and erasing one would appear not to work.
     */
    _canonBack(r, c, edge) {
      if (edge === BACK_S && r + 1 < this.height) {
        return { r: r + 1, c: c, e: BACK_N };
      }
      if (edge === BACK_E && c + 1 < this.width) {
        return { r: r, c: c + 1, e: BACK_W };
      }
      return { r: r, c: c, e: edge & 3 };
    }

    /** Place (index >= 0) or clear (index < 0) one backstitch segment. */
    setBackEdge(r, c, edge, index) {
      if (r < 0 || c < 0 || r >= this.height || c >= this.width) return false;
      var t = this._canonBack(r, c, edge);
      var i = (t.r * this.width + t.c) * BACK_EDGES + t.e;
      var v = index >= 0 ? Math.min(255, index + 1) : 0;
      var back = this._ensureBack();
      if (back[i] === v) return false;
      back[i] = v;
      return true;
    }

    /** The palette index of a segment, or -1 when that edge is bare. */
    backEdgeAt(r, c, edge) {
      if (!this.back) return -1;
      if (r < 0 || c < 0 || r >= this.height || c >= this.width) return -1;
      var t = this._canonBack(r, c, edge);
      var v = this.back[(t.r * this.width + t.c) * BACK_EDGES + t.e];
      return v ? v - 1 : -1;
    }

    /** Every placed segment in a block, deduplicated across shared borders. */
    _blockBackEdges(n) {
      var out = [];
      var seen = {};
      for (var r = n.r0; r <= n.r1; r++) {
        for (var c = n.c0; c <= n.c1; c++) {
          for (var e = 0; e < BACK_EDGES; e++) {
            var v = this.backEdgeAt(r, c, e);
            if (v < 0) continue;
            var t = this._canonBack(r, c, e);
            var key = (t.r * this.width + t.c) * BACK_EDGES + t.e;
            if (seen[key]) continue;
            seen[key] = 1;
            out.push({ r: r, c: c, e: e, v: v });
          }
        }
      }
      return out;
    }

    /** Remove every backstitch edge touching a block, borders included. */
    _clearBlockBack(n) {
      if (!this.back) return;
      for (var r = n.r0; r <= n.r1; r++) {
        for (var c = n.c0; c <= n.c1; c++) {
          for (var e = 0; e < BACK_EDGES; e++) this.setBackEdge(r, c, e, -1);
        }
      }
    }

    stitchCount() {
      var total = 0;
      for (var k in this.counts) {
        total += this.counts[k];
      }
      return total;
    }
    colorCount() {
      return Object.keys(this.counts).length;
    }

    // ---- rendering ----
    fitToView() {
      var wrap = this.canvas.parentElement;
      if (!wrap || !this.width) {
        this.render();
        return;
      }
      var availW = wrap.clientWidth - 20;
      var availH = Math.max(wrap.clientHeight - 20, 320);
      var size = Math.floor(
        Math.min(availW / this.width, availH / this.height),
      );
      this.cellSize = Math.max(
        this.minCell,
        Math.min(this.maxCell, size || this.minCell),
      );
      this.render();
    }

    setZoom(delta) {
      this.cellSize = Math.max(
        this.minCell,
        Math.min(this.maxCell, this.cellSize + delta),
      );
      this.render();
    }
    zoomPercent() {
      return Math.round((this.cellSize / 14) * 100);
    }

    render() {
      if (!this.width) return;
      var s = this.cellSize;
      this.canvas.width = this.width * s;
      this.canvas.height = this.height * s;
      this.canvas.hidden = false;
      if (this.overlayUnder) {
        // CHART-MARKUP MODE. The imported artwork is the substrate: paint it
        // first, then draw the chart over it with a transparent background so
        // the grid and the marks read on top of the original drawing.
        var ctx0 = this.ctx;
        ctx0.fillStyle = MESH;
        ctx0.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this._drawOverlay();
        drawChart(this._chartOpts(this._ad, s, { background: null }));
      } else {
        // PATTERN MODE. Full repaint through the shared adapter layer, so what is
        // on screen is produced by exactly the same code that produces the
        // PNG/SVG/PDF.
        drawChart(this._chartOpts(this._ad, s, {}));
        // The reference photo (on screen only) sits on top of the chart, where a
        // tracing aid belongs.
        this._drawOverlay();
      }
      // Progress and selection overlays come after so they stay readable, and all
      // of this is drawn OUTSIDE drawChart so it can never reach an export.
      this._drawSpotlightOverlay();
      this._drawProgressOverlay();
      // Annotations and note flags sit over the chart (and over the progress
      // wash), because they are the things you need to SEE while stitching.
      this._drawAnnotations();
      this._drawCellNotes();
      this._drawSelectionOverlay();
      // Alignment frame + stretch handles, also on-screen only.
      this._drawOverlayHandles();
    }

    _paintCell(r, c, clearFirst) {
      var s = this.cellSize;
      var x = c * s;
      var y = r * s;
      var ctx = this.ctx;
      if (clearFirst) {
        ctx.fillStyle = MESH;
        ctx.fillRect(x, y, s, s);
        // In chart-markup mode the substrate is repainted here too, or marking a
        // cell would punch a hole in the imported artwork.
        if (this.overlayUnder) this._drawOverlay(x, y, s, s);
      }
      var idx = this.cells[r * this.width + c];
      if (idx >= 0) {
        var hex = this.hexFor(idx);
        var frac = this.frac ? this.frac[r * this.width + c] & FRAC_ALL : 0;
        var bv = this.blend ? this.blend[r * this.width + c] : 0;
        var hex2 = bv ? this.hexFor(bv - 1) : null;
        if (frac) {
          drawFractional(this._ad, x, y, s, hex, frac, hex2);
        } else if (this.showStitch && s >= 6) {
          drawStitchShape(this._ad, x, y, s, hex, this.stitchStyle, hex2);
        } else {
          var inset = Math.max(0.5, s * 0.08);
          ctx.fillStyle = hex;
          ctx.fillRect(x + inset, y + inset, s - inset * 2, s - inset * 2);
        }
        if (s >= 14) {
          if (this.showGlyphs) {
            drawGlyph(this._ad, x, y, s, this.glyphFor(idx), hex);
          } else if (this.showCodes) {
            drawCellText(this._ad, x, y, s, this.codeFor(idx), contrastInk(hex));
          }
        }
      }
      // Redraw this cell's four edges individually (rather than one rectangle)
      // so the every-5th/10th emphasis survives an incremental repaint.
      if (this.showGrid && s >= 4) {
        var x2 = x + s;
        var y2 = y + s;
        var ad = this._ad;
        ad.line([[x + 0.5, y], [x + 0.5, y2]], { stroke: gridShade(c), lineWidth: 1 });
        ad.line([[x2 + 0.5, y], [x2 + 0.5, y2]], { stroke: gridShade(c + 1), lineWidth: 1 });
        ad.line([[x, y + 0.5], [x2, y + 0.5]], { stroke: gridShade(r), lineWidth: 1 });
        ad.line([[x, y2 + 0.5], [x2, y2 + 0.5]], { stroke: gridShade(r + 1), lineWidth: 1 });
      }
      // Backstitch goes over the stitch and the grid, exactly as it does in the
      // full render, so an incremental repaint cannot reorder the layers.
      this._paintBackCell(r, c, x, y, s);
      // Re-apply the reference photo over just this cell, otherwise painting a
      // stitch would punch a hole in the tracing overlay. In chart-markup mode the
      // artwork is the substrate and was already redrawn above.
      if (!this.overlayUnder) this._drawOverlay(x, y, s, s);
      this._paintSpotlightCell(r, c);
      this._paintProgressCell(r, c);
      // The note flag belongs to the cell, so it has to come back with it.
      this._paintNoteFlag(r, c);
    }

    // ---- options ----
    setOption(key, value) {
      if (key === "showGrid") this.showGrid = value;
      else if (key === "showCodes") this.showCodes = value;
      else if (key === "showGlyphs") this.showGlyphs = value;
      else if (key === "showStitch") this.showStitch = value;
      this.render();
    }
    setCodeFormatter(fn) {
      this._codeFormatter = fn || null;
      this.render();
    }
    setSelected(index) {
      this.selectedIndex = index;
    }
    setMode(mode) {
      if (this.mode !== mode) this._clearOverlayCursor();
      this.mode = mode;
    }
    setBrushSize(size) {
      this.brushSize = parseInt(size, 10) || 1;
    }
    setStitchStyle(style) {
      this.stitchStyle =
        style === "slash" || style === "backslash" ? style : "cross";
      this.render();
    }

    // ---- locate / spotlight ----
    // Dim the chart and ring every stitch of ONE colour or ONE symbol, so
    // "where is this colour?" or "find symbol #12" is answered instantly.
    // Drawn outside drawChart (see render()), so exports are never affected.

    /** Drop the spotlight without a repaint or a notification (internal). */
    _resetSpotlight() {
      this.spotlight = null;
      this._spotlightSet = null;
      this._spotCursor = -1;
    }

    /** Palette indices that match a spotlight spec. */
    _spotlightIndices(spec) {
      var set = new Set();
      if (!spec) return set;
      if (spec.kind === "colour") {
        if (typeof spec.value === "number") set.add(spec.value);
        return set;
      }
      var self = this;
      Object.keys(this.paletteByIndex).forEach(function (k) {
        if (self.glyphFor(self.paletteByIndex[k].index) === spec.value) {
          set.add(self.paletteByIndex[k].index);
        }
      });
      return set;
    }

    /** Spot a colour: {kind:'colour', value:index}. Pass null to clear. */
    setSpotlight(spec) {
      if (!spec || spec.value === null || spec.value === undefined) {
        this.clearSpotlight();
        return;
      }
      this.spotlight = spec;
      this._spotlightSet = this._spotlightIndices(spec);
      this._spotCursor = -1;
      this.render();
      this._notifySpotlight();
    }

    /** Spot every stitch sharing a symbol: {kind:'symbol', value:glyph}. */
    setSpotlightSymbol(glyph) {
      this.setSpotlight({ kind: "symbol", value: glyph });
    }

    clearSpotlight() {
      if (!this.spotlight) return;
      this._resetSpotlight();
      this.render();
      this._notifySpotlight();
    }

    hasSpotlight() {
      return !!this.spotlight;
    }

    /** Number of stitches in the chart matching the current spotlight. */
    spotlightCount() {
      if (!this._spotlightSet || !this.width) return 0;
      var n = 0;
      for (var i = 0; i < this.cells.length; i++) {
        if (this.cells[i] >= 0 && this._spotlightSet.has(this.cells[i])) n++;
      }
      return n;
    }

    /** Next unstitched matching cell, cycling. Returns {r,c} or null. */
    nextUnstitched() {
      if (!this._spotlightSet || !this.width) return null;
      var total = this.cells.length;
      for (var step = 1; step <= total; step++) {
        var i = (this._spotCursor + step + total) % total;
        var idx = this.cells[i];
        if (idx < 0 || !this._spotlightSet.has(idx)) continue;
        if (this.progress && this.progress[i] === 1) continue; // already done
        this._spotCursor = i;
        return { r: Math.floor(i / this.width), c: i % this.width };
      }
      return null;
    }

    _notifySpotlight() {
      if (typeof this.opts.onSpotlightChange === "function") {
        this.opts.onSpotlightChange({
          spec: this.spotlight,
          count: this.spotlightCount(),
        });
      }
    }

    /** Full-canvas spotlight. Non-matching STITCHES are dimmed in runs; empty
     *  cells are left alone so an unfinished chart keeps its grid. */
    _drawSpotlightOverlay() {
      if (!this._spotlightSet || !this.width) return;
      var s = this.cellSize;
      var ctx = this.ctx;
      var w = this.width;
      var h = this.height;
      var set = this._spotlightSet;
      var r;
      var c;
      ctx.fillStyle = SPOTLIGHT_DIM;
      for (r = 0; r < h; r++) {
        var start = -1;
        for (c = 0; c <= w; c++) {
          var idx = c < w ? this.cells[r * w + c] : -2;
          var dim = c < w && idx >= 0 && !set.has(idx);
          if (dim && start < 0) start = c;
          else if (!dim && start >= 0) {
            ctx.fillRect(start * s, r * s, (c - start) * s, s);
            start = -1;
          }
        }
      }
      this._ringMatches();
    }

    /** Amber ring on every matching stitch (only needed when cells are big). */
    _ringMatches() {
      if (!this._spotlightSet || this.cellSize < 5) return;
      var s = this.cellSize;
      var ctx = this.ctx;
      var set = this._spotlightSet;
      var w = this.width;
      ctx.strokeStyle = SPOTLIGHT_RING;
      ctx.lineWidth = Math.max(1.5, s * 0.14);
      for (var r = 0; r < this.height; r++) {
        for (var c = 0; c < w; c++) {
          var v = this.cells[r * w + c];
          if (v >= 0 && set.has(v)) ctx.strokeRect(c * s + 1, r * s + 1, s - 2, s - 2);
        }
      }
    }

    /** Spotlight for a single cell, used by incremental repaints. */
    _paintSpotlightCell(r, c) {
      if (!this._spotlightSet) return;
      var s = this.cellSize;
      var ctx = this.ctx;
      var idx = this.cells[r * this.width + c];
      if (idx >= 0 && this._spotlightSet.has(idx)) {
        if (s >= 5) {
          ctx.strokeStyle = SPOTLIGHT_RING;
          ctx.lineWidth = Math.max(1.5, s * 0.14);
          ctx.strokeRect(c * s + 1, r * s + 1, s - 2, s - 2);
        }
      } else if (idx >= 0) {
        // Dim other stitches only; leave empty cells showing the grid.
        ctx.fillStyle = SPOTLIGHT_DIM;
        ctx.fillRect(c * s, r * s, s, s);
      }
    }

    // ---- annotations + per-cell notes ----
    // Your own reminders about the chart: "check this column", "the blue here is
    // a substitute", an arrow at the row you stopped on. Drawn outside
    // drawChart(), so like the spotlight and the progress wash they can never
    // reach a PNG, SVG or PDF — a chart printed for someone else should not carry
    // your margin notes.

    setAnnotations(list) {
      var out = [];
      var src = list || [];
      for (var i = 0; i < src.length && out.length < MAX_ANNOTATIONS; i++) {
        out.push(_normAnnot(src[i]));
      }
      this.annots = out;
      this.render();
    }
    annotations() {
      return this.annots.slice();
    }
    annotationCount() {
      return this.annots.length;
    }
    /** Add one annotation. Returns false once the layer is full. */
    addAnnotation(a) {
      if (this.annots.length >= MAX_ANNOTATIONS) return false;
      this.annots.push(_normAnnot(a));
      this.render();
      return true;
    }
    clearAnnotations() {
      var had = this.annots.length > 0;
      this.annots = [];
      this.render();
      return had;
    }
    /** Remove the topmost annotation within `tol` canvas pixels of a point. */
    removeAnnotationNear(px, py, tol) {
      var s = this.cellSize || 1;
      var limit = (tol || 10) / s;
      for (var i = this.annots.length - 1; i >= 0; i--) {
        if (_annotDistance(this.annots[i], px / s, py / s) <= limit) {
          this.annots.splice(i, 1);
          this.render();
          return true;
        }
      }
      return false;
    }
    setAnnotKind(kind) {
      this.annotKind = ANNOT_KINDS[kind] ? kind : "arrow";
    }
    setAnnotText(text) {
      this.annotText = String(text == null ? "" : text).slice(0, MAX_NOTE_LENGTH);
    }
    /** Preview while an annotation is being dragged out. */
    setAnnotPreview(a, b, colour) {
      this._annotDrag = a
        ? { k: this.annotKind, a: a, b: b || a, t: this.annotText, colour: colour || 0 }
        : null;
      this.render();
    }

    /** Replace the whole note map. Sparse: only cells with notes are stored. */
    setCellNotes(map) {
      this.cellNotes = null;
      if (map) {
        var out = {};
        var n = 0;
        for (var k in map) {
          if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
          var m = /^(\d+),(\d+)$/.exec(String(k));
          if (!m) continue;
          var r = parseInt(m[1], 10);
          var c = parseInt(m[2], 10);
          if (r < 0 || c < 0 || r >= this.height || c >= this.width) continue;
          var text = String(map[k] == null ? "" : map[k]).slice(0, MAX_NOTE_LENGTH).trim();
          if (!text) continue;
          out[r + "," + c] = text;
          if (++n >= MAX_CELL_NOTES) break;
        }
        if (n) this.cellNotes = out;
      }
      this.render();
    }
    cellNotesMap() {
      return this.cellNotes ? Object.assign({}, this.cellNotes) : {};
    }
    cellNoteAt(r, c) {
      if (!this.cellNotes) return "";
      var v = this.cellNotes[r + "," + c];
      return v === undefined ? "" : v;
    }
    cellNoteCount() {
      return this.cellNotes ? Object.keys(this.cellNotes).length : 0;
    }
    /** Set (or clear, with empty text) one cell's note. */
    setCellNote(r, c, text) {
      if (r < 0 || c < 0 || r >= this.height || c >= this.width) return false;
      var key = r + "," + c;
      var clean = String(text == null ? "" : text).slice(0, MAX_NOTE_LENGTH).trim();
      var had = this.cellNotes ? this.cellNotes[key] : undefined;
      if (!clean) {
        if (had === undefined) return false;
        delete this.cellNotes[key];
        if (!Object.keys(this.cellNotes).length) this.cellNotes = null;
        this._paintCell(r, c, true);
        return true;
      }
      if (had === clean) return false;
      if (!this.cellNotes) this.cellNotes = {};
      if (had === undefined && this.cellNoteCount() >= MAX_CELL_NOTES) return false;
      this.cellNotes[key] = clean;
      this._paintCell(r, c, true);
      return true;
    }

    /** Draw every annotation, plus the one being dragged. On screen only. */
    _drawAnnotations() {
      if ((!this.annots.length && !this._annotDrag) || !this.width) return;
      var s = this.cellSize || 1;
      var ctx = this.ctx;
      var list = this._annotDrag ? this.annots.concat([this._annotDrag]) : this.annots;
      ctx.save();
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        var x0 = a.a[0] * s;
        var y0 = a.a[1] * s;
        var x1 = a.b[0] * s;
        var y1 = a.b[1] * s;
        // Drawn TWICE: a dark halo first, then the ink. One pass alone is
        // illegible against either pale or dark stitches.
        ctx.lineWidth = Math.max(3, s * 0.2);
        ctx.strokeStyle = ANNOT_HALO;
        ctx.fillStyle = ANNOT_HALO;
        drawAnnotShape(ctx, a, x0, y0, x1, y1, s, true);
        var lw = Math.max(2, s * 0.12);
        ctx.lineWidth = lw;
        ctx.strokeStyle = this.hexFor(a.colour);
        ctx.fillStyle = this.hexFor(a.colour);
        drawAnnotShape(ctx, a, x0, y0, x1, y1, s, false);
      }
      ctx.restore();
    }

    /** A small corner flag on every cell that carries a note. */
    _drawCellNotes() {
      if (!this.cellNotes || !this.width) return;
      var s = this.cellSize || 1;
      if (s < 5) return;
      var ctx = this.ctx;
      var k = Math.max(4, s * 0.32);
      ctx.save();
      ctx.fillStyle = NOTE_FLAG;
      for (var key in this.cellNotes) {
        if (!Object.prototype.hasOwnProperty.call(this.cellNotes, key)) continue;
        var m = /^(\d+),(\d+)$/.exec(key);
        if (!m) continue;
        var x = parseInt(m[2], 10) * s + s;
        var y = parseInt(m[1], 10) * s;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - k, y);
        ctx.lineTo(x, y + k);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    /** The flag for one cell, for an incremental repaint. */
    _paintNoteFlag(r, c) {
      if (!this.cellNotes || !this.cellNotes[r + "," + c]) return;
      var s = this.cellSize || 1;
      if (s < 5) return;
      var ctx = this.ctx;
      var k = Math.max(4, s * 0.32);
      var x = c * s + s;
      var y = r * s;
      ctx.save();
      ctx.fillStyle = NOTE_FLAG;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - k, y);
      ctx.lineTo(x, y + k);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    /** Cell coordinates (fractional) under a pointer event. */
    _cellPointFromEvent(e) {
      var pt = this._pointFromEvent(e);
      if (!pt) return null;
      var s = this.cellSize || 1;
      return { x: pt.x / s, y: pt.y / s };
    }

    /**
     * Start an annotation. A shape is dragged out; a LABEL is placed on a single
     * click, because dragging text to size it would be a worse joke than it
     * sounds.
     */
    _beginAnnot(e) {
      var pt = this._cellPointFromEvent(e);
      if (!pt) return false;
      if (this.annotKind === "text") {
        if (!this.annotText) return false;
        if (!this.addAnnotation({
          k: "text",
          a: [pt.x, pt.y],
          b: [pt.x, pt.y],
          t: this.annotText,
          colour: this.selectedIndex,
        })) {
          return false;
        }
        this._pushHistory();
        this._notify();
        return true;
      }
      this._annotating = true;
      this._annotDrag = {
        k: this.annotKind,
        a: [pt.x, pt.y],
        b: [pt.x, pt.y],
        t: this.annotText,
        colour: this.selectedIndex,
      };
      this.render();
      return true;
    }

    _annotDragTo(e) {
      if (!this._annotDrag) return;
      var pt = this._cellPointFromEvent(e);
      if (!pt) return;
      this._annotDrag.b = [pt.x, pt.y];
      this.render();
    }

    _endAnnot() {
      if (!this._annotating) return false;
      this._annotating = false;
      var a = this._annotDrag;
      this._annotDrag = null;
      if (!a) {
        this.render();
        return false;
      }
      // A stray click is not a mark: a deliberate one always spans some cells.
      if (Math.abs(a.b[0] - a.a[0]) < 0.3 && Math.abs(a.b[1] - a.a[1]) < 0.3) {
        this.render();
        return false;
      }
      if (this.annots.length >= MAX_ANNOTATIONS) {
        this.render();
        return false;
      }
      a.a = [_round2(a.a[0]), _round2(a.a[1])];
      a.b = [_round2(a.b[0]), _round2(a.b[1])];
      this.annots.push(a);
      this.render();
      this._pushHistory();
      this._notify();
      return true;
    }

    // ---- read the chart ----
    // Best-effort colour reading for an imported chart. The palette is the only
    // colour vocabulary a document has, so "reading" a chart means snapping what
    // we sample from its artwork to the nearest palette entry. Nothing here is
    // authoritative: the user corrects it with the eyedropper or by painting.

    /** Nearest palette index for an RGB triple (simple squared distance). */
    nearestPaletteIndex(r, g, b) {
      var best = -1;
      var bestD = Infinity;
      for (var k in this.paletteByIndex) {
        var e = this.paletteByIndex[k];
        var c = hexToRgb(e.hex);
        var d =
          (c.r - r) * (c.r - r) + (c.g - g) * (c.g - g) + (c.b - b) * (c.b - b);
        if (d < bestD) {
          bestD = d;
          best = e.index;
        }
      }
      return best;
    }

    /**
     * Sample the SUBSTRATE artwork cell by cell and snap each cell to the
     * nearest palette entry.
     *
     * The artwork is redrawn offscreen at the chart's own geometry (honouring the
     * user's alignment) at READ_SUPERSAMPLE samples per cell, and each cell keeps
     * its most "inky" sample rather than an average — averaging a thin symbol
     * stroke against paper washes it out. All-paper cells are left empty.
     *
     * Returns a new Int16Array, or null when there is nothing to read.
     */
    readSubstrateGrid() {
      if (!this.width || !this.height) return null;
      var hasPages = this.pages.length > 0;
      if (!hasPages && !(this.overlayOn && this.overlayImage)) return null;
      if (typeof document === "undefined") return null;
      var w = this.width;
      var h = this.height;
      var s = this.cellSize || 20;
      var k = READ_SUPERSAMPLE;
      var off = document.createElement("canvas");
      off.width = w * k;
      off.height = h * k;
      var octx = off.getContext("2d", { willReadFrequently: true });
      if (!octx || typeof octx.getImageData !== "function") return null;
      // Map CELL units onto the supersampled buffer and reuse the SAME drawing
      // code as the screen, so every page is read exactly where it is displayed
      // (and a single-page chart reads identically to before).
      octx.save();
      octx.scale(k / s, k / s);
      this._drawOverlay(null, null, null, null, octx, true);
      octx.restore();
      var data = octx.getImageData(0, 0, w * k, h * k).data;
      var out = new Int16Array(w * h);
      out.fill(-1);
      for (var r = 0; r < h; r++) {
        for (var c = 0; c < w; c++) {
          var br = 0;
          var bg = 0;
          var bb = 0;
          var bestInk = -1;
          for (var dy = 0; dy < k; dy++) {
            for (var dx = 0; dx < k; dx++) {
              var px = c * k + dx;
              var py = r * k + dy;
              var i = (py * w * k + px) * 4;
              // Nothing was drawn here. Joined pages leave L-shaped gaps and
              // ragged edges, and an untouched sample is transparent — treating
              // it as "ink" would read every uncovered cell as black.
              if (data[i + 3] < 8) continue;
              var rr = data[i];
              var gg = data[i + 1];
              var bl = data[i + 2];
              // "Inkiness" = how far the sample is from white, so the darkest OR
              // most saturated pixel in the cell wins over the paper around it.
              var ink = 255 - Math.min(rr, gg, bl);
              if (ink > bestInk) {
                bestInk = ink;
                br = rr;
                bg = gg;
                bb = bl;
              }
            }
          }
          if (bestInk < READ_MIN_INK) continue; // all paper: no stitch here
          out[r * w + c] = this.nearestPaletteIndex(br, bg, bb);
        }
      }
      return out;
    }

    /** Replace the whole grid from a read pass (undoable, like any other edit). */
    applyReadGrid(arr) {
      if (!arr || arr.length !== this.cells.length) return false;
      this.cells.set(arr);
      // A read REPLACES the marks, so any partial stitches, outlines or blends the
      // user had drawn no longer describe this chart and go with them.
      this.frac = null;
      this.back = null;
      this.blend = null;
      this._recount();
      this._pushHistory();
      this.render();
      this._notify();
      return true;
    }

    /** Eyedropper: sample the colour under the pointer, in palette terms. */
    _pickAt(e) {
      var pt = this._pointFromEvent(e);
      if (!pt) return;
      var x = Math.max(0, Math.min(this.canvas.width - 1, Math.floor(pt.x)));
      var y = Math.max(0, Math.min(this.canvas.height - 1, Math.floor(pt.y)));
      var d;
      try {
        d = this.ctx.getImageData(x, y, 1, 1).data;
      } catch (err) {
        return; // a tainted canvas cannot be read; nothing to pick
      }
      var idx = this.nearestPaletteIndex(d[0], d[1], d[2]);
      if (idx >= 0 && typeof this.opts.onPick === "function") {
        this.opts.onPick(idx);
      }
    }

    // ---- multi-page substrate ----
    // MOST REAL CHARTS COME AS SEVERAL PAGES. Each imported page becomes a
    // substrate image placed at a CELL offset on the one seamless grid, so the
    // pages join into a single design: the legend, Locate/Spotlight, the stitch
    // count and your progress all see one chart rather than a pile of fragments.
    //
    // Everything here is drawn outside drawChart, exactly like the single trace
    // photo, so a substrate can never reach a PNG, SVG or PDF export.
    //
    // BRINGING A PAGE "ONTO THE GRID": `cols`/`rows` are how many of the
    // chart's own cells that page covers, and `col`/`row` are where it starts.
    // Appending a page at the current right edge is therefore the seamless join,
    // and it is why adding a page later cannot disturb existing markup — the
    // marks keep their cell coordinates because the grid only ever grows.

    /** Replace the substrate pages. An empty list leaves substrate mode. */
    setSubstratePages(pages) {
      var list = pages || [];
      if (list.length > MAX_SUBSTRATE_PAGES) list = list.slice(0, MAX_SUBSTRATE_PAGES);
      this.pages = list.map(function (p) {
        return {
          img: p.img || null,
          col: _num(p.col, 0),
          row: _num(p.row, 0),
          cols: Math.max(MIN_PAGE_CELLS, _num(p.cols, MIN_PAGE_CELLS)),
          rows: Math.max(MIN_PAGE_CELLS, _num(p.rows, MIN_PAGE_CELLS)),
          rot: _pageRotation(p.rot),
          crop: p.crop || null,
        };
      });
      if (this.activePage >= this.pages.length) this.activePage = 0;
      if (this.activePage < 0) this.activePage = 0;
      // Pages present => they are the artwork: the chart is drawn with a
      // transparent background over them, and every empty cell is markable.
      this.overlayUnder = this.pages.length > 0;
      if (this.pages.length) this.overlayOn = true;
      this.render();
    }

    /** Light copy of the pages (images included), for the UI and the tests. */
    substratePages() {
      return this.pages.slice();
    }

    setActivePage(index) {
      var i = Math.round(_num(index, 0));
      this.activePage = Math.max(0, Math.min(this.pages.length - 1, i));
      this.render();
    }

    activePageIndex() {
      return this.activePage;
    }

    /** The page the Align tool is editing, or null. */
    activePage() {
      return this.pages[this.activePage] || null;
    }

    /** A page's footprint on the chart, in canvas pixels. */
    pageRect(p) {
      var s = this.cellSize || 1;
      return { x: p.col * s, y: p.row * s, w: p.cols * s, h: p.rows * s };
    }

    /** Apply a partial geometry change to one page (col/row/cols/rows/rot/crop). */
    setPageGeometry(index, part) {
      var p = this.pages[index];
      if (!p || !part) return false;
      if (typeof part.col === "number") p.col = _num(part.col, p.col);
      if (typeof part.row === "number") p.row = _num(part.row, p.row);
      if (typeof part.cols === "number") {
        p.cols = Math.max(MIN_PAGE_CELLS, _num(part.cols, p.cols));
      }
      if (typeof part.rows === "number") {
        p.rows = Math.max(MIN_PAGE_CELLS, _num(part.rows, p.rows));
      }
      if (typeof part.rot === "number") p.rot = _pageRotation(part.rot);
      if (part.crop !== undefined) p.crop = part.crop || null;
      this.render();
      return true;
    }

    /** Draw one page into `ctx`, cropped and rotated inside its footprint. */
    _drawPageOn(ctx, p, x, y, w, h) {
      var img = p.img;
      if (!img) return;
      var rect = this.pageRect(p);
      // Cheap reject: a slice repaint should not touch a page it cannot overlap.
      if (typeof x === "number") {
        if (rect.x + rect.w <= x || rect.x >= x + w) return;
        if (rect.y + rect.h <= y || rect.y >= y + h) return;
      }
      var iw = img.naturalWidth || img.width;
      var ih = img.naturalHeight || img.height;
      if (!iw || !ih) return;
      var sx = 0;
      var sy = 0;
      var sw = iw;
      var sh = ih;
      if (p.crop) {
        sx = _clamp01(p.crop.x) * iw;
        sy = _clamp01(p.crop.y) * ih;
        sw = Math.max(0.01, _clamp01(p.crop.w)) * iw;
        sh = Math.max(0.01, _clamp01(p.crop.h)) * ih;
      }
      var rot = p.rot;
      ctx.save();
      if (typeof x === "number") {
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
      }
      if (rot === 90) {
        // The image turns 90 degrees clockwise inside the footprint: its width
        // maps to the footprint's HEIGHT, so the draw rect is (rows, cols).
        ctx.translate(rect.x + rect.w, rect.y);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, rect.h, rect.w);
      } else if (rot === 180) {
        ctx.translate(rect.x + rect.w, rect.y + rect.h);
        ctx.rotate(Math.PI);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, rect.w, rect.h);
      } else if (rot === 270) {
        ctx.translate(rect.x, rect.y + rect.h);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, rect.h, rect.w);
      } else {
        ctx.drawImage(img, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h);
      }
      ctx.restore();
    }

    /** Paint every page, in list order, clipping to `x,y,w,h` when given. */
    _drawPages(x, y, w, h) {
      if (!this.pages.length) return;
      var ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = this.overlayOpacity;
      for (var i = 0; i < this.pages.length; i++) {
        this._drawPageOn(ctx, this.pages[i], x, y, w, h);
      }
      ctx.restore();
    }

    /**
     * Render JUST the substrate pages onto a fresh canvas at `cell` pixels per
     * stitch, and return it. Used to compose a joined multi-page chart into one
     * bitmap (the convert-to-pattern pipeline), and nothing else.
     */
    renderSubstrate(cell, doc) {
      var d = doc || (typeof document !== "undefined" ? document : null);
      if (!d || !this.width || !this.height || !this.pages.length) return null;
      var s = Math.max(1, Math.min(64, Math.round(_num(cell, 12))));
      var canvas = d.createElement("canvas");
      canvas.width = Math.round(this.width * s);
      canvas.height = Math.round(this.height * s);
      var ctx = canvas.getContext("2d");
      if (!ctx) return null;
      // `pageRect()` measures with `cellSize`, so swapping it draws the whole
      // substrate into the scaled buffer through the ordinary page path.
      var saved = this.cellSize;
      this.cellSize = s;
      try {
        for (var i = 0; i < this.pages.length; i++) {
          this._drawPageOn(ctx, this.pages[i]);
        }
      } finally {
        this.cellSize = saved;
      }
      return canvas;
    }

    /**
     * Move the overlay layers with the grid. Annotations are anchored to CELLS
     * (that is the point of storing them in cell units), so when the origin moves
     * they must move by the same amount or they would silently point at the wrong
     * stitches. Notes are keyed by cell, so they are re-keyed.
     */
    _shiftOverlays(dr, dc, newW, newH) {
      if (dr || dc) {
        this.annots = this.annots.map(function (a) {
          return {
            k: a.k,
            a: [a.a[0] + dc, a.a[1] + dr],
            b: [a.b[0] + dc, a.b[1] + dr],
            t: a.t,
            colour: a.colour,
          };
        });
      }
      if (this.cellNotes) {
        var out = {};
        var n = 0;
        for (var key in this.cellNotes) {
          if (!Object.prototype.hasOwnProperty.call(this.cellNotes, key)) continue;
          var m = /^(\d+),(\d+)$/.exec(key);
          if (!m) continue;
          var nr = parseInt(m[1], 10) + dr;
          var nc = parseInt(m[2], 10) + dc;
          if (nr < 0 || nc < 0 || nr >= newH || nc >= newW) continue;
          out[nr + "," + nc] = this.cellNotes[key];
          n++;
        }
        this.cellNotes = n ? out : null;
      }
    }

    /** Bounding box of all pages, in cells: {col,row,cols,rows} or null. */
    pageBounds() {
      return CrossStitchCanvas.pageBoundsOf(this.pages);
    }

    /**
     * Resize the grid while KEEPING existing stitch markup at its original cell
     * coordinates (shifted by dCol/dRow when the origin itself moves). This is
     * what makes the stitch-along work: the next page of a chart can be added
     * later, growing the canvas to hold it, without disturbing a single mark.
     *
     * History is deliberately reset: an undo snapshot is only valid for the size
     * it was taken at, so undo simply restarts from the resized grid.
     */
    resizeGrid(newW, newH, dCol, dRow) {
      newW = Math.max(1, Math.round(_num(newW, 1)));
      newH = Math.max(1, Math.round(_num(newH, 1)));
      var dc = Math.round(_num(dCol, 0));
      var dr = Math.round(_num(dRow, 0));
      var oldW = this.width || 0;
      var oldH = this.height || 0;
      if (newW === oldW && newH === oldH && !dc && !dr) return false;
      var out = new Int16Array(newW * newH).fill(-1);
      var prog = new Uint8Array(newW * newH);
      var oldFrac = this.frac;
      var newFrac = oldFrac ? new Uint8Array(newW * newH) : null;
      var oldBlend = this.blend;
      var newBlend = oldBlend ? new Uint8Array(newW * newH) : null;
      // Rebuild the outline by re-canonicalising each surviving segment, because
      // a border's owning slot depends on absolute position and the origin moved.
      var edges = this.back
        ? this._blockBackEdges({ r0: 0, c0: 0, r1: oldH - 1, c1: oldW - 1 })
        : [];
      for (var r = 0; r < oldH; r++) {
        var nr = r + dr;
        if (nr < 0 || nr >= newH) continue;
        for (var c = 0; c < oldW; c++) {
          var nc = c + dc;
          if (nc < 0 || nc >= newW) continue;
          out[nr * newW + nc] = this.cells[r * oldW + c];
          if (newFrac && oldFrac[r * oldW + c]) {
            newFrac[nr * newW + nc] = oldFrac[r * oldW + c];
          }
          if (newBlend && oldBlend[r * oldW + c]) {
            newBlend[nr * newW + nc] = oldBlend[r * oldW + c];
          }
          if (this.progress && this.progress[r * oldW + c]) {
            prog[nr * newW + nc] = 1;
          }
        }
      }
      this.width = newW;
      this.height = newH;
      this.cells = out;
      this.frac = newFrac;
      this.blend = newBlend;
      this.back = null;
      for (var e = 0; e < edges.length; e++) {
        var ed = edges[e];
        this.setBackEdge(ed.r + dr, ed.c + dc, ed.e, ed.v);
      }
      this.progress = prog;
      this._shiftOverlays(dr, dc, newW, newH);
      this.sel = null;
      this._resetSpotlight();
      this._recount();
      this.history = [];
      this.historyIndex = -1;
      this._pushHistory();
      this.render();
      this._notify();
      this._notifyProgress();
      return true;
    }

    // ---- trace overlay ----
    // A reference photo the user can stitch over, faded with an opacity slider
    // and toggled off to judge the result. Everything here is drawn outside
    // drawChart, so the overlay is a view aid only: exports are untouched.
    //
    // PHOTO ALIGNMENT. A photo of a chart is almost never the exact shape of the
    // chart you are stitching, so the overlay is not just cover-fitted: the user
    // can stretch each axis and nudge it until the cells line up. Scales are
    // multipliers of the fitted size and offsets are fractions of the chart's
    // width/height, which keeps the alignment valid at any zoom.

    setOverlayImage(img) {
      this.overlayImage = img || null;
      if (!this.overlayImage) this.overlayOn = false;
      this.render();
    }

    setOverlayOn(on) {
      // "Show the artwork" must work for a joined multi-page chart too, where
      // there is no single `overlayImage` — the pages ARE the artwork.
      this.overlayOn = !!on && (!!this.overlayImage || this.pages.length > 0);
      this.render();
    }

    /**
     * CHART-MARKUP MODE. When true the overlay image becomes the SUBSTRATE: it is
     * painted BEFORE the chart and the chart is drawn with a transparent
     * background, so an imported chart's artwork shows through under the grid and
     * the progress marks. False keeps the photo ON TOP as a tracing aid, exactly
     * as before.
     */
    setOverlayUnder(on) {
      this.overlayUnder = !!on;
      this.render();
    }

    setOverlayOpacity(value) {
      var v = parseFloat(value);
      if (isNaN(v)) v = 0.5;
      this.overlayOpacity = Math.max(0, Math.min(1, v));
      this.render();
    }

    /** Current alignment, for the UI to mirror back into its controls. */
    overlayAdjust() {
      var r = this._overlayRect();
      var s = this.cellSize || 1;
      return {
        fit: this.overlayFit,
        scaleX: this.overlayScaleX,
        scaleY: this.overlayScaleY,
        offsetX: this.overlayOffsetX,
        offsetY: this.overlayOffsetY,
        // The photo's size in STITCHES. This is the number to watch while
        // fitting: when it lands on the chart's own cell count the photo's grid
        // and the chart's grid coincide.
        spanX: r ? r.w / s : 0,
        spanY: r ? r.h / s : 0,
      };
    }

    /**
     * Nudge the photo from the keyboard. Offsets are chart fractions, so one
     * press moves it a thousandth of the chart — far finer than a stitch — and
     * `mult` (Shift) steps ten times that.
     */
    nudgeOverlay(dx, dy, mult) {
      var step = OVERLAY_NUDGE * (mult || 1);
      this.setOverlayAdjust({
        offsetX: this.overlayOffsetX + dx * step,
        offsetY: this.overlayOffsetY + dy * step,
      });
    }

    /**
     * Apply a partial alignment change: {fit, scaleX, scaleY, offsetX, offsetY}.
     * Called by the sliders, by the preset buttons and by the drag handles, so
     * every route is clamped identically.
     */
    setOverlayAdjust(part) {
      var p = part || {};
      if (p.fit) {
        this.overlayFit =
          p.fit === "cover" || p.fit === "stretch" ? p.fit : "contain";
      }
      if (typeof p.scaleX === "number") this.overlayScaleX = _clampOverlayScale(p.scaleX);
      if (typeof p.scaleY === "number") this.overlayScaleY = _clampOverlayScale(p.scaleY);
      if (typeof p.offsetX === "number") this.overlayOffsetX = _clampOverlayOffset(p.offsetX);
      if (typeof p.offsetY === "number") this.overlayOffsetY = _clampOverlayOffset(p.offsetY);
      this.render();
      this._notifyOverlay();
    }

    /** Show the whole photo, centred, at its own aspect ratio. Full reset. */
    fitOverlay() {
      this.overlayFit = "contain";
      this.overlayScaleX = 1;
      this.overlayScaleY = 1;
      this.overlayOffsetX = 0;
      this.overlayOffsetY = 0;
      this.render();
      this._notifyOverlay();
    }

    /** Stretch the photo to fill the chart exactly, aspect ratio be damned. */
    stretchOverlay() {
      this.overlayFit = "stretch";
      this.overlayScaleX = 1;
      this.overlayScaleY = 1;
      this.overlayOffsetX = 0;
      this.overlayOffsetY = 0;
      this.render();
      this._notifyOverlay();
    }

    /** Re-centre at the current size, after dragging the photo off to one side. */
    centerOverlay() {
      this.overlayOffsetX = 0;
      this.overlayOffsetY = 0;
      this.render();
      this._notifyOverlay();
    }

    _notifyOverlay() {
      if (typeof this.opts.onOverlayChange === "function") {
        this.opts.onOverlayChange(this.overlayAdjust());
      }
    }

    /** The fitted (unscaled) photo size for the current fit mode. */
    _overlayFitSize() {
      var img = this.overlayImage;
      var iw = img ? img.naturalWidth || img.width : 0;
      var ih = img ? img.naturalHeight || img.height : 0;
      var cw = this.canvas.width;
      var ch = this.canvas.height;
      if (!iw || !ih || !cw || !ch) return null;
      // 'stretch' ignores the aspect ratio entirely: each axis maps to the chart.
      if (this.overlayFit === "stretch") return { w: cw, h: ch };
      var k =
        this.overlayFit === "contain"
          ? Math.min(cw / iw, ch / ih)
          : Math.max(cw / iw, ch / ih);
      return { w: iw * k, h: ih * k };
    }

    /** Where the photo lands on the chart, after fit, manual scale and nudge. */
    _overlayRect() {
      var base = this._overlayFitSize();
      if (!base) return null;
      var cw = this.canvas.width;
      var ch = this.canvas.height;
      var w = base.w * this.overlayScaleX;
      var h = base.h * this.overlayScaleY;
      return {
        x: (cw - w) / 2 + this.overlayOffsetX * cw,
        y: (ch - h) / 2 + this.overlayOffsetY * ch,
        w: w,
        h: h,
      };
    }

    // The Align tool edits EITHER the tracing photo (pattern mode) or the active
    // substrate page (chart mode). Everything that measures or draws the frame
    // asks one of these two, so the handles, the hit-testing and the drag maths
    // stay in a single place rather than forking per mode.
    _alignActive() {
      if (this.pages.length) return !!this.pages[this.activePage];
      return !!(this.overlayOn && this.overlayImage);
    }
    _alignRect() {
      if (this.pages.length) {
        var p = this.pages[this.activePage];
        return p ? this.pageRect(p) : null;
      }
      return this._overlayRect();
    }

    /** Pointer position in canvas pixels (the canvas is 1:1 with its CSS box). */
    _pointFromEvent(e) {
      var box = this.canvas.getBoundingClientRect();
      if (!box.width || !box.height) return { x: 0, y: 0 };
      return {
        x: (e.clientX - box.left) * (this.canvas.width / box.width),
        y: (e.clientY - box.top) * (this.canvas.height / box.height),
      };
    }

    /**
     * The eight stretch handles, plus the body which moves the photo.
     *
     * Handle positions are clamped INSIDE the canvas. A photo that fills or
     * overflows the chart — the normal case — would otherwise put its handles on
     * or past the edge, where they are clipped and impossible to grab, which is
     * exactly when the user needs them. Hit-testing uses these same clamped
     * points, so what you can see is what you can grab.
     */
    _overlayHandlePoints(r) {
      var half = OVERLAY_HANDLE / 2;
      var maxX = Math.max(half, this.canvas.width - half);
      var maxY = Math.max(half, this.canvas.height - half);
      var cx = function (v) {
        return Math.max(half, Math.min(maxX, v));
      };
      var cy = function (v) {
        return Math.max(half, Math.min(maxY, v));
      };
      var mx = cx(r.x + r.w / 2);
      var my = cy(r.y + r.h / 2);
      return [
        { id: "nw", x: cx(r.x), y: cy(r.y) },
        { id: "n", x: mx, y: cy(r.y) },
        { id: "ne", x: cx(r.x + r.w), y: cy(r.y) },
        { id: "e", x: cx(r.x + r.w), y: my },
        { id: "se", x: cx(r.x + r.w), y: cy(r.y + r.h) },
        { id: "s", x: mx, y: cy(r.y + r.h) },
        { id: "sw", x: cx(r.x), y: cy(r.y + r.h) },
        { id: "w", x: cx(r.x), y: my },
      ];
    }

    /** Which part of the frame is under a canvas-space point, if any. */
    _overlayTargetAt(pt) {
      var r = this._alignRect();
      if (!r || !pt) return null;
      var tol = OVERLAY_HANDLE / 2 + 1;
      var pts = this._overlayHandlePoints(r);
      for (var i = 0; i < pts.length; i++) {
        if (Math.abs(pt.x - pts[i].x) <= tol && Math.abs(pt.y - pts[i].y) <= tol) {
          return pts[i].id;
        }
      }
      if (pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) {
        return "move";
      }
      return null;
    }

    /**
     * What a press at `pt` should grab. Alignment is an explicit mode: the
     * resize points and the body drag exist only in Align, so neither the points
     * nor the resize cursors ever intrude on painting or selecting.
     */
    _overlayGrabTarget(pt) {
      if (this.mode !== "overlay") return null;
      if (!this._alignActive()) return null;
      return this._overlayTargetAt(pt);
    }

    _beginOverlayDrag(e, target) {
      // Nothing to grab while the photo is hidden, and nothing to grab before a
      // photo is loaded at all.
      if (!this._alignActive()) return false;
      var pt = this._pointFromEvent(e);
      var hit = target || this._overlayTargetAt(pt);
      if (!hit) return false;
      var r = this._alignRect();
      if (!r) return false;
      this._ovDrag = {
        target: hit,
        start: pt,
        rect: { x: r.x, y: r.y, w: r.w, h: r.h },
      };
      return true;
    }

    /**
     * Drag a handle: the opposite edge stays put while this one follows the
     * pointer, so the photo can be stretched on one axis to line its cells up
     * with the chart without disturbing the other. Dragging the body moves it.
     */
    _overlayDragTo(e) {
      if (!this._ovDrag) return;
      var pt = this._pointFromEvent(e);
      // Alt = fine drag, so the fit can be tuned below one canvas pixel.
      var k = e.altKey ? OVERLAY_FINE_DRAG : 1;
      var dx = (pt.x - this._ovDrag.start.x) * k;
      var dy = (pt.y - this._ovDrag.start.y) * k;
      var s = this._ovDrag.rect;
      var t = this._ovDrag.target;
      var r = { x: s.x, y: s.y, w: s.w, h: s.h };
      if (t === "move") {
        r.x += dx;
        r.y += dy;
      } else {
        if (t.indexOf("w") >= 0) {
          r.x += dx;
          r.w -= dx;
        }
        if (t.indexOf("e") >= 0) r.w += dx;
        if (t.indexOf("n") >= 0) {
          r.y += dy;
          r.h -= dy;
        }
        if (t.indexOf("s") >= 0) r.h += dy;
      }
      // Never let a handle cross the opposite edge: it would flip the photo and
      // read as the controls going haywire.
      if (r.w < OVERLAY_MIN_SIZE) {
        if (t.indexOf("w") >= 0) r.x = s.x + s.w - OVERLAY_MIN_SIZE;
        r.w = OVERLAY_MIN_SIZE;
      }
      if (r.h < OVERLAY_MIN_SIZE) {
        if (t.indexOf("n") >= 0) r.y = s.y + s.h - OVERLAY_MIN_SIZE;
        r.h = OVERLAY_MIN_SIZE;
      }
      this._applyOverlayRect(r);
    }

    /** Write a dragged rectangle back into scale/offset (photo) or page cells. */
    _applyOverlayRect(r) {
      // CHART MODE: the rect IS the page, so a drag writes cells directly. The
      // grid is NOT re-origined mid-drag (that would move the page under the
      // pointer); the host re-fits the grid once the drag ends.
      if (this.pages.length) {
        var p = this.pages[this.activePage];
        if (!p) return;
        var s = this.cellSize || 1;
        p.col = r.x / s;
        p.row = r.y / s;
        p.cols = Math.max(MIN_PAGE_CELLS, r.w / s);
        p.rows = Math.max(MIN_PAGE_CELLS, r.h / s);
        this.render();
        if (typeof this.opts.onPageChange === "function") {
          this.opts.onPageChange(this.activePage, {
            col: p.col,
            row: p.row,
            cols: p.cols,
            rows: p.rows,
          });
        }
        return;
      }
      var base = this._overlayFitSize();
      var cw = this.canvas.width;
      var ch = this.canvas.height;
      if (!base || !cw || !ch) return;
      this.overlayScaleX = _clampOverlayScale(r.w / base.w);
      this.overlayScaleY = _clampOverlayScale(r.h / base.h);
      this.overlayOffsetX = _clampOverlayOffset((r.x - (cw - r.w) / 2) / cw);
      this.overlayOffsetY = _clampOverlayOffset((r.y - (ch - r.h) / 2) / ch);
      this.render();
      this._notifyOverlay();
    }

    _endOverlayDrag() {
      if (!this._ovDrag) return;
      this._ovDrag = null;
      // A page drag can push a page past the edge of the grid; the host grows
      // and re-origins the canvas here, once, so the grid always contains the
      // chart without fighting the pointer while it is moving.
      if (this.pages.length && typeof this.opts.onPageCommit === "function") {
        this.opts.onPageCommit(this.activePage);
      }
      this._notifyOverlay();
    }

    /** Cursor feedback so the handles are discoverable before you grab one. */
    _overlayHover(e) {
      // Align only: while painting, the pointer must keep the cursor the tool
      // implies rather than flickering into resize cursors over the photo edge.
      if (this.mode !== "overlay") return;
      if (!this._alignActive()) return;
      var target = this._overlayTargetAt(this._pointFromEvent(e));
      var cursors = {
        nw: "nwse-resize",
        se: "nwse-resize",
        ne: "nesw-resize",
        sw: "nesw-resize",
        n: "ns-resize",
        s: "ns-resize",
        e: "ew-resize",
        w: "ew-resize",
        move: "move",
      };
      // Empty string, not "default", so the stylesheet keeps control away from
      // the photo.
      this.canvas.style.cursor = cursors[target] || "";
    }

    _clearOverlayCursor() {
      this.canvas.style.cursor = "";
    }

    /** Frame + resize points, drawn only for the Align tool. Screen only. */
    _drawOverlayHandles() {
      // A resize point is an Align-mode affordance: showing them over the chart
      // while painting would offer a stretch where the user expects a stitch.
      if (this.mode !== "overlay") return;
      if (!this._alignActive()) return;
      var r = this._alignRect();
      if (!r) return;
      var ctx = this.ctx;
      var half = OVERLAY_HANDLE / 2;
      ctx.save();
      ctx.strokeStyle = OVERLAY_FRAME;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
      ctx.setLineDash([]);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = OVERLAY_FRAME;
      ctx.lineWidth = 1.5;
      var pts = this._overlayHandlePoints(r);
      for (var i = 0; i < pts.length; i++) {
        ctx.beginPath();
        ctx.rect(pts[i].x - half, pts[i].y - half, OVERLAY_HANDLE, OVERLAY_HANDLE);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    /**
     * Draw the substrate. With no arguments it covers the whole chart; with a
     * rectangle it repaints just that slice, which is what keeps incremental
     * stitch painting cheap.
     *
     * MULTI-PAGE CHARTS route through here too: when pages are present they are
     * the substrate, so the single trace photo and the joined chart pages share
     * exactly one code path (and therefore one set of clipping rules).
     * `ctx` overrides the target context (used by the offscreen read pass) and
     * `rawAlpha` ignores the opacity slider so a read always sees full ink.
     */
    _drawOverlay(x, y, w, h, ctx, rawAlpha) {
      if (this.pages.length) {
        // The visibility toggle hides the artwork from the VIEW; a read pass
        // (`rawAlpha`) still measures the chart itself, because hiding a chart
        // to check your marks should not change what "Read chart colours" sees.
        if (!this.overlayOn && !rawAlpha) return;
        if (rawAlpha) {
          var target = ctx || this.ctx;
          for (var i = 0; i < this.pages.length; i++) {
            this._drawPageOn(target, this.pages[i], x, y, w, h);
          }
        } else if (!ctx) {
          this._drawPages(x, y, w, h);
        } else {
          for (var j = 0; j < this.pages.length; j++) {
            this._drawPageOn(ctx, this.pages[j], x, y, w, h);
          }
        }
        return;
      }
      if (!this.overlayOn || !this.overlayImage) return;
      var rect = this._overlayRect();
      if (!rect) return;
      var img = this.overlayImage;
      var iw = img.naturalWidth || img.width;
      var ih = img.naturalHeight || img.height;
      var sx = 0;
      var sy = 0;
      var sw = iw;
      var sh = ih;
      var dx = rect.x;
      var dy = rect.y;
      var dw = rect.w;
      var dh = rect.h;
      if (typeof x === "number") {
        // Which part of the (transformed) photo does this rectangle cover?
        var left = Math.max(x, rect.x);
        var top = Math.max(y, rect.y);
        var right = Math.min(x + w, rect.x + rect.w);
        var bottom = Math.min(y + h, rect.y + rect.h);
        if (right <= left || bottom <= top) return; // outside the photo
        sx = (left - rect.x) * (iw / rect.w);
        sy = (top - rect.y) * (ih / rect.h);
        sw = (right - left) * (iw / rect.w);
        sh = (bottom - top) * (ih / rect.h);
        dx = left;
        dy = top;
        dw = right - left;
        dh = bottom - top;
      }
      var c = ctx || this.ctx;
      c.save();
      if (!rawAlpha) c.globalAlpha = this.overlayOpacity;
      c.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      c.restore();
    }

    clearAll() {
      this.cells.fill(-1);
      // "Clear the canvas" means EVERY layer: a leftover outline, half stitch or
      // blend on an empty grid would be invisible to the colour counts.
      this.frac = null;
      this.back = null;
      this.blend = null;
      this._recount();
      this._pushHistory();
      this.render();
      this._notify();
    }

    // ---- progress tracker ----
    // Stitching progress lives beside the design, never inside it: `progress`
    // is a separate Uint8Array, so marking stitches leaves colour counts,
    // the legend, and every export completely untouched.

    setProgressOn(on) {
      this.progressOn = !!on;
      if (!this.progress && this.width) {
        this.progress = new Uint8Array(this.width * this.height);
      }
      this.render();
    }

    /** Turn every cell into a markable stitch (chart-markup mode). */
    setAllCellsStitchable(on) {
      this.allCellsStitchable = !!on;
      if (this.width) this.render();
    }

    setProgressMode(mode) {
      this.progressMode =
        mode === "column" || mode === "diagonal" ? mode : "row";
      this.render();
    }

    /** Replace the marks wholesale, e.g. when a project's progress is loaded. */
    setProgress(arr) {
      var len = this.width * this.height;
      if (arr && arr.length === len) {
        this.progress = arr;
      } else {
        this.progress = new Uint8Array(len);
        if (arr) {
          for (var i = 0; i < Math.min(arr.length, len); i++) {
            this.progress[i] = arr[i] ? 1 : 0;
          }
        }
      }
      if (this.width) this.render();
    }

    getProgress() {
      return this.progress;
    }

    clearProgress() {
      if (this.progress) this.progress.fill(0);
      this.render();
      this._notifyProgress();
    }

    setBrushSizeForMark(size) {
      this.setBrushSize(size);
    }

    /** How many units (rows / columns / diagonals) the tracker counts in. */
    unitCount() {
      if (this.progressMode === "column") return this.width;
      if (this.progressMode === "diagonal") {
        return Math.max(0, this.width + this.height - 1);
      }
      return this.height;
    }

    /** Which unit a cell belongs to, in the current counting direction. */
    _unitOf(r, c) {
      if (this.progressMode === "column") return c;
      if (this.progressMode === "diagonal") {
        return c - r + (this.height - 1);
      }
      return r;
    }

    /** An empty cell has no stitch to make, so it counts as already done. */
    _cellComplete(r, c) {
      var i = r * this.width + c;
      if (this.cells[i] < 0 && !this.allCellsStitchable) return true;
      return !!(this.progress && this.progress[i] === 1);
    }

    /**
     * First unit that still contains an unstitched cell, i.e. the row/column/
     * diagonal the user is working on. Null once everything is stitched.
     */
    currentUnit() {
      if (!this.width || !this.progress) return null;
      var units = this.unitCount();
      if (!units) return null;
      var done = new Uint8Array(units).fill(1);
      for (var r = 0; r < this.height; r++) {
        for (var c = 0; c < this.width; c++) {
          if (!this._cellComplete(r, c)) done[this._unitOf(r, c)] = 0;
        }
      }
      for (var u = 0; u < units; u++) {
        if (!done[u]) return u;
      }
      return null;
    }

    progressStats() {
      var done = 0;
      var total = 0;
      for (var i = 0; i < this.cells.length; i++) {
        if (this.cells[i] < 0 && !this.allCellsStitchable) continue;
        total++;
        if (this.progress && this.progress[i] === 1) done++;
      }
      var unit = this.currentUnit();
      return {
        done: done,
        total: total,
        percent: total ? Math.round((done / total) * 100) : 0,
        unit: unit,
        units: this.unitCount(),
        mode: this.progressMode,
        // Row/column numbers are 1-based for the person holding the needle.
        unitLabel: unit === null ? null : unit + 1,
      };
    }

    _applyMark(r, c, value) {
      if (!this.progress) return false;
      var i = r * this.width + c;
      // Missing stitches cannot be marked in pattern mode; in chart mode every
      // cell is a stitch the chart asks for, so all of them can be marked.
      if (this.cells[i] < 0 && !this.allCellsStitchable) return false;
      if (this.progress[i] === value) return false;
      this.progress[i] = value;
      this._paintCell(r, c, true);
      return true;
    }

    _markAt(e) {
      var cell = this._cellFromEvent(e);
      if (!cell) return;
      var key = cell.r * this.width + cell.c;
      if (key === this._lastCell) return;
      this._lastCell = key;
      var S = this.brushSize || 1;
      var halfStart = -Math.floor((S - 1) / 2);
      var halfEnd = Math.ceil((S - 1) / 2);
      var any = false;
      for (var dr = halfStart; dr <= halfEnd; dr++) {
        for (var dc = halfStart; dc <= halfEnd; dc++) {
          var nr = cell.r + dr;
          var nc = cell.c + dc;
          if (nr >= 0 && nr < this.height && nc >= 0 && nc < this.width) {
            if (this._applyMark(nr, nc, this._markValue)) any = true;
          }
        }
      }
      if (any) this._notifyProgress();
    }

    /**
     * Full-canvas overlay. Marks are coalesced into one rect per horizontal run,
     * so a fully-stitched 500x500 chart costs ~500 fillRects instead of 250,000.
     *
     * Three passes, in order: the band for the unit you are on, the wash over
     * finished stitches, then the tick and the band's leading edge on top — so
     * "where am I" and "what is done" stay readable over busy colours.
     */
    _drawProgressOverlay() {
      if (!this.progressOn || !this.width) return;
      var s = this.cellSize;
      var ctx = this.ctx;
      var w = this.width;
      var h = this.height;
      var r;
      var c;

      this._curUnit = this.currentUnit();

      // 1. The unit being worked on.
      if (this._curUnit !== null) {
        ctx.fillStyle = PROGRESS_BAND;
        for (r = 0; r < h; r++) {
          var bandStart = -1;
          for (c = 0; c <= w; c++) {
            var inBand = c < w && this._unitOf(r, c) === this._curUnit;
            if (inBand && bandStart < 0) bandStart = c;
            else if (!inBand && bandStart >= 0) {
              ctx.fillRect(bandStart * s, r * s, (c - bandStart) * s, s);
              bandStart = -1;
            }
          }
        }
      }

      if (!this.progress) return;

      // 2. Finished stitches, as a LIGHT wash.
      ctx.fillStyle = PROGRESS_DONE;
      for (r = 0; r < h; r++) {
        var start = -1;
        for (c = 0; c <= w; c++) {
          var marked = c < w && this.progress[r * w + c] === 1;
          if (marked && start < 0) start = c;
          else if (!marked && start >= 0) {
            ctx.fillRect(start * s, r * s, (c - start) * s, s);
            start = -1;
          }
        }
      }

      // 3. A tick per finished stitch, and the band's leading edge.
      if (s >= PROGRESS_TICK_MIN_CELL) {
        for (r = 0; r < h; r++) {
          for (c = 0; c < w; c++) {
            if (this.progress[r * w + c] === 1) this._progressTick(r, c);
          }
        }
      }
      this._progressBandEdge();
    }

    /**
     * The leading edge of the unit being worked on.
     *
     * The translucent band alone disappeared over busy colours, so "which row am
     * I on" could not be answered at a glance. A diagonal unit has no single edge,
     * so it relies on the band.
     */
    _progressBandEdge() {
      if (this._curUnit === null || this.progressMode === "diagonal") return;
      var s = this.cellSize;
      if (s < 4) return;
      var ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = PROGRESS_BAND_EDGE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (this.progressMode === "column") {
        var x = this._curUnit * s + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.height * s);
      } else {
        var y = this._curUnit * s + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(this.width * s, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    /** A tick in a finished stitch: reads as "done" even where the wash is faint. */
    _progressTick(r, c) {
      var s = this.cellSize;
      if (s < PROGRESS_TICK_MIN_CELL) return;
      var ctx = this.ctx;
      var x = c * s;
      var y = r * s;
      ctx.save();
      ctx.strokeStyle = PROGRESS_TICK;
      ctx.lineWidth = Math.max(1.5, s * 0.1);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(x + s * 0.27, y + s * 0.53);
      ctx.lineTo(x + s * 0.44, y + s * 0.71);
      ctx.lineTo(x + s * 0.75, y + s * 0.28);
      ctx.stroke();
      ctx.restore();
    }

    /** Overlay for a single cell, used by incremental repaints. */
    _paintProgressCell(r, c) {
      if (!this.progressOn || !this.progress) return;
      var s = this.cellSize;
      if (this._curUnit !== null && this._unitOf(r, c) === this._curUnit) {
        this.ctx.fillStyle = PROGRESS_BAND;
        this.ctx.fillRect(c * s, r * s, s, s);
      }
      if (this.progress[r * this.width + c] === 1) {
        this.ctx.fillStyle = PROGRESS_DONE;
        this.ctx.fillRect(c * s, r * s, s, s);
        this._progressTick(r, c);
      }
    }

    _notifyProgress() {
      if (typeof this.opts.onProgressChange === "function") {
        this.opts.onProgressChange(this.progressStats());
      }
    }

    // ---- selection ----
    // A rectangular marquee plus a clipboard. Every mutating operation goes
    // through _recount() + _pushHistory() so it behaves like any other edit
    // (undoable, legend and colour counts stay correct).

    _notifySelection() {
      if (typeof this.opts.onSelectionChange === "function") {
        this.opts.onSelectionChange(this.hasSelection(), !!this.clipboard);
      }
    }

    hasSelection() {
      return !!(this.sel && this.width);
    }

    /** Normalise the marquee regardless of which corner the drag started at. */
    _selNorm() {
      if (!this.sel) return null;
      var r0 = Math.min(this.sel.r0, this.sel.r1);
      var r1 = Math.max(this.sel.r0, this.sel.r1);
      var c0 = Math.min(this.sel.c0, this.sel.c1);
      var c1 = Math.max(this.sel.c0, this.sel.c1);
      r0 = Math.max(0, r0);
      c0 = Math.max(0, c0);
      r1 = Math.min(this.height - 1, r1);
      c1 = Math.min(this.width - 1, c1);
      if (r1 < r0 || c1 < c0) return null;
      return {
        r0: r0,
        r1: r1,
        c0: c0,
        c1: c1,
        rows: r1 - r0 + 1,
        cols: c1 - c0 + 1,
      };
    }

    selectionInfo() {
      var n = this._selNorm();
      if (!n) return null;
      return { rows: n.rows, cols: n.cols, r0: n.r0, c0: n.c0 };
    }

    setSelection(r0, c0, r1, c1) {
      this.sel = { r0: r0, c0: c0, r1: r1, c1: c1 };
      this.render();
      this._notifySelection();
    }

    clearSelection() {
      this.sel = null;
      this.render();
      this._notifySelection();
    }

    selectAll() {
      if (!this.width) return false;
      this.sel = { r0: 0, c0: 0, r1: this.height - 1, c1: this.width - 1 };
      this.render();
      this._notifySelection();
      return true;
    }

    /** Move the marquee without touching the stitches. */
    nudgeSelection(dr, dc) {
      var n = this._selNorm();
      if (!n) return false;
      var r0 = Math.max(0, Math.min(this.height - n.rows, n.r0 + dr));
      var c0 = Math.max(0, Math.min(this.width - n.cols, n.c0 + dc));
      if (r0 === n.r0 && c0 === n.c0) return false;
      this.sel = { r0: r0, c0: c0, r1: r0 + n.rows - 1, c1: c0 + n.cols - 1 };
      this.render();
      this._notifySelection();
      return true;
    }

    copySelection() {
      var n = this._selNorm();
      if (!n) return false;
      var buf = new Int16Array(n.rows * n.cols);
      var bufFrac = new Uint8Array(n.rows * n.cols);
      var bufBlend = new Uint8Array(n.rows * n.cols);
      var bufBack = new Uint8Array(n.rows * n.cols * BACK_EDGES);
      for (var r = 0; r < n.rows; r++) {
        for (var c = 0; c < n.cols; c++) {
          var src = (n.r0 + r) * this.width + (n.c0 + c);
          var dst = r * n.cols + c;
          buf[dst] = this.cells[src];
          bufFrac[dst] = this.frac ? this.frac[src] : 0;
          bufBlend[dst] = this.blend ? this.blend[src] : 0;
          // Store each cell's OWN four borders (resolved through the canonical
          // reader), so the block is self-contained wherever it is pasted.
          for (var e = 0; e < BACK_EDGES; e++) {
            var v = this.backEdgeAt(n.r0 + r, n.c0 + c, e);
            bufBack[dst * BACK_EDGES + e] = v < 0 ? 0 : v + 1;
          }
        }
      }
      this.clipboard = {
        rows: n.rows,
        cols: n.cols,
        cells: buf,
        frac: bufFrac,
        blend: bufBlend,
        back: bufBack,
      };
      this._notifySelection();
      return true;
    }

    hasClipboard() {
      return !!this.clipboard;
    }

    /** Blit a block into the grid, clipping at the edges. Returns how many cells changed. */
    _writeBlock(r0, c0, block) {
      var changed = 0;
      for (var r = 0; r < block.rows; r++) {
        for (var c = 0; c < block.cols; c++) {
          var nr = r0 + r;
          var nc = c0 + c;
          if (nr < 0 || nr >= this.height || nc < 0 || nc >= this.width) continue;
          var i = nr * this.width + nc;
          var bi = r * block.cols + c;
          var v = block.cells[bi];
          if (this.cells[i] !== v) {
            this.cells[i] = v;
            changed++;
          }
          var f = block.frac ? block.frac[bi] : 0;
          var cur = this.frac ? this.frac[i] : 0;
          if (cur !== f) {
            if (f) this._ensureFrac()[i] = f;
            else if (this.frac) this.frac[i] = 0;
            changed++;
          }
          var bl = block.blend ? block.blend[bi] : 0;
          var curb = this.blend ? this.blend[i] : 0;
          if (curb !== bl) {
            if (bl) this._ensureBlend()[i] = bl;
            else if (this.blend) this.blend[i] = 0;
            changed++;
          }
          if (block.back) {
            for (var e = 0; e < BACK_EDGES; e++) {
              var bv = block.back[bi * BACK_EDGES + e];
              if (this.setBackEdge(nr, nc, e, bv ? bv - 1 : -1)) changed++;
            }
          }
        }
      }
      return changed;
    }

    _commitSelectionEdit() {
      this._recount();
      this._pushHistory();
      this.render();
      this._notify();
      this._notifySelection();
    }

    deleteSelection() {
      var n = this._selNorm();
      if (!n) return false;
      for (var r = n.r0; r <= n.r1; r++) {
        for (var c = n.c0; c <= n.c1; c++) {
          var i = r * this.width + c;
          this.cells[i] = -1;
          if (this.frac) this.frac[i] = 0;
          // A blend describes a colour that is no longer there, so it goes too.
          if (this.blend) this.blend[i] = 0;
        }
      }
      // Clear the block's outline too, via the canonical writer, so a border
      // shared with a cell OUTSIDE the selection goes as well.
      this._clearBlockBack(n);
      this._commitSelectionEdit();
      return true;
    }

    fillSelection() {
      var n = this._selNorm();
      if (!n || this.selectedIndex < 0) return false;
      for (var r = n.r0; r <= n.r1; r++) {
        for (var c = n.c0; c <= n.c1; c++) {
          var i = r * this.width + c;
          this.cells[i] = this.selectedIndex;
        }
      }
      // A fill lays down whatever stitch PART the tool says, so filling with the
      // quarter-stitch tool really does fill the area with quarter stitches.
      if (this.stitchPart) {
        var frac = this._ensureFrac();
        for (var r2 = n.r0; r2 <= n.r1; r2++) {
          for (var c2 = n.c0; c2 <= n.c1; c2++) {
            frac[r2 * this.width + c2] = this.stitchPart;
          }
        }
      } else if (this.frac) {
        for (var r3 = n.r0; r3 <= n.r1; r3++) {
          for (var c3 = n.c0; c3 <= n.c1; c3++) {
            this.frac[r3 * this.width + c3] = 0;
          }
        }
      }
      this._commitSelectionEdit();
      return true;
    }

    /**
     * Mirror a selection. `axis` 'h' flips left-right, 'v' top-bottom.
     *
     * All three layers move: cells keep their colours, the partial-stitch flags
     * are re-oriented (mirroring "/" gives "\", a quarter arm changes corner)
     * and the outline segments follow their borders — a mirrored outline that
     * kept its original edges would no longer line up with its stitches.
     */
    mirrorSelection(axis) {
      var n = this._selNorm();
      if (!n) return false;
      var kind = axis === "v" ? "v" : "h";
      var tmp = new Int16Array(n.rows * n.cols);
      var tmpFrac = new Uint8Array(n.rows * n.cols);
      var tmpBlend = new Uint8Array(n.rows * n.cols);
      for (var r = 0; r < n.rows; r++) {
        for (var c = 0; c < n.cols; c++) {
          var i = (n.r0 + r) * this.width + (n.c0 + c);
          tmp[r * n.cols + c] = this.cells[i];
          tmpFrac[r * n.cols + c] = this.frac ? this.frac[i] : 0;
          tmpBlend[r * n.cols + c] = this.blend ? this.blend[i] : 0;
        }
      }
      var edges = this._blockBackEdges(n);
      this._clearBlockBack(n);
      for (var r2 = 0; r2 < n.rows; r2++) {
        for (var c2 = 0; c2 < n.cols; c2++) {
          var sr = kind === "v" ? n.rows - 1 - r2 : r2;
          var sc = kind === "h" ? n.cols - 1 - c2 : c2;
          var src = sr * n.cols + sc;
          var dst = (n.r0 + r2) * this.width + (n.c0 + c2);
          this.cells[dst] = tmp[src];
          if (tmpFrac[src]) {
            this._ensureFrac()[dst] = mapFrac(tmpFrac[src], kind);
          } else if (this.frac) {
            this.frac[dst] = 0;
          }
          // A blend is a property of the colour, so it just travels with the cell.
          if (tmpBlend[src]) this._ensureBlend()[dst] = tmpBlend[src];
          else if (this.blend) this.blend[dst] = 0;
        }
      }
      for (var e = 0; e < edges.length; e++) {
        var ed = edges[e];
        var nr = kind === "v" ? n.r0 + (n.rows - 1 - (ed.r - n.r0)) : ed.r;
        var nc = kind === "h" ? n.c0 + (n.cols - 1 - (ed.c - n.c0)) : ed.c;
        this.setBackEdge(nr, nc, mapBackEdge(ed.e, kind), ed.v);
      }
      this._commitSelectionEdit();
      return true;
    }

    /** dir > 0 rotates clockwise. A non-square block swaps its dimensions. */
    rotateSelection(dir) {
      var n = this._selNorm();
      if (!n) return false;
      var kind = dir > 0 ? "cw" : "ccw";
      var outRows = n.cols;
      var outCols = n.rows;
      var out = new Int16Array(outRows * outCols);
      var outFrac = new Uint8Array(outRows * outCols);
      var outBlend = new Uint8Array(outRows * outCols);
      for (var r = 0; r < n.rows; r++) {
        for (var c = 0; c < n.cols; c++) {
          var i = (n.r0 + r) * this.width + (n.c0 + c);
          var nr = dir > 0 ? c : n.cols - 1 - c;
          var nc = dir > 0 ? n.rows - 1 - r : r;
          out[nr * outCols + nc] = this.cells[i];
          outFrac[nr * outCols + nc] = this.frac ? this.frac[i] : 0;
          outBlend[nr * outCols + nc] = this.blend ? this.blend[i] : 0;
        }
      }
      // Snapshot the outline BEFORE clearing: its source edges are about to go.
      var edges = this._blockBackEdges(n);
      // Clear exactly the ORIGINAL footprint, then blit the rotated block.
      // Clearing the union of the old and new footprints would destroy cells
      // outside the selection (a 2x3 block rotated to 3x2 inside a larger grid
      // would wipe a 3x3 area). Source cells outside the rotated result must go,
      // which clearing the source achieves exactly.
      for (var rr = 0; rr < n.rows; rr++) {
        for (var cc = 0; cc < n.cols; cc++) {
          var di = (n.r0 + rr) * this.width + (n.c0 + cc);
          this.cells[di] = -1;
          if (this.frac) this.frac[di] = 0;
          if (this.blend) this.blend[di] = 0;
        }
      }
      this._clearBlockBack(n);
      for (var r2 = 0; r2 < outRows; r2++) {
        for (var c2 = 0; c2 < outCols; c2++) {
          var tr = n.r0 + r2;
          var tc = n.c0 + c2;
          if (tr >= this.height || tc >= this.width) continue;
          this.cells[tr * this.width + tc] = out[r2 * outCols + c2];
          if (outFrac[r2 * outCols + c2]) {
            this._ensureFrac()[tr * this.width + tc] = outFrac[r2 * outCols + c2];
          }
          if (outBlend[r2 * outCols + c2]) {
            this._ensureBlend()[tr * this.width + tc] = outBlend[r2 * outCols + c2];
          }
        }
      }
      // Re-canonicalise every moved segment onto the destination grid, because
      // the south/east slot a border belongs to depends on where it landed.
      for (var e = 0; e < edges.length; e++) {
        var ed = edges[e];
        var dr = ed.r - n.r0;
        var dc = ed.c - n.c0;
        var nr2 = dir > 0 ? n.r0 + dc : n.r0 + (n.cols - 1 - dc);
        var nc2 = dir > 0 ? n.c0 + (n.rows - 1 - dr) : n.c0 + dr;
        this.setBackEdge(nr2, nc2, mapBackEdge(ed.e, kind), ed.v);
      }
      this.sel = {
        r0: n.r0,
        c0: n.c0,
        r1: Math.min(this.height - 1, n.r0 + outRows - 1),
        c1: Math.min(this.width - 1, n.c0 + outCols - 1),
      };
      this._commitSelectionEdit();
      return true;
    }

    /** Paste the clipboard with its top-left at the marquee's top-left. */
    pasteClipboard() {
      if (!this.clipboard) return false;
      var n = this._selNorm();
      var r0 = n ? n.r0 : 0;
      var c0 = n ? n.c0 : 0;
      // Pasting identical content over itself is a no-op, not an error.
      var target = {
        rows: this.clipboard.rows,
        cols: this.clipboard.cols,
        cells: this.clipboard.cells,
        // A paste reproduces the STITCH, not just its colour: the partial-stitch
        // flags, the outline and the blend partner all come with it.
        frac: this.clipboard.frac,
        back: this.clipboard.back,
        blend: this.clipboard.blend,
      };
      var changed = this._writeBlock(r0, c0, target);
      this.sel = {
        r0: r0,
        c0: c0,
        r1: Math.min(this.height - 1, r0 + target.rows - 1),
        c1: Math.min(this.width - 1, c0 + target.cols - 1),
      };
      if (!changed) {
        this.render();
        this._notifySelection();
        return false;
      }
      this._commitSelectionEdit();
      return true;
    }

    /**
     * Resize the chart to the marquee. Progress marks are dropped because the
     * grid dimensions change, which invalidates their positions.
     */
    cropToSelection() {
      var n = this._selNorm();
      if (!n) return false;
      var out = new Int16Array(n.rows * n.cols);
      var outFrac = this.frac ? new Uint8Array(n.rows * n.cols) : null;
      var outBlend = this.blend ? new Uint8Array(n.rows * n.cols) : null;
      var edges = this._blockBackEdges(n);
      for (var r = 0; r < n.rows; r++) {
        for (var c = 0; c < n.cols; c++) {
          var si = (n.r0 + r) * this.width + (n.c0 + c);
          var di = r * n.cols + c;
          out[di] = this.cells[si];
          if (outFrac) outFrac[di] = this.frac[si];
          if (outBlend) outBlend[di] = this.blend[si];
        }
      }
      this.width = n.cols;
      this.height = n.rows;
      this.cells = out;
      this.frac = outFrac;
      this.blend = outBlend;
      // A crop MOVES the origin, so every surviving segment has its border
      // re-canonicalised onto the new grid.
      this.back = null;
      for (var e = 0; e < edges.length; e++) {
        var ed = edges[e];
        this.setBackEdge(ed.r - n.r0, ed.c - n.c0, ed.e, ed.v);
      }
      this._shiftOverlays(-n.r0, -n.c0, n.cols, n.rows);
      this.progress = new Uint8Array(n.rows * n.cols);
      this.sel = null;
      this._recount();
      this.history = [];
      this.historyIndex = -1;
      this._pushHistory();
      this.fitToView();
      this._notify();
      this._notifySelection();
      return true;
    }

    /** Marching-ants outline. Drawn outside drawChart, so exports never show it. */
    _drawSelectionOverlay() {
      var n = this._selNorm();
      if (!n) return;
      var s = this.cellSize;
      var ctx = this.ctx;
      var x = n.c0 * s;
      var y = n.r0 * s;
      var w = n.cols * s;
      var h = n.rows * s;
      ctx.save();
      ctx.fillStyle = "rgba(168,85,247,0.16)";
      ctx.fillRect(x, y, w, h);
      // Two offset dashed passes, so the outline stays legible over any stitch.
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#ffffff";
      ctx.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
      ctx.lineDashOffset = 6;
      ctx.strokeStyle = "#7c3aed";
      ctx.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
      ctx.restore();
    }

    // ---- interaction ----
    _cellFromEvent(e) {
      var rect = this.canvas.getBoundingClientRect();
      var scaleX = this.canvas.width / rect.width;
      var scaleY = this.canvas.height / rect.height;
      var px = (e.clientX - rect.left) * scaleX;
      var py = (e.clientY - rect.top) * scaleY;
      var c = Math.floor(px / this.cellSize);
      var r = Math.floor(py / this.cellSize);
      if (r < 0 || c < 0 || r >= this.height || c >= this.width) return null;
      return { r: r, c: c };
    }

    _applyCell(r, c, value) {
      var i = r * this.width + c;
      var prev = this.cells[i];
      var changed = false;
      if (prev !== value) {
        if (prev >= 0) {
          this.counts[prev]--;
          if (this.counts[prev] <= 0) delete this.counts[prev];
        }
        this.cells[i] = value;
        if (value >= 0) {
          this.counts[value] = (this.counts[value] || 0) + 1;
        }
        changed = true;
      }
      // The stitch-type layers belong to the cell as much as its colour does:
      // erasing has to take them with it, or a partial stitch or an outline would
      // survive as an orphan on an empty cell. Painting SETS the partial (rather
      // than adding to it) so the tool always lays down what it says.
      if (value < 0) {
        if (this.frac && this.frac[i]) {
          this.frac[i] = 0;
          changed = true;
        }
        if (this.blend && this.blend[i]) {
          this.blend[i] = 0;
          changed = true;
        }
        if (this.back && this._clearBackCell(r, c)) changed = true;
      } else {
        if (this.setFracAt(r, c, this.stitchPart)) changed = true;
        // Painting with a blend replaces whatever blend was there, and painting
        // without one clears it: a solid colour must not keep a stale partner.
        if (this.setBlendAt(r, c, this.stitchBlend)) changed = true;
      }
      if (changed) this._paintCell(r, c, true);
      return changed;
    }

    /** Remove all four borders of a cell (canonicalised, so shared ones go too). */
    _clearBackCell(r, c) {
      if (!this.back) return false;
      var any = false;
      for (var e = 0; e < BACK_EDGES; e++) {
        if (this.setBackEdge(r, c, e, -1)) any = true;
      }
      return any;
    }

    /**
     * Repaint the backstitch visible inside ONE cell.
     *
     * A border line straddles the boundary between two cells, so half of it
     * belongs to each. Clearing and redrawing a single cell would erase the
     * neighbour's half and leave a gap in a long outline — so the surrounding
     * cells are redrawn and CLIPPED to this one, and the neighbour repaints its
     * own half when it is redrawn in turn.
     */
    _paintBackCell(r, c, x, y, s) {
      if (!this.back || s < 4) return;
      var self = this;
      var ctx = this.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, s, s);
      ctx.clip();
      drawBackEdges({
        ad: this._ad,
        back: this.back,
        w: this.width,
        h: this.height,
        s: s,
        ox: 0,
        oy: 0,
        vc0: 0,
        vr0: 0,
        r0: r - 1,
        r1: r + 1,
        c0: c - 1,
        c1: c + 1,
        hexFor: function (i) {
          return self.hexFor(i);
        },
      });
      ctx.restore();
    }

    /**
     * Which cell border the pointer is nearest, if it is near one at all.
     * Backstitch is drawn ON a border, so hit-testing the border rather than the
     * cell interior is what makes running a drag along an outline feel direct.
     */
    _backEdgeFromEvent(e) {
      var cell = this._cellFromEvent(e);
      if (!cell) return null;
      var box = this.canvas.getBoundingClientRect();
      if (!box.width || !box.height) return null;
      var s = this.cellSize;
      var px = (e.clientX - box.left) * (this.canvas.width / box.width);
      var py = (e.clientY - box.top) * (this.canvas.height / box.height);
      var fx = px / s - cell.c; // 0..1 across the cell
      var fy = py / s - cell.r;
      var dN = fy;
      var dS = 1 - fy;
      var dW = fx;
      var dE = 1 - fx;
      var best = dN;
      var edge = BACK_N;
      if (dS < best) {
        best = dS;
        edge = BACK_S;
      }
      if (dW < best) {
        best = dW;
        edge = BACK_W;
      }
      if (dE < best) {
        best = dE;
        edge = BACK_E;
      }
      // In the middle of a cell the user is aiming at nothing, not at a diagonal.
      if (best > 0.34) return null;
      return { r: cell.r, c: cell.c, e: edge };
    }

    /** Place (or clear, while erasing) the border under the pointer. */
    _paintBackAt(e) {
      var hit = this._backEdgeFromEvent(e);
      if (!hit) return;
      var key = (hit.r * this.width + hit.c) * BACK_EDGES + hit.e;
      if (key === this._lastBackKey) return;
      this._lastBackKey = key;
      var value = this._paintValue;
      if (value < 0 && this.backEdgeAt(hit.r, hit.c, hit.e) < 0) return;
      if (!this.setBackEdge(hit.r, hit.c, hit.e, value)) return;
      // Both cells that share this border have to be repainted, or one half of
      // the line would be missing until the next full render.
      this._paintCell(hit.r, hit.c, true);
      var t = this._canonBack(hit.r, hit.c, hit.e);
      if (t.r !== hit.r || t.c !== hit.c) this._paintCell(t.r, t.c, true);
      this._notify();
    }

    _paintAt(e) {
      var cell = this._cellFromEvent(e);
      if (!cell) return;
      var key = cell.r * this.width + cell.c;
      if (key === this._lastCell) return;
      this._lastCell = key;

      var anyApplied = false;
      var S = this.brushSize || 1;
      var halfStart = -Math.floor((S - 1) / 2);
      var halfEnd = Math.ceil((S - 1) / 2);

      for (var dr = halfStart; dr <= halfEnd; dr++) {
        for (var dc = halfStart; dc <= halfEnd; dc++) {
          var nr = cell.r + dr;
          var nc = cell.c + dc;
          if (nr >= 0 && nr < this.height && nc >= 0 && nc < this.width) {
            if (this._applyCell(nr, nc, this._paintValue)) {
              anyApplied = true;
            }
          }
        }
      }
      if (anyApplied) {
        this._notify();
      }
    }

    _floodFill(startR, startC, targetValue) {
      var i = startR * this.width + startC;
      var startValue = this.cells[i];
      if (startValue === targetValue) return;

      var queue = [{ r: startR, c: startC }];
      var anyApplied = false;
      var width = this.width;
      var height = this.height;
      var visited = new Uint8Array(width * height);
      visited[i] = 1;

      while (queue.length > 0) {
        var curr = queue.shift();

        if (this._applyCell(curr.r, curr.c, targetValue)) {
          anyApplied = true;
        }

        var directions = [
          { r: -1, c: 0 },
          { r: 1, c: 0 },
          { r: 0, c: -1 },
          { r: 0, c: 1 },
        ];

        for (var d = 0; d < directions.length; d++) {
          var nr = curr.r + directions[d].r;
          var nc = curr.c + directions[d].c;
          if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
            var nidx = nr * width + nc;
            if (!visited[nidx] && this.cells[nidx] === startValue) {
              visited[nidx] = 1;
              queue.push({ r: nr, c: nc });
            }
          }
        }
      }

      if (anyApplied) {
        this._pushHistory();
        this._notify();
      }
    }

    /**
     * A history entry has to cover EVERY layer. Snapshotting only `cells` would
     * make undo leave stray half stitches and outline segments behind, because
     * those layers are not derivable from the colours.
     */
    _snapshot() {
      var notes = this.cellNotes ? Object.assign({}, this.cellNotes) : null;
      return {
        cells: new Int16Array(this.cells),
        frac: this.frac ? new Uint8Array(this.frac) : null,
        back: this.back ? new Uint8Array(this.back) : null,
        blend: this.blend ? new Uint8Array(this.blend) : null,
        // Annotations and cell notes are edits too, so undo has to cover them.
        annots: this.annots.map(function (a) {
          return { k: a.k, a: a.a.slice(), b: a.b.slice(), t: a.t, colour: a.colour };
        }),
        notes: notes,
      };
    }

    _restoreSnapshot(snap) {
      if (!snap) return;
      this.cells.set(snap.cells);
      this.frac = snap.frac ? new Uint8Array(snap.frac) : null;
      this.back = snap.back ? new Uint8Array(snap.back) : null;
      this.blend = snap.blend ? new Uint8Array(snap.blend) : null;
      this.annots = (snap.annots || []).map(function (a) {
        return { k: a.k, a: a.a.slice(), b: a.b.slice(), t: a.t, colour: a.colour };
      });
      this.cellNotes = snap.notes ? Object.assign({}, snap.notes) : null;
    }

    _pushHistory() {
      if (this.historyIndex < this.history.length - 1) {
        this.history = this.history.slice(0, this.historyIndex + 1);
      }
      this.history.push(this._snapshot());
      if (this.history.length > 50) {
        this.history.shift();
      }
      this.historyIndex = this.history.length - 1;
    }

    undo() {
      if (this.historyIndex > 0) {
        this.historyIndex--;
        this._restoreSnapshot(this.history[this.historyIndex]);
        this._recount();
        this.render();
        this._notify();
        return true;
      }
      return false;
    }

    redo() {
      if (this.historyIndex < this.history.length - 1) {
        this.historyIndex++;
        this._restoreSnapshot(this.history[this.historyIndex]);
        this._recount();
        this.render();
        this._notify();
        return true;
      }
      return false;
    }

    _notify() {
      if (typeof this.opts.onChange === "function") {
        this.opts.onChange();
      }
    }

    // ---- panning ----
    // Middle-click drags the chart around. The canvas is not a scroll container
    // itself (it is exactly as big as the chart), so panning moves its parent,
    // .canvas-wrap. Nothing here touches `cells`, so it cannot edit the design.

    _beginPan(e) {
      var wrap = this.canvas.parentElement;
      if (!wrap) return;
      this._panning = true;
      this._panStart = { x: e.clientX, y: e.clientY };
      this._panOrigin = {
        left: wrap.scrollLeft,
        top: wrap.scrollTop,
        winX: typeof window.scrollX === "number" ? window.scrollX : 0,
        winY: typeof window.scrollY === "number" ? window.scrollY : 0,
      };
      this.canvas.classList.add("panning");
    }

    _panTo(e) {
      var wrap = this.canvas.parentElement;
      if (!wrap || !this._panStart || !this._panOrigin) return;
      // Drag right -> look further left, exactly like a direct-manipulation pan.
      var dx = e.clientX - this._panStart.x;
      var dy = e.clientY - this._panStart.y;
      var scrollX = wrap.scrollWidth > wrap.clientWidth;
      var scrollY = wrap.scrollHeight > wrap.clientHeight;
      if (scrollX) wrap.scrollLeft = this._panOrigin.left - dx;
      if (scrollY) wrap.scrollTop = this._panOrigin.top - dy;
      // An axis the wrapper cannot scroll has to pan the PAGE instead: on a
      // short window a zoomed chart makes the wrapper grow rather than clip, so
      // scrollTop sits at 0 forever and a vertical drag would do nothing.
      if ((!scrollX || !scrollY) && typeof window.scrollTo === "function") {
        window.scrollTo(
          this._panOrigin.winX - (scrollX ? 0 : dx),
          this._panOrigin.winY - (scrollY ? 0 : dy),
        );
      }
    }

    _endPan() {
      if (!this._panning) return;
      this._panning = false;
      this._panStart = null;
      this._panOrigin = null;
      this.canvas.classList.remove("panning");
    }

    _bindEvents() {
      var self = this;
      this.canvas.addEventListener("contextmenu", function (e) {
        e.preventDefault();
      });
      // Middle-click is reserved for panning, so it must not also pop up the
      // browser's autoscroll / "open in new tab" behaviour.
      this.canvas.addEventListener("auxclick", function (e) {
        if (e.button === 1) e.preventDefault();
      });
      this.canvas.addEventListener("mousedown", function (e) {
        if (!self.width) return;
        e.preventDefault();
        // Middle-click is the pan handle in EVERY tool, so it can never paint,
        // mark progress or start a marquee by accident.
        if (e.button === 1) {
          self._beginPan(e);
          return;
        }
        // The photo's resize points work in EVERY tool so they are always there
        // to grab; only the body drag belongs to Align mode.
        if (e.button === 0) {
          var ovTarget = self._overlayGrabTarget(self._pointFromEvent(e));
          if (ovTarget) {
            self._beginOverlayDrag(e, ovTarget);
            return;
          }
        }
        // Align mode never edits stitches: a click that misses the photo is a
        // no-op rather than a paint.
        if (self.mode === "overlay") return;
        // Eyedropper samples the colour under the pointer instead of editing.
        if (self.mode === "pick") {
          self._pickAt(e);
          return;
        }
        self._painting = true;
        self._lastCell = -1;

        // Select mode drags a marquee instead of editing stitches.
        if (self.mode === "select") {
          var scell = self._cellFromEvent(e);
          if (scell) {
            self._selAnchor = scell;
            self._selDragging = true;
            self.sel = {
              r0: scell.r,
              c0: scell.c,
              r1: scell.r,
              c1: scell.c,
            };
            self.render();
          } else {
            self._painting = false;
          }
          return;
        }

        // Progress mode marks stitches off rather than editing the design, so
        // it deliberately bypasses _paintValue and the undo history.
        if (self.mode === "progress") {
          var pcell = self._cellFromEvent(e);
          if (!pcell) {
            self._painting = false;
            return;
          }
          var pi = pcell.r * self.width + pcell.c;
          if (e.button === 2) {
            self._markValue = 0; // right-click always clears
          } else if (self.cells[pi] >= 0 || self.allCellsStitchable) {
            self._markValue = self.progress[pi] ? 0 : 1; // left-click toggles
          } else {
            self._painting = false; // empty cell: nothing to stitch
            return;
          }
          self._markAt(e);
          return;
        }

        // Annotations are a markup layer, not an edit to the stitches.
        if (self.mode === "annotate") {
          var apt = self._pointFromEvent(e);
          if (e.button === 2) {
            if (apt && self.removeAnnotationNear(apt.x, apt.y, Math.max(10, self.cellSize * 0.5))) {
              self._pushHistory();
              self._notify();
            }
            return;
          }
          self._beginAnnot(e);
          return;
        }

        var erase = e.button === 2 || (self.mode === "erase" && e.button === 0);
        self._paintValue = erase ? -1 : self.selectedIndex;
        if (self._paintValue === undefined) self._paintValue = -1;

        // Backstitch paints cell BORDERS rather than cell interiors, so it has
        // its own hit-test and its own drag loop.
        if (self.mode === "back") {
          self._lastBackKey = -1;
          self._paintBackAt(e);
          return;
        }

        if (self.mode === "fill") {
          var cell = self._cellFromEvent(e);
          if (cell) {
            self._floodFill(cell.r, cell.c, self._paintValue);
          }
          self._painting = false; // Don't drag-paint on fill
        } else {
          self._paintAt(e);
        }
      });
      window.addEventListener("mousemove", function (e) {
        if (self._panning) {
          self._panTo(e);
          return;
        }
        if (self._ovDrag) {
          self._overlayDragTo(e);
          return;
        }
        if (self._annotating) {
          self._annotDragTo(e);
          return;
        }
        if (!self._painting) return;
        if (self.mode === "select") {
          if (!self._selDragging || !self.sel) return;
          var sc = self._cellFromEvent(e);
          if (sc) {
            self.sel.r1 = sc.r;
            self.sel.c1 = sc.c;
            self.render();
          }
          return;
        }
        if (self.mode === "progress") self._markAt(e);
        else if (self.mode === "back") self._paintBackAt(e);
        else self._paintAt(e);
      });
      window.addEventListener("mouseup", function () {
        self._endPan();
        self._endOverlayDrag();
        if (self._annotating) self._endAnnot();
        if (self._painting) {
          self._painting = false;
          if (self.mode === "select") {
            self._selDragging = false;
            self._notifySelection();
          } else if (self.mode === "progress") {
            // Repaint so the current-unit band follows the marks that just
            // changed. Progress is not pushed to the design undo history.
            self.render();
          } else {
            self._pushHistory();
          }
        }
        self._lastCell = -1;
        self._lastBackKey = -1;
      });
      // A drag can end outside the window (alt-tab, release over another app),
      // so the pan must not be left stuck on.
      window.addEventListener("blur", function () {
        self._endPan();
        self._endOverlayDrag();
        if (self._annotating) self._endAnnot();
      });
      // Hover feedback for the alignment handles. Bound to the canvas so it only
      // runs while the pointer is actually over the chart.
      this.canvas.addEventListener("mousemove", function (e) {
        if (self._ovDrag) return;
        self._overlayHover(e);
      });
      this.canvas.addEventListener("mouseleave", function () {
        if (!self._ovDrag) self._clearOverlayCursor();
      });
    }

    // ---- export ----
    /** Export options: paper-white palette, grid on, ruler optional. */
    _exportOpts(ad, s, over) {
      var base = {
        background: "#ffffff",
        gridColor: PAPER_GRID,
        midGridColor: PAPER_GRID_MID,
        majorGridColor: PAPER_GRID_MAJOR,
        showGrid: true,
      };
      if (over) {
        for (var k in over) {
          if (Object.prototype.hasOwnProperty.call(over, k)) base[k] = over[k];
        }
      }
      return this._chartOpts(ad, s, base);
    }

    /**
     * Draw this chart into ANY adapter (SVG, PDF, ...) using export options.
     * The single public entry point for the non-canvas exporters, so they all
     * share one geometry with the screen and the PNG.
     */
    renderTo(adapter, cellSize, over) {
      drawChart(this._exportOpts(adapter, cellSize, over));
    }

    /** Render the chart to a PNG blob. `over` overrides any drawChart option. */
    exportBlob(cb, scale, over) {
      var s = Math.max(scale || 16, 8);
      var off = document.createElement("canvas");
      off.width = this.width * s;
      off.height = this.height * s;
      drawChart(this._exportOpts(new CanvasAdapter(off.getContext("2d")), s, over));
      off.toBlob(cb, "image/png");
    }

    /** Render the chart to a vector SVG string. */
    exportSvg(over) {
      var s = Math.max((over && over.scale) || 18, 8);
      var ad = new SvgAdapter();
      drawChart(this._exportOpts(ad, s, over));
      var w = this.width * s;
      var h = this.height * s;
      return (
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="' +
        w +
        '" height="' +
        h +
        '" viewBox="0 0 ' +
        w +
        " " +
        h +
        '">\n' +
        ad.toString() +
        "\n</svg>\n"
      );
    }
  }

  window.CrossStitchCanvas = CrossStitchCanvas;
  // Exposed for the headless test harness and for app.js.
  CrossStitchCanvas.progressToRuns = progressToRuns;
  CrossStitchCanvas.progressFromRuns = progressFromRuns;
  CrossStitchCanvas.MAX_SUBSTRATE_PAGES = MAX_SUBSTRATE_PAGES;
  // Stitch types: the flag vocabulary, the mirror/rotate maps, the RLE codec and
  // the label helper are all pure, so the harness can test them directly and
  // app.js can persist a layer without duplicating the format.
  CrossStitchCanvas.FRAC = {
    NW: FRAC_NW,
    NE: FRAC_NE,
    SE: FRAC_SE,
    SW: FRAC_SW,
    SLASH: FRAC_SLASH,
    BACKSLASH: FRAC_BACKSLASH,
    ALL: FRAC_ALL,
    // The named partials the tool offers, so the UI and the renderer cannot drift.
    HALF_SLASH: FRAC_SLASH,
    HALF_BACKSLASH: FRAC_BACKSLASH,
    QUARTER_NW: FRAC_NW,
    QUARTER_NE: FRAC_NE,
    QUARTER_SE: FRAC_SE,
    QUARTER_SW: FRAC_SW,
    // A three-quarter stitch pairs a corner arm with the diagonal that MISSES it,
    // which is what makes it read as three of the four arms.
    THREEQ_NW: FRAC_NW | FRAC_SLASH,
    THREEQ_NE: FRAC_NE | FRAC_BACKSLASH,
    THREEQ_SE: FRAC_SE | FRAC_SLASH,
    THREEQ_SW: FRAC_SW | FRAC_BACKSLASH,
  };
  CrossStitchCanvas.BACK = {
    N: BACK_N,
    E: BACK_E,
    S: BACK_S,
    W: BACK_W,
    EDGES: BACK_EDGES,
  };
  CrossStitchCanvas.mapFrac = mapFrac;
  CrossStitchCanvas.mapBackEdge = mapBackEdge;
  CrossStitchCanvas.fracLabel = fracLabel;
  CrossStitchCanvas.BLEND_NONE = BLEND_NONE;
  CrossStitchCanvas.bytesToRuns = bytesToRuns;
  CrossStitchCanvas.runsToBytes = runsToBytes;
  // Annotations / per-cell notes (on-screen only, but persisted).
  CrossStitchCanvas.MAX_ANNOTATIONS = MAX_ANNOTATIONS;
  CrossStitchCanvas.MAX_CELL_NOTES = MAX_CELL_NOTES;
  CrossStitchCanvas.MAX_NOTE_LENGTH = MAX_NOTE_LENGTH;
  CrossStitchCanvas.ANNOT_KINDS = Object.keys(ANNOT_KINDS);
  // A hard ceiling on a decoded layer, mirroring the grid size limit: a
  // hand-edited document must not be able to make us allocate wildly.
  CrossStitchCanvas.MAX_LAYER_LENGTH = 500 * 500 * BACK_EDGES;

  /**
   * Bounding box of a list of pages, in cells: {col,row,cols,rows} or null when
   * the list is empty. The seamless grid is always exactly this box.
   */
  CrossStitchCanvas.pageBoundsOf = function (pages) {
    var minC = Infinity;
    var minR = Infinity;
    var maxC = -Infinity;
    var maxR = -Infinity;
    for (var i = 0; i < (pages || []).length; i++) {
      var p = pages[i] || {};
      var c = _num(p.col, 0);
      var r = _num(p.row, 0);
      var w = Math.max(MIN_PAGE_CELLS, _num(p.cols, MIN_PAGE_CELLS));
      var h = Math.max(MIN_PAGE_CELLS, _num(p.rows, MIN_PAGE_CELLS));
      minC = Math.min(minC, c);
      minR = Math.min(minR, r);
      maxC = Math.max(maxC, c + w);
      maxR = Math.max(maxR, r + h);
    }
    if (minC === Infinity) return null;
    return { col: minC, row: minR, cols: maxC - minC, rows: maxR - minR };
  };

  /**
   * Turn the LEGACY single-page alignment {fit,scaleX,scaleY,offsetX,offsetY}
   * into the equivalent page geometry, in cells.
   *
   * Documents saved before multi-page support stored one `source` plus a `fit`
   * transform. Reading them as a single page keeps every existing chart project
   * opening unchanged instead of silently losing its artwork placement.
   */
  CrossStitchCanvas.pageFromFit = function (fit, gridCols, gridRows, imgW, imgH) {
    var f = fit || {};
    var gW = Math.max(1, _num(gridCols, 1));
    var gH = Math.max(1, _num(gridRows, 1));
    var iw = _num(imgW, 0);
    var ih = _num(imgH, 0);
    var mode = f.fit === "cover" || f.fit === "stretch" ? f.fit : "contain";
    var bw = gW;
    var bh = gH;
    if (mode !== "stretch" && iw > 0 && ih > 0) {
      var k =
        mode === "contain"
          ? Math.min(gW / iw, gH / ih)
          : Math.max(gW / iw, gH / ih);
      bw = iw * k;
      bh = ih * k;
    }
    var w = bw * _num(f.scaleX, 1);
    var h = bh * _num(f.scaleY, 1);
    return {
      col: (gW - w) / 2 + _num(f.offsetX, 0) * gW,
      row: (gH - h) / 2 + _num(f.offsetY, 0) * gH,
      cols: Math.max(MIN_PAGE_CELLS, w),
      rows: Math.max(MIN_PAGE_CELLS, h),
    };
  };
})();
