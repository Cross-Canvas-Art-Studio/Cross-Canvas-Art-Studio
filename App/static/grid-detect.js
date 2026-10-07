/**
 * grid-detect.js - finds the stitch grid of an imported cross-stitch chart.
 *
 * A premade pattern (or a screenshot of one) is drawn on its own regular guide
 * grid, one cell per stitch. Importing it at any other size is what turns it
 * into mush: a 182-cell chart squeezed into 60 cells loses every letter and the
 * fine guide lines bleed through the colours. Measuring that grid and matching
 * the canvas to it is the difference between a faithful import and mud.
 *
 * Deliberately dependency-free, and split so the maths can be unit tested
 * headlessly (see tools/verify_render.js): detectFromPixels() takes raw RGBA,
 * and only detectFromImage() touches a canvas. Mirrored in spirit by
 * image_manager.py, which is where the server does the actual pixelation.
 */
(function () {
  "use strict";

  // Guide lines are one or two pixels wide, so the cell period is searched in
  // this window. The winner has to clear MIN_CONFIDENCE on BOTH axes: a photo
  // can have a strongly periodic texture, but it will not repeat both ways.
  var MIN_PERIOD = 3;
  var MAX_PERIOD = 80;
  var MIN_CONFIDENCE = 0.55;

  // A detected grid outside this range is not a chart worth snapping to.
  var MIN_CELLS = 8;
  var MAX_CELLS = 500;

  // Profiles are measured on a centred crop, at 1:1 so the period is in real
  // source pixels. Bounded so a huge screenshot cannot make this slow.
  var CROP = 1600;

  /**
   * Strongest repeating period in a 1-D profile, or null when there is none.
   * Returns the normalised autocorrelation of that lag as `confidence`.
   */
  function periodOf(profile) {
    var n = profile.length;
    var i;
    if (n < MIN_PERIOD * 4) return null;

    var mean = 0;
    for (i = 0; i < n; i++) mean += profile[i];
    mean /= n;

    var centred = new Float64Array(n);
    var energy = 0;
    for (i = 0; i < n; i++) {
      var v = profile[i] - mean;
      centred[i] = v;
      energy += v * v;
    }
    if (energy <= 1e-9) return null; // flat profile: no structure to find

    var maxLag = Math.min(MAX_PERIOD, Math.floor(n / 4));
    if (maxLag < MIN_PERIOD) return null;

    // ac[k] = how well the profile matches itself shifted by k pixels.
    var ac = new Float64Array(maxLag + 2);
    for (var k = MIN_PERIOD; k <= maxLag; k++) {
      var sum = 0;
      for (i = 0; i + k < n; i++) sum += centred[i] * centred[i + k];
      ac[k] = sum / energy;
    }

    var bestK = 0;
    var best = 0;
    for (k = MIN_PERIOD; k <= maxLag; k++) {
      if (ac[k] >= ac[k - 1] && ac[k] >= ac[k + 1] && ac[k] > best) {
        best = ac[k];
        bestK = k;
      }
    }
    if (!bestK || best < MIN_CONFIDENCE) return null;

    // A grid also repeats at 2x, 3x ... its cell size, and the longest lag
    // sometimes scores highest. Walk back to the true cell.
    var changed = true;
    while (changed) {
      changed = false;
      for (var div = 2; div <= 4; div++) {
        if (bestK % div) continue;
        var candidate = bestK / div;
        if (candidate >= MIN_PERIOD && ac[candidate] >= best * 0.9) {
          bestK = candidate;
          best = ac[candidate];
          changed = true;
          break;
        }
      }
    }
    return { period: bestK, confidence: best };
  }

  /**
   * Detect the stitch grid of a chart image.
   *
   * @param {Uint8ClampedArray|Uint8Array} data RGBA pixels of a width x height
   *        buffer. May be a centred crop of a larger image, in which case pass
   *        the real image size as imgWidth/imgHeight so the cell counts come
   *        out right (the crop is taken at 1:1, so periods are unaffected).
   * @returns {{cols:number, rows:number, periodX:number, periodY:number,
   *            confidence:number}|null}
   */
  function detectFromPixels(data, width, height, imgWidth, imgHeight) {
    if (!data || !width || !height) return null;
    var fullW = imgWidth || width;
    var fullH = imgHeight || height;

    // Project the image onto each axis: guide lines are darker than the paper
    // around them, so their positions show up as dips in the mean luminance.
    var colProfile = new Float64Array(width);
    var rowProfile = new Float64Array(height);
    for (var y = 0; y < height; y++) {
      var offset = y * width * 4;
      var rowSum = 0;
      for (var x = 0; x < width; x++, offset += 4) {
        var lum =
          0.299 * data[offset] +
          0.587 * data[offset + 1] +
          0.114 * data[offset + 2];
        colProfile[x] += lum;
        rowSum += lum;
      }
      rowProfile[y] = -rowSum / width;
    }
    for (var c = 0; c < width; c++) colProfile[c] = -colProfile[c] / height;

    var px = periodOf(colProfile);
    var py = periodOf(rowProfile);
    if (!px || !py) return null;

    var cols = Math.round(fullW / px.period);
    var rows = Math.round(fullH / py.period);
    if (
      cols < MIN_CELLS ||
      rows < MIN_CELLS ||
      cols > MAX_CELLS ||
      rows > MAX_CELLS
    ) {
      return null;
    }
    return {
      cols: cols,
      rows: rows,
      periodX: px.period,
      periodY: py.period,
      confidence: Math.min(px.confidence, py.confidence),
    };
  }

  /** Same as detectFromPixels, taking an <img> (or ImageBitmap) instead. */
  function detectFromImage(img, doc) {
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    if (!iw || !ih) return null;
    var cw = Math.min(iw, CROP);
    var ch = Math.min(ih, CROP);
    var x0 = (iw - cw) >> 1;
    var y0 = (ih - ch) >> 1;
    var document_ = doc || (typeof document !== "undefined" ? document : null);
    if (!document_) return null;
    var canvas = document_.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, x0, y0, cw, ch, 0, 0, cw, ch);
    var data = ctx.getImageData(0, 0, cw, ch).data;
    return detectFromPixels(data, cw, ch, iw, ih);
  }

  window.StitchGridDetect = {
    detectFromImage: detectFromImage,
    detectFromPixels: detectFromPixels,
    periodOf: periodOf,
    MIN_CONFIDENCE: MIN_CONFIDENCE,
  };
})();
