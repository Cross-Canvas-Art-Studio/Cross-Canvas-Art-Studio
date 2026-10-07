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
    overlay: null, // decoded reference photo to trace over (memory only)
    overlayUrl: null, // blob URL backing state.overlay, revoked on replace
    currentProjectId: null,
    gridMax: 500,
    gridMin: 5,
    arLocked: false,
    arRatio: null, // height / width when locked
    codeFormat: "code", // 'code' | 'name' | 'rgb' | 'num' | 'sim' | 'hex' | 'dmc'
    dirty: false, // unsaved changes since last save/load/new
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
      "overlayGroup",
      "overlayDrop",
      "overlayInput",
      "overlayName",
      "overlayOn",
      "overlayOpacity",
      "overlayOpacityVal",
      "overlayClearBtn",
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
      "toolProgress",
      "toolSelect",
      "brushSize",
      "btnUndo",
      "btnRedo",
      "zoomOut",
      "zoomIn",
      "zoomLevel",
      "zoomFit",
      "toggleGridLines",
      "toggleCodes",
      "toggleGlyphs",
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
      "skeinSummary",
      "buyYarnBtn",
      "exportPngBtn",
      "exportSvgBtn",
      "exportPdfBtn",
      "exportJsonBtn",
      "progressOn",
      "progressRow",
      "progressColumn",
      "progressDiagonal",
      "progressPercent",
      "progressHint",
      "progressClearBtn",
      "progressOptions",
      "selectOptions",
      "selDims",
      "selCopyBtn",
      "selCutBtn",
      "selPasteBtn",
      "selFillBtn",
      "selDeleteBtn",
      "selMirrorHBtn",
      "selMirrorVBtn",
      "selRotLBtn",
      "selRotRBtn",
      "selAllBtn",
      "selCropBtn",
      "selClearBtn",
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

  // ---------- unsaved-changes tracking ----------
  // state.dirty drives the beforeunload guard so a closed tab cannot silently
  // discard work. Set on any canvas edit or title change; cleared whenever the
  // design is persisted, loaded, imported, or replaced with a blank canvas.
  function markDirty() {
    state.dirty = true;
    scheduleDraftSave();
  }
  function markClean() {
    state.dirty = false;
    clearDraft();
  }

  // ---------- draft autosave ----------
  // A debounced snapshot so a closed tab (or a crash) cannot destroy the design.
  // The grid is stored as base64 of the raw Int16Array: at the 500x500 ceiling
  // that is a 500 KB buffer -> ~667 KB of text, comfortably inside the ~5 MB
  // localStorage quota and far cheaper than JSON of 250,000 decimal numbers.
  var DRAFT_KEY = "stitchee_draft";
  var DRAFT_DELAY = 2000;
  var draftTimer = null;

  function bytesToBase64(bytes) {
    var chunk = 0x8000;
    var out = "";
    for (var i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(
        null,
        bytes.subarray(i, Math.min(i + chunk, bytes.length)),
      );
    }
    return btoa(out);
  }

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function scheduleDraftSave() {
    if (!state.canvas || state.canvas.isEmpty()) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, DRAFT_DELAY);
  }

  function saveDraft() {
    if (!state.canvas || state.canvas.isEmpty()) return;
    try {
      var cells = state.canvas.cells;
      var bytes = new Uint8Array(
        cells.buffer,
        cells.byteOffset,
        cells.byteLength,
      );
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          v: 1,
          title: els.projectTitle.value.trim(),
          width: state.canvas.width,
          height: state.canvas.height,
          projectId: state.currentProjectId,
          savedAt: Date.now(),
          data: bytesToBase64(bytes),
        }),
      );
    } catch (e) {
      // Quota exceeded, or storage unavailable (private mode). Drop the draft
      // rather than leave a half-written one that could fail to parse.
      clearDraft();
    }
  }

  function clearDraft() {
    clearTimeout(draftTimer);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      /* storage unavailable; nothing to clear */
    }
  }

  /**
   * Point the size inputs at the design currently on the canvas. Without this
   * the inputs keep showing the default (or the previous) size after a load,
   * import or draft restore, so "New blank canvas" would surprise the user.
   * Assigning .value deliberately does NOT dispatch 'change', so this never
   * triggers a resize.
   */
  function syncGridInputs(w, h) {
    if (!w || !h) return;
    els.gridWidth.value = w;
    els.gridHeight.value = h;
    // Assigning .value does not fire 'change', so the finished-size hint would
    // otherwise keep showing the previous grid's measurements.
    updateFabricSize();
  }

  // ---------- progress tracker ----------
  // Kept per project and RLE-encoded, so a fully-stitched 500x500 chart costs
  // a few dozen characters instead of 250 KB. Deliberately NOT part of the
  // saved project document: progress is per device and per person, and it must
  // never travel with the design or into an export.
  var progressSaveTimer = null;
  var progressUiTimer = null;

  function progressKey() {
    return "stitchee_progress_" + (state.currentProjectId || "draft");
  }

  function saveProgress() {
    if (!state.canvas || state.canvas.isEmpty()) return;
    var arr = state.canvas.getProgress();
    if (!arr) return;
    try {
      localStorage.setItem(
        progressKey(),
        JSON.stringify({
          v: 1,
          w: state.canvas.width,
          h: state.canvas.height,
          mode: state.canvas.progressMode,
          // Remember whether the overlay was showing, so a reload restores the
          // view the user left rather than marks they cannot see.
          on: !!state.canvas.progressOn,
          runs: window.CrossStitchCanvas.progressToRuns(arr),
        }),
      );
    } catch (e) {
      /* storage full or unavailable: progress is a nicety, never block on it */
    }
  }

  function scheduleProgressSave() {
    clearTimeout(progressSaveTimer);
    progressSaveTimer = setTimeout(saveProgress, 300);
  }

  /** Debounced so painting a large chart does not recompute stats per stroke. */
  function scheduleProgressUiRefresh() {
    if (!els.progressOn || !els.progressOn.checked) return;
    clearTimeout(progressUiTimer);
    progressUiTimer = setTimeout(function () {
      updateProgressUI();
    }, 400);
  }

  function loadProgress() {
    if (!state.canvas || state.canvas.isEmpty()) return;
    var raw = null;
    try {
      raw = localStorage.getItem(progressKey());
    } catch (e) {
      return;
    }
    var doc = null;
    if (raw) {
      try {
        doc = JSON.parse(raw);
      } catch (e) {
        doc = null;
      }
    }
    // A size change means the stored marks no longer line up with the grid.
    if (!doc || doc.w !== state.canvas.width || doc.h !== state.canvas.height) {
      state.canvas.setProgress(null);
      updateProgressUI();
      return;
    }
    state.canvas.setProgress(
      window.CrossStitchCanvas.progressFromRuns(doc.runs, doc.w * doc.h),
    );
    if (doc.mode) {
      state.canvas.setProgressMode(doc.mode);
      syncProgressModeButtons(doc.mode);
    }
    if (doc.on) {
      els.progressOn.checked = true;
      state.canvas.setProgressOn(true);
    }
    updateProgressUI();
  }

  /** Move stored progress from the draft key to a project key on first save. */
  function migrateProgressKey(fromKey) {
    var to = progressKey();
    if (fromKey === to) return;
    try {
      var raw = localStorage.getItem(fromKey);
      if (raw && !localStorage.getItem(to)) localStorage.setItem(to, raw);
      localStorage.removeItem(fromKey);
    } catch (e) {
      /* ignore */
    }
  }

  function syncProgressModeButtons(mode) {
    mode = mode || (state.canvas && state.canvas.progressMode) || "row";
    els.progressRow.classList.toggle("active", mode === "row");
    els.progressColumn.classList.toggle("active", mode === "column");
    els.progressDiagonal.classList.toggle("active", mode === "diagonal");
  }

  function updateProgressUI(st) {
    if (!state.canvas || state.canvas.isEmpty()) {
      els.progressPercent.textContent = "0%";
      els.progressHint.textContent = "\u2014";
      return;
    }
    st = st || state.canvas.progressStats();
    els.progressPercent.textContent = st.percent + "%";
    if (st.unit === null) {
      els.progressHint.textContent =
        "All " + st.total + " stitches marked stitched.";
      return;
    }
    var noun =
      st.mode === "column"
        ? "Column"
        : st.mode === "diagonal"
          ? "Diagonal"
          : "Row";
    els.progressHint.textContent =
      noun + " " + st.unitLabel + " of " + st.units + " \u00b7 " + st.done +
      " / " + st.total + " stitches";
  }

  function setProgressMode(mode) {
    state.canvas.setProgressMode(mode);
    syncProgressModeButtons(mode);
    updateProgressUI();
    scheduleProgressSave();
  }

  /**
   * Offer to restore an unsaved draft on boot. Called once the palette is
   * loaded, because the grid cannot be coloured in before then.
   */
  function maybeRestoreDraft() {
    var raw;
    try {
      raw = localStorage.getItem(DRAFT_KEY);
    } catch (e) {
      return;
    }
    if (!raw) return;

    var doc;
    try {
      doc = JSON.parse(raw);
    } catch (e) {
      clearDraft();
      return;
    }
    if (!doc || doc.v !== 1 || !doc.data || !doc.width || !doc.height) {
      clearDraft();
      return;
    }

    var when = doc.savedAt ? new Date(doc.savedAt).toLocaleString() : "earlier";
    var label = doc.title ? '"' + doc.title + '"' : "your unsaved design";
    if (
      !confirm(
        "Restore " + label + " (" + doc.width + "x" + doc.height + ") saved " +
          when + "?",
      )
    ) {
      clearDraft();
      return;
    }

    var bytes;
    try {
      bytes = base64ToBytes(doc.data);
    } catch (e) {
      clearDraft();
      return;
    }
    var cells = new Int16Array(
      bytes.buffer,
      0,
      Math.floor(bytes.length / 2),
    );
    if (cells.length !== doc.width * doc.height) {
      clearDraft();
      toast("Draft was corrupt; discarded", "error");
      return;
    }

    var grid = [];
    for (var r = 0; r < doc.height; r++) {
      var row = [];
      for (var c = 0; c < doc.width; c++) row.push(cells[r * doc.width + c]);
      grid.push(row);
    }
    state.canvas.loadGrid(doc.width, doc.height, grid);
    syncGridInputs(doc.width, doc.height);
    state.currentProjectId = doc.projectId || null;
    els.projectTitle.value = doc.title || "";
    loadProgress();
    showCanvas(true);
    updateZoomLabel();
    onDesignChange();
    // Still unsaved, so it stays dirty and keeps autosaving.
    markDirty();
    toast("Unsaved draft restored", "ok");
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
    if (f === "dmc") {
      // Falls back to the 3-letter palette code when the floss table has no
      // usable match, so the label is never blank.
      return e.dmc ? e.dmc.code : e.code;
    }
    return e.code; // default: 3-letter code
  }

  function buildFormatPanel(e) {
    var container = els.codeFormats;
    if (!container) return;
    container.innerHTML = "";
    if (!e) return;
    var formats = [
      { key: "code", label: "Code", value: formatEntry(e, "code") },
      { key: "name", label: "Name", value: formatEntry(e, "name") },
      { key: "rgb", label: "RGB", value: formatEntry(e, "rgb") },
      { key: "num", label: "No.", value: formatEntry(e, "num") },
      { key: "sim", label: "Sim", value: formatEntry(e, "sim") },
      { key: "hex", label: "Hex", value: formatEntry(e, "hex") },
    ];
    if (flossEnabled()) {
      formats.push({ key: "dmc", label: "DMC", value: formatEntry(e, "dmc") });
    }
    formats.forEach(function (f) {
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
        // Palette is ready, so a draft can now be colour-matched correctly.
        maybeRestoreDraft();
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
      // A premade pattern is drawn on its own guide grid; measure it here so
      // the canvas can be matched to it (see applyPatternGrid).
      var pattern = null;
      if (window.StitchGridDetect) {
        try {
          pattern = window.StitchGridDetect.detectFromImage(img);
        } catch (e) {
          pattern = null;
        }
      }
      URL.revokeObjectURL(url);
      callback(w, h, pattern);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      callback(null, null, null);
    };
    img.src = url;
  }

  function setImageSizeHint(w, h, pattern) {
    var text = "Original: " + w + "\u00d7" + h + " px";
    if (pattern) {
      text += " \u00b7 pattern grid " + pattern.cols + "\u00d7" + pattern.rows;
    }
    els.imgDimsHint.textContent = text;
    els.imgDimsHint.hidden = false;
  }

  /**
   * Adopt the grid the source chart is drawn on. Squeezing a 182-cell pattern
   * into a 60-cell canvas is what makes an import unreadable, so when the guide
   * grid is unmistakable the canvas follows it. The inputs stay editable, and
   * a non-chart photo detects nothing so nothing changes.
   */
  function applyPatternGrid(pattern) {
    els.gridWidth.value = pattern.cols;
    els.gridHeight.value = pattern.rows;
    if (state.arLocked) state.arRatio = pattern.rows / pattern.cols;
    updateFabricSize();
    toast(
      "Pattern grid detected \u2014 canvas set to " +
        pattern.cols +
        "\u00d7" +
        pattern.rows,
      "ok",
    );
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
    // Read dimensions so Auto button can scale the grid correctly, and look
    // for a premade pattern's own guide grid while the image is decoded.
    readImageDimensions(file, function (w, h, pattern) {
      if (!w || !h) return;
      state.imageNaturalSize = { w: w, h: h };
      els.autoSizeBtn.disabled = false;
      setImageSizeHint(w, h, pattern);
      if (pattern) applyPatternGrid(pattern);
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

  // ---------- trace overlay ----------
  // A reference photo laid over the chart so the user can stitch on top of it
  // and fade it out to check the result. Deliberately memory-only: it is never
  // uploaded, saved with a project or exported, so a multi-megabyte photo can
  // never blow the localStorage quota or leave the device.
  function setOverlayStatus(hasImage, name) {
    els.overlayOn.disabled = !hasImage;
    els.overlayOpacity.disabled = !hasImage;
    els.overlayClearBtn.disabled = !hasImage;
    // The slider and the remove button only earn their toolbar space once a
    // photo is loaded, hence the group class rather than per-element hiding.
    els.overlayGroup.classList.toggle("has-photo", !!hasImage);
    els.overlayDrop.classList.toggle("has-image", !!hasImage);
    els.overlayDrop.textContent = hasImage ? "Replace" : "Photo";
    var tip = hasImage
      ? "Tracing photo: " + name + " (click to replace)"
      : "Choose a photo to trace over the chart";
    els.overlayDrop.title = tip;
    els.overlayDrop.setAttribute("aria-label", tip);
    // Announced to screen readers, since the name itself has no room on screen.
    els.overlayName.textContent = hasImage ? "Tracing " + name : "";
    if (!hasImage) {
      els.overlayOn.checked = false;
      state.canvas.setOverlayImage(null);
      return;
    }
    var pct = clampInt(els.overlayOpacity.value, 0, 100, 50);
    els.overlayOn.checked = true;
    state.canvas.setOverlayImage(state.overlay);
    state.canvas.setOverlayOpacity(pct / 100);
    state.canvas.setOverlayOn(true);
  }

  function onOverlaySelected(file) {
    if (!file || !/^image\//.test(file.type)) {
      toast("Please choose an image file", "error");
      return;
    }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      // Hold the blob URL open for as long as the image is in use: the canvas
      // may be repainted long after the file input was cleared.
      if (state.overlayUrl) URL.revokeObjectURL(state.overlayUrl);
      state.overlayUrl = url;
      state.overlay = img;
      setOverlayStatus(true, file.name);
      toast("Overlay ready \u2014 fade it with the opacity slider", "ok");
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      toast("Could not read that image", "error");
    };
    img.src = url;
  }

  function clearOverlay() {
    if (state.overlayUrl) URL.revokeObjectURL(state.overlayUrl);
    state.overlayUrl = null;
    state.overlay = null;
    els.overlayInput.value = "";
    setOverlayStatus(false, "");
    toast("Overlay removed", "ok");
  }

  // ---------- design application ----------
  function applyDesign(design, title) {
    state.canvas.loadGrid(design.width, design.height, design.grid);
    syncGridInputs(design.width, design.height);
    state.currentProjectId = null;
    if (title && !els.projectTitle.value) {
      els.projectTitle.value = title;
    }
    showCanvas(true);
    updateZoomLabel();
    onDesignChange();
    markClean();
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
    markClean();
    toast("Blank " + gs.w + "×" + gs.h + " canvas ready", "ok");
  }

  // ---------- floss + skein helpers ----------
  function flossConfig() {
    return (state.config && state.config.floss) || null;
  }

  function flossEnabled() {
    var f = flossConfig();
    return !!(f && f.enabled !== false && f.size !== 0);
  }

  function flossBrand() {
    var f = flossConfig();
    return (f && f.brand) || "DMC";
  }

  function skeinConfig() {
    var s = state.config && state.config.skein;
    return s && s.enabled !== false ? s : null;
  }

  /** Attach the floss match and the estimated skein count to legend rows. */
  function annotateUsed(used) {
    var skn = window.StitchSkein;
    var raw = skeinConfig();
    var count = fabricCountValue();
    used.forEach(function (u) {
      var e = state.paletteByIndex[u.index];
      if (e) {
        if (u.code === undefined) u.code = e.code;
        if (u.name === undefined) u.name = e.name;
        if (u.hex === undefined) u.hex = e.hex;
        u.dmc = e.dmc || null;
      }
      u.skeins = skn && raw ? skn.skeinsFor(u.count, count, raw) : 0;
    });
    return used;
  }

  /** One-line estimate for the whole design, or "" when it is not applicable. */
  function skeinSummaryText(used) {
    var skn = window.StitchSkein;
    var raw = skeinConfig();
    if (!skn || !raw || !used.length) return "";
    var o = skn.options(raw);
    var total = 0;
    var stitches = 0;
    used.forEach(function (u) {
      total += u.skeins || 0;
      stitches += u.count;
    });
    return (
      "≈ " + total + " skein" + (total === 1 ? "" : "s") + " of " +
      flossBrand() + " floss for " + stitches + " stitches at " +
      fabricCountValue() + " ct (" + o.usedStrands + " strands, includes " +
      Math.round(o.wasteFactor * 100) + "% waste). Estimate only."
    );
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
    // Prefer real floss codes when we know them: "DMC 310 666" is an order a
    // stitcher can actually fill, unlike a guess at the yarn weight.
    var brand = flossBrand();
    var codes = used
      .map(function (u) {
        return u.dmc && u.dmc.code;
      })
      .filter(function (c) {
        return !!c;
      })
      .slice(0, 8);
    var query;
    if (codes.length) {
      query = ((af.floss_query || brand + " embroidery floss") + " " + codes.join(" ")).trim();
    } else {
      var names = used
        .slice(0, 5)
        .map(function (u) {
          return u.name;
        })
        .join(" ");
      query = ((af.base_query || "worsted weight yarn") + " " + names).trim();
    }
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

    annotateUsed(used);

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
        var sknHtml = u.skeins
          ? '<span class="skn">≈' +
            u.skeins +
            " skein" +
            (u.skeins === 1 ? "" : "s") +
            "</span>"
          : "";
        var dmcHtml = flossEnabled() && u.dmc
          ? '<span class="dmc">' + escapeHtml(flossBrand() + " " + u.dmc.code) + "</span>"
          : "";
        row.innerHTML =
          '<span class="swatch" style="background:' +
          u.hex +
          '"></span>' +
          '<span class="code">' +
          escapeHtml(formatEntry(u, state.codeFormat)) +
          "</span>" +
          '<span class="name">' +
          escapeHtml(u.name) +
          dmcHtml +
          "</span>" +
          '<span class="count">' +
          u.count +
          sknHtml +
          "</span>";
        row.addEventListener("click", function () {
          selectColor(u.index);
        });
        els.legendList.appendChild(row);
      });
    }

    if (els.skeinSummary) {
      var summary = skeinSummaryText(used);
      els.skeinSummary.textContent = summary;
      els.skeinSummary.hidden = !summary;
    }

    updateBuyYarn(used);

    updateInfoDims();
    if (!state.canvas.isEmpty()) {
      els.infoStitches.textContent =
        "· " + state.canvas.stitchCount() + " stitches";
      els.infoColors.textContent =
        "· " + state.canvas.colorCount() + " colours";
    }
    // Painting changes the stitch total, which shifts the progress percentage.
    scheduleProgressUiRefresh();
    updateSelectionUI();
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
    els.toolProgress.classList.toggle("active", mode === "progress");
    els.toolSelect.classList.toggle("active", mode === "select");
    syncToolOptions();
  }

  /**
   * Reveal the contextual options row belonging to the active tool. The progress
   * row also stays up whenever tracking is on, so the counter and percentage do
   * not vanish the moment you switch back to painting.
   */
  function syncToolOptions() {
    var mode = state.canvas ? state.canvas.mode : "paint";
    els.selectOptions.hidden = mode !== "select";
    els.progressOptions.hidden = !(
      mode === "progress" || els.progressOn.checked
    );
  }
  function updateZoomLabel() {
    els.zoomLevel.textContent = state.canvas.zoomPercent() + "%";
  }

  function zoomBy(delta) {
    state.canvas.setZoom(delta);
    updateZoomLabel();
  }

  /**
   * Zoom keeping whatever is under the pointer under the pointer, so the chart
   * does not jump out from under the cursor mid-inspection. scrollLeft/Top can
   * only move once the chart overflows its wrapper, which is exactly when it
   * matters.
   */
  function zoomAtPointer(delta, clientX, clientY) {
    var wrap = els.canvasWrap;
    var before = state.canvas.cellSize;
    var rect = els.stitchCanvas.getBoundingClientRect();
    var px = clientX - rect.left;
    var py = clientY - rect.top;
    zoomBy(delta);
    var k = state.canvas.cellSize / before;
    if (!wrap || k === 1) return;
    wrap.scrollLeft += px * (k - 1);
    wrap.scrollTop += py * (k - 1);
  }

  // Ctrl/⌘ + wheel over the canvas zooms it. Accumulated because a trackpad's
  // pinch arrives as a flood of tiny deltas that would otherwise race straight
  // to the zoom limit.
  var WHEEL_STEP = 40;
  var wheelAccum = 0;

  function onCanvasWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return; // plain wheel keeps scrolling
    if (!state.canvas || state.canvas.isEmpty()) return;
    e.preventDefault();
    var dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16; // Firefox counts lines, not pixels
    wheelAccum += dy;
    if (Math.abs(wheelAccum) < WHEEL_STEP) return;
    var dir = wheelAccum < 0 ? 2 : -2;
    wheelAccum = 0;
    zoomAtPointer(dir, e.clientX, e.clientY);
  }

  // ---------- collapsible panels ----------
  // Every sidebar panel that has a heading gets a disclosure control. The
  // toggle is built around the existing <h2> instead of in the markup, so panel
  // heads that also carry a search box or a badge keep working untouched.
  var PANELS_KEY = "stitchee_panels";

  function loadPanelState() {
    try {
      return JSON.parse(localStorage.getItem(PANELS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function savePanelState() {
    var out = {};
    Array.prototype.forEach.call(
      document.querySelectorAll(".panel.toggleable"),
      function (p) {
        out[p.getAttribute("data-panel")] = p.classList.contains("collapsed");
      },
    );
    try {
      localStorage.setItem(PANELS_KEY, JSON.stringify(out));
    } catch (e) {
      /* collapsing is a nicety: never block on storage */
    }
  }

  function initCollapsiblePanels() {
    var saved = loadPanelState();
    Array.prototype.forEach.call(
      document.querySelectorAll(".panel > .panel-head"),
      function (head) {
        var panel = head.parentElement;
        var h2 = head.querySelector("h2");
        if (!h2) return;
        var title = (h2.textContent || "").trim();
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "panel-toggle";
        btn.appendChild(h2); // moves the heading inside the button
        head.insertBefore(btn, head.firstChild);
        panel.classList.add("toggleable");
        panel.setAttribute("data-panel", title);
        var collapsed = !!saved[title];
        panel.classList.toggle("collapsed", collapsed);
        btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
        btn.title = collapsed ? "Expand " + title : "Collapse " + title;
        btn.addEventListener("click", function () {
          var now = panel.classList.toggle("collapsed");
          btn.setAttribute("aria-expanded", now ? "false" : "true");
          btn.title = now ? "Expand " + title : "Collapse " + title;
          savePanelState();
        });
      },
    );
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

  // ---------- selection ----------
  // The canvas methods call _notify() on any change, which already runs
  // markDirty() + onDesignChange(), so these wrappers only handle UI feedback.
  function updateSelectionUI() {
    if (!state.canvas) return;
    var has = state.canvas.hasSelection();
    var clip = state.canvas.hasClipboard();
    var info = has ? state.canvas.selectionInfo() : null;
    els.selDims.textContent = info ? info.rows + "\u00d7" + info.cols : "\u2014";
    [
      "selCopyBtn", "selCutBtn", "selFillBtn", "selDeleteBtn",
      "selMirrorHBtn", "selMirrorVBtn", "selRotLBtn", "selRotRBtn",
      "selCropBtn", "selClearBtn",
    ].forEach(function (id) {
      els[id].disabled = !has;
    });
    els.selPasteBtn.disabled = !clip;
    els.selAllBtn.disabled = state.canvas.isEmpty();
  }

  function copySelection() {
    if (!state.canvas.copySelection()) {
      toast("Nothing selected", "error");
      return;
    }
    var n = state.canvas.selectionInfo();
    toast(n ? "Copied " + n.rows + "\u00d7" + n.cols : "Copied", "ok");
  }

  function cutSelection() {
    if (!state.canvas.copySelection()) {
      toast("Nothing selected", "error");
      return;
    }
    state.canvas.deleteSelection();
    toast("Cut", "ok");
  }

  function pasteSelection() {
    // Distinguish "nothing copied" from "pasted over identical content", which
    // is a valid no-op rather than an error.
    if (!state.canvas.hasClipboard()) {
      toast("Nothing to paste", "error");
      return;
    }
    if (!state.canvas.pasteClipboard()) {
      toast("Pasted (no change)", "ok");
      return;
    }
    toast("Pasted", "ok");
  }

  function fillSelection() {
    if (!state.canvas.fillSelection()) {
      toast("Select a colour first", "error");
      return;
    }
    toast("Filled selection", "ok");
  }

  function deleteSelection() {
    if (!state.canvas.deleteSelection()) return;
    toast("Deleted selection", "ok");
  }

  function mirrorSelection(axis) {
    if (!state.canvas.mirrorSelection(axis)) return;
    toast(axis === "h" ? "Mirrored horizontally" : "Mirrored vertically", "ok");
  }

  function rotateSelection(dir) {
    if (!state.canvas.rotateSelection(dir)) return;
    toast(dir > 0 ? "Rotated clockwise" : "Rotated counter-clockwise", "ok");
  }

  function cropSelection() {
    if (!state.canvas.cropToSelection()) return;
    // cropToSelection resizes the grid, so the size inputs and zoom must follow.
    syncGridInputs(state.canvas.width, state.canvas.height);
    updateZoomLabel();
    toast("Cropped to " + state.canvas.width + "\u00d7" + state.canvas.height, "ok");
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
        // Progress is keyed per project, so carry the draft's tracker state
        // across to the new project id instead of orphaning it.
        var prevProgressKey = progressKey();
        state.currentProjectId = res.d.project.id;
        migrateProgressKey(prevProgressKey);
        markClean();
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
        syncGridInputs(p.width, p.height);
        state.currentProjectId = p.id;
        els.projectTitle.value = p.title;
        loadProgress();
        showCanvas(true);
        updateZoomLabel();
        onDesignChange();
        markClean();
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

  /** Vector SVG of the chart, with whatever symbols/codes are switched on. */
  function exportSvg() {
    if (state.canvas.isEmpty()) {
      toast("Nothing to export", "error");
      return;
    }
    var svg = state.canvas.exportSvg({ scale: 18 });
    var blob = new Blob([svg], { type: "image/svg+xml" });
    downloadBlob(
      blob,
      (els.projectTitle.value.trim() || "cross-canvas") + ".svg",
    );
    toast("SVG chart exported", "ok");
  }

  // ---------- PDF export ----------
  // Tiled, vector, printable. Cell size shrinks until the chart fits in a sane
  // page count, then each tile is drawn through the shared renderer with a
  // view so a large chart is not redrawn in full on every page.
  var PDF_MAX_PAGES = 36;
  var PDF_MIN_CELL = 8; // pt per stitch; below this the chart stops being legible
  var PDF_MAX_CELL = 22;

  function pdfGeometry(cell) {
    var page = window.StitchPdf.PAGE_SIZES.a4;
    var margin = 26;
    var ruler = 14;
    return {
      page: page,
      margin: margin,
      ruler: ruler,
      cell: cell,
      cols: Math.max(1, Math.floor((page.width - margin * 2 - ruler) / cell)),
      rows: Math.max(1, Math.floor((page.height - margin * 2 - ruler) / cell)),
    };
  }

  function buildPdfPages() {
    var P = window.StitchPdf;
    var w = state.canvas.width;
    var h = state.canvas.height;
    if (!w || !h) return null;

    var cell = PDF_MAX_CELL;
    var g;
    for (;;) {
      g = pdfGeometry(cell);
      g.pagesX = Math.ceil(w / g.cols);
      g.pagesY = Math.ceil(h / g.rows);
      if (g.pagesX * g.pagesY <= PDF_MAX_PAGES || cell <= PDF_MIN_CELL) break;
      cell -= 1;
    }

    var title = els.projectTitle.value.trim() || "Untitled Design";
    var pages = [];
    var total = g.pagesX * g.pagesY;
    var pageNo = 0;

    for (var py = 0; py < g.pagesY; py++) {
      for (var px = 0; px < g.pagesX; px++) {
        var col0 = px * g.cols;
        var row0 = py * g.rows;
        var col1 = Math.min(w - 1, col0 + g.cols - 1);
        var row1 = Math.min(h - 1, row0 + g.rows - 1);
        pageNo++;

        var page = new P.PdfPage(g.page.width, g.page.height);
        var ad = new P.PdfAdapter(page, [255, 255, 255]);
        ad.rect(0, 0, g.page.width, g.page.height, { fill: "#ffffff" });

        state.canvas.renderTo(ad, g.cell, {
          offsetX: g.margin + g.ruler,
          offsetY: g.margin + g.ruler,
          view: { col0: col0, col1: col1, row0: row0, row1: row1 },
          ruler: {
            gutter: g.ruler,
            every: 10,
            fontSize: 6.5,
            color: "#444444",
            startCol: 1,
          },
        });

        var footer =
          title +
          (total > 1
            ? "  ·  page " + pageNo + "/" + total + "  ·  cols " +
              (col0 + 1) + "-" + (col1 + 1) + "  ·  rows " +
              (row0 + 1) + "-" + (row1 + 1)
            : "");
        ad.text(g.page.width - g.margin, g.page.height - g.margin / 2, footer, {
          fill: "#555555",
          size: 7,
          family: "sans-serif",
          anchor: "end",
          baseline: "alphabetic",
        });
        pages.push(page);
      }
    }

    pages.push(buildPdfLegendPage(P, g, title));
    return pages;
  }

  /** Title block, totals and the two-column yarn key. */
  function buildPdfLegendPage(P, g, title) {
    var page = new P.PdfPage(g.page.width, g.page.height);
    var ad = new P.PdfAdapter(page, [255, 255, 255]);
    ad.rect(0, 0, g.page.width, g.page.height, { fill: "#ffffff" });

    var x = g.margin;
    var y = g.margin + 20;
    ad.text(x, y, title, {
      fill: "#000000",
      size: 20,
      family: "sans-serif",
      weight: "bold",
      anchor: "start",
      baseline: "alphabetic",
    });
    y += 20;
    ad.text(
      x,
      y,
      state.canvas.width + " x " + state.canvas.height + " stitches  ·  " +
        state.canvas.stitchCount() + " stitches  ·  " +
        state.canvas.colorCount() + " colours",
      {
        fill: "#444444",
        size: 10,
        family: "sans-serif",
        anchor: "start",
        baseline: "alphabetic",
      },
    );
    y += 26;

    var counts = state.canvas.getCounts();
    var used = annotateUsed(
      Object.keys(counts)
        .map(function (k) {
          return { index: parseInt(k, 10), count: counts[k] };
        })
        .sort(function (a, b) {
          return b.count - a.count;
        }),
    );
    var brand = flossBrand();
    var sknSummary = skeinSummaryText(used);

    if (sknSummary) {
      ad.text(x, y, sknSummary, {
        fill: "#444444",
        size: 10,
        family: "sans-serif",
        anchor: "start",
        baseline: "alphabetic",
      });
      y += 16;
    }

    var colW = (g.page.width - g.margin * 2) / 2;
    var perCol = Math.ceil(used.length / 2);
    var lineH = 20;
    var swatch = 12;

    used.forEach(function (u, i) {
      var col = i < perCol ? 0 : 1;
      var row = i < perCol ? i : i - perCol;
      var ex = g.margin + col * colW;
      var ey = y + row * lineH;
      var e = state.paletteByIndex[u.index] || {};
      ad.rect(ex, ey, swatch, swatch, {
        fill: e.hex || "#888888",
        stroke: "#999999",
        lineWidth: 0.5,
      });
      ad.text(
        ex + swatch + 6,
        ey + swatch * 0.78,
        (e.code || "?") + "  " + (e.name || "") +
          (u.dmc ? "  ·  " + brand + " " + u.dmc.code : ""),
        {
          fill: "#000000",
          size: 10,
          family: "sans-serif",
          anchor: "start",
          baseline: "alphabetic",
        },
      );
      ad.text(
        ex + colW - 8,
        ey + swatch * 0.78,
        u.skeins ? u.count + "  (" + u.skeins + " sk)" : String(u.count),
        {
          fill: "#444444",
          size: 10,
          family: "sans-serif",
          anchor: "end",
          baseline: "alphabetic",
        },
      );
    });

    return page;
  }

  function exportPdf() {
    if (state.canvas.isEmpty()) {
      toast("Nothing to export", "error");
      return;
    }
    if (!window.StitchPdf) {
      toast("PDF support unavailable", "error");
      return;
    }
    els.exportPdfBtn.disabled = true;
    var originalText = els.exportPdfBtn.textContent;
    els.exportPdfBtn.textContent = "Exporting...";

    function done() {
      els.exportPdfBtn.disabled = false;
      els.exportPdfBtn.textContent = originalText;
    }

    setTimeout(function () {
      var pages;
      try {
        pages = buildPdfPages();
      } catch (e) {
        done();
        toast("PDF export failed", "error");
        return;
      }
      if (!pages || !pages.length) {
        done();
        toast("Nothing to export", "error");
        return;
      }
      window.StitchPdf.buildPdf(pages, {
        title: els.projectTitle.value.trim() || "Untitled Design",
        author: "Stitchee",
        creator: "Stitchee",
      })
        .then(function (blob) {
          downloadBlob(
            blob,
            (els.projectTitle.value.trim() || "cross-canvas") + ".pdf",
          );
          done();
          toast(
            pages.length > 1
              ? "PDF exported (" + pages.length + " pages)"
              : "PDF exported",
            "ok",
          );
        })
        .catch(function () {
          done();
          toast("PDF export failed", "error");
        });
    }, 30);
  }

  function exportJson() {
    if (state.canvas.isEmpty()) {
      toast("Nothing to export", "error");
      return;
    }
    var design = state.canvas.getDesign();
    var counts = state.canvas.getCounts();
    var legend = annotateUsed(
      Object.keys(counts).map(function (k) {
        var e = state.paletteByIndex[parseInt(k, 10)];
        return {
          index: parseInt(k, 10),
          code: e ? e.code : "",
          name: e ? e.name : "",
          hex: e ? e.hex : "",
          count: counts[k],
        };
      }),
    );
    // Compact the floss match down to what a shopping list needs.
    legend.forEach(function (r) {
      r.dmc = r.dmc ? { code: r.dmc.code, name: r.dmc.name } : null;
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
        syncGridInputs(doc.width, doc.height);
        state.currentProjectId = null;
        if (doc.title) els.projectTitle.value = doc.title;
        showCanvas(true);
        updateZoomLabel();
        onDesignChange();
        markClean();
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
    // trace overlay: pick or drop a photo, toggle it, fade it. #overlayDrop is
    // a real <button>, so the browser gives us Enter/Space for free.
    els.overlayDrop.addEventListener("click", function () {
      els.overlayInput.click();
    });
    els.overlayInput.addEventListener("change", function () {
      if (this.files[0]) onOverlaySelected(this.files[0]);
    });
    ["dragover", "dragenter"].forEach(function (ev) {
      els.overlayDrop.addEventListener(ev, function (e) {
        e.preventDefault();
        els.overlayDrop.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      els.overlayDrop.addEventListener(ev, function (e) {
        e.preventDefault();
        els.overlayDrop.classList.remove("dragover");
      });
    });
    els.overlayDrop.addEventListener("drop", function (e) {
      if (e.dataTransfer.files[0]) onOverlaySelected(e.dataTransfer.files[0]);
    });
    els.overlayOn.addEventListener("change", function () {
      state.canvas.setOverlayOn(this.checked);
    });
    els.overlayOpacity.addEventListener("input", function () {
      els.overlayOpacityVal.textContent = this.value;
      state.canvas.setOverlayOpacity(clampInt(this.value, 0, 100, 50) / 100);
    });
    els.overlayClearBtn.addEventListener("click", clearOverlay);
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
    // Fabric count drives both the finished size and the skein estimate.
    var onFabricChange = function () {
      updateFabricSize();
      onDesignChange();
    };
    els.fabricCount.addEventListener("change", onFabricChange);
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
      zoomBy(2);
    });
    els.zoomOut.addEventListener("click", function () {
      zoomBy(-2);
    });
    els.zoomFit.addEventListener("click", function () {
      state.canvas.fitToView();
      updateZoomLabel();
    });
    // Ctrl + wheel zooms the chart. Bound to the canvas area only, so the rest
    // of the page keeps normal scrolling and browser zoom.
    els.canvasWrap.addEventListener("wheel", onCanvasWheel, { passive: false });
    els.btnUndo.addEventListener("click", undoAction);
    els.btnRedo.addEventListener("click", redoAction);
    window.addEventListener("keydown", function (e) {
      // Never hijack keys while the user is typing into a field. (This also fixes
      // Ctrl+Z in the title box triggering an undo.)
      var t = e.target;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      ) {
        return;
      }
      var mod = e.ctrlKey || e.metaKey;
      var k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        undoAction();
        return;
      }
      if (mod && k === "y") {
        e.preventDefault();
        redoAction();
        return;
      }
      if (!state.canvas || state.canvas.isEmpty()) return;
      if (mod && k === "a") {
        e.preventDefault();
        state.canvas.selectAll();
        return;
      }
      if (mod && k === "c") {
        e.preventDefault();
        copySelection();
        return;
      }
      if (mod && k === "x") {
        e.preventDefault();
        cutSelection();
        return;
      }
      if (mod && k === "v") {
        e.preventDefault();
        pasteSelection();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (state.canvas.hasSelection()) {
          e.preventDefault();
          deleteSelection();
        }
        return;
      }
      if (e.key === "Escape") {
        state.canvas.clearSelection();
        return;
      }
      var dr = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
      var dc = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      if ((dr || dc) && state.canvas.hasSelection()) {
        e.preventDefault();
        state.canvas.nudgeSelection(dr, dc);
      }
    });
    els.toggleGridLines.addEventListener("change", function () {
      state.canvas.setOption("showGrid", this.checked);
    });
    els.toggleCodes.addEventListener("change", function () {
      state.canvas.setOption("showCodes", this.checked);
    });
    els.toggleGlyphs.addEventListener("change", function () {
      state.canvas.setOption("showGlyphs", this.checked);
    });
    els.toggleStitch.addEventListener("change", function () {
      state.canvas.setOption("showStitch", this.checked);
    });

    // progress tracker
    els.toolProgress.addEventListener("click", function () {
      setMode("progress");
    });
    els.progressOn.addEventListener("change", function () {
      state.canvas.setProgressOn(this.checked);
      updateProgressUI();
      syncToolOptions();
    });
    els.progressRow.addEventListener("click", function () {
      setProgressMode("row");
    });
    els.progressColumn.addEventListener("click", function () {
      setProgressMode("column");
    });
    els.progressDiagonal.addEventListener("click", function () {
      setProgressMode("diagonal");
    });
    els.progressClearBtn.addEventListener("click", function () {
      if (state.canvas.isEmpty()) return;
      state.canvas.clearProgress();
      updateProgressUI();
      saveProgress();
      toast("Progress cleared", "ok");
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
    els.projectTitle.addEventListener("input", markDirty);
    els.saveProjectBtn.addEventListener("click", saveProject);
    els.exportPngBtn.addEventListener("click", exportPng);
    els.exportSvgBtn.addEventListener("click", exportSvg);
    els.exportPdfBtn.addEventListener("click", exportPdf);
    els.exportJsonBtn.addEventListener("click", exportJson);

    // selection
    els.toolSelect.addEventListener("click", function () {
      setMode("select");
    });
    els.selCopyBtn.addEventListener("click", copySelection);
    els.selCutBtn.addEventListener("click", cutSelection);
    els.selPasteBtn.addEventListener("click", pasteSelection);
    els.selFillBtn.addEventListener("click", fillSelection);
    els.selDeleteBtn.addEventListener("click", deleteSelection);
    els.selMirrorHBtn.addEventListener("click", function () {
      mirrorSelection("h");
    });
    els.selMirrorVBtn.addEventListener("click", function () {
      mirrorSelection("v");
    });
    els.selRotLBtn.addEventListener("click", function () {
      rotateSelection(-1);
    });
    els.selRotRBtn.addEventListener("click", function () {
      rotateSelection(1);
    });
    els.selAllBtn.addEventListener("click", function () {
      state.canvas.selectAll();
    });
    els.selCropBtn.addEventListener("click", cropSelection);
    els.selClearBtn.addEventListener("click", function () {
      state.canvas.clearSelection();
    });
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

    window.addEventListener("beforeunload", function (e) {
      if (!state.dirty) return undefined;
      e.preventDefault();
      e.returnValue = "";
      return "";
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
    initCollapsiblePanels();
    state.canvas = new CrossStitchCanvas(els.stitchCanvas, {
      onChange: function () {
        markDirty();
        onDesignChange();
      },
      onProgressChange: function (st) {
        updateProgressUI(st);
        scheduleProgressSave();
      },
      onSelectionChange: function () {
        updateSelectionUI();
      },
    });
    initFeatureFlags();
    bind();
    updateSelectionUI();
    syncToolOptions();
    loadConfig();
    loadProjects();
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
