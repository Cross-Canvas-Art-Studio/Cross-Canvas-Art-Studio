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
    locateMode: "colour",
    imageNaturalSize: null,
    overlay: null, // decoded reference photo to trace over (memory only)
    overlayUrl: null, // blob URL backing state.overlay, revoked on replace
    currentProjectId: null,
    notes: "",
    // 'pattern' = a design made in Stitchee; 'chart' = an imported chart marked
    // up over its own artwork (source image + alignment transform).
    docKind: "pattern",
    source: null, // {id,name,mime,w,h} — the bytes live in IndexedDB
    fit: null, // {fit,scaleX,scaleY,offsetX,offsetY} for the imported chart
    chartFile: null, // picked but not yet imported
    // MULTI-PAGE CHARTS. `pages` is the source of truth: each entry is one
    // imported sheet placed at a cell offset on the ONE seamless grid.
    // `source` above is kept as a derived mirror of page 0 so the existing
    // save/export/draft paths keep working unchanged.
    pages: [],
    activePage: 0,
    pageUrls: [], // object URLs backing the decoded page images
    chartFiles: null, // picked but not yet imported (may be several pages)
    chartFileInfo: null, // per-file {w,h,pattern} from the grid detector
    chartDims: null,
    chartPattern: null,
    gridMax: 500,
    gridMin: 5,
    arLocked: false,
    arRatio: null, // height / width when locked
    stitchPart: 0, // FRAC_* flags the paint tools lay down (0 = full cross)
    blendIndex: -1, // partner floss for a blend, or -1 for a solid colour
    annotKind: "arrow", // 'arrow' | 'ellipse' | 'rect' | 'text'
    annotText: "", // label text for the next text annotation
    noteCell: null, // {r,c} the note input is currently editing
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
      "chartDropZone",
      "chartInput",
      "chartPreview",
      "chartHint",
      "chartImportBtn",
      "readChartBtn",
      "chartConvertBtn",
      "chartShow",
      "chartShowRow",
      "pagesPanel",
      "pagesList",
      "pageEditor",
      "addPageBtn",
      "addPageInput",
      "joinRightBtn",
      "joinBelowBtn",
      "pageCol",
      "pageRow",
      "pageCols",
      "pageRows",
      "pageRotateBtn",
      "pageRemoveBtn",
      "paletteSearch",
      "selectedSwatch",
      "selectedName",
      "codeFormats",
      "paletteGroups",
      "toolPaint",
      "toolErase",
      "toolFill",
      "toolPick",
      "toolBack",
      "toolAnnot",
      "toolNote",
      "annotOptions",
      "annotCount",
      "annotClearBtn",
      "annotText",
      "annotArrow",
      "annotEllipse",
      "annotRect",
      "annotLabel",
      "noteOptions",
      "noteInput",
      "noteSaveBtn",
      "noteClearBtn",
      "noteCount",
      "stitchPart",
      "stitchPartHint",
      "canvasToolbar",
      "toolbarStatic",
      "toolbarDynamic",
      "optionsBar",
      "stitchCluster",
      "brushGroup",
      "stitchPlaceGroup",
      "stitchDrawGroup",
      "viewBtn",
      "viewMenu",
      "blendOn",
      "blendWith",
      "blendHint",
      "toolProgress",
      "toolSelect",
      "toolOverlay",
      "overlayOptions",
      "ovFitBtn",
      "ovStretchBtn",
      "ovCenterBtn",
      "ovScaleX",
      "ovScaleXVal",
      "ovScaleY",
      "ovScaleYVal",
      "ovOffsetX",
      "ovOffsetXVal",
      "ovOffsetY",
      "ovOffsetYVal",
      "ovSpanVal",
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
      "progressStats",
      "progressClearBtn",
      "progressOptions",
      "selectOptions",
      "toggleLocate",
      "locateOptions",
      "locateByColour",
      "locateBySymbol",
      "locateCount",
      "locateNextBtn",
      "locateClearBtn",
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
      "projectNotes",
      "saveProjectBtn",
      "projectList",
      "toast",
      "helpBtn",
      "helpModal",
      "helpClose",
      "shadeCardBtn",
      "shadeCardModal",
      "shadeCardClose",
      "shadeCardBody",
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

  /** Per-chart free-text notes, kept in sync with the Notes textarea. */
  function setNotes(text) {
    state.notes = typeof text === "string" ? text : "";
    if (els.projectNotes) els.projectNotes.value = state.notes;
  }

  // ---------- stitch types (fractional stitches + backstitch) ----------
  // A cell's COLOUR lives in `cells`; the layers describe the MARK. They travel
  // as run-length strings, so an ordinary pattern (no partial stitches, no
  // outline) saves exactly the bytes it did before these layers existed.
  function layerRuns(arr) {
    if (!arr) return null;
    var C = window.CrossStitchCanvas;
    if (!C) return null;
    var text = C.bytesToRuns(arr);
    return text || null;
  }

  function layerBytes(str, length) {
    var C = window.CrossStitchCanvas;
    if (!C || !str || !length) return null;
    if (length > C.MAX_LAYER_LENGTH) return null;
    return C.runsToBytes(str, length);
  }

  /** The stitch-type layers, ready to persist. Absent when there are none. */
  function designLayers() {
    if (!state.canvas) return { frac: null, back: null, blend: null };
    var L = state.canvas.getLayers();
    return {
      frac: layerRuns(L.frac),
      back: layerRuns(L.back),
      blend: layerRuns(L.blend),
    };
  }

  /** Decode a document's stitch-type layers for a grid of this size. */
  function docLayers(doc, w, h) {
    var C = window.CrossStitchCanvas;
    return {
      frac: layerBytes(doc && doc.frac, w * h),
      back: layerBytes(doc && doc.back, w * h * (C ? C.BACK.EDGES : 4)),
      blend: layerBytes(doc && doc.blend, w * h),
    };
  }

  // ---------- blended threads ----------
  //
  // A blend is two flosses held together in one stitch, which is how a chart
  // shows a shade you cannot buy. The colour in `cells` stays the PRIMARY - the
  // one you pick in the palette - and the blend layer names the partner, so
  // colour counts, the legend and the shopping list all keep working.
  function setBlendPartner(index) {
    state.blendIndex = typeof index === "number" && index >= 0 ? index : -1;
    applyBlendToCanvas();
    updateBlendHint();
  }

  function setBlendOn(on) {
    if (els.blendOn) els.blendOn.checked = !!on;
    if (els.blendWith) els.blendWith.disabled = !on;
    applyBlendToCanvas();
    updateBlendHint();
  }

  /** The canvas only learns the partner while blends are switched on. */
  function applyBlendToCanvas() {
    if (!state.canvas) return;
    state.canvas.setBlendPartner(blendActive() ? state.blendIndex : -1);
  }

  function blendActive() {
    return !!(els.blendOn && els.blendOn.checked && state.blendIndex >= 0);
  }

  function updateBlendHint() {
    if (!els.blendHint) return;
    var primary = state.paletteByIndex[state.selectedIndex];
    var partner = state.paletteByIndex[state.blendIndex];
    if (!blendActive()) {
      els.blendHint.textContent = "two flosses together";
      return;
    }
    if (!partner) {
      els.blendHint.textContent = "pick a second colour";
      return;
    }
    if (state.blendIndex === state.selectedIndex) {
      els.blendHint.textContent = "pick a different second colour";
      return;
    }
    els.blendHint.textContent =
      (primary ? primary.code : "?") + " + " + partner.code + " blend";
  }

  /**
   * Fill the partner dropdown from whatever palette this build ships. Note this
   * is the BUILT-IN palette (DMC + the app's own yarns), not a full shade card -
   * see the share panel for the codes this build actually knows.
   */
  function buildBlendOptions() {
    if (!els.blendWith) return;
    var sel = els.blendWith;
    sel.innerHTML = "";
    var none = document.createElement("option");
    none.value = "-1";
    none.textContent = "Blend with\u2026";
    sel.appendChild(none);
    state.palette.forEach(function (e) {
      var o = document.createElement("option");
      o.value = String(e.index);
      o.textContent = e.code + " \u2014 " + e.name;
      sel.appendChild(o);
    });
    // Default to the first colour that differs from the current selection, so
    // ticking "Blend" does something visible straight away.
    var first = -1;
    for (var i = 0; i < state.palette.length; i++) {
      if (state.palette[i].index !== state.selectedIndex) {
        first = state.palette[i].index;
        break;
      }
    }
    sel.value = String(first);
    state.blendIndex = first;
    setBlendOn(false);
  }

  function setStitchPart(flags) {
    var C = window.CrossStitchCanvas;
    state.stitchPart = flags | 0;
    state.canvas.setStitchPart(state.stitchPart);
    if (els.stitchPartHint) {
      els.stitchPartHint.textContent = state.stitchPart
        ? C.fracLabel(state.stitchPart) + " stitches"
        : "full cross stitches";
    }
  }

  /** Counts of the extra stitch types, for the canvas info line. */
  function stitchTypeText() {
    var parts = [];
    var frac = state.canvas.fractionalCount();
    if (frac) parts.push(frac + " partial");
    var back = state.canvas.backSegmentCount();
    if (back) parts.push(back + " backstitch");
    return parts.length ? "· " + parts.join(" · ") : "";
  }

  /**
   * The annotation + note layers, ready to persist. They are the stitcher's own
   * reminders, so they save with the document even though they never print.
   */
  function designOverlays() {
    var out = { annots: null, cellNotes: null };
    if (!state.canvas) return out;
    var annots = state.canvas.annotations();
    if (annots.length) out.annots = annots;
    var notes = state.canvas.cellNotesMap();
    if (Object.keys(notes).length) out.cellNotes = notes;
    return out;
  }

  /** Apply a loaded document's annotation + note layers. */
  function applyOverlays(doc) {
    if (!state.canvas) return;
    state.canvas.setAnnotations(doc && doc.annots);
    state.canvas.setCellNotes(doc && doc.cellNotes);
    refreshOverlayCounts();
  }

  function refreshOverlayCounts() {
    if (els.annotCount) {
      var n = state.canvas ? state.canvas.annotationCount() : 0;
      els.annotCount.textContent =
        n + (n === 1 ? " mark" : " marks");
    }
    if (els.noteCount) {
      var c = state.canvas ? state.canvas.cellNoteCount() : 0;
      els.noteCount.textContent = c + (c === 1 ? " cell" : " cells");
    }
  }

  function setAnnotKind(kind) {
    state.annotKind = kind;
    state.canvas.setAnnotKind(kind);
    [
      [els.annotArrow, "arrow"],
      [els.annotEllipse, "ellipse"],
      [els.annotRect, "rect"],
      [els.annotLabel, "text"],
    ].forEach(function (pair) {
      if (pair[0]) pair[0].classList.toggle("active", pair[1] === kind);
    });
    // The label text only matters for a label, so it steps forward for one.
    if (els.annotText) els.annotText.disabled = kind !== "text";
  }

  /** Enter/Clear for the note on the cell the user last clicked. */
  function commitNote() {
    if (!state.noteCell) {
      toast("Click a stitch on the canvas first", "warn");
      return;
    }
    var c = state.noteCell;
    if (state.canvas.setCellNote(c.r, c.c, els.noteInput.value)) {
      state.canvas._pushHistory();
      markDirty();
      refreshOverlayCounts();
      toast(
        els.noteInput.value.trim() ? "Note saved" : "Note cleared",
        "ok",
      );
    }
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
    var layers = designLayers();
    var overlays = designOverlays();
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
          notes: state.notes,
          kind: state.docKind,
          source: state.docKind === "chart" ? state.source : null,
          // The joined page list (geometry + IndexedDB ids). `source` above is
          // kept as the single-page mirror an older reader understands.
          pages: state.docKind === "chart" ? pageDescriptors() : null,
          // Stitch-type layers, run-length encoded (null when unused).
          frac: layers.frac,
          back: layers.back,
          blend: layers.blend,
          // Annotations + per-cell notes: the stitcher's own reminders.
          annots: overlays.annots,
          cellNotes: overlays.cellNotes,
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
    // A size change means the stored marks no longer line up with the grid —
    // UNLESS the grid only grew, which is exactly what adding another page of a
    // stitch-along does. Marks are anchored at the top-left, so a chart that got
    // wider or taller keeps every stitch already marked.
    if (!doc) {
      state.canvas.setProgress(null);
      updateProgressUI();
      return;
    }
    if (doc.w !== state.canvas.width || doc.h !== state.canvas.height) {
      if (doc.w > state.canvas.width || doc.h > state.canvas.height) {
        state.canvas.setProgress(null);
        updateProgressUI();
        return;
      }
      var src = window.CrossStitchCanvas.progressFromRuns(doc.runs, doc.w * doc.h);
      var grown = new Uint8Array(state.canvas.width * state.canvas.height);
      for (var pr = 0; pr < doc.h; pr++) {
        for (var pc = 0; pc < doc.w; pc++) {
          grown[pr * state.canvas.width + pc] = src[pr * doc.w + pc];
        }
      }
      state.canvas.setProgress(grown);
    } else {
      state.canvas.setProgress(
        window.CrossStitchCanvas.progressFromRuns(doc.runs, doc.w * doc.h),
      );
    }
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
    var empty = !state.canvas || state.canvas.isEmpty();
    // Nothing to report on an empty canvas, so the readout steps aside rather
    // than showing a row of dashes next to the finished-size line.
    if (els.progressGroup) els.progressGroup.hidden = empty;
    if (empty) {
      els.progressPercent.textContent = "0%";
      els.progressHint.textContent = "\u2014";
      if (els.progressStats) els.progressStats.textContent = "\u2014";
      return;
    }
    st = st || state.canvas.progressStats();
    els.progressPercent.textContent = st.percent + "%";
    if (st.unit === null) {
      els.progressHint.textContent =
        "All " + st.total + " stitches marked stitched.";
    } else {
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
    if (els.progressStats) els.progressStats.textContent = progressStatsText(st);
  }

  /**
   * The one figure the status line does NOT already carry: how much is left. The
   * stitch count, the colour count and the finished size sit immediately to its
   * left on the same line, so repeating them here was pure noise.
   */
  function progressStatsText(st) {
    if (!state.canvas || state.canvas.isEmpty()) return "\u2014";
    var remaining = Math.max(0, st.total - st.done);
    return remaining + " left";
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
    var dl = docLayers(doc, doc.width, doc.height);
    state.canvas.loadGrid(
      doc.width, doc.height, grid, dl.frac, dl.back, dl.blend,
    );
    applyOverlays(doc);
    syncGridInputs(doc.width, doc.height);
    state.currentProjectId = doc.projectId || null;
    els.projectTitle.value = doc.title || "";
    setNotes(doc.notes || "");
    restoreProjectKind(doc, false);
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
    // Fabric/unit changes shift the finished size shown in the stats line too.
    if (state.canvas && !state.canvas.isEmpty()) updateProgressUI();
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
        buildBlendOptions();
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

  function selectColor(index, keepTool) {
    state.selectedIndex = index;
    state.canvas.setSelected(index);
    var e = state.paletteByIndex[index];
    if (e) {
      els.selectedSwatch.style.background = e.hex;
      els.selectedName.textContent = e.name;
      buildFormatPanel(e);
    }
    updateBlendHint();
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
    if (!keepTool) setMode("paint");
    // while locating, switching colour re-targets the spotlight
    if (els.toggleLocate && els.toggleLocate.checked) applySpotlight();
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
    els.toolOverlay.disabled = !hasImage;
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
    // The alignment row appears with the photo and leaves with it, so
    // syncToolOptions() has to run on this path too and not only on tool changes.
    syncToolOptions();
    if (!hasImage) {
      els.overlayOn.checked = false;
      state.canvas.setOverlayImage(null);
      // Align mode has nothing left to align, so hand the tools back.
      if (state.canvas.mode === "overlay") setMode("paint");
      syncOverlayControls();
      return;
    }
    var pct = clampInt(els.overlayOpacity.value, 0, 100, 50);
    els.overlayOn.checked = true;
    state.canvas.setOverlayImage(state.overlay);
    state.canvas.setOverlayOpacity(pct / 100);
    state.canvas.setOverlayOn(true);
    syncOverlayControls();
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

  // ---------- import an existing chart (markup mode) ----------
  // An imported chart keeps its OWN artwork as the canvas: the image bytes are
  // stored in IndexedDB (photo-sized files never fit in localStorage), the grid
  // is an empty canvas sized to the chart, and the artwork is drawn UNDER the
  // grid so progress is marked straight onto the original.
  //
  // A chart is usually printed across SEVERAL SHEETS, so each imported sheet
  // becomes a PAGE placed at a cell offset on the one seamless grid: the whole
  // design is marked up as a single chart instead of a pile of projects, and the
  // legend, Locate/Spotlight and the stitch count all see the complete chart.
  // The grid is always exactly the bounding box of the pages, which is what
  // makes a stitch-along safe — adding the next page only grows the canvas at
  // its edge, so markup already made keeps its cell coordinates.

  function setChartModeUI(on) {
    state.docKind = on ? "chart" : "pattern";
    // The toolbar's trace-overlay controls would be confusing in chart mode (the
    // artwork IS the canvas, not a tracing photo), so they step aside for the
    // chart's own "Show the imported chart" toggle.
    // The toolbar's Trace cluster is only in the row while the Align tool is (or
    // in chart mode a page is being seated). syncToolOptions() owns that.
    els.chartShowRow.hidden = !on;
    els.chartConvertBtn.hidden = !on;
    els.readChartBtn.hidden = !on;
    els.pagesPanel.hidden = !on;
    if (on) els.chartShow.checked = true;
    // A chart's grid is empty (the stitches come from its artwork), so every
    // cell has to be markable even though no palette colour is set.
    if (state.canvas) state.canvas.setAllCellsStitchable(!!on);
    syncToolOptions();
  }

  // ---- chart pages ----
  /** Persistable half of a page: everything except the decoded image. */
  function pageDescriptor(p) {
    return {
      id: p.id,
      name: p.name,
      mime: p.mime,
      w: p.w,
      h: p.h,
      col: p.col,
      row: p.row,
      cols: p.cols,
      rows: p.rows,
      rot: p.rot || 0,
      crop: p.crop || null,
    };
  }
  function pageDescriptors() {
    return state.pages.map(pageDescriptor);
  }
  function numOr(v, fallback) {
    var n = typeof v === "number" ? v : parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  /**
   * Read a stored chart document into live page descriptors. Documents saved
   * before multi-page support carry one `source` plus a `fit` transform; that is
   * converted into the equivalent single page so existing charts open unchanged.
   */
  function resolvePages(p) {
    var raw = p && p.pages;
    if (!Array.isArray(raw) || !raw.length) {
      if (!p || !p.source || !p.source.id) return [];
      var geom = window.CrossStitchCanvas.pageFromFit(
        p.fit, p.width, p.height, p.source.w, p.source.h,
      );
      raw = [
        {
          id: p.source.id,
          name: p.source.name,
          mime: p.source.mime,
          w: p.source.w,
          h: p.source.h,
          col: geom.col,
          row: geom.row,
          cols: geom.cols,
          rows: geom.rows,
          rot: 0,
        },
      ];
    }
    return raw
      .map(function (d) {
        if (!d || !d.id) return null;
        return {
          id: d.id,
          name: d.name || "page",
          mime: d.mime || "image/png",
          w: numOr(d.w, 0),
          h: numOr(d.h, 0),
          col: numOr(d.col, 0),
          row: numOr(d.row, 0),
          cols: Math.max(1, numOr(d.cols, 1)),
          rows: Math.max(1, numOr(d.rows, 1)),
          rot: numOr(d.rot, 0),
          crop: d.crop || null,
          img: null,
        };
      })
      .filter(Boolean);
  }

  /** Push the page list onto the canvas and keep the legacy mirror in step. */
  function syncPagesToCanvas() {
    if (!state.canvas) return;
    state.canvas.setOverlayOpacity(1);
    state.canvas.setSubstratePages(
      state.pages.map(function (p) {
        return {
          img: p.img,
          col: p.col,
          row: p.row,
          cols: p.cols,
          rows: p.rows,
          rot: p.rot,
          crop: p.crop,
        };
      }),
    );
    state.canvas.setActivePage(state.activePage);
    if (state.pages.length) {
      els.toolOverlay.disabled = false;
      state.canvas.setOverlayOn(els.chartShow ? els.chartShow.checked : true);
    }
    // `state.source` is only a convenience mirror of page 0 now; the save,
    // export and draft paths read it as the chart's source descriptor.
    state.source = state.pages.length ? pageDescriptor(state.pages[0]) : null;
  }

  /** Decode one page's stored image. The blob URL is KEPT, because the artwork
   *  is drawn on every repaint and re-read by "Read chart colours". */
  function loadPageImage(p) {
    var store = window.StitchImageStore;
    if (!store || !p || !p.id) return Promise.resolve(null);
    if (p.img) return Promise.resolve(p.img);
    return store.get(p.id).then(function (blob) {
      if (!blob) return null;
      return new Promise(function (resolve) {
        var url = URL.createObjectURL(blob);
        state.pageUrls.push(url);
        var img = new Image();
        img.onload = function () {
          resolve(img);
        };
        img.onerror = function () {
          resolve(null);
        };
        img.src = url;
      });
    });
  }

  /** Decode every page. Resolves false if any image is missing from the device. */
  function loadAllPageImages() {
    var store = window.StitchImageStore;
    if (!state.pages.length) return Promise.resolve(true);
    if (!store || !store.supported()) return Promise.resolve(false);
    var ok = true;
    return Promise.all(
      state.pages.map(function (p) {
        return loadPageImage(p).then(function (img) {
          p.img = img;
          if (!img) ok = false;
          return img;
        });
      }),
    ).then(function () {
      return ok;
    });
  }

  /**
   * Make the grid exactly the bounding box of the pages. Appending a page to the
   * right/bottom only GROWS the canvas, which is why existing markup and
   * progress survive — that is the stitch-along guarantee. A page pushed to the
   * left/above moves the origin instead, shifting the artwork and the markup
   * together so they stay aligned.
   */
  function fitGridToPages() {
    var C = window.CrossStitchCanvas;
    var b = C.pageBoundsOf(state.pages);
    if (!b) return false;
    var dCol = b.col < 0 ? Math.ceil(-b.col) : 0;
    var dRow = b.row < 0 ? Math.ceil(-b.row) : 0;
    if (dCol || dRow) {
      state.pages.forEach(function (p) {
        p.col += dCol;
        p.row += dRow;
      });
      b = C.pageBoundsOf(state.pages);
    }
    var capped = false;
    var needW = Math.max(state.canvas.width + dCol, Math.ceil(b.col + b.cols));
    var needH = Math.max(state.canvas.height + dRow, Math.ceil(b.row + b.rows));
    if (needW > state.gridMax) {
      needW = state.gridMax;
      capped = true;
    }
    if (needH > state.gridMax) {
      needH = state.gridMax;
      capped = true;
    }
    if (
      needW !== state.canvas.width ||
      needH !== state.canvas.height ||
      dCol ||
      dRow
    ) {
      state.canvas.resizeGrid(needW, needH, dCol, dRow);
    }
    return capped;
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  function syncPageControls() {
    var p = state.pages[state.activePage];
    if (!els.pageEditor) return;
    els.pageEditor.hidden = !p;
    if (!p) return;
    els.pageCol.value = round1(p.col);
    els.pageRow.value = round1(p.row);
    els.pageCols.value = round1(p.cols);
    els.pageRows.value = round1(p.rows);
  }

  /** Rebuild the page list. Built with DOM calls so a file name can never be
   *  interpreted as markup. */
  function refreshPagesUI() {
    var list = els.pagesList;
    if (!list) return;
    list.innerHTML = "";
    if (!state.pages.length) {
      if (els.pageEditor) els.pageEditor.hidden = true;
      return;
    }
    state.pages.forEach(function (p, i) {
      var row = document.createElement("div");
      row.className = "page-item" + (i === state.activePage ? " active" : "");
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.setAttribute("data-index", String(i));
      row.title = "Edit this page";

      var name = document.createElement("span");
      name.className = "page-name";
      name.textContent = i + 1 + ". " + (p.name || "page");

      var meta = document.createElement("span");
      meta.className = "page-meta";
      meta.textContent =
        round1(p.cols) + "\u00d7" + round1(p.rows) +
        " @ " + round1(p.col) + "," + round1(p.row) +
        (p.rot ? " \u00b7 " + p.rot + "\u00b0" : "");

      row.appendChild(name);
      row.appendChild(meta);

      [
        ["up", "\u2191", "Move this page earlier"],
        ["down", "\u2193", "Move this page later"],
      ].forEach(function (spec) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "page-order-btn";
        b.setAttribute("data-act", spec[0]);
        b.title = spec[2];
        b.textContent = spec[1];
        row.appendChild(b);
      });

      list.appendChild(row);
    });
    syncPageControls();
  }

  function setActivePage(i) {
    state.activePage = Math.max(0, Math.min(state.pages.length - 1, i || 0));
    if (state.canvas) state.canvas.setActivePage(state.activePage);
    refreshPagesUI();
  }

  /** Move the active page by whole cells (the arrow keys, Align mode). */
  function nudgeActivePage(dc, dr, mult) {
    var p = state.pages[state.activePage];
    if (!p) return;
    var step = mult || 1;
    p.col += dc * step;
    p.row += dr * step;
    fitGridToPages();
    syncPagesToCanvas();
    refreshPagesUI();
    syncGridInputs(state.canvas.width, state.canvas.height);
    markDirty();
  }

  /** Commit a geometry edit from the number boxes. */
  function setActivePageGeometry(part) {
    var p = state.pages[state.activePage];
    if (!p) return;
    if (typeof part.col === "number") p.col = part.col;
    if (typeof part.row === "number") p.row = part.row;
    if (typeof part.cols === "number") p.cols = Math.max(1, part.cols);
    if (typeof part.rows === "number") p.rows = Math.max(1, part.rows);
    var capped = fitGridToPages();
    syncPagesToCanvas();
    refreshPagesUI();
    syncGridInputs(state.canvas.width, state.canvas.height);
    if (capped) toast("The canvas is at its 500-stitch limit", "warn");
    markDirty();
  }

  /** Rotate the active page a quarter turn. The footprint swaps too, so the
   *  artwork keeps its shape instead of being squashed into the old box. */
  function rotateActivePage() {
    var p = state.pages[state.activePage];
    if (!p) return;
    p.rot = ((p.rot || 0) + 90) % 360;
    var t = p.cols;
    p.cols = p.rows;
    p.rows = t;
    fitGridToPages();
    syncPagesToCanvas();
    refreshPagesUI();
    syncGridInputs(state.canvas.width, state.canvas.height);
    markDirty();
    toast("Page rotated", "ok");
  }

  function removeActivePage() {
    var i = state.activePage;
    var p = state.pages[i];
    if (!p) return;
    if (state.pages.length === 1) {
      // The last page is the chart: dropping it leaves nothing to mark up.
      detachSource();
      state.canvas.newBlank(
        clampInt(els.gridWidth.value, state.gridMin, state.gridMax, 60),
        clampInt(els.gridHeight.value, state.gridMin, state.gridMax, 80),
      );
      syncGridInputs(state.canvas.width, state.canvas.height);
      onDesignChange();
      markDirty();
      return;
    }
    state.pages.splice(i, 1);
    state.activePage = Math.max(0, Math.min(state.pages.length - 1, i - 1));
    // The page is gone from the document, so its bytes are orphaned: drop them
    // rather than leak an image for every page the user removes.
    var store = window.StitchImageStore;
    if (store && p.id) store.remove(p.id);
    fitGridToPages();
    syncPagesToCanvas();
    refreshPagesUI();
    syncGridInputs(state.canvas.width, state.canvas.height);
    markDirty();
    toast("Page removed", "ok");
  }

  /** Reorder the page list (also the draw order). Positions are untouched. */
  function moveActivePage(dir) {
    var i = state.activePage;
    var j = i + dir;
    if (j < 0 || j >= state.pages.length) return;
    var t = state.pages[i];
    state.pages[i] = state.pages[j];
    state.pages[j] = t;
    state.activePage = j;
    syncPagesToCanvas();
    refreshPagesUI();
    markDirty();
  }

  /** Seat the active page hard against the previous one: the seamless join. */
  function joinActivePage(dir) {
    var i = state.activePage;
    var p = state.pages[i];
    var prev = i > 0 ? state.pages[i - 1] : null;
    if (!p) return;
    if (!prev) {
      toast("This is the first page — nothing to join it to", "warn");
      return;
    }
    if (dir === "below") {
      p.col = Math.round(prev.col);
      p.row = Math.round(prev.row + prev.rows);
    } else {
      p.col = Math.round(prev.col + prev.cols);
      p.row = Math.round(prev.row);
    }
    fitGridToPages();
    syncPagesToCanvas();
    refreshPagesUI();
    syncGridInputs(state.canvas.width, state.canvas.height);
    markDirty();
    toast(dir === "below" ? "Joined below the previous page" : "Joined to the right of the previous page", "ok");
  }

  /** Drop every reference to an imported chart. The stored images are KEPT, so a
   *  saved chart project can still be re-opened on this device. */
  function detachSource() {
    state.source = null;
    state.fit = null;
    state.pages = [];
    state.activePage = 0;
    state.chartFile = null;
    state.chartFiles = null;
    state.chartFileInfo = null;
    state.chartDims = null;
    state.chartPattern = null;
    state.overlay = null;
    if (state.pageUrls && state.pageUrls.length) {
      state.pageUrls.forEach(function (u) {
        URL.revokeObjectURL(u);
      });
      state.pageUrls = [];
    }
    if (state.overlayUrl) {
      URL.revokeObjectURL(state.overlayUrl);
      state.overlayUrl = null;
    }
    if (state.canvas) {
      state.canvas.setOverlayOn(false);
      state.canvas.setOverlayImage(null);
      state.canvas.setSubstratePages([]);
    }
    if (els.chartInput) els.chartInput.value = "";
    if (els.addPageInput) els.addPageInput.value = "";
    if (els.chartPreview) els.chartPreview.hidden = true;
    if (els.chartImportBtn) {
      els.chartImportBtn.disabled = true;
      els.chartImportBtn.textContent = "Import chart";
    }
    setChartModeUI(false);
    refreshPagesUI();
  }

  /**
   * Restore a loaded project's document kind. A chart needs its artwork decoded
   * from IndexedDB, which is async, so this returns a promise.
   */
  function restoreProjectKind(p, keepClean) {
    var pages = p && p.kind === "chart" ? resolvePages(p) : [];
    if (pages.length) {
      state.pages = pages;
      state.activePage = 0;
      state.chartFile = null;
      state.chartFiles = null;
      state.chartFileInfo = null;
      // Legacy charts kept their transform in `fit`; pages supersede it.
      state.fit = null;
      setChartModeUI(true);
      refreshPagesUI();
      return loadAllPageImages().then(function (ok) {
        if (!ok) {
          toast(
            "Import the chart image again \u2014 it is not stored on this device",
            "warn",
          );
        }
        // Normally the saved grid already bounds the pages; only a hand-edited
        // or truncated document should ever need growing here.
        var b = window.CrossStitchCanvas.pageBoundsOf(state.pages);
        if (
          b &&
          (b.col < 0 ||
            b.row < 0 ||
            Math.ceil(b.col + b.cols) > state.canvas.width ||
            Math.ceil(b.row + b.rows) > state.canvas.height)
        ) {
          fitGridToPages();
          syncGridInputs(state.canvas.width, state.canvas.height);
        }
        syncPagesToCanvas();
        refreshPagesUI();
        if (keepClean) markClean();
      });
    }
    detachSource();
    return Promise.resolve();
  }

  /** A user picked one or more chart pages: preview the first and measure them
   *  all, so the import can match each sheet's own guide grid. */
  function onChartSelected(files) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) {
      return f && /^image\//.test(f.type);
    });
    if (!list.length) {
      toast("Please choose an image file", "error");
      return;
    }
    state.chartFiles = list;
    state.chartFileInfo = list.map(function () {
      return null;
    });
    state.chartFile = list[0];
    els.chartImportBtn.disabled = true;

    var reader = new FileReader();
    reader.onload = function (e) {
      els.chartPreview.src = e.target.result;
      els.chartPreview.hidden = false;
    };
    reader.readAsDataURL(list[0]);

    var pending = list.length;
    els.chartHint.textContent =
      "Reading " + list.length + " page" + (list.length > 1 ? "s" : "") + "\u2026";
    list.forEach(function (file, i) {
      readImageDimensions(file, function (w, h, pattern) {
        state.chartFileInfo[i] = { w: w, h: h, pattern: pattern };
        pending--;
        if (pending > 0) return;
        var detected = state.chartFileInfo.filter(function (info) {
          return info && info.pattern;
        }).length;
        var first = state.chartFileInfo[0] || {};
        var cols = first.pattern
          ? first.pattern.cols
          : clampInt(els.gridWidth.value, state.gridMin, state.gridMax, 60);
        var rows = first.pattern
          ? first.pattern.rows
          : clampInt(els.gridHeight.value, state.gridMin, state.gridMax, 80);
        els.chartHint.textContent =
          list.length +
          (list.length > 1 ? " pages" : " page") +
          " \u00b7 page 1 is " +
          (first.pattern
            ? cols + "\u00d7" + rows + " cells (detected)"
            : "your current canvas size \u2014 adjust it if that is wrong") +
          (list.length > 1
            ? " \u00b7 " + detected + " of " + list.length +
              " grids detected \u00b7 joined left to right"
            : "");
        els.chartImportBtn.disabled = false;
      });
    });
  }

  /** Import the picked sheets as joined pages on one seamless canvas. */
  function importChart() {
    var files = state.chartFiles;
    if (!files || !files.length) {
      toast("Choose a chart image first", "error");
      return;
    }
    var store = window.StitchImageStore;
    if (!store || !store.supported()) {
      toast("This browser cannot store chart images", "error");
      return;
    }
    var infos = state.chartFileInfo || [];
    var fallbackCols = clampInt(els.gridWidth.value, state.gridMin, state.gridMax, 60);
    var fallbackRows = clampInt(els.gridHeight.value, state.gridMin, state.gridMax, 80);
    var pages = [];
    var runningCol = 0;

    els.chartImportBtn.disabled = true;
    els.chartImportBtn.textContent = "Importing\u2026";

    var chain = Promise.resolve();
    files.forEach(function (file, i) {
      chain = chain.then(function () {
        var info = infos[i] || {};
        var cols = info.pattern ? info.pattern.cols : fallbackCols;
        var rows = info.pattern ? info.pattern.rows : fallbackRows;
        return store.put(file).then(function (id) {
          pages.push({
            id: id,
            name: file.name || "page-" + (i + 1),
            mime: file.type || "image/png",
            w: info.w || 0,
            h: info.h || 0,
            col: runningCol,
            row: 0,
            cols: cols,
            rows: rows,
            rot: 0,
            crop: null,
            img: null,
          });
          // The seamless join: each page begins exactly where the last ended.
          runningCol += cols;
        });
      });
    });

    chain
      .then(function () {
        state.pages = pages;
        state.activePage = 0;
        // A chart is an EMPTY grid — nothing is stitched in Stitchee colours —
        // whose substrate is the joined artwork.
        var b = window.CrossStitchCanvas.pageBoundsOf(pages);
        state.canvas.newBlank(
          Math.min(state.gridMax, Math.ceil(b.cols)),
          Math.min(state.gridMax, Math.ceil(b.rows)),
        );
        state.currentProjectId = null;
        setNotes("");
        setChartModeUI(true);
        return loadAllPageImages();
      })
      .then(function () {
        var capped = fitGridToPages();
        syncPagesToCanvas();
        refreshPagesUI();
        syncGridInputs(state.canvas.width, state.canvas.height);
        showCanvas(true);
        updateZoomLabel();
        onDesignChange();
        markDirty();
        els.chartImportBtn.disabled = false;
        els.chartImportBtn.textContent = "Import chart";
        // Seating the pages on the grid is the very next job.
        setMode("overlay");
        toast(
          pages.length +
            (pages.length > 1 ? " pages joined" : " chart imported") +
            " (" + state.canvas.width + "\u00d7" + state.canvas.height +
            (capped ? ", capped at the 500-stitch limit" : "") +
            ") \u2014 drag the frame until the grid lines up",
          capped ? "warn" : "ok",
        );
      })
      .catch(function () {
        els.chartImportBtn.disabled = false;
        els.chartImportBtn.textContent = "Import chart";
        toast("Could not import that chart", "error");
      });
  }

  /**
   * Add more pages to the chart already on screen. This is the stitch-along:
   * the new sheets are seated after the current right edge and the canvas grows
   * to hold them, so every mark already made keeps its place.
   */
  function addChartPages(files) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) {
      return f && /^image\//.test(f.type);
    });
    if (!list.length) {
      toast("Please choose an image file", "error");
      return;
    }
    var C = window.CrossStitchCanvas;
    if (state.pages.length + list.length > C.MAX_SUBSTRATE_PAGES) {
      toast("That is more pages than this chart can hold", "error");
      return;
    }
    var store = window.StitchImageStore;
    if (!store || !store.supported()) {
      toast("This browser cannot store chart images", "error");
      return;
    }
    var b = state.canvas.pageBounds() || { col: 0, row: 0, cols: 0, rows: 0 };
    var runningCol = Math.ceil(b.col + b.cols);
    var added = [];
    var fallbackCols = clampInt(els.gridWidth.value, state.gridMin, state.gridMax, 60);
    var fallbackRows = clampInt(els.gridHeight.value, state.gridMin, state.gridMax, 80);

    els.addPageBtn.disabled = true;
    var chain = Promise.resolve();
    list.forEach(function (file, i) {
      chain = chain.then(function () {
        return new Promise(function (resolve) {
          readImageDimensions(file, function (w, h, pattern) {
            var cols = pattern ? pattern.cols : fallbackCols;
            var rows = pattern ? pattern.rows : fallbackRows;
            store.put(file).then(function (id) {
              added.push({
                id: id,
                name: file.name || "page-" + (state.pages.length + i + 1),
                mime: file.type || "image/png",
                w: w || 0,
                h: h || 0,
                col: runningCol,
                row: 0,
                cols: cols,
                rows: rows,
                rot: 0,
                crop: null,
                img: null,
              });
              runningCol += cols;
              resolve();
            }, resolve);
          });
        });
      });
    });

    chain
      .then(function () {
        state.pages = state.pages.concat(added);
        state.activePage = state.pages.length - added.length;
        setChartModeUI(true);
        return loadAllPageImages();
      })
      .then(function () {
        var capped = fitGridToPages();
        syncPagesToCanvas();
        refreshPagesUI();
        syncGridInputs(state.canvas.width, state.canvas.height);
        state.canvas.fitToView();
        updateZoomLabel();
        onDesignChange();
        markDirty();
        els.addPageBtn.disabled = false;
        if (els.addPageInput) els.addPageInput.value = "";
        setMode("overlay");
        toast(
          "Added " + added.length + " page" + (added.length > 1 ? "s" : "") +
            (capped
              ? " \u2014 the canvas is at its 500-stitch limit"
              : " \u2014 drag the frame to line it up"),
          capped ? "warn" : "ok",
        );
      })
      .catch(function () {
        els.addPageBtn.disabled = false;
        toast("Could not add that page", "error");
      });
  }


  /**
   * Compose the joined pages into ONE bitmap for the convert pipeline. The
   * pages are drawn at their grid offsets through the same code that renders
   * them on screen, so a converted multi-page chart matches what was marked up.
   */
  function composePagesBlob() {
    return new Promise(function (resolve) {
      var w = state.canvas.width;
      var h = state.canvas.height;
      // The analyser resamples to the grid, so a modest bitmap loses nothing and
      // keeps a wide chart from allocating a needlessly huge canvas.
      var cell = Math.max(2, Math.min(20, Math.floor(2400 / Math.max(w, h, 1))));
      var canvas = state.canvas.renderSubstrate(cell);
      if (!canvas || typeof canvas.toBlob !== "function") {
        resolve(null);
        return;
      }
      canvas.toBlob(function (blob) {
        resolve(blob);
      }, "image/png");
    });
  }

  /** Read the imported chart's colours, best-effort, then hand over to painting. */
  function readChart() {
    if (state.docKind !== "chart" || !state.pages.length) {
      toast("Import a chart first", "warn");
      return;
    }
    var grid = state.canvas.readSubstrateGrid();
    if (!grid) {
      toast("Nothing to read", "error");
      return;
    }
    if (!state.canvas.applyReadGrid(grid)) {
      toast("Nothing to read", "error");
      return;
    }
    var colours = state.canvas.colorCount();
    toast(
      colours
        ? "Read " + colours + " colours \u2014 fix any with Pick and Paint"
        : "No stitch colours found \u2014 this chart may use symbols over a key",
      colours ? "ok" : "warn",
    );
  }

  /**
   * Run the ordinary analyse pipeline over the imported chart's artwork.
   *
   * A joined multi-page chart is converted as ONE image: the pages are composed
   * into a single bitmap at their grid offsets first, so the converted pattern
   * is the whole design rather than page 1 on its own.
   */
  function convertChartToPattern() {
    var store = window.StitchImageStore;
    var first = state.pages[0] || null;
    var pending;
    if (state.chartFile) {
      pending = Promise.resolve(state.chartFile);
    } else if (state.pages.length > 1) {
      pending = composePagesBlob();
    } else {
      pending = store && first && first.id
        ? store.get(first.id)
        : Promise.resolve(null);
    }
    els.chartConvertBtn.disabled = true;
    var name = (first && first.name) || "chart";
    pending
      .then(function (blob) {
        if (!blob) throw new Error("missing source image");
        var gs = gridSize();
        var fd = new FormData();
        fd.append("image", blob, name);
        fd.append("width", gs.w);
        fd.append("height", gs.h);
        fd.append("max_colors", els.imgMaxColors.value);
        fd.append("resample", els.resampleMode.value);
        return fetch("/api/analyze-image", { method: "POST", body: fd }).then(
          function (r) {
            return r.json().then(function (d) {
              return { ok: r.ok, d: d };
            });
          },
        );
      })
      .then(function (res) {
        els.chartConvertBtn.disabled = false;
        if (!res.ok) {
          toast(res.d.error || "Conversion failed", "error");
          return;
        }
        applyDesign(res.d, name.replace(/\.[^.]+$/, ""));
        toast("Converted \u00b7 " + res.d.stats.color_count + " yarn colours", "ok");
      })
      .catch(function () {
        els.chartConvertBtn.disabled = false;
        toast("Conversion failed", "error");
      });
  }

  // ---------- design application ----------
  function applyDesign(design, title) {
    state.canvas.loadGrid(design.width, design.height, design.grid);
    syncGridInputs(design.width, design.height);
    state.currentProjectId = null;
    setNotes("");
    // A generated/converted design is a PATTERN, so any imported chart artwork
    // underneath it is no longer the substrate.
    detachSource();
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
    setNotes("");
    detachSource();
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
  /**
   * Thread equivalents: how much of a full stitch's thread one backstitch
   * segment uses. A cross is two legs plus the return journey; a backstitch
   * segment is about one leg, so half a stitch is the fair equivalent when
   * estimating skeins. It is only used for the ESTIMATE — the legend still
   * reports the real segment count.
   */
  var BACK_STITCH_EQUIV = 0.5;

  function stitchEquiv(u) {
    // `blendHalf` is already the half-stitch-per-side share, so a blended stitch
    // contributes half a stitch of thread to each of its two colours.
    return (u.count || 0) + (u.back || 0) * BACK_STITCH_EQUIV + (u.blendHalf || 0);
  }

  /**
   * The legend / shopping list: ONE row per floss, whether that floss is used
   * for stitches, for a backstitch outline, or both.
   *
   * A colour used ONLY as an outline has no cells at all, so `getCounts()` never
   * mentions it. Building the list from the union is what stops a chart outlined
   * in DMC 310 from telling you to buy every colour except the black.
   */
  function legendRows() {
    var counts = state.canvas.getCounts();
    var backs = state.canvas.backCounts ? state.canvas.backCounts() : {};
    var blends = state.canvas.blendCounts ? state.canvas.blendCounts() : {};
    var byIndex = {};
    function slot(i) {
      if (!byIndex[i]) {
        byIndex[i] = {
          index: i,
          count: 0,
          back: 0,
          blendHalf: 0,
          blendStitches: 0,
        };
      }
      return byIndex[i];
    }
    Object.keys(counts).forEach(function (k) {
      slot(parseInt(k, 10)).count = counts[k];
    });
    Object.keys(backs).forEach(function (k) {
      slot(parseInt(k, 10)).back = backs[k];
    });

    // A blended stitch is two flosses held together, so it uses HALF a stitch's
    // thread of EACH colour. Charge half to each side and take those stitches
    // back off the primary's solid count, or the same stitch would appear in
    // both the pair row and the primary row and be bought twice.
    var pairs = [];
    Object.keys(blends).forEach(function (key) {
      var parts = key.split(",");
      var a = parseInt(parts[0], 10);
      var b = parseInt(parts[1], 10);
      var n = blends[key];
      if (!(n > 0) || !isFinite(a) || !isFinite(b) || a === b) return;
      slot(a).count -= n;
      slot(a).blendHalf += n * 0.5;
      slot(a).blendStitches += n;
      slot(b).blendHalf += n * 0.5;
      slot(b).blendStitches += n;
      pairs.push({ a: a, b: b, count: n });
    });

    var used = Object.keys(byIndex).map(function (k) {
      var u = byIndex[k];
      var e = state.paletteByIndex[u.index];
      u.code = e ? e.code : "?";
      u.name = e ? e.name : "Unknown";
      u.hex = e ? e.hex : "#888";
      return u;
    });
    // One row per BLEND, named for both flosses. The thread estimate stays on
    // the two colour rows, so this row is the picture and the stitch count.
    pairs.forEach(function (p) {
      var ea = state.paletteByIndex[p.a];
      var eb = state.paletteByIndex[p.b];
      used.push({
        index: p.a,
        partnerIndex: p.b,
        isBlend: true,
        count: p.count,
        back: 0,
        blendHalf: 0,
        blendStitches: 0,
        code: (ea ? ea.code : "?") + " + " + (eb ? eb.code : "?"),
        name:
          (ea ? ea.name : "Unknown") + " + " + (eb ? eb.name : "Unknown"),
        hex: ea ? ea.hex : "#888",
        hex2: eb ? eb.hex : "#888",
      });
    });
    // Most thread first, so a heavily-outlined colour is not buried at the end
    // just because it has no stitches.
    used.sort(function (a, b) {
      return stitchEquiv(b) - stitchEquiv(a) || (b.back || 0) - (a.back || 0);
    });
    return annotateUsed(used);
  }

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
        // A blend row is titled for TWO flosses, so it must not inherit one
        // floss's DMC match (it would put a wrong code on the shopping list).
        if (!u.isBlend) u.dmc = e.dmc || null;
      }
      // The skein estimate has to include the outline, or a colour used only for
      // backstitch would be reported as needing no floss at all. A blend row
      // owns none of the thread - the two colour rows do - so it holds none.
      u.skeins = u.isBlend
        ? 0
        : skn && raw
          ? skn.skeinsFor(stitchEquiv(u), count, raw)
          : 0;
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
    var backs = 0;
    used.forEach(function (u) {
      total += u.skeins || 0;
      stitches += u.count || 0;
      backs += u.back || 0;
    });
    // Backstitch is quoted in segments, not stitches, so it is named separately
    // rather than folded silently into the stitch total.
    var work =
      stitches + " stitches" +
      (backs ? " + " + backs + " backstitch segments" : "");
    return (
      "≈ " + total + " skein" + (total === 1 ? "" : "s") + " of " +
      flossBrand() + " floss for " + work + " at " +
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
    var used = legendRows();

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
        // An outline-only colour has no stitch count, so "0" would read as a
        // mistake; the backstitch length is the number that matters there.
        var cntHtml = u.count ? String(u.count) : "";
        var backHtml = u.back
          ? '<span class="bkn" title="Backstitch segments in this colour">' +
            u.back + " backstitch</span>"
          : "";
        // A blend has no skein figure of its own: its thread is charged to the
        // two colour rows, half a stitch each. Say so rather than showing "0".
        var blendHtml = u.isBlend
          ? '<span class="bkn" title="Blended stitches: half a stitch of each floss">' +
            "blend \u00b7 \u00bd each</span>"
          : "";
        var shareHtml =
          !u.isBlend && u.blendStitches
            ? '<span class="bkn" title="Stitches blended with another floss">' +
              u.blendStitches + " in blends</span>"
            : "";
        // Two colours in one stitch: the swatch is split so the row shows the
        // blend at a glance, exactly the way the stitch is drawn.
        var swatchHtml = u.isBlend
          ? '<span class="swatch blend" style="background:linear-gradient(135deg,' +
            u.hex + ' 0 50%,' + u.hex2 + ' 50% 100%)"></span>'
          : '<span class="swatch" style="background:' + u.hex + '"></span>';
        row.innerHTML =
          swatchHtml +
          '<span class="code">' +
          escapeHtml(formatEntry(u, state.codeFormat)) +
          "</span>" +
          '<span class="name">' +
          escapeHtml(u.name) +
          dmcHtml +
          "</span>" +
          '<span class="count">' +
          cntHtml +
          backHtml +
          blendHtml +
          shareHtml +
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

    // The markup badges are driven from the same place as the legend, so adding
    // or removing an annotation or a note updates the count immediately.
    refreshOverlayCounts();

    updateInfoDims();
    if (!state.canvas.isEmpty()) {
      els.infoStitches.textContent =
        "· " + state.canvas.stitchCount() + " stitches" +
        // Partial stitches and backstitch segments are extra marks in the same
        // chart, so they belong on the same readout as the stitch count.
        (stitchTypeText() ? " " + stitchTypeText() : "");
      els.infoColors.textContent =
        "· " + state.canvas.colorCount() + " colours";
    }
    // Painting changes the stitch total, which shifts the progress percentage.
    scheduleProgressUiRefresh();
    updateSelectionUI();
    refreshLocateCount();
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

  // ---------- shade card ----------
  // Every palette colour with its code and nearest DMC floss, so the whole
  // stash can be surveyed at once (the legend lists only the colours in use).
  function buildShadeCard() {
    var host = els.shadeCardBody;
    if (!host) return;
    host.innerHTML = "";
    if (!state.palette.length) {
      host.innerHTML = '<p class="shade-card-empty">Palette not loaded yet.</p>';
      return;
    }
    state.palette.forEach(function (e) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "shade-item";
      item.title = "Paint with " + e.name;
      var dmcHtml =
        flossEnabled() && e.dmc
          ? '<span class="shade-dmc">' +
            escapeHtml(flossBrand() + " " + e.dmc.code) +
            "</span>"
          : "";
      item.innerHTML =
        '<span class="shade-swatch" style="background:' +
        e.hex +
        '"></span>' +
        '<span class="shade-meta">' +
        '<span class="shade-code">' +
        escapeHtml(e.code || "") +
        "</span>" +
        '<span class="shade-name">' +
        escapeHtml(e.name || "") +
        "</span>" +
        dmcHtml +
        "</span>";
      item.addEventListener("click", function () {
        selectColor(e.index);
        closeShadeCard();
      });
      host.appendChild(item);
    });
  }

  function openShadeCard() {
    if (!els.shadeCardModal) return;
    buildShadeCard();
    els.shadeCardModal.classList.add("active");
    els.shadeCardModal.setAttribute("aria-hidden", "false");
    if (els.shadeCardClose) els.shadeCardClose.focus();
  }

  function closeShadeCard() {
    if (!els.shadeCardModal) return;
    els.shadeCardModal.classList.remove("active");
    els.shadeCardModal.setAttribute("aria-hidden", "true");
    if (els.shadeCardBtn) els.shadeCardBtn.focus();
  }

  // ---------- locate / spotlight ----------
  // Dim the chart and ring every stitch of the selected colour (or every stitch
  // sharing the selected colour's symbol). Drawn by the canvas outside
  // drawChart, so it is a view aid only and never reaches an export.
  function locateValue() {
    if (state.selectedIndex < 0) return null;
    return state.locateMode === "symbol"
      ? state.canvas.glyphFor(state.selectedIndex)
      : state.selectedIndex;
  }

  function applySpotlight() {
    if (!state.canvas) return;
    if (!els.toggleLocate.checked) {
      state.canvas.clearSpotlight();
      return;
    }
    var value = locateValue();
    if (value === null) {
      els.toggleLocate.checked = false;
      toast("Pick a colour to locate first", "warn");
      state.canvas.clearSpotlight();
      return;
    }
    state.canvas.setSpotlight({ kind: state.locateMode, value: value });
  }

  function refreshLocateCount() {
    if (!els.locateCount || !state.canvas) return;
    if (!state.canvas.hasSpotlight()) {
      els.locateCount.textContent = "\u2014";
      return;
    }
    var n = state.canvas.spotlightCount();
    els.locateCount.textContent = n + (n === 1 ? " stitch" : " stitches");
  }

  function updateLocateUI() {
    refreshLocateCount();
  }

  function setLocateMode(mode) {
    state.locateMode = mode === "symbol" ? "symbol" : "colour";
    els.locateByColour.classList.toggle("active", state.locateMode === "colour");
    els.locateBySymbol.classList.toggle("active", state.locateMode === "symbol");
    if (els.toggleLocate.checked) applySpotlight();
  }

  function clearLocate() {
    els.toggleLocate.checked = false;
    if (state.canvas) state.canvas.clearSpotlight();
    syncToolOptions();
  }

  /** Centre the chart on a cell (used by "Next unstitched"). */
  function scrollToCell(cell) {
    if (!cell || !els.canvasWrap || !state.canvas) return;
    var s = state.canvas.cellSize;
    var wrap = els.canvasWrap;
    wrap.scrollLeft = cell.c * s - wrap.clientWidth / 2 + s / 2;
    wrap.scrollTop = cell.r * s - wrap.clientHeight / 2 + s / 2;
  }

  function locateNextUnstitched() {
    if (!state.canvas || !state.canvas.hasSpotlight()) {
      toast("Turn Locate on first", "warn");
      return;
    }
    var cell = state.canvas.nextUnstitched();
    if (!cell) {
      toast("No unstitched stitches of this colour left", "ok");
      return;
    }
    scrollToCell(cell);
  }

  // ---------- tools ----------
  function setMode(mode) {
    state.canvas.setMode(mode);
    els.toolPaint.classList.toggle("active", mode === "paint");
    els.toolErase.classList.toggle("active", mode === "erase");
    els.toolFill.classList.toggle("active", mode === "fill");
    els.toolPick.classList.toggle("active", mode === "pick");
    els.toolBack.classList.toggle("active", mode === "back");
    els.toolAnnot.classList.toggle("active", mode === "annotate");
    els.toolNote.classList.toggle("active", mode === "note");
    els.toolProgress.classList.toggle("active", mode === "progress");
    els.toolSelect.classList.toggle("active", mode === "select");
    els.toolOverlay.classList.toggle("active", mode === "overlay");
    // Picking the tracker turns the view ON. Marks are recorded whether or not
    // the overlay is showing, so without this you could mark stitches and see
    // nothing at all — the single most confusing way to meet the feature.
    if (mode === "progress" && !state.canvas.progressOn) {
      els.progressOn.checked = true;
      state.canvas.setProgressOn(true);
      scheduleProgressSave();
      updateProgressUI();
    }
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
    // ONLY while the Progress tool is up. It used to stay visible whenever
    // tracking was on, which stacked it under another tool's row and resized the
    // canvas out from under the pointer. Nothing is lost: the live readout moved
    // to the info line under the canvas, where it is visible while you paint.
    els.progressOptions.hidden = mode !== "progress";
    // Alignment is a tool like the others, so its controls follow the tool:
    // they appear with Align and get out of the way for everything else. In
    // chart mode there is no tracing photo — Align seats a PAGE, whose controls
    // live with the page list instead of here.
    els.overlayOptions.hidden = mode !== "overlay" || state.docKind === "chart";
    // The markup layers bring their own controls, like every other tool.
    if (els.annotOptions) els.annotOptions.hidden = mode !== "annotate";
    if (els.noteOptions) els.noteOptions.hidden = mode !== "note";
    // The locate row stays up while locating, regardless of the active tool.
    els.locateOptions.hidden = !els.toggleLocate.checked;
    syncToolContextual(mode);
    syncOptionsBar();
  }

  /**
   * Show the toolbar controls that only apply to some tools, and hide the rest.
   * Size and Stitch-place change what a click LAYS DOWN, so they only mean
   * something to the tools that place stitches; showing them while Annotating is
   * noise. The Trace cluster is only useful to the Align tool, which is the only
   * one that can move the photo.
   *
   * All of it lives in the RIGHT-hand zone, so none of this coming and going can
   * move the static tools on the left.
   */
  function syncToolContextual(mode) {
    var places = mode === "paint" || mode === "fill" || mode === "erase";
    var parts = mode === "paint" || mode === "fill" || mode === "back";
    if (els.brushGroup) els.brushGroup.hidden = !places;
    if (els.stitchPlaceGroup) els.stitchPlaceGroup.hidden = !parts;
    // The cluster exists only to hold those two, so it goes when they both do -
    // otherwise it would be a label and a divider rule around nothing.
    if (els.stitchCluster) {
      els.stitchCluster.hidden = !places && !parts;
    }
    if (els.overlayGroup) {
      // The Trace cluster is only useful to Align - but it is ALSO the only way to
      // load a photo, and the Align button stays disabled until one is loaded. So
      // it remains in the row while there is no photo yet, and steps aside once
      // there is one (you are then either aligning it or not).
      var hasPhoto = !!state.overlay;
      els.overlayGroup.hidden =
        state.docKind === "chart" || (mode !== "overlay" && hasPhoto);
    }
    // With nothing left to show, the zone itself goes: an empty right-hand block
    // would still draw its divider rule. The static zone is never touched.
    if (els.toolbarDynamic) {
      var stitchShown = els.stitchCluster && !els.stitchCluster.hidden;
      var traceShown = els.overlayGroup && !els.overlayGroup.hidden;
      els.toolbarDynamic.hidden = !stitchShown && !traceShown;
    }
  }

  /** The View popover: one button, closed by Escape or a click anywhere else. */
  function setViewMenuOpen(open) {
    if (!els.viewMenu || !els.viewBtn) return;
    els.viewMenu.hidden = !open;
    els.viewBtn.setAttribute("aria-expanded", open ? "true" : "false");
    els.viewBtn.classList.toggle("active", !!open);
  }

  /**
   * The options bar exists only while one of its rows does. Below the toolbar the
   * canvas is the flexible element, so an empty bar would be a band of nothing
   * pushing the chart down - and the rows themselves are the single source of
   * truth for whether anything applies.
   */
  function syncOptionsBar() {
    if (!els.optionsBar) return;
    var rows = [
      els.selectOptions,
      els.progressOptions,
      els.annotOptions,
      els.noteOptions,
      els.locateOptions,
      els.overlayOptions,
    ];
    var any = false;
    rows.forEach(function (row) {
      if (row && !row.hidden) any = true;
    });
    els.optionsBar.hidden = !any;
  }

  /** The readouts are editable number fields, so both sides get the value. */
  function setRange(input, field, value) {
    input.value = value;
    field.value = value;
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  /** Mirror the canvas alignment back into the controls (drag handles included). */
  function syncOverlayControls() {
    if (!state.canvas || !els.ovScaleX) return;
    var a = state.canvas.overlayAdjust();
    setRange(els.ovScaleX, els.ovScaleXVal, round2(a.scaleX * 100));
    setRange(els.ovScaleY, els.ovScaleYVal, round2(a.scaleY * 100));
    setRange(els.ovOffsetX, els.ovOffsetXVal, round2(a.offsetX * 100));
    setRange(els.ovOffsetY, els.ovOffsetYVal, round2(a.offsetY * 100));
    if (els.ovSpanVal) {
      els.ovSpanVal.textContent = a.spanX
        ? round2(a.spanX) + " \u00d7 " + round2(a.spanY)
        : "\u2014";
    }
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
    var layers = designLayers();
    var overlays = designOverlays();
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
      body: JSON.stringify({
        title: title,
        grid: design.grid,
        notes: state.notes,
        kind: state.docKind,
        source: state.docKind === "chart" ? state.source : null,
        pages: state.docKind === "chart" ? pageDescriptors() : null,
        // STITCH TYPES: the mark each cell carries, and the outlines on the cell
        // borders. Omitted entirely when a design uses neither, so an ordinary
        // pattern's document looks exactly as it always did.
        frac: layers.frac,
        back: layers.back,
        // BLENDS: the partner floss of every cell stitched with two flosses
        // held together. Also omitted when unused.
        blend: layers.blend,
        // Your own reminders about the chart. They never print, but they are
        // part of the document, so they travel with it.
        annots: overlays.annots,
        cellNotes: overlays.cellNotes,
      }),
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
        var pl = docLayers(p, p.width, p.height);
        state.canvas.loadGrid(
          p.width, p.height, p.grid, pl.frac, pl.back, pl.blend,
        );
        applyOverlays(p);
        syncGridInputs(p.width, p.height);
        state.currentProjectId = p.id;
        els.projectTitle.value = p.title;
        setNotes(p.notes || "");
        restoreProjectKind(p, true);
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
    var layers = designLayers();
    var overlays = designOverlays();
    // The same rows the legend shows, so an export cannot disagree with what the
    // user read on screen.
    var legend = legendRows().map(function (r) {
      return {
        index: r.index,
        code: r.code,
        name: r.name,
        hex: r.hex,
        count: r.count,
        // A shopping list needs backstitch as its own line: a chart outlined in
        // one floss but stitched in another needs both on the order.
        backstitch: r.back || 0,
        skeins: r.skeins || 0,
        dmc: r.dmc ? { code: r.dmc.code, name: r.dmc.name } : null,
      };
    });
    var doc = {
      app: "cross-canvas-art",
      version: 1,
      title: els.projectTitle.value.trim() || "Untitled Design",
      notes: state.notes,
      kind: state.docKind,
      // The image BYTES are never exported (IndexedDB only): a chart export
      // carries the page geometry + names so it can be re-linked locally.
      source: state.docKind === "chart" ? state.source : null,
      pages: state.docKind === "chart" ? pageDescriptors() : null,
      // Stitch-type layers, run-length encoded so a sparse outline stays small.
      frac: layers.frac,
      back: layers.back,
      blend: layers.blend,
      // Annotations and per-cell notes (on-screen only, but saved).
      annots: overlays.annots,
      cellNotes: overlays.cellNotes,
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
        var jl = docLayers(doc, doc.width, doc.height);
        state.canvas.loadGrid(
          doc.width, doc.height, doc.grid, jl.frac, jl.back, jl.blend,
        );
        applyOverlays(doc);
        syncGridInputs(doc.width, doc.height);
        state.currentProjectId = null;
        if (doc.title) els.projectTitle.value = doc.title;
        setNotes(doc.notes || "");
        restoreProjectKind(doc, true);
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
          $("sourceChart").hidden = tab !== "chart";
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

    // import an existing chart (markup mode)
    els.chartDropZone.addEventListener("click", function () {
      els.chartInput.click();
    });
    els.chartDropZone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        els.chartInput.click();
      }
    });
    els.chartInput.addEventListener("change", function () {
      if (this.files.length) onChartSelected(this.files);
    });
    ["dragover", "dragenter"].forEach(function (ev) {
      els.chartDropZone.addEventListener(ev, function (e) {
        e.preventDefault();
        els.chartDropZone.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      els.chartDropZone.addEventListener(ev, function (e) {
        e.preventDefault();
        els.chartDropZone.classList.remove("dragover");
      });
    });
    els.chartDropZone.addEventListener("drop", function (e) {
      if (e.dataTransfer.files.length) onChartSelected(e.dataTransfer.files);
    });
    els.chartImportBtn.addEventListener("click", importChart);
    els.readChartBtn.addEventListener("click", readChart);
    els.chartConvertBtn.addEventListener("click", convertChartToPattern);
    els.chartShow.addEventListener("change", function () {
      state.canvas.setOverlayOn(this.checked);
    });

    // chart pages
    els.addPageBtn.addEventListener("click", function () {
      els.addPageInput.click();
    });
    els.addPageInput.addEventListener("change", function () {
      if (this.files.length) addChartPages(this.files);
    });
    els.joinRightBtn.addEventListener("click", function () {
      joinActivePage("right");
    });
    els.joinBelowBtn.addEventListener("click", function () {
      joinActivePage("below");
    });
    els.pageRotateBtn.addEventListener("click", rotateActivePage);
    els.pageRemoveBtn.addEventListener("click", removeActivePage);
    [
      [els.pageCol, "col"],
      [els.pageRow, "row"],
      [els.pageCols, "cols"],
      [els.pageRows, "rows"],
    ].forEach(function (pair) {
      pair[0].addEventListener("change", function () {
        var part = {};
        part[pair[1]] = parseFloat(this.value);
        setActivePageGeometry(part);
      });
    });
    // One delegated listener for the whole list, so reordering pages does not
    // need a handler per row that has to be rebuilt with it.
    els.pagesList.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var orderBtn = t.closest("button[data-act]");
      if (orderBtn) {
        moveActivePage(orderBtn.getAttribute("data-act") === "up" ? -1 : 1);
        return;
      }
      var item = t.closest(".page-item");
      if (item) setActivePage(parseInt(item.getAttribute("data-index"), 10));
    });
    els.pagesList.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var t = e.target;
      if (!t || !t.closest) return;
      var item = t.closest(".page-item");
      if (!item) return;
      e.preventDefault();
      setActivePage(parseInt(item.getAttribute("data-index"), 10));
    });

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
    els.toolPick.addEventListener("click", function () {
      setMode("pick");
    });
    els.toolBack.addEventListener("click", function () {
      setMode("back");
    });
    els.toolAnnot.addEventListener("click", function () {
      setMode("annotate");
    });
    els.toolNote.addEventListener("click", function () {
      setMode("note");
    });

    // Annotations: a shape to drag out, or a label to click down.
    [
      [els.annotArrow, "arrow"],
      [els.annotEllipse, "ellipse"],
      [els.annotRect, "rect"],
      [els.annotLabel, "text"],
    ].forEach(function (pair) {
      pair[0].addEventListener("click", function () {
        setAnnotKind(pair[1]);
      });
    });
    els.annotText.addEventListener("input", function () {
      state.annotText = this.value;
      state.canvas.setAnnotText(this.value);
    });
    els.annotClearBtn.addEventListener("click", function () {
      if (!state.canvas.clearAnnotations()) return;
      state.canvas._pushHistory();
      markDirty();
      refreshOverlayCounts();
      toast("Annotations cleared", "ok");
    });

    // Per-cell notes: click a stitch to load its note, then Save or Clear.
    els.noteSaveBtn.addEventListener("click", commitNote);
    els.noteClearBtn.addEventListener("click", function () {
      if (!state.noteCell) return;
      if (state.canvas.setCellNote(state.noteCell.r, state.noteCell.c, "")) {
        els.noteInput.value = "";
        state.canvas._pushHistory();
        markDirty();
        refreshOverlayCounts();
        toast("Note cleared", "ok");
      }
    });
    els.noteInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        commitNote();
      }
    });
    // Clicking a stitch with the Note tool loads that cell's note into the box.
    els.stitchCanvas.addEventListener("click", function (e) {
      if (state.canvas.mode !== "note") return;
      var cell = state.canvas._cellFromEvent(e);
      if (!cell) return;
      state.noteCell = { r: cell.r, c: cell.c };
      els.noteInput.value = state.canvas.cellNoteAt(cell.r, cell.c);
      els.noteInput.focus();
    });
    // Stitch type: what the paint, fill and erase tools lay down. A partial
    // stitch keeps the cell's colour, so it still counts, legends and estimates
    // exactly like a full cross.
    els.stitchPart.addEventListener("change", function () {
      setStitchPart(parseInt(this.value, 10) || 0);
    });
    // Blended threads: two flosses held together in one stitch.
    if (els.blendOn) {
      els.blendOn.addEventListener("change", function () {
        setBlendOn(this.checked);
      });
    }
    if (els.blendWith) {
      els.blendWith.addEventListener("change", function () {
        setBlendPartner(parseInt(this.value, 10));
        // Choosing a second floss IS the intent to blend, so the box follows.
        if (state.blendIndex >= 0 && !els.blendOn.checked) setBlendOn(true);
      });
    }
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
      // Escape closes the View popover from anywhere, including with an empty
      // canvas (which returns early further down).
      if (e.key === "Escape" && els.viewMenu && !els.viewMenu.hidden) {
        setViewMenuOpen(false);
        return;
      }
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
      // In Align mode the arrows nudge the tracing photo (Shift = 10x), which is
      // the finest way to seat it on the chart's cells. Otherwise they nudge a
      // selection, as before.
      if (state.canvas.mode === "overlay" && e.key.indexOf("Arrow") === 0) {
        e.preventDefault();
        var odr = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
        var odc = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
        // In chart mode Align moves the ACTIVE PAGE a cell at a time; otherwise
        // it nudges the tracing photo, as before.
        if (state.pages.length) {
          nudgeActivePage(odc, odr, e.shiftKey ? 10 : 1);
        } else {
          state.canvas.nudgeOverlay(odc, odr, e.shiftKey ? 10 : 1);
        }
        return;
      }
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

    // View popover: one button for the display toggles. A click outside or Escape
    // closes it; clicking a checkbox inside deliberately does NOT, so several can
    // be changed in a row.
    if (els.viewBtn && els.viewMenu) {
      els.viewBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        setViewMenuOpen(els.viewMenu.hidden);
      });
      els.viewMenu.addEventListener("click", function (e) {
        e.stopPropagation();
      });
      document.addEventListener("click", function () {
        setViewMenuOpen(false);
      });
    }

    // locate / spotlight
    els.toggleLocate.addEventListener("change", function () {
      applySpotlight();
      syncToolOptions();
    });
    els.locateByColour.addEventListener("click", function () {
      setLocateMode("colour");
    });
    els.locateBySymbol.addEventListener("click", function () {
      setLocateMode("symbol");
    });
    els.locateNextBtn.addEventListener("click", locateNextUnstitched);
    els.locateClearBtn.addEventListener("click", clearLocate);

    // progress tracker
    els.toolProgress.addEventListener("click", function () {
      setMode("progress");
    });
    els.toolOverlay.addEventListener("click", function () {
      setMode("overlay");
    });
    // Photo alignment: presets, plus one coarse slider and one precise number
    // box per axis, so a photo that is a few percent too narrow can be seated
    // exactly on the chart's cells.
    els.ovFitBtn.addEventListener("click", function () {
      state.canvas.fitOverlay();
    });
    els.ovStretchBtn.addEventListener("click", function () {
      state.canvas.stretchOverlay();
    });
    els.ovCenterBtn.addEventListener("click", function () {
      state.canvas.centerOverlay();
    });
    [
      [els.ovScaleX, els.ovScaleXVal, "scaleX"],
      [els.ovScaleY, els.ovScaleYVal, "scaleY"],
      [els.ovOffsetX, els.ovOffsetXVal, "offsetX"],
      [els.ovOffsetY, els.ovOffsetYVal, "offsetY"],
    ].forEach(function (trio) {
      var rangeEl = trio[0];
      var numEl = trio[1];
      var key = trio[2];
      var apply = function (percent) {
        var part = {};
        part[key] = percent / 100;
        state.canvas.setOverlayAdjust(part);
      };
      rangeEl.addEventListener("input", function () {
        apply(parseFloat(this.value) || 0);
      });
      // Typed values commit on Enter/blur rather than per keystroke, so a
      // half-typed "1" never yanks the photo around mid-edit.
      numEl.addEventListener("change", function () {
        var v = parseFloat(this.value);
        if (isNaN(v)) {
          syncOverlayControls();
          return;
        }
        apply(Math.max(-1000, Math.min(1000, v)));
      });
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
    els.projectNotes.addEventListener("input", function () {
      state.notes = this.value;
      markDirty();
    });
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

    // shade card
    els.shadeCardBtn.addEventListener("click", openShadeCard);
    els.shadeCardClose.addEventListener("click", closeShadeCard);
    els.shadeCardModal.addEventListener("click", function (e) {
      if (e.target === els.shadeCardModal) closeShadeCard();
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
      onOverlayChange: function () {
        syncOverlayControls();
        // Re-seating an imported chart's artwork is an edit, so it must be saved
        // like any other change.
        if (state.docKind === "chart") markDirty();
      },
      onSpotlightChange: function () {
        updateLocateUI();
      },
      onPick: function (index) {
        // Eyedropper: adopt the colour but STAY in the tool, so several colours
        // can be picked one after another.
        selectColor(index, true);
        var e = state.paletteByIndex[index];
        toast("Picked " + (e ? e.name : "colour"), "ok");
      },
      onPageChange: function (index, geom) {
        // A page is being dragged: mirror it into the page list live, but do NOT
        // re-fit the grid mid-drag (that would shift the page under the pointer).
        var p = state.pages[index];
        if (!p) return;
        if (typeof geom.col === "number") p.col = geom.col;
        if (typeof geom.row === "number") p.row = geom.row;
        if (typeof geom.cols === "number") p.cols = Math.max(1, geom.cols);
        if (typeof geom.rows === "number") p.rows = Math.max(1, geom.rows);
        syncPageControls();
      },
      onPageCommit: function () {
        // Drag finished: now grow/re-origin the grid so it contains the chart.
        var capped = fitGridToPages();
        syncGridInputs(state.canvas.width, state.canvas.height);
        syncPagesToCanvas();
        refreshPagesUI();
        if (capped) toast("The canvas is at its 500-stitch limit", "warn");
        markDirty();
      },
    });
    initFeatureFlags();
    bind();
    // Mirror the default stitch type into the readout and the canvas, so the two
    // are never out of step on a fresh page.
    setStitchPart(0);
    setAnnotKind("arrow");
    refreshOverlayCounts();
    updateSelectionUI();
    syncToolOptions();
    loadConfig();
    loadProjects();
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
