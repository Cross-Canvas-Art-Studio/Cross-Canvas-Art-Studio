/**
 * CrossStitchCanvas - renders a yarn cross-stitch chart on an HTML5 canvas and
 * handles interactive painting.
 *
 * The grid is a flat Int16Array of palette indices (-1 = empty). Each filled
 * cell is drawn as an "X" cross-stitch (two diagonal strands, the under-strand
 * slightly darkened for depth) sitting on a plastic-canvas mesh. A canvas is
 * used instead of DOM cells because a 200x200 chart is 40,000 cells. Single
 * cells are repainted during drag for smooth interaction; full re-renders only
 * happen on load, zoom, or toggles.
 */
(function () {
  "use strict";

  var MESH = "#20242e";
  var GRID_LINE = "rgba(255,255,255,0.06)";

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
      this.showSymbols = false;
      this.showStitch = true;
      this.selectedIndex = -1;
      this.mode = "paint";
      this._codeFormatter = null;
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
      this._recount();
      this.fitToView();
    }

    newBlank(width, height) {
      this.width = width;
      this.height = height;
      this.cells = new Int16Array(width * height).fill(-1);
      this._recount();
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
      this.ctx.fillStyle = MESH;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      for (var r = 0; r < this.height; r++) {
        for (var c = 0; c < this.width; c++) {
          this._paintCell(r, c, false);
        }
      }
    }

    _paintCell(r, c, clearFirst) {
      var s = this.cellSize;
      var x = c * s,
        y = r * s;
      var ctx = this.ctx;
      if (clearFirst) {
        ctx.fillStyle = MESH;
        ctx.fillRect(x, y, s, s);
      }
      var idx = this.cells[r * this.width + c];
      if (idx >= 0) {
        var hex = this.hexFor(idx);
        if (this.showStitch && s >= 6) {
          this._drawStitch(x, y, s, hex);
        } else {
          var inset = Math.max(0.5, s * 0.08);
          ctx.fillStyle = hex;
          ctx.fillRect(x + inset, y + inset, s - inset * 2, s - inset * 2);
        }
        if (this.showSymbols && s >= 14) {
          ctx.fillStyle =
            luminance(hex) > 0.55
              ? "rgba(0,0,0,0.75)"
              : "rgba(255,255,255,0.85)";
          ctx.font = Math.floor(s * 0.32) + "px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(this.codeFor(idx), x + s / 2, y + s / 2 + 1);
        }
      }
      if (this.showGrid && s >= 4) {
        ctx.strokeStyle = GRID_LINE;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, s, s);
      }
    }

    _drawStitch(x, y, s, hex) {
      var ctx = this.ctx;
      var inset = s * 0.16;
      var x0 = x + inset,
        y0 = y + inset,
        x1 = x + s - inset,
        y1 = y + s - inset;
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(1.2, s * 0.3);
      // under strand ("/") slightly darker for depth
      ctx.strokeStyle = shade(hex, -22);
      ctx.beginPath();
      ctx.moveTo(x0, y1);
      ctx.lineTo(x1, y0);
      ctx.stroke();
      // over strand ("\")
      ctx.strokeStyle = hex;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // ---- options ----
    setOption(key, value) {
      if (key === "showGrid") this.showGrid = value;
      else if (key === "showSymbols") this.showSymbols = value;
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

    clearAll() {
      this.cells.fill(-1);
      this._recount();
      this.render();
      this._notify();
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
      if (this._applyCell(cell.r, cell.c, this._paintValue)) {
        this._notify();
      }
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
        var erase = e.button === 2 || (self.mode === "erase" && e.button === 0);
        self._paintValue = erase ? -1 : self.selectedIndex;
        if (self._paintValue === undefined) self._paintValue = -1;
        self._paintAt(e);
      });
      window.addEventListener("mousemove", function (e) {
        if (self._painting) self._paintAt(e);
      });
      window.addEventListener("mouseup", function () {
        self._painting = false;
        self._lastCell = -1;
      });
    }

    // ---- export ----
    exportBlob(cb, scale) {
      // Render a clean copy at a fixed cell size for a crisp exported chart.
      var s = Math.max(scale || 16, 8);
      var off = document.createElement("canvas");
      off.width = this.width * s;
      off.height = this.height * s;
      var octx = off.getContext("2d");
      octx.fillStyle = "#ffffff";
      octx.fillRect(0, 0, off.width, off.height);
      for (var r = 0; r < this.height; r++) {
        for (var c = 0; c < this.width; c++) {
          var idx = this.cells[r * this.width + c];
          var x = c * s,
            y = r * s;
          if (idx >= 0) {
            var hex = this.hexFor(idx);
            var inset = s * 0.16;
            octx.lineCap = "round";
            octx.lineWidth = Math.max(1.4, s * 0.3);
            octx.strokeStyle = shade(hex, -22);
            octx.beginPath();
            octx.moveTo(x + inset, y + s - inset);
            octx.lineTo(x + s - inset, y + inset);
            octx.stroke();
            octx.strokeStyle = hex;
            octx.beginPath();
            octx.moveTo(x + inset, y + inset);
            octx.lineTo(x + s - inset, y + s - inset);
            octx.stroke();
          }
          octx.strokeStyle = "rgba(0,0,0,0.12)";
          octx.lineWidth = 1;
          octx.strokeRect(x + 0.5, y + 0.5, s, s);
        }
      }
      off.toBlob(cb, "image/png");
    }
  }

  window.CrossStitchCanvas = CrossStitchCanvas;
})();
