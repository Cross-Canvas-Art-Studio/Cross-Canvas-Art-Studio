/**
 * ascii.js - client-side ASCII art generator (Cross Canvas Art Studio).
 *
 * Maps image luminance to a character ramp, with optional inversion, an
 * adjustable character width and a colored mode that tints each character
 * with the source pixel's colour. Copy as text or download .txt / .html.
 */
(function () {
  "use strict";

  var els = {};
  function $(id) {
    return document.getElementById(id);
  }

  var CHARSETS = {
    classic: "@%#*+=-:. ",
    detailed:
      "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ",
    block: "\u2588\u2593\u2592\u2591 ",
    binary: "#. ",
    shade: "\u2589\u258A\u258B\u258C\u258D\u258E\u258F ",
    numeric: "9876543210 ",
    alpha: "ABCDEFGHIJKLMNOPQRSTUVWXYZ ",
    currency: "$€£¥¢#@%&*+ ",
    braille: "\u28FF\u287F\u285F\u284F\u2847\u2843\u2801 ",
  };

  // Ramps are ordered brightest/first to faintest/last (see the non-inverted
  // luminance mapping below). If the custom ramp is empty, fall back to classic.
  function resolveRamp() {
    if (state.charset === "custom") {
      var c = els.customCharset && els.customCharset.value.trim();
      return c || CHARSETS.classic;
    }
    return CHARSETS[state.charset] || CHARSETS.classic;
  }

  // Resolve any character to a 5x5 glyph:
  //   1. exact glyph in FONT;
  //   2. accented letters decompose to their base letter (é -> e, ü -> u);
  //   3. bare combining marks become a space;
  //   4. anything else (Greek, Cyrillic, CJK, emoji, ...) renders as itself so
  //      no standard character ever produces a blank.
  function glyphFor(ch) {
    if (FONT[ch]) return FONT[ch];
    var decomposed = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (decomposed.length === 1 && FONT[decomposed]) return FONT[decomposed];
    if (!decomposed) return FONT[" "];
    return selfGlyph(ch);
  }

  function selfGlyph(ch) {
    var blank = "     ";
    var mid = blank.slice(0, 2) + ch + blank.slice(3);
    return [blank, blank, mid, blank, blank];
  }

  var state = {
    source: "image", // 'image' | 'text'
    sourceCanvas: null,
    fileName: "",
    width: 120,
    charset: "classic",
    invert: false,
    color: false,
    fontSize: 8,
    textScale: 1,
    text: "",
    html: "",
    outW: 0,
    outH: 0,
  };

  // 5x5 block-letter banner font (uppercase). Each glyph is exactly 5 rows of
  // 5 characters. Lowercase input is uppercased before rendering.
  var FONT = {
    A: [" ### ", "#   #", "#####", "#   #", "#   #"],
    B: ["#### ", "#   #", "#### ", "#   #", "#### "],
    C: [" ####", "#    ", "#    ", "#    ", " ####"],
    D: ["#### ", "#   #", "#   #", "#   #", "#### "],
    E: ["#####", "#    ", "#### ", "#    ", "#####"],
    F: ["#####", "#    ", "#### ", "#    ", "#    "],
    G: [" ####", "#    ", "#  ##", "#   #", " ####"],
    H: ["#   #", "#   #", "#####", "#   #", "#   #"],
    I: ["#####", "  #  ", "  #  ", "  #  ", "#####"],
    J: ["  ###", "   # ", "   # ", "#  # ", " ##  "],
    K: ["#   #", "#  # ", "###  ", "#  # ", "#   #"],
    L: ["#    ", "#    ", "#    ", "#    ", "#####"],
    M: ["#   #", "## ##", "# # #", "#   #", "#   #"],
    N: ["#   #", "##  #", "# # #", "#  ##", "#   #"],
    O: [" ### ", "#   #", "#   #", "#   #", " ### "],
    P: ["#### ", "#   #", "#### ", "#    ", "#    "],
    Q: [" ### ", "#   #", "# # #", "#  # ", " ## #"],
    R: ["#### ", "#   #", "#### ", "#  # ", "#   #"],
    S: [" ####", "#    ", " ### ", "    #", "#### "],
    T: ["#####", "  #  ", "  #  ", "  #  ", "  #  "],
    U: ["#   #", "#   #", "#   #", "#   #", " ### "],
    V: ["#   #", "#   #", "#   #", " # # ", "  #  "],
    W: ["#   #", "#   #", "# # #", "## ##", "#   #"],
    X: ["#   #", " # # ", "  #  ", " # # ", "#   #"],
    Y: ["#   #", " # # ", "  #  ", "  #  ", "  #  "],
    Z: ["#####", "   # ", "  #  ", " #   ", "#####"],
    0: [" ### ", "#   #", "# # #", "#   #", " ### "],
    1: ["  #  ", " ##  ", "  #  ", "  #  ", "#####"],
    2: [" ### ", "#   #", "   # ", "  #  ", "#####"],
    3: ["#####", "   # ", " ### ", "   # ", "#####"],
    4: ["#   #", "#   #", "#####", "    #", "    #"],
    5: ["#####", "#    ", "#### ", "    #", "#### "],
    6: [" ### ", "#    ", "#### ", "#   #", " ### "],
    7: ["#####", "    #", "   # ", "  #  ", "  #  "],
    8: [" ### ", "#   #", " ### ", "#   #", " ### "],
    9: [" ### ", "#   #", " ####", "    #", " ### "],
    " ": ["     ", "     ", "     ", "     ", "     "],
    ".": ["     ", "     ", "     ", "  ## ", "  ## "],
    ",": ["     ", "     ", "     ", "  ## ", " #   "],
    "!": ["  #  ", "  #  ", "  #  ", "     ", "  #  "],
    "?": [" ### ", "#   #", "   # ", "     ", "  #  "],
    "-": ["     ", "     ", "#####", "     ", "     "],
    "'": ["  #  ", "  #  ", "     ", "     ", "     "],
    ":": ["     ", "  #  ", "     ", "  #  ", "     "],
    ";": ["     ", "  #  ", "     ", "  #  ", " #   "],
    "(": ["   # ", "  #  ", "  #  ", "  #  ", "   # "],
    ")": [" #   ", "  #  ", "  #  ", "  #  ", " #   "],
    "/": ["    #", "   # ", "  #  ", " #   ", "#    "],
    "\\": ["#    ", " #   ", "  #  ", "   # ", "    #"],
    "+": ["     ", "  #  ", "#####", "  #  ", "     "],
    "=": ["     ", "#####", "     ", "#####", "     "],
    "*": ["     ", "# # #", " ### ", "# # #", "     "],
    "_": ["     ", "     ", "     ", "     ", "#####"],
    // Lowercase letters (kept distinct from capitals so case is preserved).
    a: [" ### ", "#   #", " ####", "#   #", " ####"],
    b: ["#    ", "# ## ", "##  #", "#   #", "#### "],
    c: ["     ", " ### ", "#    ", "#    ", " ####"],
    d: ["    #", " # ##", "#  # ", "#   #", " ####"],
    e: ["     ", " ### ", "#####", "#    ", " ####"],
    f: ["  ## ", " #   ", "###  ", " #   ", " #   "],
    g: [" ####", "#   #", " ####", "    #", " ### "],
    h: ["#    ", "# ## ", "##  #", "#   #", "#   #"],
    i: ["  #  ", "     ", "  #  ", "  #  ", "  #  "],
    j: ["   # ", "     ", "   # ", "   # ", " ### "],
    k: ["#    ", "#  # ", "##   ", "#  # ", "#   #"],
    l: ["##   ", " #   ", " #   ", " #   ", " ### "],
    m: ["     ", "# # #", "#####", "#   #", "#   #"],
    n: ["     ", "# ## ", "##  #", "#   #", "#   #"],
    o: ["     ", " ### ", "#   #", "#   #", " ### "],
    p: ["# ## ", "##  #", "#### ", "#    ", "#    "],
    q: [" # ##", "#  # ", " ####", "    #", "    #"],
    r: ["     ", "# ## ", "##   ", "#    ", "#    "],
    s: ["     ", " ####", "#    ", "   # ", "#### "],
    t: [" #   ", "###  ", " #   ", " #   ", "  ## "],
    u: ["     ", "#   #", "#   #", "#   #", " ####"],
    v: ["     ", "#   #", "#   #", " # # ", "  #  "],
    w: ["     ", "#   #", "# # #", "#####", "# # #"],
    x: ["     ", "#   #", " ### ", " # # ", "#   #"],
    y: ["     ", "#   #", " ####", "    #", " ### "],
    z: ["     ", "#####", "  #  ", " #   ", "#####"],
    "@": [" ### ", "#   #", "# ## ", "#   #", " ### "],
    "#": [" # # ", "#####", " # # ", "#####", " # # "],
    "$": ["  #  ", " ####", "# #  ", " ####", "  #  "],
    "%": ["#   #", "   # ", "  #  ", " #   ", "#   #"],
    "&": [" ##  ", "#  # ", " ##  ", "#  # ", "# #  "],
    "<": ["   # ", "  #  ", " #   ", "  #  ", "   # "],
    ">": [" #   ", "  #  ", "   # ", "  #  ", " #   "],
    "[": [" ### ", " #   ", " #   ", " #   ", " ### "],
    "]": [" ### ", "   # ", "   # ", "   # ", " ### "],
    "{": ["  ## ", "  #  ", " #   ", "  #  ", "  ## "],
    "}": [" ##  ", "  #  ", "   # ", "  #  ", " ##  "],
    "\"": [" # # ", " # # ", "     ", "     ", "     "],
    "~": ["     ", "     ", "#   #", " ### ", "     "],
    "^": ["  #  ", " # # ", "#   #", "     ", "     "],
    "`": ["  #  ", " #   ", "     ", "     ", "     "],
    "|": ["  #  ", "  #  ", "  #  ", "  #  ", "  #  "],
    // Common Unicode symbols & punctuation (all five chars per row)
    "€": [" ### ", "#    ", "#### ", "#    ", " ### "],
    "£": [" ### ", " #   ", " ### ", " #   ", "#####"],
    "¥": ["#   #", " # # ", "  #  ", "  #  ", "  #  "],
    "©": [" ### ", "#   #", "#  ##", "#   #", " ### "],
    "®": [" ### ", "#   #", "# ## ", "# #  ", " ### "],
    "™": ["#####", " # # ", " # # ", "     ", "     "],
    "°": [" ### ", "#   #", "#   #", " ### ", "     "],
    "±": ["     ", "  #  ", "#####", "  #  ", "#####"],
    "×": ["#   #", " # # ", "  #  ", " # # ", "#   #"],
    "÷": ["  #  ", "     ", "#####", "     ", "  #  "],
    "«": [" #   ", "#  # ", "  #  ", "#  # ", " #   "],
    "»": ["   # ", " #  #", "  #  ", " #  #", "   # "],
    "¡": ["  #  ", "  #  ", "  #  ", "     ", "  #  "],
    "¿": ["  #  ", "     ", "   # ", "#   #", " ### "],
    "→": ["     ", "    #", "#####", "    #", "     "],
    "←": ["     ", "#    ", "#####", "#    ", "     "],
    "↑": ["  #  ", " ### ", "  #  ", "  #  ", "  #  "],
    "↓": ["  #  ", "  #  ", "  #  ", " ### ", "  #  "],
    "↔": ["     ", "#   #", "#####", "#   #", "     "],
    "♥": [" # # ", "#####", "#####", " ### ", "  #  "],
    "★": ["  #  ", " ### ", "#####", " ### ", "  #  "],
    "☆": ["  #  ", " ### ", "# # #", " ### ", "  #  "],
    "✓": ["     ", "     ", "    #", "  # #", "##   "],
    "✗": ["#   #", " # # ", "  #  ", " # # ", "#   #"],
    "•": ["     ", " ### ", " ### ", " ### ", "     "],
    "·": ["     ", "     ", " ### ", "     ", "     "],
    "…": ["     ", "     ", "     ", "# # #", "     "],
    "–": ["     ", "     ", "#####", "     ", "     "],
    "—": ["     ", "     ", "#####", "     ", "     "],
    "‘": ["  #  ", "  #  ", "     ", "     ", "     "],
    "’": ["  #  ", "  #  ", "     ", "     ", "     "],
    "“": [" # # ", " # # ", "     ", "     ", "     "],
    "”": [" # # ", " # # ", "     ", "     ", "     "],
    "§": [" ####", "#    ", " ### ", "    #", "#### "],
  };

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function baseName(name) {
    return (name || "image").replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-");
  }
  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
      "sourceImage", "sourceText", "imageSettings",
      "dropZone", "imageInput", "uploadPreview", "removeImageBtn",
      "textInput", "textScale", "textScaleVal",
      "width", "widthVal", "charset", "customCharset", "customHint",
      "invertToggle", "colorToggle",
      "fontSize", "copyTextBtn",
      "canvasEmpty", "asciiWrap", "asciiOut",
      "infoOriginal", "infoAscii",
      "downloadTxtBtn", "downloadHtmlBtn",
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
        buildAscii();
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
    els.downloadTxtBtn.disabled = false;
    els.downloadHtmlBtn.disabled = false;
  }

  function removeImage() {
    state.sourceCanvas = null;
    state.text = "";
    state.html = "";
    state.fileName = "";
    els.uploadPreview.hidden = true;
    els.uploadPreview.removeAttribute("src");
    els.removeImageBtn.hidden = true;
    els.canvasEmpty.style.display = "flex";
    els.asciiOut.textContent = "";
    els.asciiOut.innerHTML = "";
    els.downloadTxtBtn.disabled = true;
    els.downloadHtmlBtn.disabled = true;
    els.infoOriginal.textContent = "\u2014";
    els.infoAscii.textContent = "";
  }

  // ---------- generation ----------
  function buildAscii() {
    if (state.source === "text") {
      buildTextAscii();
      return;
    }
    if (!state.sourceCanvas) return;
    var srcW = state.sourceCanvas.width;
    var srcH = state.sourceCanvas.height;
    var w = state.width;
    var h = Math.max(1, Math.round(w * (srcH / srcW) * 0.5));
    state.outW = w;
    state.outH = h;

    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(state.sourceCanvas, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h).data;

    var chars = resolveRamp();
    var n = chars.length - 1;
    var textLines = [];
    var htmlLines = [];

    for (var y = 0; y < h; y++) {
      var t = "";
      var hh = "";
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) * 4;
        var r = data[o], g = data[o + 1], b = data[o + 2];
        var lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        var idx = state.invert
          ? Math.round((lum / 255) * n)
          : Math.round(((255 - lum) / 255) * n);
        var ch = chars.charAt(clamp(idx, 0, n));
        t += ch;
        if (state.color) {
          hh +=
            '<span style="color:rgb(' + r + "," + g + "," + b + ')">' +
            escapeHtml(ch) +
            "</span>";
        }
      }
      textLines.push(t);
      htmlLines.push(hh);
    }
    state.text = textLines.join("\n");
    state.html = htmlLines.join("\n");
    renderOutput();
    updateInfo();
  }

  // Repeat each cell of a glyph 's' times horizontally and each row 's' times
  // vertically so the 5x5 banner font can be rendered larger.
  function scaleGlyph(g, s) {
    if (s <= 1) return g;
    var out = [];
    for (var r = 0; r < g.length; r++) {
      var row = g[r];
      var scaledRow = "";
      for (var i = 0; i < row.length; i++) {
        scaledRow += row.charAt(i).repeat(s);
      }
      for (var k = 0; k < s; k++) out.push(scaledRow);
    }
    return out;
  }

  function buildTextAscii() {
    var text = els.textInput.value;
    var scale = state.textScale;
    if (!text.trim()) {
      state.text = "";
      state.html = "";
      state.outW = 0;
      state.outH = 0;
      els.downloadTxtBtn.disabled = true;
      els.downloadHtmlBtn.disabled = true;
      renderOutput();
      updateInfo();
      return;
    }

    var glyphs = [];
    // Iterate by code point so emoji (surrogate pairs) are not split.
    Array.from(text).forEach(function (ch) {
      glyphs.push(scaleGlyph(glyphFor(ch), scale));
    });

    var rows = [];
    var rowCount = 5 * scale;
    for (var r = 0; r < rowCount; r++) {
      var line = "";
      for (var g = 0; g < glyphs.length; g++) {
        if (g > 0) line += " ";
        line += glyphs[g][r];
      }
      rows.push(line);
    }
    state.text = rows.join("\n");
    state.outW = rows.reduce(function (m, l) {
      return Math.max(m, l.length);
    }, 0);
    state.outH = rows.length;

    if (state.color) {
      state.html = rows
        .map(function (line) {
          var out = "";
          for (var i2 = 0; i2 < line.length; i2++) {
            out +=
              '<span style="color:#a855f7">' +
              escapeHtml(line.charAt(i2)) +
              "</span>";
          }
          return out;
        })
        .join("\n");
    } else {
      state.html = "";
    }

    els.downloadTxtBtn.disabled = false;
    els.downloadHtmlBtn.disabled = false;
    renderOutput();
    updateInfo();
  }

  function renderOutput() {
    if (state.color) {
      els.asciiOut.innerHTML = state.html;
    } else {
      els.asciiOut.textContent = state.text;
    }
    els.asciiOut.style.fontSize = state.fontSize + "px";
  }

  function updateInfo() {
    if (state.source === "text") {
      var n = Array.from(els.textInput.value).length; // code points, not UTF-16 units
      els.infoOriginal.textContent = state.text
        ? "Text \u00b7 " + n + " char" + (n === 1 ? "" : "s")
        : "\u2014";
      els.infoAscii.textContent = state.outW
        ? state.outW + " \u00d7 " + state.outH + " chars" +
          (state.color ? " \u00b7 colored" : "")
        : "Type some text to generate";
      return;
    }
    if (!state.sourceCanvas) return;
    els.infoOriginal.textContent =
      state.sourceCanvas.width + " \u00d7 " + state.sourceCanvas.height + " px";
    els.infoAscii.textContent =
      state.outW + " \u00d7 " + state.outH + " chars" +
      (state.color ? " \u00b7 colored" : "");
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

  function copyAscii() {
    if (!state.text) return;
    copyText(state.text, "ASCII art copied");
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

  function downloadTxt() {
    if (!state.text) return;
    var blob = new Blob([state.text], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, "ascii-" + baseName(state.fileName) + ".txt", "Text downloaded");
  }

  function downloadHtml() {
    if (!state.html && !state.text) return;
    var body = state.color ? state.html : escapeHtml(state.text).replace(/\n/g, "\n");
    var doc =
      "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n" +
      "<title>ASCII art</title>\n<style>body{background:#0b0d12;color:#e7eaf0;" +
      "font-family:Consolas,'Courier New',monospace;font-size:10px;line-height:1;" +
      "padding:12px;overflow:auto;}pre{margin:0;white-space:pre;}</style>\n" +
      "</head>\n<body>\n<pre>" + body + "</pre>\n</body>\n</html>\n";
    var blob = new Blob([doc], { type: "text/html;charset=utf-8" });
    downloadBlob(blob, "ascii-" + baseName(state.fileName) + ".html", "HTML downloaded");
  }

  // ---------- events ----------
  var buildTimer = 0;
  function scheduleBuild() {
    clearTimeout(buildTimer);
    buildTimer = setTimeout(buildAscii, 50);
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

    // source tabs (Image / Text)
    document.querySelectorAll("[data-ascii-source]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setSource(btn.getAttribute("data-ascii-source"));
      });
    });
    els.textInput.addEventListener("input", function () {
      if (state.source === "text") scheduleBuild();
    });
    els.textScale.addEventListener("input", function () {
      state.textScale = clamp(parseInt(els.textScale.value, 10) || 1, 1, 3);
      els.textScaleVal.textContent = state.textScale;
      if (state.source === "text") scheduleBuild();
    });

    els.width.addEventListener("input", function () {
      state.width = clamp(parseInt(els.width.value, 10) || 120, 20, 240);
      els.widthVal.textContent = state.width;
      scheduleBuild();
    });
    els.charset.addEventListener("change", function () {
      state.charset = els.charset.value;
      var isCustom = state.charset === "custom";
      els.customCharset.hidden = !isCustom;
      els.customHint.hidden = !isCustom;
      if (isCustom) {
        if (!els.customCharset.value) els.customCharset.value = "@%#*+=-:. ";
        els.customCharset.focus();
      }
      scheduleBuild();
    });
    els.customCharset.addEventListener("input", function () {
      if (state.charset === "custom") scheduleBuild();
    });
    els.invertToggle.addEventListener("change", function () {
      state.invert = els.invertToggle.checked;
      scheduleBuild();
    });
    els.colorToggle.addEventListener("change", function () {
      state.color = els.colorToggle.checked;
      if (state.sourceCanvas || state.source === "text") {
        scheduleBuild();
      } else {
        renderOutput();
      }
    });
    els.fontSize.addEventListener("input", function () {
      state.fontSize = clamp(parseInt(els.fontSize.value, 10) || 8, 4, 20);
      els.asciiOut.style.fontSize = state.fontSize + "px";
    });

    els.copyTextBtn.addEventListener("click", copyAscii);
    els.downloadTxtBtn.addEventListener("click", downloadTxt);
    els.downloadHtmlBtn.addEventListener("click", downloadHtml);

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
  }

  // ---------- source switching ----------
  function setSource(src) {
    state.source = src;
    els.sourceImage.hidden = src !== "image";
    els.sourceText.hidden = src !== "text";
    els.imageSettings.hidden = src !== "image";
    document.querySelectorAll("[data-ascii-source]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-ascii-source") === src);
    });
    buildAscii();
  }

  function init() {
    cacheEls();
    bindEvents();
    setSource("image");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
