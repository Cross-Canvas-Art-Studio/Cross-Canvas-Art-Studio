/**
 * static-adapter.js – client-side API shim for the GitHub Pages site.
 *
 * Intercepts window.fetch() before app.js runs and provides client-side
 * implementations of every backend endpoint the UI calls:
 *
 *   /api/config          → hardcoded palette + config (no AI, no auth)
 *   /api/analyze-image   → client-side Canvas-API pixelation + nearest-colour
 *   /api/projects        → CRUD backed by localStorage
 *   /api/projects/:id    → load / update / delete single project
 *
 * Also provides a stub window.llmAPIManager (api-manager.js is excluded from
 * the static build, but app.js still references it).
 */
(function () {
  "use strict";

  // ── Palette (mirrors palette_manager.py DEFAULT_PALETTE, index = position) ──
  var PALETTE = [
    // Neutrals
    { index: 0, code: "WHT", name: "White", hex: "#FFFFFF", family: "Neutral" },
    { index: 1, code: "SNW", name: "Snow", hex: "#F7F4EC", family: "Neutral" },
    { index: 2, code: "ARN", name: "Aran", hex: "#EFE6CE", family: "Neutral" },
    { index: 3, code: "CRM", name: "Cream", hex: "#F3E7C0", family: "Neutral" },
    { index: 4, code: "BUF", name: "Buff", hex: "#E4D5A8", family: "Neutral" },
    {
      index: 5,
      code: "OAT",
      name: "Oatmeal",
      hex: "#D8CBB0",
      family: "Neutral",
    },
    {
      index: 6,
      code: "SLV",
      name: "Silver",
      hex: "#C9CDD2",
      family: "Neutral",
    },
    {
      index: 7,
      code: "LGY",
      name: "Light Grey",
      hex: "#AAB0B6",
      family: "Neutral",
    },
    { index: 8, code: "GRY", name: "Grey", hex: "#8A9099", family: "Neutral" },
    { index: 9, code: "STL", name: "Steel", hex: "#6E747C", family: "Neutral" },
    {
      index: 10,
      code: "CHL",
      name: "Charcoal",
      hex: "#3E4247",
      family: "Neutral",
    },
    {
      index: 11,
      code: "BLK",
      name: "Black",
      hex: "#1A1A1A",
      family: "Neutral",
    },
    // Reds & Pinks
    {
      index: 12,
      code: "CHY",
      name: "Cherry",
      hex: "#C1272D",
      family: "Red / Pink",
    },
    {
      index: 13,
      code: "RED",
      name: "Red",
      hex: "#E01B22",
      family: "Red / Pink",
    },
    {
      index: 14,
      code: "BRG",
      name: "Burgundy",
      hex: "#6E1E2A",
      family: "Red / Pink",
    },
    {
      index: 15,
      code: "COR",
      name: "Coral",
      hex: "#F2664F",
      family: "Red / Pink",
    },
    {
      index: 16,
      code: "WML",
      name: "Watermelon",
      hex: "#F04E6E",
      family: "Red / Pink",
    },
    {
      index: 17,
      code: "ROS",
      name: "Rose",
      hex: "#E68FA6",
      family: "Red / Pink",
    },
    {
      index: 18,
      code: "PNK",
      name: "Pink",
      hex: "#F6C6D4",
      family: "Red / Pink",
    },
    {
      index: 19,
      code: "HPK",
      name: "Hot Pink",
      hex: "#E93E97",
      family: "Red / Pink",
    },
    {
      index: 20,
      code: "ORC",
      name: "Orchid",
      hex: "#C86FB0",
      family: "Red / Pink",
    },
    // Oranges, Yellows & Browns
    {
      index: 21,
      code: "PMP",
      name: "Pumpkin",
      hex: "#E8722A",
      family: "Orange / Yellow / Brown",
    },
    {
      index: 22,
      code: "ORG",
      name: "Orange",
      hex: "#F5921B",
      family: "Orange / Yellow / Brown",
    },
    {
      index: 23,
      code: "GLD",
      name: "Gold",
      hex: "#F2B705",
      family: "Orange / Yellow / Brown",
    },
    {
      index: 24,
      code: "YEL",
      name: "Yellow",
      hex: "#F6D915",
      family: "Orange / Yellow / Brown",
    },
    {
      index: 25,
      code: "CRN",
      name: "Cornsilk",
      hex: "#F3E79A",
      family: "Orange / Yellow / Brown",
    },
    {
      index: 26,
      code: "CML",
      name: "Camel",
      hex: "#C79A5B",
      family: "Orange / Yellow / Brown",
    },
    {
      index: 27,
      code: "BRN",
      name: "Brown",
      hex: "#8A5A2B",
      family: "Orange / Yellow / Brown",
    },
    {
      index: 28,
      code: "COF",
      name: "Coffee",
      hex: "#5A3B22",
      family: "Orange / Yellow / Brown",
    },
    {
      index: 29,
      code: "CHO",
      name: "Chocolate",
      hex: "#3B2A20",
      family: "Orange / Yellow / Brown",
    },
    // Greens
    { index: 30, code: "LIM", name: "Lime", hex: "#8DC63F", family: "Green" },
    {
      index: 31,
      code: "SPR",
      name: "Spring Green",
      hex: "#4FB24A",
      family: "Green",
    },
    {
      index: 32,
      code: "KEL",
      name: "Kelly Green",
      hex: "#2E9E4B",
      family: "Green",
    },
    { index: 33, code: "HUN", name: "Hunter", hex: "#1E6B3A", family: "Green" },
    { index: 34, code: "FOR", name: "Forest", hex: "#14532B", family: "Green" },
    { index: 35, code: "SAG", name: "Sage", hex: "#A6B98C", family: "Green" },
    { index: 36, code: "OLV", name: "Olive", hex: "#7A7B2E", family: "Green" },
    { index: 37, code: "MNT", name: "Mint", hex: "#B7E4C7", family: "Green" },
    { index: 38, code: "TEA", name: "Teal", hex: "#1E8A7A", family: "Green" },
    // Blues
    { index: 39, code: "AQU", name: "Aqua", hex: "#4FC3C7", family: "Blue" },
    {
      index: 40,
      code: "TRQ",
      name: "Turquoise",
      hex: "#17A2B8",
      family: "Blue",
    },
    { index: 41, code: "SKY", name: "Sky", hex: "#7EC8E3", family: "Blue" },
    {
      index: 42,
      code: "LBL",
      name: "Light Blue",
      hex: "#A9CCE3",
      family: "Blue",
    },
    {
      index: 43,
      code: "CFL",
      name: "Cornflower",
      hex: "#5B8DEF",
      family: "Blue",
    },
    { index: 44, code: "BLU", name: "Blue", hex: "#2E6FDA", family: "Blue" },
    { index: 45, code: "ROY", name: "Royal", hex: "#1E3FA0", family: "Blue" },
    { index: 46, code: "NVY", name: "Navy", hex: "#15224B", family: "Blue" },
    { index: 47, code: "DEN", name: "Denim", hex: "#3E5C76", family: "Blue" },
    // Purples
    {
      index: 48,
      code: "LAV",
      name: "Lavender",
      hex: "#C8A2D6",
      family: "Purple",
    },
    {
      index: 49,
      code: "AMY",
      name: "Amethyst",
      hex: "#9B59B6",
      family: "Purple",
    },
    {
      index: 50,
      code: "PUR",
      name: "Purple",
      hex: "#7A3EA1",
      family: "Purple",
    },
    { index: 51, code: "PLM", name: "Plum", hex: "#5E2B69", family: "Purple" },
    { index: 52, code: "GRP", name: "Grape", hex: "#3F1D5A", family: "Purple" },
  ];

  // Precompute RGB arrays — index matches PALETTE position == palette index
  var PAL_RGB = PALETTE.map(function (e) {
    var h = e.hex.replace("#", "");
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  });

  // ── Nearest palette index by Euclidean RGB distance ──
  function nearestPalIdx(r, g, b) {
    var best = 0,
      bestDist = Infinity;
    for (var i = 0; i < PAL_RGB.length; i++) {
      var p = PAL_RGB[i];
      var dr = r - p[0],
        dg = g - p[1],
        db = b - p[2];
      var d = dr * dr + dg * dg + db * db;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return PALETTE[best].index;
  }

  // ── llmAPIManager stub (api-manager.js is excluded from static build) ──
  window.llmAPIManager = {
    setServerKeys: function () {},
    requiresKey: function () {
      return false;
    },
    hasServerKey: function () {
      return false;
    },
    getKey: function () {
      return "";
    },
    setKey: function () {},
    isLocal: function () {
      return false;
    },
    getHeaders: function () {
      return { "Content-Type": "application/json" };
    },
    categorizeError: function (m) {
      return m || "Error";
    },
  };

  // ── localStorage project store ──
  // One-time migration from the legacy "cca_demo_projects" key so saved
  // projects survive the rename to the production store.
  var LEGACY_PROJ_KEY = "cca_demo_projects";
  var PROJ_KEY = "stitchee_projects";

  function loadStore() {
    try {
      if (
        localStorage.getItem(PROJ_KEY) === null &&
        localStorage.getItem(LEGACY_PROJ_KEY) !== null
      ) {
        localStorage.setItem(PROJ_KEY, localStorage.getItem(LEGACY_PROJ_KEY));
        localStorage.removeItem(LEGACY_PROJ_KEY);
      }
      return JSON.parse(localStorage.getItem(PROJ_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveStore(store) {
    try {
      localStorage.setItem(PROJ_KEY, JSON.stringify(store));
    } catch (e) {
      /* ignore quota errors */
    }
  }

  // ── Fake Response helper ──
  function resp(data, status) {
    return Promise.resolve(
      new Response(JSON.stringify(data), {
        status: status || 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  // ── /api/config ──
  function handleConfig() {
    return resp({
      app: {
        title: "Stitchee",
        subtitle: "Cross Canvas Art Studio",
        affiliate: {
          enabled: true,
          label: "Buy these yarns",
          tag: "jonesckevin-20",
          base_query: "worsted weight yarn",
          url_template: "https://www.amazon.com/s?k={query}&tag={tag}",
        },
      },
      grid: {
        min_size: 5,
        max_size: 500,
        default_width: 60,
        default_height: 80,
        default_max_colors: 16,
        max_colors: 52,
      },
      upload: {
        max_file_size_mb: 25,
        allowed_extensions: [".bmp", ".gif", ".jpeg", ".jpg", ".png", ".webp"],
      },
      palette: PALETTE,
      llm: { default_provider: "ollama", providers: {} },
      features: {
        ai_enabled: false,
        allow_client_api_keys: false,
        auth_enabled: false,
        registration_enabled: false,
        require_auth: false,
        guest_login_enabled: false,
      },
      current_user: null,
      server_api_keys: {},
    });
  }

  // ── /api/analyze-image ──
  function handleAnalyzeImage(init) {
    var fd = init && init.body;
    if (!(fd instanceof FormData)) {
      return resp({ error: "No image data" }, 400);
    }

    var file = fd.get("image");
    var reqW = Math.max(
      5,
      Math.min(500, parseInt(fd.get("width") || "60", 10)),
    );
    var reqH = Math.max(
      5,
      Math.min(500, parseInt(fd.get("height") || "80", 10)),
    );
    var maxClrs = Math.max(
      2,
      Math.min(52, parseInt(fd.get("max_colors") || "16", 10)),
    );

    if (!file) {
      return resp({ error: "No image file" }, 400);
    }

    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();

      img.onload = function () {
        try {
          var cv = document.createElement("canvas");
          cv.width = reqW;
          cv.height = reqH;
          var ctx = cv.getContext("2d");
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, reqW, reqH);
          URL.revokeObjectURL(url);

          var pix = ctx.getImageData(0, 0, reqW, reqH).data;
          var cache = {};
          var rawGrid = [];

          for (var r = 0; r < reqH; r++) {
            var row = [];
            for (var c = 0; c < reqW; c++) {
              var o = (r * reqW + c) * 4;
              // Treat transparent pixels as empty
              if (pix[o + 3] < 128) {
                row.push(-1);
                continue;
              }
              var key = (pix[o] << 16) | (pix[o + 1] << 8) | pix[o + 2];
              if (!(key in cache)) {
                cache[key] = nearestPalIdx(pix[o], pix[o + 1], pix[o + 2]);
              }
              row.push(cache[key]);
            }
            rawGrid.push(row);
          }

          // Count colour frequency, then enforce maxClrs limit
          var counts = {};
          rawGrid.forEach(function (row) {
            row.forEach(function (v) {
              if (v >= 0) {
                counts[v] = (counts[v] || 0) + 1;
              }
            });
          });
          var sorted = Object.keys(counts)
            .map(Number)
            .sort(function (a, b) {
              return counts[b] - counts[a];
            });

          var finalGrid = rawGrid;
          if (sorted.length > maxClrs) {
            var allowed = {};
            sorted.slice(0, maxClrs).forEach(function (i) {
              allowed[i] = true;
            });

            // Remap over-limit colours to nearest allowed colour
            var remap = {};
            sorted.slice(maxClrs).forEach(function (ri) {
              var bestD = Infinity,
                bestI = sorted[0];
              sorted.slice(0, maxClrs).forEach(function (ai) {
                var ar = PAL_RGB[ri],
                  br = PAL_RGB[ai];
                var d =
                  (ar[0] - br[0]) * (ar[0] - br[0]) +
                  (ar[1] - br[1]) * (ar[1] - br[1]) +
                  (ar[2] - br[2]) * (ar[2] - br[2]);
                if (d < bestD) {
                  bestD = d;
                  bestI = ai;
                }
              });
              remap[ri] = bestI;
            });

            finalGrid = rawGrid.map(function (row) {
              return row.map(function (v) {
                return v >= 0 && !allowed[v] ? remap[v] : v;
              });
            });
            sorted = sorted.slice(0, maxClrs);
          }

          resolve(
            new Response(
              JSON.stringify({
                width: reqW,
                height: reqH,
                grid: finalGrid,
                stats: { color_count: sorted.length },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        } catch (err) {
          resolve(resp({ error: "Image processing failed" }, 500));
        }
      };

      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(resp({ error: "Failed to load image" }, 400));
      };

      img.src = url;
    });
  }

  // ── /api/projects helpers ──
  function projectMeta(p) {
    var colors = {};
    (p.grid || []).forEach(function (row) {
      row.forEach(function (v) {
        if (v >= 0) {
          colors[v] = true;
        }
      });
    });
    return {
      id: p.id,
      title: p.title,
      width: p.width,
      height: p.height,
      color_count: Object.keys(colors).length,
      updated_at: p.updated_at,
    };
  }

  function handleGetProjects() {
    var store = loadStore();
    var list = Object.values(store)
      .map(projectMeta)
      .sort(function (a, b) {
        return (b.updated_at || 0) - (a.updated_at || 0);
      });
    return resp({ projects: list });
  }

  function handleSaveProject(init) {
    var body = JSON.parse((init && init.body) || "{}");
    var grid = body.grid || [];
    var h = grid.length;
    var w = h ? (grid[0] || []).length : 0;
    var id =
      "proj_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    var proj = {
      id: id,
      title: body.title || "Untitled",
      grid: grid,
      width: w,
      height: h,
      updated_at: Date.now(),
    };
    var store = loadStore();
    store[id] = proj;
    saveStore(store);
    return resp({ project: projectMeta(proj) });
  }

  function handleLoadProject(id) {
    var store = loadStore();
    var p = store[id];
    if (!p) {
      return resp({ error: "Project not found" }, 404);
    }
    return resp({ project: p });
  }

  function handleUpdateProject(id, init) {
    var store = loadStore();
    if (!store[id]) {
      return resp({ error: "Project not found" }, 404);
    }
    var body = JSON.parse((init && init.body) || "{}");
    var grid = body.grid || store[id].grid;
    var h = grid.length;
    var w = h ? (grid[0] || []).length : 0;
    store[id] = Object.assign({}, store[id], {
      title: body.title || store[id].title,
      grid: grid,
      width: w,
      height: h,
      updated_at: Date.now(),
    });
    saveStore(store);
    return resp({ project: projectMeta(store[id]) });
  }

  function handleDeleteProject(id) {
    var store = loadStore();
    if (!store[id]) {
      return resp({ error: "Project not found" }, 404);
    }
    delete store[id];
    saveStore(store);
    return resp({ deleted: true });
  }

  // ── Intercept window.fetch ──
  var _realFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    var url =
      typeof input === "string"
        ? input
        : input && typeof input.url === "string"
          ? input.url
          : "";

    if (url === "/api/config") {
      return handleConfig();
    }
    if (url === "/api/analyze-image") {
      return handleAnalyzeImage(init);
    }

    if (url === "/api/projects") {
      var method = ((init && init.method) || "GET").toUpperCase();
      if (method === "GET") {
        return handleGetProjects();
      }
      if (method === "POST") {
        return handleSaveProject(init);
      }
    }

    var projM = url.match(/^\/api\/projects\/([^/]+)$/);
    if (projM) {
      var pid = projM[1];
      var m = ((init && init.method) || "GET").toUpperCase();
      if (m === "GET") {
        return handleLoadProject(pid);
      }
      if (m === "PUT") {
        return handleUpdateProject(pid, init);
      }
      if (m === "DELETE") {
        return handleDeleteProject(pid);
      }
    }

    // Pass everything else through (health checks, etc.)
    return _realFetch(input, init);
  };
})();

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
  function escXml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
      this.stitchStyle = "cross"; // 'cross' | 'slash' | 'backslash'
      this.selectedIndex = -1;
      this.mode = "paint";
      this.brushSize = 1;
      this.history = [];
      this.historyIndex = -1;
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
      this.history = [];
      this.historyIndex = -1;
      this._pushHistory();
      this.fitToView();
    }

    newBlank(width, height) {
      this.width = width;
      this.height = height;
      this.cells = new Int16Array(width * height).fill(-1);
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
      this._drawStitchShape(this.ctx, x, y, s, hex, this.stitchStyle);
    }

    _drawStitchShape(ctx, x, y, s, hex, style) {
      var inset = s * 0.16;
      var x0 = x + inset,
        y0 = y + inset,
        x1 = x + s - inset,
        y1 = y + s - inset;
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(1.2, s * 0.3);
      if (style === "slash") {
        // single diagonal "/" (bottom-left → top-right)
        ctx.strokeStyle = hex;
        ctx.beginPath();
        ctx.moveTo(x0, y1);
        ctx.lineTo(x1, y0);
        ctx.stroke();
      } else if (style === "backslash") {
        // single diagonal "\" (top-left → bottom-right) — reverse direction
        ctx.strokeStyle = hex;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      } else {
        // full cross "X": under strand ("/") slightly darker for depth
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
        if (self._painting) self._paintAt(e);
      });
      window.addEventListener("mouseup", function () {
        if (self._painting) {
          self._painting = false;
          self._pushHistory();
        }
        self._lastCell = -1;
      });
    }

    // ---- export ----
    exportBlob(cb, scale, opts) {
      // Render a clean copy at a fixed cell size for a crisp exported chart.
      // Pass opts.codes = true to print each cell's colour code on top.
      var o = opts || {};
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
            this._drawStitchShape(octx, x, y, s, hex, this.stitchStyle);
            if (o.codes && s >= 14) {
              var code = this.codeFor(idx);
              if (code) {
                octx.fillStyle =
                  luminance(hex) > 0.55
                    ? "rgba(0,0,0,0.75)"
                    : "rgba(255,255,255,0.85)";
                octx.font = Math.floor(s * 0.32) + "px ui-monospace, monospace";
                octx.textAlign = "center";
                octx.textBaseline = "middle";
                octx.fillText(code, x + s / 2, y + s / 2 + 1);
              }
            }
          }
          octx.strokeStyle = "rgba(0,0,0,0.12)";
          octx.lineWidth = 1;
          octx.strokeRect(x + 0.5, y + 0.5, s, s);
        }
      }
      off.toBlob(cb, "image/png");
    }

    exportSvg(opts) {
      // Generate a vector SVG of the chart. Text (the colour codes) stays
      // crisp at any zoom or print size, unlike a rasterised PNG.
      var o = opts || {};
      var s = 18;
      var W = this.width * s,
        H = this.height * s;
      var out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="' +
          W +
          '" height="' +
          H +
          '" viewBox="0 0 ' +
          W +
          " " +
          H +
          '">',
        '<rect width="100%" height="100%" fill="#ffffff"/>',
      ];
      for (var r = 0; r < this.height; r++) {
        for (var c = 0; c < this.width; c++) {
          var idx = this.cells[r * this.width + c];
          var x = c * s,
            y = r * s;
          if (idx >= 0) {
            var hex = this.hexFor(idx);
            var inset = s * 0.16;
            var x0 = x + inset,
              y0 = y + inset,
              x1 = x + s - inset,
              y1 = y + s - inset;
            var lw = Math.max(1.2, s * 0.3);
            if (this.stitchStyle === "slash") {
              out.push(
                '<line stroke="' +
                  hex +
                  '" stroke-width="' +
                  lw +
                  '" stroke-linecap="round" x1="' +
                  x0 +
                  '" y1="' +
                  y1 +
                  '" x2="' +
                  x1 +
                  '" y2="' +
                  y0 +
                  '"/>'
              );
            } else if (this.stitchStyle === "backslash") {
              out.push(
                '<line stroke="' +
                  hex +
                  '" stroke-width="' +
                  lw +
                  '" stroke-linecap="round" x1="' +
                  x0 +
                  '" y1="' +
                  y0 +
                  '" x2="' +
                  x1 +
                  '" y2="' +
                  y1 +
                  '"/>'
              );
            } else {
              out.push(
                '<line stroke="' +
                  shade(hex, -22) +
                  '" stroke-width="' +
                  lw +
                  '" stroke-linecap="round" x1="' +
                  x0 +
                  '" y1="' +
                  y1 +
                  '" x2="' +
                  x1 +
                  '" y2="' +
                  y0 +
                  '"/>'
              );
              out.push(
                '<line stroke="' +
                  hex +
                  '" stroke-width="' +
                  lw +
                  '" stroke-linecap="round" x1="' +
                  x0 +
                  '" y1="' +
                  y0 +
                  '" x2="' +
                  x1 +
                  '" y2="' +
                  y1 +
                  '"/>'
              );
            }
            if (o.codes) {
              var code = this.codeFor(idx);
              if (code) {
                var fill = luminance(hex) > 0.55 ? "#000000" : "#ffffff";
                out.push(
                  '<text x="' +
                    (x + s / 2) +
                    '" y="' +
                    (y + s / 2 + 1) +
                    '" font-family="ui-monospace, monospace" font-size="' +
                    Math.floor(s * 0.38) +
                    '" text-anchor="middle" dominant-baseline="middle" fill="' +
                    fill +
                    '" opacity="0.85">' +
                    escXml(code) +
                    "</text>"
                );
              }
            }
          }
          out.push(
            '<rect x="' +
              (x + 0.5) +
              '" y="' +
              (y + 0.5) +
              '" width="' +
              (s - 1) +
              '" height="' +
              (s - 1) +
              '" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="1"/>'
          );
        }
      }
      out.push("</svg>");
      return out.join("\n");
    }

    maxSafeExportScale(target) {
      // Largest cell size that keeps an exported PNG within practical canvas
      // limits (side length and total pixels). Used by the high-res export.
      var w = this.width || 1;
      var h = this.height || 1;
      var MAX_DIM = 16384;
      var MAX_PIXELS = 100000000;
      var s = Math.max(8, target || 32);
      s = Math.min(s, Math.floor(MAX_DIM / w), Math.floor(MAX_DIM / h));
      s = Math.min(s, Math.floor(Math.sqrt(MAX_PIXELS / (w * h))));
      return Math.max(8, s);
    }
  }

  window.CrossStitchCanvas = CrossStitchCanvas;
})();

