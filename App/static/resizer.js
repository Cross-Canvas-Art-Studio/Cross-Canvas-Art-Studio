/**
 * resizer.js - client-side image resizer / compressor (Cross Canvas Art Studio).
 *
 * All processing happens in the browser via the Canvas API. Resizes to a target
 * width/height (with optional aspect-ratio lock), quick percentage presets,
 * pixel-perfect (nearest-neighbour) upscaling, and PNG / JPEG / WEBP export with
 * a live estimated file size.
 */
(function () {
  "use strict";

  var els = {};
  function $(id) {
    return document.getElementById(id);
  }

  var MAX_DIM = 8192;

  var state = {
    sourceCanvas: null,
    outputCanvas: null,
    fileName: "",
    fileSize: 0,
    width: 0,
    height: 0,
    lockAspect: false,
    pixelPerfect: false,
    format: "png",
    quality: 0.92,
    zoom: 1,
    fitScale: 1,
  };

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function baseName(name) {
    return (name || "image").replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-");
  }
  function fmtBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  }

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

  function cacheEls() {
    [
      "dropZone", "imageInput", "uploadPreview", "removeImageBtn",
      "width", "height", "arLockBtn", "arLockIcon", "arLockShackle",
      "scalePresets", "pixelPerfectToggle",
      "format", "qualityRow", "quality", "qualityVal",
      "zoomOut", "zoomIn", "zoomLevel", "zoomFit",
      "canvasWrap", "canvasEmpty", "pixelStage", "displayCanvas",
      "infoOriginal", "infoOutput", "infoEstimate",
      "exportDimsHint", "exportSizeHint", "downloadBtn", "downloadOrigBtn",
      "toast", "helpBtn", "helpModal", "helpClose", "footerYear",
    ].forEach(function (id) {
      els[id] = $(id);
    });
  }

  // ---------- image loading ----------
  function loadFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      toast("Please choose an image file", "error");
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        state.fileName = file.name;
        state.fileSize = file.size || 0;
        var c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        state.sourceCanvas = c;
        state.width = c.width;
        state.height = c.height;
        els.width.value = c.width;
        els.height.value = c.height;
        onImageReady();
        rebuild();
      };
      img.onerror = function () {
        toast("Could not read that image", "error");
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function onImageReady() {
    els.uploadPreview.src = state.sourceCanvas.toDataURL("image/png");
    els.uploadPreview.hidden = false;
    els.removeImageBtn.hidden = false;
    els.canvasEmpty.style.display = "none";
    els.pixelStage.hidden = false;
    els.downloadBtn.disabled = false;
    els.downloadOrigBtn.disabled = false;
  }

  function removeImage() {
    state.sourceCanvas = null;
    state.outputCanvas = null;
    state.fileName = "";
    state.fileSize = 0;
    els.uploadPreview.hidden = true;
    els.uploadPreview.removeAttribute("src");
    els.removeImageBtn.hidden = true;
    els.pixelStage.hidden = true;
    els.canvasEmpty.style.display = "flex";
    els.downloadBtn.disabled = true;
    els.downloadOrigBtn.disabled = true;
    els.infoOriginal.textContent = "\u2014";
    els.infoOutput.textContent = "";
    els.infoEstimate.textContent = "";
    els.exportDimsHint.textContent = "\u2014";
    els.exportSizeHint.textContent = "";
  }

  // ---------- output ----------
  function outputDims() {
    return {
      w: clamp(parseInt(els.width.value, 10) || 0, 1, MAX_DIM),
      h: clamp(parseInt(els.height.value, 10) || 0, 1, MAX_DIM),
    };
  }

  function aspect() {
    return state.sourceCanvas
      ? state.sourceCanvas.width / state.sourceCanvas.height
      : 1;
  }

  function rebuild() {
    if (!state.sourceCanvas) return;
    var d = outputDims();
    var out = document.createElement("canvas");
    out.width = d.w;
    out.height = d.h;
    var ctx = out.getContext("2d");
    ctx.imageSmoothingEnabled = !state.pixelPerfect;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(state.sourceCanvas, 0, 0, d.w, d.h);
    state.outputCanvas = out;
    render();
    updateInfo();
    estimateSize();
  }

  function estimateSize() {
    if (!state.outputCanvas) return;
    var mime = "image/" + state.format;
    state.outputCanvas.toBlob(function (blob) {
      var size = blob ? blob.size : 0;
      els.infoEstimate.textContent = size ? "\u2248 " + fmtBytes(size) : "";
      els.exportSizeHint.textContent = size
        ? "Estimated size: " + fmtBytes(size)
        : "";
    }, mime, state.quality);
  }

  // ---------- display ----------
  function computeFit() {
    var wrap = els.canvasWrap;
    var availW = Math.max(80, wrap.clientWidth - 24);
    var availH = Math.max(80, wrap.clientHeight - 24);
    var aspect = state.outputCanvas.width / state.outputCanvas.height;
    var w = availW;
    var h = w / aspect;
    if (h > availH) {
      h = availH;
      w = h * aspect;
    }
    state.fitScale = w / state.outputCanvas.width;
  }

  function render() {
    if (!state.sourceCanvas || !state.outputCanvas) return;
    computeFit();
    var sw = state.outputCanvas.width;
    var sh = state.outputCanvas.height;
    var cssW = Math.max(1, Math.round(sw * state.fitScale * state.zoom));
    var cssH = Math.max(1, Math.round(sh * state.fitScale * state.zoom));
    els.pixelStage.style.width = cssW + "px";
    els.pixelStage.style.height = cssH + "px";
    var dpr = window.devicePixelRatio || 1;
    els.displayCanvas.width = Math.round(cssW * dpr);
    els.displayCanvas.height = Math.round(cssH * dpr);
    var ctx = els.displayCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = !state.pixelPerfect;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(state.outputCanvas, 0, 0, cssW, cssH);
    els.zoomLevel.textContent =
      state.zoom === 1 ? "Fit" : Math.round(state.zoom * 100) + "%";
  }

  function updateInfo() {
    var d = outputDims();
    var orig =
      state.sourceCanvas.width + " \u00d7 " + state.sourceCanvas.height + " px";
    if (state.fileSize) orig += " \u00b7 " + fmtBytes(state.fileSize);
    els.infoOriginal.textContent = orig;
    els.infoOutput.textContent = "Output " + d.w + " \u00d7 " + d.h + " px";
    els.exportDimsHint.textContent = d.w + " \u00d7 " + d.h + " px \u00b7 " +
      state.format.toUpperCase();
  }

  // ---------- export ----------
  function downloadBlob(blob, filename, msg) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
    toast(msg, "ok");
  }

  function download() {
    if (!state.outputCanvas) return;
    var d = outputDims();
    var mime = "image/" + state.format;
    state.outputCanvas.toBlob(function (blob) {
      if (!blob) {
        toast("Export failed", "error");
        return;
      }
      var ext = state.format === "jpeg" ? "jpg" : state.format;
      downloadBlob(
        blob,
        "resized-" + baseName(state.fileName) + "-" + d.w + "x" + d.h + "." + ext,
        state.format.toUpperCase() + " downloaded",
      );
    }, mime, state.quality);
  }

  function downloadOriginal() {
    if (!state.sourceCanvas) return;
    state.sourceCanvas.toBlob(function (blob) {
      if (!blob) {
        toast("Export failed", "error");
        return;
      }
      downloadBlob(
        blob,
        (state.fileName || "original").replace(/\.[^.]+$/, "") + ".png",
        "Original downloaded",
      );
    }, "image/png");
  }

  // ---------- debounced rebuild ----------
  var rebuildTimer = 0;
  function scheduleRebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, 60);
  }

  // ---------- events ----------
  function bindEvents() {
    els.dropZone.addEventListener("click", function () {
      els.imageInput.click();
    });
    els.dropZone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        els.imageInput.click();
      }
    });
    ["dragenter", "dragover"].forEach(function (ev) {
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
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    els.imageInput.addEventListener("change", function () {
      if (els.imageInput.files && els.imageInput.files[0]) {
        loadFile(els.imageInput.files[0]);
      }
      els.imageInput.value = "";
    });
    els.removeImageBtn.addEventListener("click", removeImage);

    // resize inputs
    els.width.addEventListener("input", function () {
      var w = clamp(parseInt(els.width.value, 10) || 0, 1, MAX_DIM);
      if (state.lockAspect && state.sourceCanvas) {
        els.height.value = Math.round(w / aspect());
      }
      scheduleRebuild();
    });
    els.height.addEventListener("input", function () {
      var h = clamp(parseInt(els.height.value, 10) || 0, 1, MAX_DIM);
      if (state.lockAspect && state.sourceCanvas) {
        els.width.value = Math.round(h * aspect());
      }
      scheduleRebuild();
    });
    els.arLockBtn.addEventListener("click", function () {
      state.lockAspect = !state.lockAspect;
      els.arLockBtn.classList.toggle("locked", state.lockAspect);
      els.arLockBtn.title = state.lockAspect
        ? "Unlock aspect ratio"
        : "Lock aspect ratio";
    });

    // presets
    els.scalePresets.querySelectorAll(".preset-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!state.sourceCanvas) return;
        var pct = parseInt(btn.getAttribute("data-pct"), 10) || 100;
        els.width.value = Math.round((state.sourceCanvas.width * pct) / 100);
        els.height.value = Math.round((state.sourceCanvas.height * pct) / 100);
        els.scalePresets.querySelectorAll(".preset-btn").forEach(function (b) {
          b.classList.toggle("active", b === btn);
        });
        scheduleRebuild();
      });
    });

    els.pixelPerfectToggle.addEventListener("change", function () {
      state.pixelPerfect = els.pixelPerfectToggle.checked;
      scheduleRebuild();
    });

    // format / quality
    els.format.addEventListener("change", function () {
      state.format = els.format.value;
      els.qualityRow.classList.toggle(
        "visible",
        state.format === "jpeg" || state.format === "webp",
      );
      if (state.sourceCanvas) {
        scheduleRebuild();
      }
    });
    els.quality.addEventListener("input", function () {
      state.quality = clamp(parseInt(els.quality.value, 10) || 92, 1, 100) / 100;
      els.qualityVal.textContent = Math.round(state.quality * 100);
      if (state.sourceCanvas) scheduleRebuild();
    });

    // zoom
    els.zoomIn.addEventListener("click", function () {
      state.zoom = clamp(state.zoom * 1.25, 0.1, 16);
      render();
    });
    els.zoomOut.addEventListener("click", function () {
      state.zoom = clamp(state.zoom / 1.25, 0.1, 16);
      render();
    });
    els.zoomFit.addEventListener("click", function () {
      state.zoom = 1;
      render();
    });

    // export
    els.downloadBtn.addEventListener("click", download);
    els.downloadOrigBtn.addEventListener("click", downloadOriginal);

    // help modal
    els.helpBtn.addEventListener("click", function () {
      els.helpModal.classList.add("active");
    });
    els.helpClose.addEventListener("click", function () {
      els.helpModal.classList.remove("active");
    });
    els.helpModal.addEventListener("click", function (e) {
      if (e.target === els.helpModal) els.helpModal.classList.remove("active");
    });

    els.footerYear.textContent = new Date().getFullYear();
    window.addEventListener("resize", function () {
      if (state.outputCanvas) render();
    });
  }

  function init() {
    cacheEls();
    bindEvents();
    // default: PNG -> quality row hidden
    els.qualityRow.classList.remove("visible");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
