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
  var PROGRESS_DIM = "rgba(15,17,23,0.62)"; // already-stitched cells
  var PROGRESS_BAND = "rgba(168,85,247,0.20)"; // the unit being worked on

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

  function drawStitchShape(ad, x, y, s, hex, style) {
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
      // Full cross: the under-strand is darkened for depth, as on screen.
      ad.line(
        [
          [x0, y1],
          [x1, y0],
        ],
        { stroke: shade(hex, -22), lineWidth: lw, lineCap: "round" },
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
        var idx = o.cells[r * w + c];
        if (idx < 0) continue;
        x = ox + (c - c0) * s;
        y = oy + (r - r0) * s;
        var hex = o.hexFor(idx);
        if (o.showStitch && s >= 6) {
          drawStitchShape(ad, x, y, s, hex, o.stitchStyle);
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
      // Progress tracker. `progress` is deliberately SEPARATE from `cells` so
      // marking stitches never touches colour counts or any export.
      this.progress = null; // Uint8Array, 1 = stitched
      this.progressOn = false;
      this.progressMode = "row"; // 'row' | 'column' | 'diagonal'
      this._markValue = 1;
      this._curUnit = null;
      // Selection marquee + clipboard. The outline is drawn outside drawChart,
      // so a selection can never appear in an export.
      this.sel = null;
      this.clipboard = null;
      this._selDragging = false;
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

    loadGrid(width, height, grid) {
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
      this.progress = new Uint8Array(width * height);
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
      this.progress = new Uint8Array(width * height);
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
      // Full repaint through the shared adapter layer, so what is on screen is
      // produced by exactly the same code that produces the PNG/SVG/PDF.
      drawChart(this._chartOpts(this._ad, s, {}));
      // Progress and selection overlays are on-screen only; they are drawn
      // OUTSIDE drawChart so they can never reach the PNG, SVG or PDF exports.
      this._drawProgressOverlay();
      this._drawSelectionOverlay();
    }

    _paintCell(r, c, clearFirst) {
      var s = this.cellSize;
      var x = c * s;
      var y = r * s;
      var ctx = this.ctx;
      if (clearFirst) {
        ctx.fillStyle = MESH;
        ctx.fillRect(x, y, s, s);
      }
      var idx = this.cells[r * this.width + c];
      if (idx >= 0) {
        var hex = this.hexFor(idx);
        if (this.showStitch && s >= 6) {
          drawStitchShape(this._ad, x, y, s, hex, this.stitchStyle);
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
      this._paintProgressCell(r, c);
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

    clearAll() {
      this.cells.fill(-1);
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
      if (this.cells[i] < 0) return true;
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
        if (this.cells[i] < 0) continue;
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
      if (this.cells[i] < 0) return false; // nothing stitched there
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

      // The unit being worked on, under the dim so the wash still reads.
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
      ctx.fillStyle = PROGRESS_DIM;
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
        this.ctx.fillStyle = PROGRESS_DIM;
        this.ctx.fillRect(c * s, r * s, s, s);
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
      for (var r = 0; r < n.rows; r++) {
        for (var c = 0; c < n.cols; c++) {
          buf[r * n.cols + c] =
            this.cells[(n.r0 + r) * this.width + (n.c0 + c)];
        }
      }
      this.clipboard = { rows: n.rows, cols: n.cols, cells: buf };
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
          var v = block.cells[r * block.cols + c];
          if (this.cells[i] !== v) {
            this.cells[i] = v;
            changed++;
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
          this.cells[r * this.width + c] = -1;
        }
      }
      this._commitSelectionEdit();
      return true;
    }

    fillSelection() {
      var n = this._selNorm();
      if (!n || this.selectedIndex < 0) return false;
      for (var r = n.r0; r <= n.r1; r++) {
        for (var c = n.c0; c <= n.c1; c++) {
          this.cells[r * this.width + c] = this.selectedIndex;
        }
      }
      this._commitSelectionEdit();
      return true;
    }

    mirrorSelection(axis) {
      var n = this._selNorm();
      if (!n) return false;
      var tmp = new Int16Array(n.rows * n.cols);
      for (var r = 0; r < n.rows; r++) {
        for (var c = 0; c < n.cols; c++) {
          tmp[r * n.cols + c] = this.cells[(n.r0 + r) * this.width + (n.c0 + c)];
        }
      }
      for (var r2 = 0; r2 < n.rows; r2++) {
        for (var c2 = 0; c2 < n.cols; c2++) {
          var sr = axis === "v" ? n.rows - 1 - r2 : r2;
          var sc = axis === "h" ? n.cols - 1 - c2 : c2;
          this.cells[(n.r0 + r2) * this.width + (n.c0 + c2)] =
            tmp[sr * n.cols + sc];
        }
      }
      this._commitSelectionEdit();
      return true;
    }

    /** dir > 0 rotates clockwise. A non-square block swaps its dimensions. */
    rotateSelection(dir) {
      var n = this._selNorm();
      if (!n) return false;
      var outRows = n.cols;
      var outCols = n.rows;
      var out = new Int16Array(outRows * outCols);
      for (var r = 0; r < n.rows; r++) {
        for (var c = 0; c < n.cols; c++) {
          var v = this.cells[(n.r0 + r) * this.width + (n.c0 + c)];
          var nr = dir > 0 ? c : n.cols - 1 - c;
          var nc = dir > 0 ? n.rows - 1 - r : r;
          out[nr * outCols + nc] = v;
        }
      }
      // Clear exactly the ORIGINAL footprint, then blit the rotated block.
      // Clearing the union of the old and new footprints would destroy cells
      // outside the selection (a 2x3 block rotated to 3x2 inside a larger grid
      // would wipe a 3x3 area). Source cells outside the rotated result must go,
      // which clearing the source achieves exactly.
      for (var rr = 0; rr < n.rows; rr++) {
        for (var cc = 0; cc < n.cols; cc++) {
          this.cells[(n.r0 + rr) * this.width + (n.c0 + cc)] = -1;
        }
      }
      for (var r2 = 0; r2 < outRows; r2++) {
        for (var c2 = 0; c2 < outCols; c2++) {
          var tr = n.r0 + r2;
          var tc = n.c0 + c2;
          if (tr >= this.height || tc >= this.width) continue;
          this.cells[tr * this.width + tc] = out[r2 * outCols + c2];
        }
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
      for (var r = 0; r < n.rows; r++) {
        for (var c = 0; c < n.cols; c++) {
          out[r * n.cols + c] = this.cells[(n.r0 + r) * this.width + (n.c0 + c)];
        }
      }
      this.width = n.cols;
      this.height = n.rows;
      this.cells = out;
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
      if (prev === value) return false;
      if (prev >= 0) {
        this.counts[prev]--;
        if (this.counts[prev] <= 0) delete this.counts[prev];
      }
      this.cells[i] = value;
      if (value >= 0) {
        this.counts[value] = (this.counts[value] || 0) + 1;
      }
      this._paintCell(r, c, true);
      return true;
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

    _pushHistory() {
      if (this.historyIndex < this.history.length - 1) {
        this.history = this.history.slice(0, this.historyIndex + 1);
      }
      this.history.push(new Int16Array(this.cells));
      if (this.history.length > 50) {
        this.history.shift();
      }
      this.historyIndex = this.history.length - 1;
    }

    undo() {
      if (this.historyIndex > 0) {
        this.historyIndex--;
        this.cells.set(this.history[this.historyIndex]);
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
        this.cells.set(this.history[this.historyIndex]);
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

    _bindEvents() {
      var self = this;
      this.canvas.addEventListener("contextmenu", function (e) {
        e.preventDefault();
      });
      this.canvas.addEventListener("mousedown", function (e) {
        if (!self.width) return;
        e.preventDefault();
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
          } else if (self.cells[pi] >= 0) {
            self._markValue = self.progress[pi] ? 0 : 1; // left-click toggles
          } else {
            self._painting = false; // empty cell: nothing to stitch
            return;
          }
          self._markAt(e);
          return;
        }

        var erase = e.button === 2 || (self.mode === "erase" && e.button === 0);
        self._paintValue = erase ? -1 : self.selectedIndex;
        if (self._paintValue === undefined) self._paintValue = -1;

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
        else self._paintAt(e);
      });
      window.addEventListener("mouseup", function () {
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
  // Exposed for the headless test harness.
  CrossStitchCanvas.progressToRuns = progressToRuns;
  CrossStitchCanvas.progressFromRuns = progressFromRuns;
})();
