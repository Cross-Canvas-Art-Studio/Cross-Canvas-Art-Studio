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
        max_size: 200,
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
      Math.min(200, parseInt(fd.get("width") || "60", 10)),
    );
    var reqH = Math.max(
      5,
      Math.min(200, parseInt(fd.get("height") || "80", 10)),
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
