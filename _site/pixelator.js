/**
 * pixelator.js - client-side image pixelizer (Cross Canvas Art Studio).
 *
 * Everything runs in the browser via the Canvas API - images are never
 * uploaded. Features:
 *   - adjustable pixel / block size (1-128 px)
 *   - colour-count reduction (median-cut palette, 2-256 colours)
 *   - optional Floyd-Steinberg dithering
 *   - brightness / contrast / saturation pre-adjustment
 *   - draggable before/after split comparison, grid overlay, zoom
 *   - PNG export at pixel-grid or original size
 */
(function () {
  "use strict";

  var els = {};
  function $(id) {
    return document.getElementById(id);
  }

  var MIN_PIXEL = 1;
  var MAX_PIXEL = 128;
  var PRESETS = [4, 8, 16, 32, 64];

  var state = {
    image: null,        // HTMLImageElement
    sourceCanvas: null, // original image at natural size
    adjustedCanvas: null,
    resultCanvas: null, // pixelated result, same size as source
    usedColors: 0,
    fileName: "",
    pixelSize: 16,
    maxColors: 256,
    dither: false,
    brightness: 100,
    contrast: 100,
    saturation: 100,
    view: "split", // 'split' | 'result' | 'original'
    gridOverlay: false,
    zoom: 1, // 1 == fit to viewport
    divider: 50, // percent position of the split handle
    dragging: false,
  };

  // ---------- utilities ----------
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }
  function baseName(name) {
    return (name || "image").replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-");
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
      "pixelSize", "pixelSizeVal", "pixelPresets", "gridDimsHint",
      "maxColors", "maxColorsVal", "ditherToggle",
      "brightness", "brightnessVal", "contrast", "contrastVal",
      "saturation", "saturationVal", "adjustResetBtn",
      "viewSplit", "viewResult", "viewOriginal", "gridOverlayToggle",
      "zoomOut", "zoomIn", "zoomLevel", "zoomFit",
      "canvasWrap", "canvasEmpty", "pixelStage", "displayCanvas",
      "compareDivider", "compareHint",
      "infoOriginal", "infoGrid", "infoBlock", "infoColors",
      "exportScale", "exportDimsHint", "downloadPngBtn", "downloadOrigBtn",
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
        state.image = img;
        state.fileName = file.name;
        var c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        state.sourceCanvas = c;
        onImageReady();
        pixelate();
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
    els.downloadPngBtn.disabled = false;
    els.downloadOrigBtn.disabled = false;
  }

  function removeImage() {
    state.image = null;
    state.sourceCanvas = null;
    state.adjustedCanvas = null;
    state.resultCanvas = null;
    state.usedColors = 0;
    state.fileName = "";
    els.uploadPreview.hidden = true;
    els.uploadPreview.removeAttribute("src");
    els.removeImageBtn.hidden = true;
    els.pixelStage.hidden = true;
    els.canvasEmpty.style.display = "flex";
    els.downloadPngBtn.disabled = true;
    els.downloadOrigBtn.disabled = true;
    els.infoOriginal.textContent = "\u2014";
    els.infoGrid.textContent = "";
    els.infoBlock.textContent = "";
    els.infoColors.textContent = "";
    els.gridDimsHint.textContent = "Grid: \u2014";
    els.exportDimsHint.textContent = "\u2014";
  }

  // ---------- pixelation pipeline ----------
  function gridSize() {
    if (!state.sourceCanvas) return { w: 0, h: 0 };
    return {
      w: Math.max(1, Math.round(state.sourceCanvas.width / state.pixelSize)),
      h: Math.max(1, Math.round(state.sourceCanvas.height / state.pixelSize)),
    };
  }

  function buildAdjustedCanvas() {
    var c = document.createElement("canvas");
    c.width = state.sourceCanvas.width;
    c.height = state.sourceCanvas.height;
    var ctx = c.getContext("2d");
    ctx.filter =
      "brightness(" + state.brightness + "%) " +
      "contrast(" + state.contrast + "%) " +
      "saturate(" + state.saturation + "%)";
    ctx.drawImage(state.sourceCanvas, 0, 0);
    state.adjustedCanvas = c;
  }

  function pixelate() {
    if (!state.sourceCanvas) return;
    buildAdjustedCanvas();
    var g = gridSize();

    // 1. Downscale to the pixel grid (bilinear => average of each block).
    var tmp = document.createElement("canvas");
    tmp.width = g.w;
    tmp.height = g.h;
    var tctx = tmp.getContext("2d", { willReadFrequently: true });
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(state.adjustedCanvas, 0, 0, g.w, g.h);

    // 2. Reduce colours (with optional dithering).
    quantizeCanvas(tmp, state.maxColors, state.dither);
    state.usedColors = countColors(tmp);

    // 3. Upscale back to source size with crisp (nearest-neighbour) blocks.
    var res = document.createElement("canvas");
    res.width = state.sourceCanvas.width;
    res.height = state.sourceCanvas.height;
    var rctx = res.getContext("2d");
    rctx.imageSmoothingEnabled = false;
    rctx.drawImage(tmp, 0, 0, res.width, res.height);
    state.resultCanvas = res;

    render();
    updateInfo();
  }

  // ---------- colour quantization ----------
  function quantizeCanvas(canvas, maxColors, dither) {
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var d = imgData.data;
    var w = canvas.width;
    var h = canvas.height;
    var n = w * h;

    // Collect opaque samples for the palette (capped for speed).
    var samples = [];
    var step = Math.max(1, Math.floor(n / 40000));
    for (var i = 0; i < n; i += step) {
      var o = i * 4;
      if (d[o + 3] >= 128) samples.push([d[o], d[o + 1], d[o + 2]]);
    }
    var palette = samples.length
      ? medianCut(samples, clamp(maxColors, 2, 256))
      : [[0, 0, 0]];

    if (dither) {
      var err = new Float32Array(n * 3);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var idx = (y * w + x) * 4;
          if (d[idx + 3] < 128) {
            d[idx] = 0; d[idx + 1] = 0; d[idx + 2] = 0; d[idx + 3] = 0;
            continue;
          }
          var eo = (y * w + x) * 3;
          var r = clamp255(d[idx] + err[eo]);
          var g = clamp255(d[idx + 1] + err[eo + 1]);
          var b = clamp255(d[idx + 2] + err[eo + 2]);
          var c = nearestColor(palette, r, g, b);
          d[idx] = c[0]; d[idx + 1] = c[1]; d[idx + 2] = c[2];
          var qr = r - c[0], qg = g - c[1], qb = b - c[2];
          if (x + 1 < w) {
            var e1 = eo + 3;
            err[e1] += qr * 0.4375; err[e1 + 1] += qg * 0.4375; err[e1 + 2] += qb * 0.4375;
          }
          if (y + 1 < h) {
            if (x > 0) {
              var e2 = eo + w * 3 - 3;
              err[e2] += qr * 0.1875; err[e2 + 1] += qg * 0.1875; err[e2 + 2] += qb * 0.1875;
            }
            var e3 = eo + w * 3;
            err[e3] += qr * 0.3125; err[e3 + 1] += qg * 0.3125; err[e3 + 2] += qb * 0.3125;
            if (x + 1 < w) {
              var e4 = eo + w * 3 + 3;
              err[e4] += qr * 0.0625; err[e4 + 1] += qg * 0.0625; err[e4 + 2] += qb * 0.0625;
            }
          }
        }
      }
    } else {
      for (var j = 0; j < n; j++) {
        var p = j * 4;
        if (d[p + 3] < 128) {
          d[p] = 0; d[p + 1] = 0; d[p + 2] = 0; d[p + 3] = 0;
          continue;
        }
        var cc = nearestColor(palette, d[p], d[p + 1], d[p + 2]);
        d[p] = cc[0]; d[p + 1] = cc[1]; d[p + 2] = cc[2];
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function nearestColor(palette, r, g, b) {
    var best = palette[0];
    var bestD = Infinity;
    for (var i = 0; i < palette.length; i++) {
      var c = palette[i];
      var dr = r - c[0], dg = g - c[1], db = b - c[2];
      var dist = dr * dr + dg * dg + db * db;
      if (dist < bestD) {
        bestD = dist;
        best = c;
        if (dist === 0) break;
      }
    }
    return best;
  }

  function bucketRange(b) {
    var minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
    for (var i = 0; i < b.length; i++) {
      var c = b[i];
      if (c[0] < minR) minR = c[0]; if (c[0] > maxR) maxR = c[0];
      if (c[1] < minG) minG = c[1]; if (c[1] > maxG) maxG = c[1];
      if (c[2] < minB) minB = c[2]; if (c[2] > maxB) maxB = c[2];
    }
    return [maxR - minR, maxG - minG, maxB - minB];
  }

  function medianCut(samples, maxColors) {
    var buckets = [samples];
    while (buckets.length < maxColors) {
      var bi = -1, bestW = -1;
      for (var i = 0; i < buckets.length; i++) {
        var b = buckets[i];
        if (b.length < 2) continue;
        var rng = bucketRange(b);
        var w = Math.max(rng[0], rng[1], rng[2]);
        if (w > bestW) { bestW = w; bi = i; }
      }
      if (bi < 0) break;
      var bucket = buckets.splice(bi, 1)[0];
      var rr = bucketRange(bucket);
      var axis = rr[0] >= rr[1] && rr[0] >= rr[2] ? 0 : rr[1] >= rr[2] ? 1 : 2;
      bucket.sort(function (a, b2) { return a[axis] - b2[axis]; });
      var mid = Math.floor(bucket.length / 2);
      buckets.push(bucket.slice(0, mid), bucket.slice(mid));
    }
    var pal = [];
    buckets.forEach(function (b) {
      if (!b.length) return;
      var r = 0, g = 0, bl = 0;
      for (var i = 0; i < b.length; i++) {
        r += b[i][0]; g += b[i][1]; bl += b[i][2];
      }
      pal.push([Math.round(r / b.length), Math.round(g / b.length), Math.round(bl / b.length)]);
    });
    return pal;
  }

  function countColors(canvas) {
    var d = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
    var set = Object.create(null);
    var count = 0;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      var key = d[i] + "," + d[i + 1] + "," + d[i + 2];
      if (!set[key]) { set[key] = 1; count++; }
    }
    return count;
  }

  // ---------- display ----------
  function computeFit() {
    var wrap = els.canvasWrap;
    var availW = Math.max(80, wrap.clientWidth - 24);
    var availH = Math.max(80, wrap.clientHeight - 24);
    var aspect = state.sourceCanvas.width / state.sourceCanvas.height;
    var w = availW;
    var h = w / aspect;
    if (h > availH) {
      h = availH;
      w = h * aspect;
    }
    state.fitScale = w / state.sourceCanvas.width;
  }

  function drawGrid(ctx, ds, x0, x1, cssH) {
    var step = state.pixelSize * ds;
    if (step < 4) return; // too dense to be useful
    ctx.strokeStyle = "rgba(0,0,0,0.30)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var gx = 0; gx * step <= x1 + 0.5; gx++) {
      var px = Math.round(gx * step) + 0.5;
      if (px >= x0 - 0.5) {
        ctx.moveTo(px, 0);
        ctx.lineTo(px, cssH);
      }
    }
    for (var gy = 0; gy * step <= cssH + 0.5; gy++) {
      var py = Math.round(gy * step) + 0.5;
      ctx.moveTo(x0, py);
      ctx.lineTo(x1, py);
    }
    ctx.stroke();
  }

  function render() {
    if (!state.sourceCanvas || !state.resultCanvas) return;
    computeFit();
    var srcW = state.sourceCanvas.width;
    var srcH = state.sourceCanvas.height;
    var cssW = Math.max(1, Math.round(srcW * state.fitScale * state.zoom));
    var cssH = Math.max(1, Math.round(srcH * state.fitScale * state.zoom));

    els.pixelStage.style.width = cssW + "px";
    els.pixelStage.style.height = cssH + "px";

    var dpr = window.devicePixelRatio || 1;
    els.displayCanvas.width = Math.round(cssW * dpr);
    els.displayCanvas.height = Math.round(cssH * dpr);
    var ctx = els.displayCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var ds = cssW / srcW;
    var x = (cssW * state.divider) / 100;

    if (state.view === "original") {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(state.sourceCanvas, 0, 0, cssW, cssH);
      els.compareDivider.hidden = true;
    } else if (state.view === "result") {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(state.resultCanvas, 0, 0, cssW, cssH);
      if (state.gridOverlay) drawGrid(ctx, ds, 0, cssW, cssH);
      els.compareDivider.hidden = true;
    } else {
      // split: original on the left, pixelated on the right
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, x, cssH);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(state.sourceCanvas, 0, 0, cssW, cssH);
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, 0, cssW - x, cssH);
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(state.resultCanvas, 0, 0, cssW, cssH);
      if (state.gridOverlay) drawGrid(ctx, ds, x, cssW, cssH);
      ctx.restore();

      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssH);
      ctx.stroke();

      els.compareDivider.style.left = state.divider + "%";
      els.compareDivider.hidden = false;
    }

    els.zoomLevel.textContent =
      state.zoom === 1 ? "Fit" : Math.round(state.zoom * 100) + "%";
    if (els.compareHint) {
      els.compareHint.style.visibility =
        state.view === "split" ? "visible" : "hidden";
    }
  }

  function updateInfo() {
    var g = gridSize();
    els.infoOriginal.textContent =
      state.sourceCanvas.width + " \u00d7 " + state.sourceCanvas.height + " px";
    els.infoGrid.textContent = "Grid " + g.w + " \u00d7 " + g.h;
    els.infoBlock.textContent = "Block " + state.pixelSize + " px";
    els.infoColors.textContent = state.resultCanvas
      ? state.usedColors + " colour" + (state.usedColors === 1 ? "" : "s")
      : "";
    els.gridDimsHint.textContent = "Grid: " + g.w + " \u00d7 " + g.h + " px";
    var d = exportDims();
    els.exportDimsHint.textContent = d.w + " \u00d7 " + d.h + " px";
  }

  function exportDims() {
    var g = gridSize();
    var v = els.exportScale.value;
    if (v === "native") {
      return { w: state.sourceCanvas.width, h: state.sourceCanvas.height };
    }
    var m = parseInt(v.replace("grid", ""), 10) || 1;
    return { w: g.w * m, h: g.h * m };
  }

  function downloadBlob(canvas, filename, msg) {
    canvas.toBlob(function (blob) {
      if (!blob) {
        toast("Export failed", "error");
        return;
      }
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
    }, "image/png");
  }

  function exportPng() {
    if (!state.resultCanvas) return;
    var d = exportDims();
    var out = document.createElement("canvas");
    out.width = d.w;
    out.height = d.h;
    var ctx = out.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.resultCanvas, 0, 0, d.w, d.h);
    downloadBlob(out, "pixelated-" + baseName(state.fileName) + ".png", "PNG downloaded");
  }

  function downloadOriginal() {
    if (!state.sourceCanvas) return;
    downloadBlob(
      state.sourceCanvas,
      (state.fileName || "original").replace(/\.[^.]+$/, "") + ".png",
      "Original downloaded",
    );
  }

  // ---------- debounced re-pixelation ----------
  var pixelateTimer = 0;
  function schedulePixelate() {
    clearTimeout(pixelateTimer);
    pixelateTimer = setTimeout(pixelate, 50);
  }

  function setView(v) {
    state.view = v;
    [
      ["viewSplit", "split"],
      ["viewResult", "result"],
      ["viewOriginal", "original"],
    ].forEach(function (pair) {
      els[pair[0]].classList.toggle("active", state.view === pair[1]);
    });
    render();
  }

  function setZoom(z) {
    state.zoom = clamp(z, 0.1, 16);
    render();
  }

  function updatePresetActive() {
    els.pixelPresets.querySelectorAll(".preset-btn").forEach(function (btn) {
      btn.classList.toggle(
        "active",
        parseInt(btn.getAttribute("data-size"), 10) === state.pixelSize,
      );
    });
  }

  // ---------- events ----------
  function bindAdjust(id, key, min, max) {
    var el = els[id];
    var out = els[id + "Val"];
    el.addEventListener("input", function () {
      var v = clamp(parseInt(el.value, 10) || 100, min, max);
      state[key] = v;
      out.textContent = v;
      schedulePixelate();
    });
  }

  function bindEvents() {
    // drop zone / file input
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

    // pixel size
    els.pixelSize.addEventListener("input", function () {
      state.pixelSize = clamp(parseInt(els.pixelSize.value, 10) || 16, MIN_PIXEL, MAX_PIXEL);
      els.pixelSizeVal.textContent = state.pixelSize;
      updatePresetActive();
      schedulePixelate();
    });
    els.pixelPresets.querySelectorAll(".preset-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.pixelSize = clamp(parseInt(btn.getAttribute("data-size"), 10) || 16, MIN_PIXEL, MAX_PIXEL);
        els.pixelSize.value = state.pixelSize;
        els.pixelSizeVal.textContent = state.pixelSize;
        updatePresetActive();
        schedulePixelate();
      });
    });

    // colours
    els.maxColors.addEventListener("input", function () {
      state.maxColors = clamp(parseInt(els.maxColors.value, 10) || 256, 2, 256);
      els.maxColorsVal.textContent = state.maxColors;
      schedulePixelate();
    });
    els.ditherToggle.addEventListener("change", function () {
      state.dither = els.ditherToggle.checked;
      schedulePixelate();
    });

    // adjustments
    bindAdjust("brightness", "brightness", 50, 150);
    bindAdjust("contrast", "contrast", 50, 150);
    bindAdjust("saturation", "saturation", 0, 200);
    els.adjustResetBtn.addEventListener("click", function () {
      state.brightness = state.contrast = state.saturation = 100;
      els.brightness.value = 100;
      els.brightnessVal.textContent = 100;
      els.contrast.value = 100;
      els.contrastVal.textContent = 100;
      els.saturation.value = 100;
      els.saturationVal.textContent = 100;
      schedulePixelate();
    });

    // view / overlay / zoom
    setView("split");
    els.viewSplit.addEventListener("click", function () { setView("split"); });
    els.viewResult.addEventListener("click", function () { setView("result"); });
    els.viewOriginal.addEventListener("click", function () { setView("original"); });
    els.gridOverlayToggle.addEventListener("change", function () {
      state.gridOverlay = els.gridOverlayToggle.checked;
      render();
    });
    els.zoomIn.addEventListener("click", function () { setZoom(state.zoom * 1.25); });
    els.zoomOut.addEventListener("click", function () { setZoom(state.zoom / 1.25); });
    els.zoomFit.addEventListener("click", function () { setZoom(1); });

    // split handle drag
    function updateDividerFromEvent(e) {
      var rect = els.pixelStage.getBoundingClientRect();
      state.divider = clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100);
      render();
    }
    els.pixelStage.addEventListener("pointerdown", function (e) {
      if (state.view !== "split") return;
      state.dragging = true;
      els.pixelStage.setPointerCapture(e.pointerId);
      updateDividerFromEvent(e);
    });
    els.pixelStage.addEventListener("pointermove", function (e) {
      if (!state.dragging) return;
      updateDividerFromEvent(e);
    });
    ["pointerup", "pointercancel"].forEach(function (ev) {
      els.pixelStage.addEventListener(ev, function () {
        state.dragging = false;
      });
    });

    // export
    els.exportScale.addEventListener("change", function () {
      if (state.sourceCanvas) updateInfo();
    });
    els.downloadPngBtn.addEventListener("click", exportPng);
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

    // misc
    els.footerYear.textContent = new Date().getFullYear();
    window.addEventListener("resize", function () {
      if (state.sourceCanvas) render();
    });
  }

  function init() {
    cacheEls();
    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