/**
 * app.js - main UI controller for Stitchee (Cross Canvas Art Studio).
 *
 * Loads config, builds the yarn palette + provider UI, and wires the three
 * design sources (image upload, AI description, blank canvas) plus the custom
 * paint tools, legend, project storage and export. Talks to the backend with
 * fetch(); the CrossStitchCanvas handles all drawing and pointer interaction.
 */
(function () {
  "use strict";

  var els = {};
  var state = {
    config: null,
    palette: [],
    paletteByIndex: {},
    providers: {},
    canvas: null,
    selectedIndex: -1,
    selectedFile: null,
    imageNaturalSize: null,
    currentProjectId: null,
    gridMax: 500,
    gridMin: 5,
    arLocked: false,
    arRatio: null, // height / width when locked
    codeFormat: "code", // 'code' | 'name' | 'rgb' | 'num' | 'sim' | 'hex'
  };

  function $(id) {
    return document.getElementById(id);
  }

  function cacheEls() {
    [
      "gridWidth",
      "gridHeight",
      "sizeHint",
      "fabricCount",
      "fabricSizeHint",
      "sizeUnit",
      "autoSizeBtn",
      "imgDimsHint",
      "arLockBtn",
      "dropZone",
      "imageInput",
      "uploadPreview",
      "imgMaxColors",
      "imgMaxColorsVal",
      "resampleMode",
      "analyzeBtn",
      "aiProvider",
      "aiTestBtn",
      "aiModel",
      "aiKeyRow",
      "aiApiKey",
      "aiDescription",
      "aiMaxColors",
      "aiMaxColorsVal",
      "generateBtn",
      "aiStatus",
      "newBlankBtn",
      "paletteSearch",
      "selectedSwatch",
      "selectedName",
      "codeFormats",
      "paletteGroups",
      "toolPaint",
      "toolErase",
      "toolFill",
      "brushSize",
      "btnUndo",
      "btnRedo",
      "zoomOut",
      "zoomIn",
      "zoomLevel",
      "zoomFit",
      "toggleGridLines",
      "toggleSymbols",
      "toggleStitch",
      "styleCross",
      "styleSlash",
      "styleBackslash",
      "clearBtn",
      "canvasWrap",
      "canvasEmpty",
      "stitchCanvas",
      "infoDims",
      "infoStitches",
      "infoColors",
      "legendList",
      "legendCount",
      "buyYarnBtn",
      "exportFormat",
      "exportImageBtn",
      "exportJsonBtn",
      "importJsonBtn",
      "importJsonInput",
      "projectTitle",
      "saveProjectBtn",
      "projectList",
      "toast",
      "helpBtn",
      "helpModal",
      "helpClose",
      "brandSubtitle",
    ].forEach(function (id) {
      els[id] = $(id);
    });
  }

  // ---------- utilities ----------
  var toastTimer = null;
  function toast(msg, kind) {
    var t = els.toast;
    t.textContent = msg;
    t.className = "toast show " + (kind || "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.className = "toast";
    }, 3200);
  }

  function clampInt(v, lo, hi, def) {
    v = parseInt(v, 10);
    if (isNaN(v)) return def;
    return Math.max(lo, Math.min(hi, v));
  }

  // ---------- palette code-format helpers ----------
  function hexToRgbArr(hex) {
    hex = (hex || "#000000").replace("#", "");
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map(function (c) {
          return c + c;
        })
        .join("");
    }
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }

  function formatEntry(e, fmt) {
    if (!e) return "";
    var f = fmt || state.codeFormat;
    if (f === "name") {
      return e.name + " / " + e.code;
    }
    if (f === "rgb") {
      var c = hexToRgbArr(e.hex);
      return c[0] + " " + c[1] + " " + c[2];
    }
    if (f === "num") {
      return String(e.index).padStart(4, "0");
    }
    if (f === "sim") {
      return "S" + String(e.index).padStart(3, "0");
    }
    if (f === "hex") {
      return e.hex;
    }
    return e.code; // default: 3-letter code
  }

  function buildFormatPanel(e) {
    var container = els.codeFormats;
    if (!container) return;
    container.innerHTML = "";
    if (!e) return;
    [
      { key: "code", label: "Code", value: formatEntry(e, "code") },
      { key: "name", label: "Name", value: formatEntry(e, "name") },
      { key: "rgb", label: "RGB", value: formatEntry(e, "rgb") },
      { key: "num", label: "No.", value: formatEntry(e, "num") },
      { key: "sim", label: "Sim", value: formatEntry(e, "sim") },
      { key: "hex", label: "Hex", value: formatEntry(e, "hex") },
    ].forEach(function (f) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "code-format-row" + (f.key === state.codeFormat ? " active" : "");
      btn.title = "Use " + f.label + " as label format";
      btn.innerHTML =
        '<span class="cfmt-label">' +
        f.label +
        "</span>" +
        '<span class="cfmt-value">' +
        escapeHtml(f.value) +
        "</span>";
      btn.addEventListener("click", function () {
        state.codeFormat = f.key;
        state.canvas.setCodeFormatter(function (entry) {
          return formatEntry(entry, state.codeFormat);
        });
        buildFormatPanel(state.paletteByIndex[state.selectedIndex]);
        onDesignChange();
      });
      container.appendChild(btn);
    });
  }

  function gridSize() {
    return {
      w: clampInt(els.gridWidth.value, state.gridMin, state.gridMax, 60),
      h: clampInt(els.gridHeight.value, state.gridMin, state.gridMax, 80),
    };
  }

  // ---- fabric / finished size ----
  function fabricCountValue() {
    return parseInt(els.fabricCount.value, 10) || 14;
  }

  function unitValue() {
    return els.sizeUnit && els.sizeUnit.value === "in" ? "in" : "cm";
  }

  function fmtSize(n) {
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function physicalSizeLabel(w, h) {
    var gs = gridSize();
    w = typeof w === "number" ? w : gs.w;
    h = typeof h === "number" ? h : gs.h;
    var count = fabricCountValue();
    var inW = w / count;
    var inH = h / count;
    var unit = unitValue();
    if (unit === "in") {
      return fmtSize(inW) + " × " + fmtSize(inH) + " in";
    }
    return fmtSize(inW * 2.54) + " × " + fmtSize(inH * 2.54) + " cm";
  }

  function updateFabricSize() {
    if (!els.fabricSizeHint) return;
    var gs = gridSize();
    var count = fabricCountValue();
    var unit = unitValue();
    var inW = gs.w / count;
    var inH = gs.h / count;
    var cmW = inW * 2.54;
    var cmH = inH * 2.54;
    var primary =
      unit === "in"
        ? [fmtSize(inW), fmtSize(inH), "in"]
        : [fmtSize(cmW), fmtSize(cmH), "cm"];
    var secondary =
      unit === "in"
        ? [fmtSize(cmW), fmtSize(cmH), "cm"]
        : [fmtSize(inW), fmtSize(inH), "in"];
    els.fabricSizeHint.textContent =
      "≈ " +
      primary[0] +
      " × " +
      primary[1] +
      " " +
      primary[2] +
      " (" +
      secondary[0] +
      " × " +
      secondary[1] +
      " " +
      secondary[2] +
      ") at " +
      count +
      " ct";
    updateInfoDims();
  }

  function updateInfoDims() {
    if (!els.infoDims || state.canvas.isEmpty()) return;
    els.infoDims.textContent =
      state.canvas.width +
      " × " +
      state.canvas.height +
      " stitches · " +
      physicalSizeLabel(state.canvas.width, state.canvas.height);
  }

  function showCanvas(show) {
    els.canvasEmpty.style.display = show ? "none" : "flex";
    els.stitchCanvas.hidden = !show;
  }

  // ---------- config ----------
  function loadConfig() {
    fetch("/api/config")
      .then(function (r) {
        return r.json();
      })
      .then(function (cfg) {
        state.config = cfg;
        state.palette = cfg.palette || [];
        state.palette.forEach(function (e) {
          state.paletteByIndex[e.index] = e;
        });
        state.providers = (cfg.llm && cfg.llm.providers) || {};
        var g = cfg.grid || {};
        state.gridMax = g.max_size || 500;
        state.gridMin = g.min_size || 5;

        if (cfg.app) {
          if (cfg.app.subtitle && els.brandSubtitle)
            els.brandSubtitle.textContent = cfg.app.subtitle;
        }
        els.gridWidth.max = state.gridMax;
        els.gridHeight.max = state.gridMax;
        els.gridWidth.min = state.gridMin;
        els.gridHeight.min = state.gridMin;
        els.gridWidth.value = g.default_width || 60;
        els.gridHeight.value = g.default_height || 80;
        els.sizeHint.textContent = "stitches (max " + state.gridMax + ")";
        updateFabricSize();
        els.imgMaxColors.max = g.max_colors || state.palette.length;
        els.imgMaxColors.value = g.default_max_colors || 16;
        els.imgMaxColorsVal.textContent = els.imgMaxColors.value;

        if (window.llmAPIManager) {
          window.llmAPIManager.setServerKeys(cfg.server_api_keys || {});
        }

        state.canvas.setPalette(state.palette);
        buildPalette();
        buildProviders();
        if (state.palette.length) {
          selectColor(state.palette[0].index);
        }
      })
      .catch(function () {
        toast("Failed to load configuration", "error");
      });
  }

  // ---------- palette ----------
  function buildPalette() {
    var container = els.paletteGroups;
    container.innerHTML = "";
    var families = {};
    state.palette.forEach(function (e) {
      (families[e.family] = families[e.family] || []).push(e);
    });
    Object.keys(families).forEach(function (fam) {
      var famEl = document.createElement("div");
      var head = document.createElement("div");
      head.className = "palette-family";
      head.textContent = fam;
      famEl.appendChild(head);
      var grid = document.createElement("div");
      grid.className = "swatch-grid";
      families[fam].forEach(function (e) {
        var btn = document.createElement("button");
        btn.className = "swatch-btn";
        btn.type = "button";
        btn.style.background = e.hex;
        btn.title = e.code + " — " + e.name;
        btn.setAttribute(
          "aria-label",
          "Paint with " + e.name + " (" + e.code + ")",
        );
        btn.setAttribute("data-index", e.index);
        btn.setAttribute("data-name", (e.name + " " + e.code).toLowerCase());
        btn.addEventListener("click", function () {
          selectColor(e.index);
        });
        grid.appendChild(btn);
      });
      famEl.appendChild(grid);
      container.appendChild(famEl);
    });
  }

  function selectColor(index) {
    state.selectedIndex = index;
    state.canvas.setSelected(index);
    var e = state.paletteByIndex[index];
    if (e) {
      els.selectedSwatch.style.background = e.hex;
      els.selectedName.textContent = e.name;
      buildFormatPanel(e);
    }
    Array.prototype.forEach.call(
      els.paletteGroups.querySelectorAll(".swatch-btn"),
      function (b) {
        b.classList.toggle(
          "selected",
          parseInt(b.getAttribute("data-index"), 10) === index,
        );
      },
    );
    // reflect in legend highlight
    Array.prototype.forEach.call(
      els.legendList.querySelectorAll(".legend-row"),
      function (row) {
        row.classList.toggle(
          "selected",
          parseInt(row.getAttribute("data-index"), 10) === index,
        );
      },
    );
    // painting with a colour implies paint mode
    setMode("paint");
  }

  function filterPalette() {
    var q = els.paletteSearch.value.trim().toLowerCase();
    Array.prototype.forEach.call(
      els.paletteGroups.querySelectorAll(".swatch-btn"),
      function (b) {
        var match = !q || b.getAttribute("data-name").indexOf(q) !== -1;
        b.style.display = match ? "" : "none";
      },
    );
  }

  // ---------- providers / AI ----------
  function buildProviders() {
    var sel = els.aiProvider;
    sel.innerHTML = "";
    var defaultProvider =
      (state.config.llm && state.config.llm.default_provider) || "ollama";
    Object.keys(state.providers).forEach(function (key) {
      var opt = document.createElement("option");
      opt.value = key;
      opt.textContent = state.providers[key].name || key;
      sel.appendChild(opt);
    });
    sel.value = defaultProvider;
    updateKeyRow();
  }

  function currentProvider() {
    return els.aiProvider.value;
  }

  function updateKeyRow() {
    var p = currentProvider();
    var mgr = window.llmAPIManager;
    var needsKey = mgr && mgr.requiresKey(p) && !mgr.hasServerKey(p);
    els.aiKeyRow.hidden = !needsKey;
    if (needsKey && mgr) {
      els.aiApiKey.value = mgr.getKey(p) || "";
    }
    // reset models
    els.aiModel.innerHTML =
      '<option value="">Test connection to load models</option>';
  }

  function testConnection() {
    var p = currentProvider();
    var mgr = window.llmAPIManager;
    setAiStatus(
      "Testing " + (state.providers[p] ? state.providers[p].name : p) + "…",
      "busy",
    );
    els.aiTestBtn.disabled = true;
    fetch("/api/llm/test", {
      method: "POST",
      headers: mgr.getHeaders(p),
      body: JSON.stringify({ provider: p }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        els.aiTestBtn.disabled = false;
        if (!res.ok || !res.d.connected) {
          setAiStatus(mgr.categorizeError(res.d.error), "error");
          return;
        }
        populateModels(res.d.models || [], p);
        setAiStatus(
          "Connected · " + (res.d.models || []).length + " models",
          "ok",
        );
      })
      .catch(function () {
        els.aiTestBtn.disabled = false;
        setAiStatus("Connection failed", "error");
      });
  }

  function populateModels(models, provider) {
    var sel = els.aiModel;
    sel.innerHTML = "";
    if (!models.length) {
      sel.innerHTML = '<option value="">No models found</option>';
      return;
    }
    models.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      sel.appendChild(opt);
    });
    var def =
      state.providers[provider] && state.providers[provider].default_model;
    if (def && models.indexOf(def) !== -1) {
      sel.value = def;
    }
  }

  function setAiStatus(msg, kind) {
    els.aiStatus.textContent = msg || "";
    els.aiStatus.className = "ai-status " + (kind || "");
  }

  function generateDesign() {
    var p = currentProvider();
    var model = els.aiModel.value;
    var desc = els.aiDescription.value.trim();
    if (!model) {
      setAiStatus("Select a model first (press Test).", "error");
      return;
    }
    if (!desc) {
      setAiStatus("Describe what you want to design.", "error");
      return;
    }
    var gs = gridSize();
    var w = gs.w;
    var h = gs.h;
    setAiStatus("Generating design… this can take a moment.", "busy");
    els.generateBtn.disabled = true;
    fetch("/api/generate-design", {
      method: "POST",
      headers: window.llmAPIManager.getHeaders(p),
      body: JSON.stringify({
        provider: p,
        model: model,
        description: desc,
        width: w,
        height: h,
        max_colors: parseInt(els.aiMaxColors.value, 10),
      }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        els.generateBtn.disabled = false;
        if (!res.ok) {
          setAiStatus(
            window.llmAPIManager.categorizeError(res.d.error),
            "error",
          );
          return;
        }
        applyDesign(res.d, res.d.title || "AI Design");
        setAiStatus(res.d.description || "Design ready.", "ok");
        toast("AI design created", "ok");
      })
      .catch(function () {
        els.generateBtn.disabled = false;
        setAiStatus("Generation failed", "error");
      });
  }

  // ---------- image upload ----------
  function readImageDimensions(file, callback) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth,
        h = img.naturalHeight;
      URL.revokeObjectURL(url);
      callback(w, h);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      callback(null, null);
    };
    img.src = url;
  }

  function autoSizeFromImage() {
    var sz = state.imageNaturalSize;
    if (!sz) return;
    // Scale to fit within the current W×H bounding box, preserving aspect ratio.
    var maxW = clampInt(els.gridWidth.value, state.gridMin, state.gridMax, 80);
    var maxH = clampInt(els.gridHeight.value, state.gridMin, state.gridMax, 80);
    var scale = Math.min(maxW / sz.w, maxH / sz.h);
    var w = Math.max(
      state.gridMin,
      Math.min(state.gridMax, Math.round(sz.w * scale)),
    );
    var h = Math.max(
      state.gridMin,
      Math.min(state.gridMax, Math.round(sz.h * scale)),
    );
    els.gridWidth.value = w;
    els.gridHeight.value = h;
    updateFabricSize();
    // Keep the AR lock ratio in sync with the new dimensions.
    if (state.arLocked) {
      state.arRatio = h / w;
    }
    toast(
      "Canvas set to " + w + "\u00d7" + h + " (matches image aspect ratio)",
      "ok",
    );
  }

  // ---- aspect ratio lock ----
  function updateArLockUI() {
    if (!els.arLockBtn) return;
    var locked = state.arLocked;
    els.arLockBtn.classList.toggle("locked", locked);
    var labelText = locked ? "Unlock aspect ratio" : "Lock aspect ratio";
    els.arLockBtn.title = labelText;
    els.arLockBtn.setAttribute("aria-label", labelText);
    // Swap shackle open/closed by adjusting the SVG path
    var path = document.getElementById("arLockShackle");
    if (path) {
      path.setAttribute(
        "d",
        locked
          ? "M2.5 6V5a3 3 0 0 1 6 0v1" // closed shackle
          : "M2.5 6V4a3 3 0 0 1 6 0v2",
      ); // open shackle
    }
  }

  function toggleArLock() {
    state.arLocked = !state.arLocked;
    if (state.arLocked) {
      var w = clampInt(els.gridWidth.value, state.gridMin, state.gridMax, 60);
      var h = clampInt(els.gridHeight.value, state.gridMin, state.gridMax, 80);
      state.arRatio = h / w;
      toast("Aspect ratio locked (" + w + ":" + h + ")", "ok");
    } else {
      state.arRatio = null;
    }
    updateArLockUI();
  }

  function onFileSelected(file) {
    if (!file || !/^image\//.test(file.type)) {
      toast("Please choose an image file", "error");
      return;
    }
    state.selectedFile = file;
    var reader = new FileReader();
    reader.onload = function (e) {
      els.uploadPreview.src = e.target.result;
      els.uploadPreview.hidden = false;
    };
    reader.readAsDataURL(file);
    els.analyzeBtn.disabled = false;
    // Read dimensions so Auto button can scale the grid correctly.
    readImageDimensions(file, function (w, h) {
      if (w && h) {
        state.imageNaturalSize = { w: w, h: h };
        els.autoSizeBtn.disabled = false;
        els.imgDimsHint.textContent = "Original: " + w + "\u00d7" + h + " px";
        els.imgDimsHint.hidden = false;
      }
    });
  }

  function analyzeImage() {
    if (!state.selectedFile) {
      toast("Choose an image first", "error");
      return;
    }
    var gs = gridSize();
    var fd = new FormData();
    fd.append("image", state.selectedFile);
    fd.append("width", gs.w);
    fd.append("height", gs.h);
    fd.append("max_colors", els.imgMaxColors.value);
    fd.append("resample", els.resampleMode.value);
    els.analyzeBtn.disabled = true;
    els.analyzeBtn.textContent = "Rendering…";
    fetch("/api/analyze-image", { method: "POST", body: fd })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        els.analyzeBtn.disabled = false;
        els.analyzeBtn.textContent = "Render to canvas";
        if (!res.ok) {
          toast(res.d.error || "Analysis failed", "error");
          return;
        }
        applyDesign(res.d, state.selectedFile.name.replace(/\.[^.]+$/, ""));
        toast(
          "Image rendered · " + res.d.stats.color_count + " yarn colours",
          "ok",
        );
      })
      .catch(function () {
        els.analyzeBtn.disabled = false;
        els.analyzeBtn.textContent = "Render to canvas";
        toast("Analysis failed", "error");
      });
  }

  // ---------- design application ----------
  function applyDesign(design, title) {
    state.canvas.loadGrid(design.width, design.height, design.grid);
    state.currentProjectId = null;
    if (title && !els.projectTitle.value) {
      els.projectTitle.value = title;
    }
    showCanvas(true);
    updateZoomLabel();
    onDesignChange();
  }

  function newBlank() {
    var gs = gridSize();
    state.canvas.newBlank(gs.w, gs.h);
    state.currentProjectId = null;
    showCanvas(true);
    if (state.selectedIndex < 0 && state.palette.length)
      selectColor(state.palette[0].index);
    updateZoomLabel();
    onDesignChange();
    toast("Blank " + gs.w + "×" + gs.h + " canvas ready", "ok");
  }

  // ---------- affiliate "buy these yarns" ----------
  function affiliateConfig() {
    return (state.config && state.config.app && state.config.app.affiliate) || null;
  }

  function updateBuyYarn(used) {
    var btn = els.buyYarnBtn;
    if (!btn) return;
    var af = affiliateConfig();
    var isConfigured =
      af && af.enabled && af.tag && af.tag !== "YOUR_AFFILIATE_TAG" && af.tag.indexOf("YOUR_") !== 0;
    if (!isConfigured || !used.length) {
      btn.style.display = "none";
      return;
    }
    var names = used
      .slice(0, 5)
      .map(function (u) {
        return u.name;
      })
      .join(" ");
    var query = ((af.base_query || "worsted weight yarn") + " " + names).trim();
    var template =
      af.url_template || "https://www.amazon.com/s?k={query}&tag={tag}";
    btn.href = template
      .replace("{query}", encodeURIComponent(query))
      .replace("{tag}", encodeURIComponent(af.tag));
    btn.textContent = af.label || "Buy these yarns";
    btn.style.display = "block";
  }

  // ---------- legend + info ----------
  function onDesignChange() {
    var counts = state.canvas.getCounts();
    var used = Object.keys(counts)
      .map(function (k) {
        var idx = parseInt(k, 10);
        var e = state.paletteByIndex[idx];
        return {
          index: idx,
          count: counts[k],
          code: e ? e.code : "?",
          name: e ? e.name : "Unknown",
          hex: e ? e.hex : "#888",
        };
      })
      .sort(function (a, b) {
        return b.count - a.count;
      });

    els.legendCount.textContent = used.length;
    els.legendList.innerHTML = "";
    if (!used.length) {
      els.legendList.innerHTML =
        '<div class="legend-empty">No stitches yet.</div>';
    } else {
      used.forEach(function (u) {
        var row = document.createElement("div");
        row.className =
          "legend-row" + (u.index === state.selectedIndex ? " selected" : "");
        row.setAttribute("data-index", u.index);
        row.innerHTML =
          '<span class="swatch" style="background:' +
          u.hex +
          '"></span>' +
          '<span class="code">' +
          escapeHtml(formatEntry(u, state.codeFormat)) +
          "</span>" +
          '<span class="name">' +
          escapeHtml(u.name) +
          "</span>" +
          '<span class="count">' +
          u.count +
          "</span>";
        row.addEventListener("click", function () {
          selectColor(u.index);
        });
        els.legendList.appendChild(row);
      });
    }

    updateBuyYarn(used);

    updateInfoDims();
    if (!state.canvas.isEmpty()) {
      els.infoStitches.textContent =
        "· " + state.canvas.stitchCount() + " stitches";
      els.infoColors.textContent =
        "· " + state.canvas.colorCount() + " colours";
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  // ---------- tools ----------
  function setMode(mode) {
    state.canvas.setMode(mode);
    els.toolPaint.classList.toggle("active", mode === "paint");
    els.toolErase.classList.toggle("active", mode === "erase");
    els.toolFill.classList.toggle("active", mode === "fill");
  }
  function updateZoomLabel() {
    els.zoomLevel.textContent = state.canvas.zoomPercent() + "%";
  }

  function setStitchStyle(style) {
    state.canvas.setStitchStyle(style);
    var activeId =
      style === "slash"
        ? "styleSlash"
        : style === "backslash"
          ? "styleBackslash"
          : "styleCross";
    [els.styleCross, els.styleSlash, els.styleBackslash].forEach(function (b) {
      b.classList.toggle("active", b === els[activeId]);
    });
  }

  function undoAction() {
    if (state.canvas.undo()) {
      toast("Undo", "ok");
      onDesignChange();
    }
  }

  function redoAction() {
    if (state.canvas.redo()) {
      toast("Redo", "ok");
      onDesignChange();
    }
  }

  // ---------- projects ----------
  function saveProject() {
    if (state.canvas.isEmpty()) {
      toast("Nothing to save yet", "error");
      return;
    }
    var design = state.canvas.getDesign();
    var title = els.projectTitle.value.trim() || "Untitled Design";
    var isUpdate = !!state.currentProjectId;
    var url = isUpdate
      ? "/api/projects/" + state.currentProjectId
      : "/api/projects";
    var method = isUpdate ? "PUT" : "POST";

    els.saveProjectBtn.disabled = true;
    var originalText = els.saveProjectBtn.textContent;
    els.saveProjectBtn.textContent = "Saving...";

    fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title, grid: design.grid }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        els.saveProjectBtn.disabled = false;
        els.saveProjectBtn.textContent = originalText;
        if (!res.ok) {
          toast(res.d.error || "Save failed", "error");
          return;
        }
        var savedTitle = res.d.project.title || "Untitled Design";
        els.projectTitle.value = savedTitle;
        state.currentProjectId = res.d.project.id;
        toast(isUpdate ? "Project updated" : "Project saved", "ok");
        loadProjects();
      })
      .catch(function () {
        els.saveProjectBtn.disabled = false;
        els.saveProjectBtn.textContent = originalText;
        toast("Save failed", "error");
      });
  }

  function loadProjects() {
    fetch("/api/projects")
      .then(function (r) {
        return r.ok ? r.json() : { projects: [] };
      })
      .then(function (data) {
        var list = els.projectList;
        list.innerHTML = "";
        var projects = data.projects || [];
        if (!projects.length) {
          list.innerHTML = '<div class="legend-empty">No saved projects.</div>';
          return;
        }
        projects.forEach(function (p) {
          var row = document.createElement("div");
          row.className = "project-row";
          row.innerHTML =
            '<div class="p-main"><div class="p-title">' +
            escapeHtml(p.title) +
            "</div>" +
            '<div class="p-meta">' +
            p.width +
            "×" +
            p.height +
            " · " +
            p.color_count +
            " colours</div></div>";
          var loadBtn = document.createElement("button");
          loadBtn.className = "icon-btn";
          loadBtn.type = "button";
          loadBtn.title = "Load";
          loadBtn.innerHTML = "&#8635;";
          loadBtn.setAttribute("aria-label", "Load project " + p.title);
          loadBtn.addEventListener("click", function () {
            loadProject(p.id);
          });
          var delBtn = document.createElement("button");
          delBtn.className = "icon-btn danger";
          delBtn.type = "button";
          delBtn.title = "Delete";
          delBtn.innerHTML = "&#128465;";
          delBtn.setAttribute("aria-label", "Delete project " + p.title);
          delBtn.addEventListener("click", function () {
            deleteProject(p.id, p.title);
          });
          row.appendChild(loadBtn);
          row.appendChild(delBtn);
          list.appendChild(row);
        });
      })
      .catch(function () {
        /* ignore */
      });
  }

  function loadProject(id) {
    fetch("/api/projects/" + id)
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        if (!res.ok) {
          toast(res.d.error || "Load failed", "error");
          return;
        }
        var p = res.d.project;
        state.canvas.loadGrid(p.width, p.height, p.grid);
        state.currentProjectId = p.id;
        els.projectTitle.value = p.title;
        showCanvas(true);
        updateZoomLabel();
        onDesignChange();
        toast('Loaded "' + p.title + '"', "ok");
      })
      .catch(function () {
        toast("Load failed", "error");
      });
  }

  function deleteProject(id, title) {
    if (!confirm('Delete "' + title + '"? This cannot be undone.')) return;
    fetch("/api/projects/" + id, { method: "DELETE" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        if (!res.ok) {
          toast(res.d.error || "Delete failed", "error");
          return;
        }
        if (state.currentProjectId === id) state.currentProjectId = null;
        toast("Project deleted", "ok");
        loadProjects();
      })
      .catch(function () {
        toast("Delete failed", "error");
      });
  }

  // ---------- export / import ----------
  function setExporting(on) {
    if (!els.exportImageBtn) return;
    els.exportImageBtn.disabled = on;
    els.exportImageBtn.textContent = on ? "Exporting..." : "Download";
  }

  function exportImage() {
    if (state.canvas.isEmpty()) {
      toast("Nothing to export", "error");
      return;
    }
    var fmt = els.exportFormat.value || "svg-codes";
    var base = els.projectTitle.value.trim() || "cross-canvas";
    setExporting(true);
    setTimeout(function () {
      var done = false;
      function finish(msg) {
        if (done) return;
        done = true;
        setExporting(false);
        toast(msg, "ok");
      }
      try {
        if (fmt === "svg-codes") {
          var svg = state.canvas.exportSvg({ codes: true });
          downloadBlob(
            new Blob([svg], { type: "image/svg+xml" }),
            base + "-codes.svg",
          );
          finish("SVG chart with codes exported");
        } else if (fmt === "png-hd") {
          state.canvas.exportBlob(
            function (blob) {
              downloadBlob(blob, base + "-hd.png");
              finish("High-res PNG chart exported");
            },
            state.canvas.maxSafeExportScale(32),
          );
        } else {
          state.canvas.exportBlob(
            function (blob) {
              downloadBlob(blob, base + ".png");
              finish("PNG chart exported");
            },
            18,
          );
        }
      } catch (err) {
        finish("Export failed");
      }
    }, 50);
  }

  function exportJson() {
    if (state.canvas.isEmpty()) {
      toast("Nothing to export", "error");
      return;
    }
    var design = state.canvas.getDesign();
    var counts = state.canvas.getCounts();
    var legend = Object.keys(counts).map(function (k) {
      var e = state.paletteByIndex[parseInt(k, 10)];
      return {
        index: parseInt(k, 10),
        code: e ? e.code : "",
        name: e ? e.name : "",
        hex: e ? e.hex : "",
        count: counts[k],
      };
    });
    var doc = {
      app: "cross-canvas-art",
      version: 1,
      title: els.projectTitle.value.trim() || "Untitled Design",
      width: design.width,
      height: design.height,
      grid: design.grid,
      legend: legend,
    };
    var blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    });
    downloadBlob(blob, doc.title + ".json");
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var doc = JSON.parse(e.target.result);
        if (!doc.grid || !doc.width || !doc.height) throw new Error("bad");
        state.canvas.loadGrid(doc.width, doc.height, doc.grid);
        state.currentProjectId = null;
        if (doc.title) els.projectTitle.value = doc.title;
        showCanvas(true);
        updateZoomLabel();
        onDesignChange();
        toast("Design imported", "ok");
      } catch (err) {
        toast("Invalid design file", "error");
      }
    };
    reader.readAsText(file);
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  // ---------- events ----------
  function bind() {
    // source tabs
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-source-tab]"),
      function (btn) {
        btn.addEventListener("click", function () {
          var tab = btn.getAttribute("data-source-tab");
          Array.prototype.forEach.call(
            document.querySelectorAll("[data-source-tab]"),
            function (b) {
              b.classList.toggle("active", b === btn);
            },
          );
          $("sourceUpload").hidden = tab !== "upload";
          $("sourceAI").hidden = tab !== "ai";
          $("sourceBlank").hidden = tab !== "blank";
        });
      },
    );

    // upload
    els.dropZone.addEventListener("click", function () {
      els.imageInput.click();
    });
    els.dropZone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        els.imageInput.click();
      }
    });
    els.imageInput.addEventListener("change", function () {
      if (this.files[0]) onFileSelected(this.files[0]);
    });
    ["dragover", "dragenter"].forEach(function (ev) {
      els.dropZone.addEventListener(ev, function (e) {
        e.preventDefault();
        els.dropZone.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      els.dropZone.addEventListener(ev, function (e) {
        e.preventDefault();
        els.dropZone.classList.remove("dragover");
      });
    });
    els.dropZone.addEventListener("drop", function (e) {
      if (e.dataTransfer.files[0]) onFileSelected(e.dataTransfer.files[0]);
    });
    els.imgMaxColors.addEventListener("input", function () {
      els.imgMaxColorsVal.textContent = this.value;
    });
    els.imgMaxColors.addEventListener("change", function () {
      if (state.selectedFile) {
        analyzeImage();
      }
    });
    els.resampleMode.addEventListener("change", function () {
      if (state.selectedFile) {
        analyzeImage();
      }
    });
    els.analyzeBtn.addEventListener("click", analyzeImage);
    els.autoSizeBtn.addEventListener("click", autoSizeFromImage);
    els.arLockBtn.addEventListener("click", toggleArLock);
    // Propagate dimension changes when aspect ratio is locked.
    els.gridWidth.addEventListener("input", function () {
      if (state.arLocked && state.arRatio !== null) {
        var w = clampInt(this.value, state.gridMin, state.gridMax, 60);
        els.gridHeight.value = Math.max(
          state.gridMin,
          Math.min(state.gridMax, Math.round(w * state.arRatio)),
        );
      }
      updateFabricSize();
    });
    els.gridHeight.addEventListener("input", function () {
      if (state.arLocked && state.arRatio !== null) {
        var h = clampInt(this.value, state.gridMin, state.gridMax, 80);
        els.gridWidth.value = Math.max(
          state.gridMin,
          Math.min(state.gridMax, Math.round(h / state.arRatio)),
        );
      }
      updateFabricSize();
    });
    els.fabricCount.addEventListener("change", updateFabricSize);
    els.sizeUnit.addEventListener("change", updateFabricSize);

    // AI
    els.aiProvider.addEventListener("change", updateKeyRow);
    els.aiApiKey.addEventListener("change", function () {
      if (window.llmAPIManager)
        window.llmAPIManager.setKey(currentProvider(), this.value.trim());
    });
    els.aiTestBtn.addEventListener("click", testConnection);
    els.generateBtn.addEventListener("click", generateDesign);
    els.aiMaxColors.addEventListener("input", function () {
      els.aiMaxColorsVal.textContent = this.value;
    });

    // blank
    els.newBlankBtn.addEventListener("click", newBlank);

    // palette search
    els.paletteSearch.addEventListener("input", filterPalette);

    // tools
    els.toolPaint.addEventListener("click", function () {
      setMode("paint");
    });
    els.toolErase.addEventListener("click", function () {
      setMode("erase");
    });
    els.toolFill.addEventListener("click", function () {
      setMode("fill");
    });
    els.brushSize.addEventListener("change", function () {
      state.canvas.setBrushSize(this.value);
    });
    els.zoomIn.addEventListener("click", function () {
      state.canvas.setZoom(2);
      updateZoomLabel();
    });
    els.zoomOut.addEventListener("click", function () {
      state.canvas.setZoom(-2);
      updateZoomLabel();
    });
    els.zoomFit.addEventListener("click", function () {
      state.canvas.fitToView();
      updateZoomLabel();
    });
    els.btnUndo.addEventListener("click", undoAction);
    els.btnRedo.addEventListener("click", redoAction);
    window.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoAction();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redoAction();
      }
    });
    els.toggleGridLines.addEventListener("change", function () {
      state.canvas.setOption("showGrid", this.checked);
    });
    els.toggleSymbols.addEventListener("change", function () {
      state.canvas.setOption("showSymbols", this.checked);
    });
    els.toggleStitch.addEventListener("change", function () {
      state.canvas.setOption("showStitch", this.checked);
    });
    els.styleCross.addEventListener("click", function () {
      setStitchStyle("cross");
    });
    els.styleSlash.addEventListener("click", function () {
      setStitchStyle("slash");
    });
    els.styleBackslash.addEventListener("click", function () {
      setStitchStyle("backslash");
    });
    els.clearBtn.addEventListener("click", function () {
      if (state.canvas.isEmpty()) return;
      if (confirm("Clear all stitches from the canvas?")) {
        state.canvas.clearAll();
      }
    });

    // projects / export
    els.saveProjectBtn.addEventListener("click", saveProject);
    els.exportImageBtn.addEventListener("click", exportImage);
    els.exportJsonBtn.addEventListener("click", exportJson);
    els.importJsonBtn.addEventListener("click", function () {
      els.importJsonInput.click();
    });
    els.importJsonInput.addEventListener("change", function () {
      if (this.files[0]) importJson(this.files[0]);
      this.value = "";
    });

    // help modal Focus Management (Palette Accessibility)
    els.helpBtn.addEventListener("click", function () {
      els.helpModal.classList.add("active");
      els.helpModal.setAttribute("aria-hidden", "false");
      els.helpClose.focus();
    });
    els.helpClose.addEventListener("click", function () {
      els.helpModal.classList.remove("active");
      els.helpModal.setAttribute("aria-hidden", "true");
      els.helpBtn.focus();
    });
    els.helpModal.addEventListener("click", function (e) {
      if (e.target === els.helpModal) {
        els.helpModal.classList.remove("active");
        els.helpModal.setAttribute("aria-hidden", "true");
        els.helpBtn.focus();
      }
    });

    window.addEventListener("resize", function () {
      if (!state.canvas.isEmpty()) {
        state.canvas.fitToView();
        updateZoomLabel();
      }
    });
  }

  function initFeatureFlags() {
    var aiEnabled =
      document.documentElement.getAttribute("data-ai-enabled") === "true";
    if (!aiEnabled) {
      var aiTab = document.querySelector('[data-source-tab="ai"]');
      if (aiTab) aiTab.hidden = true;
    }
  }

  function init() {
    cacheEls();
    state.canvas = new CrossStitchCanvas(els.stitchCanvas, {
      onChange: onDesignChange,
    });
    initFeatureFlags();
    bind();
    loadConfig();
    loadProjects();
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
