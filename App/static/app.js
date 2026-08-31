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
      "exportPngBtn",
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
  function exportPng() {
    if (state.canvas.isEmpty()) {
      toast("Nothing to export", "error");
      return;
    }
    els.exportPngBtn.disabled = true;
    var originalText = els.exportPngBtn.textContent;
    els.exportPngBtn.textContent = "Exporting...";

    setTimeout(function () {
      state.canvas.exportBlob(function (blob) {
        downloadBlob(
          blob,
          (els.projectTitle.value.trim() || "cross-canvas") + ".png",
        );
        els.exportPngBtn.disabled = false;
        els.exportPngBtn.textContent = originalText;
        toast("PNG chart exported", "ok");
      }, 18);
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
    els.exportPngBtn.addEventListener("click", exportPng);
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
