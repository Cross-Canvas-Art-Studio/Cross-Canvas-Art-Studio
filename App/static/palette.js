/**
 * palette.js - client-side colour palette extractor (Cross Canvas Art Studio).
 *
 * Extracts the dominant colours from an image using median-cut quantization
 * (the same algorithm as pixelator.js), shows them as click-to-copy swatches
 * with coverage percentages, and exports HEX / CSS / JSON / PNG.
 */
(function () {
  "use strict";

  var els = {};
  function $(id) {
    return document.getElementById(id);
  }

  // Shared helpers from tool-common.js (loaded before this script).
  var T = window.StitchTool;
  var clamp = T.clamp, clamp255 = T.clamp255, baseName = T.baseName,
      pad2 = T.pad2, rgbToHex = T.rgbToHex, toast = T.toast,
      copyText = T.copyText, downloadBlob = T.downloadBlob,
      medianCut = T.medianCut, nearestIndex = T.nearestIndex;

  var state = {
    sourceCanvas: null,
    fileName: "",
    maxColors: 8,
    sortBy: "count", // 'count' | 'hue'
    palette: [], // [{rgb, hex, count, pct}]
    zoom: 1,
    fitScale: 1,
  };

  function cacheEls() {
    [
      "dropZone", "imageInput", "uploadPreview", "removeImageBtn",
      "maxColors", "maxColorsVal", "sortBy",
      "pickedRow", "pickedSwatch", "pickedHex", "pickedRgb",
      "zoomOut", "zoomIn", "zoomLevel", "zoomFit",
      "canvasWrap", "canvasEmpty", "pixelStage", "displayCanvas",
      "paletteStrip", "infoOriginal", "infoColours",
      "swatchGrid", "swatchCount",
      "copyHexBtn", "copyCssBtn", "downloadJsonBtn", "downloadPngBtn",
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
        var c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0);
        state.sourceCanvas = c;
        onImageReady();
        extract();
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
    els.paletteStrip.hidden = false;
    render();
    enableExport(true);
  }

  function removeImage() {
    state.sourceCanvas = null;
    state.palette = [];
    state.fileName = "";
    els.uploadPreview.hidden = true;
    els.uploadPreview.removeAttribute("src");
    els.removeImageBtn.hidden = true;
    els.pixelStage.hidden = true;
    els.paletteStrip.hidden = true;
    els.canvasEmpty.style.display = "flex";
    els.infoOriginal.textContent = "\u2014";
    els.infoColours.textContent = "";
    els.swatchGrid.innerHTML =
      '<p class="legend-empty">Upload an image to see colours.</p>';
    els.swatchCount.textContent = "0";
    els.pickedRow.hidden = true;
    enableExport(false);
  }

  function enableExport(on) {
    ["copyHexBtn", "copyCssBtn", "downloadJsonBtn", "downloadPngBtn"].forEach(
      function (id) {
        els[id].disabled = !on;
      },
    );
  }

  // ---------- quantization (median cut, shared via tool-common.js) ----------
  function hueOf(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min;
    if (d === 0) return 0;
    var h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return Math.round(h * 60);
  }

  // ---------- extraction ----------
  function sampleCanvas(canvas, target) {
    var scale = Math.min(1, target / Math.max(canvas.width, canvas.height));
    var w = Math.max(1, Math.round(canvas.width * scale));
    var h = Math.max(1, Math.round(canvas.height * scale));
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(canvas, 0, 0, w, h);
    return c;
  }

  function extract() {
    if (!state.sourceCanvas) return;
    var sc = sampleCanvas(state.sourceCanvas, 256);
    var ctx = sc.getContext("2d", { willReadFrequently: true });
    var data = ctx.getImageData(0, 0, sc.width, sc.height).data;

    var samples = [];
    var total = 0;
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] >= 128) {
        samples.push([data[i], data[i + 1], data[i + 2]]);
        total++;
      }
    }
    if (!total) {
      toast("No visible colours found", "error");
      return;
    }

    var pal = medianCut(samples, clamp(state.maxColors, 2, 32));
    var counts = new Array(pal.length).fill(0);
    for (var j = 0; j < data.length; j += 4) {
      if (data[j + 3] < 128) continue;
      counts[nearestIndex(pal, data[j], data[j + 1], data[j + 2])]++;
    }

    var entries = pal.map(function (c, k) {
      return {
        rgb: c,
        hex: rgbToHex(c),
        count: counts[k],
        pct: Math.round((counts[k] / total) * 1000) / 10,
      };
    });
    if (state.sortBy === "hue") {
      entries.sort(function (a, b) { return hueOf(a.rgb) - hueOf(b.rgb); });
    } else {
      entries.sort(function (a, b) { return b.count - a.count; });
    }
    state.palette = entries;

    renderSwatches();
    renderStrip();
    updateInfo();
  }

  function renderSwatches() {
    els.swatchGrid.innerHTML = "";
    state.palette.forEach(function (e) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "p-swatch";
      btn.title = "Copy " + e.hex;
      var color = document.createElement("span");
      color.className = "p-swatch-color";
      color.style.background = e.hex;
      var meta = document.createElement("span");
      meta.className = "p-swatch-meta";
      var hex = document.createElement("span");
      hex.className = "p-swatch-hex";
      hex.textContent = e.hex;
      var pct = document.createElement("span");
      pct.className = "p-swatch-pct";
      pct.textContent = e.pct + "%";
      meta.appendChild(hex);
      meta.appendChild(pct);
      btn.appendChild(color);
      btn.appendChild(meta);
      btn.addEventListener("click", function () {
        copyText(e.hex, "Copied " + e.hex);
      });
      els.swatchGrid.appendChild(btn);
    });
    els.swatchCount.textContent = state.palette.length;
  }

  function renderStrip() {
    els.paletteStrip.innerHTML = "";
    state.palette.forEach(function (e) {
      var span = document.createElement("span");
      span.style.background = e.hex;
      span.title = e.hex + " \u00b7 " + e.pct + "%";
      els.paletteStrip.appendChild(span);
    });
  }

  function updateInfo() {
    els.infoOriginal.textContent =
      state.sourceCanvas.width + " \u00d7 " + state.sourceCanvas.height + " px";
    els.infoColours.textContent = state.palette.length + " colours extracted";
  }

  // ---------- display ----------
  function computeFit() {
    state.fitScale = T.fitScaleFor(state.sourceCanvas, els.canvasWrap);
  }

  function render() {
    if (!state.sourceCanvas) return;
    computeFit();
    var sw = state.sourceCanvas.width;
    var sh = state.sourceCanvas.height;
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
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(state.sourceCanvas, 0, 0, cssW, cssH);
    els.zoomLevel.textContent =
      state.zoom === 1 ? "Fit" : Math.round(state.zoom * 100) + "%";
  }

  // ---------- clipboard / export ----------
  function copyHex() {
    copyText(state.palette.map(function (e) { return e.hex; }).join(", "), "HEX values copied");
  }

  function copyCss() {
    var lines = [":root {"];
    state.palette.forEach(function (e, i) {
      lines.push("  --palette-" + (i + 1) + ": " + e.hex + ";");
    });
    lines.push("}");
    copyText(lines.join("\n"), "CSS variables copied");
  }

  function downloadJson() {
    var payload = {
      source: state.fileName || null,
      count: state.palette.length,
      colors: state.palette.map(function (e) {
        return { hex: e.hex, rgb: e.rgb, share: e.pct / 100 };
      }),
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    downloadBlob(blob, "palette-" + baseName(state.fileName) + ".json", "JSON downloaded");
  }

  function downloadPng() {
    var cell = 40;
    var cols = 2;
    var rows = Math.ceil(state.palette.length / cols);
    var pad = 12;
    var canvas = document.createElement("canvas");
    canvas.width = cols * cell + pad * 2;
    canvas.height = rows * cell + pad * 2;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    state.palette.forEach(function (e, i) {
      ctx.fillStyle = e.hex;
      var x = pad + (i % cols) * cell;
      var y = pad + Math.floor(i / cols) * cell;
      ctx.fillRect(x, y, cell - 2, cell - 2);
    });
    canvas.toBlob(function (blob) {
      if (!blob) {
        toast("Export failed", "error");
        return;
      }
      downloadBlob(blob, "palette-" + baseName(state.fileName) + ".png", "Palette PNG downloaded");
    }, "image/png");
  }

  // ---------- events ----------
  var extractTimer = 0;
  function scheduleExtract() {
    clearTimeout(extractTimer);
    extractTimer = setTimeout(extract, 50);
  }

  function bindEvents() {
    T.wireDropZone(els.dropZone, els.imageInput, loadFile);
    els.removeImageBtn.addEventListener("click", removeImage);

    els.maxColors.addEventListener("input", function () {
      state.maxColors = clamp(parseInt(els.maxColors.value, 10) || 8, 2, 32);
      els.maxColorsVal.textContent = state.maxColors;
      scheduleExtract();
    });
    els.sortBy.addEventListener("change", function () {
      state.sortBy = els.sortBy.value;
      if (state.sourceCanvas) extract();
    });

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

    // click the preview to pick (and copy) a colour
    els.displayCanvas.addEventListener("click", function (e) {
      if (!state.sourceCanvas) return;
      var rect = els.displayCanvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var x = (e.clientX - rect.left) / rect.width;
      var y = (e.clientY - rect.top) / rect.height;
      var px = clamp(
        Math.floor(x * state.sourceCanvas.width),
        0,
        state.sourceCanvas.width - 1,
      );
      var py = clamp(
        Math.floor(y * state.sourceCanvas.height),
        0,
        state.sourceCanvas.height - 1,
      );
      var d = state.sourceCanvas
        .getContext("2d", { willReadFrequently: true })
        .getImageData(px, py, 1, 1).data;
      var hex = rgbToHex([d[0], d[1], d[2]]);
      els.pickedRow.hidden = false;
      els.pickedSwatch.style.background = hex;
      els.pickedHex.textContent = hex;
      els.pickedRgb.textContent = "rgb(" + d[0] + ", " + d[1] + ", " + d[2] + ")";
      copyText(hex, "Copied " + hex);
    });

    els.copyHexBtn.addEventListener("click", copyHex);
    els.copyCssBtn.addEventListener("click", copyCss);
    els.downloadJsonBtn.addEventListener("click", downloadJson);
    els.downloadPngBtn.addEventListener("click", downloadPng);

    T.wireHelpModal();

    T.wireFooterYear();
    window.addEventListener("resize", function () {
      if (state.sourceCanvas) render();
    });
  }

  function init() {
    cacheEls();
    // Sidebar panels get a disclosure control, exactly as on Stitchee.
    T.initCollapsiblePanels();
    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
