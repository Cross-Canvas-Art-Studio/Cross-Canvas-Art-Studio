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

  var state = {
    sourceCanvas: null,
    fileName: "",
    maxColors: 8,
    sortBy: "count", // 'count' | 'hue'
    palette: [], // [{rgb, hex, count, pct}]
    zoom: 1,
    fitScale: 1,
  };

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }
  function baseName(name) {
    return (name || "image").replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-");
  }
  function pad2(n) {
    return n < 16 ? "0" + n.toString(16) : n.toString(16);
  }
  function rgbToHex(rgb) {
    return "#" + pad2(rgb[0]) + pad2(rgb[1]) + pad2(rgb[2]);
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
      "maxColors", "maxColorsVal", "sortBy",
      "zoomOut", "zoomIn", "zoomLevel", "zoomFit",
      "canvasWrap", "canvasEmpty", "pixelStage", "displayCanvas",
      "paletteStrip", "infoOriginal", "infoColours",
      "swatchGrid", "swatchCount",
      "copyHexBtn", "copyCssBtn", "downloadJsonBtn", "downloadPngBtn",
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
        var c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
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
    enableExport(false);
  }

  function enableExport(on) {
    ["copyHexBtn", "copyCssBtn", "downloadJsonBtn", "downloadPngBtn"].forEach(
      function (id) {
        els[id].disabled = !on;
      },
    );
  }

  // ---------- quantization (median cut, shared with pixelator) ----------
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

  function nearestIndex(palette, r, g, b) {
    var best = 0;
    var bestD = Infinity;
    for (var i = 0; i < palette.length; i++) {
      var c = palette[i];
      var dr = r - c[0], dg = g - c[1], db = b - c[2];
      var dist = dr * dr + dg * dg + db * db;
      if (dist < bestD) {
        bestD = dist;
        best = i;
        if (dist === 0) break;
      }
    }
    return best;
  }

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
  function copyText(text, msg) {
    function done() {
      toast(msg || "Copied", "ok");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        fallbackCopy(text);
        done();
      });
    } else {
      fallbackCopy(text);
      done();
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) { /* noop */ }
    ta.remove();
  }

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

    els.copyHexBtn.addEventListener("click", copyHex);
    els.copyCssBtn.addEventListener("click", copyCss);
    els.downloadJsonBtn.addEventListener("click", downloadJson);
    els.downloadPngBtn.addEventListener("click", downloadPng);

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
