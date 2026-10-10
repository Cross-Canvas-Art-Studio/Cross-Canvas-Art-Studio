/**
 * tool-common.js - shared client-side helpers for the four free tools
 * (Pixelator, Resizer, Palette, ASCII).
 *
 * These functions were previously copy-pasted into each tool script. They live
 * here so a fix lands once. Loaded as a plain `<script>` before the tool script
 * on each tool page, and copied into the static build alongside them.
 *
 * Exposes `window.StitchTool`. Nothing here reads tool-specific state; the
 * drop-zone / help-modal / footer helpers read the shared ids that every page
 * now gets from base.html (one header, one footer, one help modal).
 */
(function () {
  "use strict";

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
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- toast ----------
  var toastTimer = null;
  function toast(msg, kind) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.className = "toast show " + (kind || "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.className = "toast";
    }, 3200);
  }

  // ---------- download / clipboard ----------
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

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {
      /* noop */
    }
    ta.remove();
  }

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

  // ---------- colour quantization (median cut, shared) ----------
  function bucketRange(b) {
    var minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
    for (var i = 0; i < b.length; i++) {
      var c = b[i];
      if (c[0] < minR) minR = c[0];
      if (c[0] > maxR) maxR = c[0];
      if (c[1] < minG) minG = c[1];
      if (c[1] > maxG) maxG = c[1];
      if (c[2] < minB) minB = c[2];
      if (c[2] > maxB) maxB = c[2];
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

  function nearestColor(palette, r, g, b) {
    return palette[nearestIndex(palette, r, g, b)];
  }

  // ---------- shared behaviours ----------
  /** Wire a drop zone + file input to one onFile(file) callback. */
  function wireDropZone(dropEl, inputEl, onFile) {
    if (!dropEl || !inputEl) return;
    dropEl.addEventListener("click", function () {
      inputEl.click();
    });
    dropEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        inputEl.click();
      }
    });
    ["dragenter", "dragover"].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault();
        dropEl.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault();
        dropEl.classList.remove("dragover");
      });
    });
    dropEl.addEventListener("drop", function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) onFile(f);
    });
    inputEl.addEventListener("change", function () {
      if (inputEl.files && inputEl.files[0]) onFile(inputEl.files[0]);
      inputEl.value = "";
    });
  }

  /**
   * Wire the shared help modal (base.html) with real focus handling: focus moves
   * to the close button on open and returns to the button on close. The four
   * tools previously only toggled a class, so keyboard users got no focus return.
   */
  function wireHelpModal() {
    var btn = document.getElementById("helpBtn");
    var modal = document.getElementById("helpModal");
    var close = document.getElementById("helpClose");
    if (!btn || !modal) return;

    function open() {
      modal.classList.add("active");
      modal.setAttribute("aria-hidden", "false");
      if (close) close.focus();
    }
    function shut() {
      modal.classList.remove("active");
      modal.setAttribute("aria-hidden", "true");
      btn.focus();
    }
    btn.addEventListener("click", open);
    if (close) close.addEventListener("click", shut);
    modal.addEventListener("click", function (e) {
      if (e.target === modal) shut();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("active")) shut();
    });
  }

  /** Stamp the current year into the shared #footerYear. */
  function wireFooterYear() {
    var el = document.getElementById("footerYear");
    if (el) el.textContent = new Date().getFullYear();
  }

  /** Fit scale for a canvas inside its scroll wrap (1:1), for the tools' zoom. */
  function fitScaleFor(canvas, wrapEl, pad) {
    var gap = pad == null ? 24 : pad;
    var availW = Math.max(80, wrapEl.clientWidth - gap);
    var availH = Math.max(80, wrapEl.clientHeight - gap);
    var aspect = canvas.width / canvas.height;
    var w = availW;
    var h = w / aspect;
    if (h > availH) {
      h = availH;
      w = h * aspect;
    }
    return w / canvas.width;
  }

  window.StitchTool = {
    clamp: clamp,
    clamp255: clamp255,
    baseName: baseName,
    pad2: pad2,
    rgbToHex: rgbToHex,
    escapeHtml: escapeHtml,
    toast: toast,
    downloadBlob: downloadBlob,
    copyText: copyText,
    fallbackCopy: fallbackCopy,
    medianCut: medianCut,
    nearestIndex: nearestIndex,
    nearestColor: nearestColor,
    wireDropZone: wireDropZone,
    wireHelpModal: wireHelpModal,
    wireFooterYear: wireFooterYear,
    fitScaleFor: fitScaleFor,
  };
})();
