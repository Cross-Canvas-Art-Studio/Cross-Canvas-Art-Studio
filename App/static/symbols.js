/**
 * symbols.js - the built-in stitch-symbol glyph table.
 *
 * A cross-stitch chart is printed in black and white, so every colour needs a
 * distinct monochrome symbol to stay readable. Palette entries carry a `symbol`
 * index (assigned in App/palette_manager.py, delivered via /api/config); the
 * geometry for those indices lives here.
 *
 * Glyphs are described with primitives shared by all three render backends
 * (HTML5 canvas, SVG, PDF) so a symbol draws identically everywhere:
 *
 *   {k:'line',   p:[[x,y],...]}   open polyline, stroked
 *   {k:'poly',   p:[[x,y],...]}   closed polygon, filled
 *   {k:'circle', cx, cy, r}       stroked circle
 *   {k:'disc',   cx, cy, r}       filled circle
 *
 * Coordinates are in a normalised 100x100 box; the renderer scales them into
 * whatever the current cell size is. Deliberately no curves or filled text, so
 * the PDF backend needs no path parser and no embedded font.
 */
(function () {
  "use strict";

  function L() {
    return { k: "line", p: Array.prototype.slice.call(arguments) };
  }
  function P() {
    return { k: "poly", p: Array.prototype.slice.call(arguments) };
  }
  function C(cx, cy, r) {
    return { k: "circle", cx: cx, cy: cy, r: r };
  }
  function D(cx, cy, r) {
    return { k: "disc", cx: cx, cy: cy, r: r };
  }

  var SYMBOLS = [
    // ---- simple strokes (most legible when cells are small) ----
    [L([18, 18], [82, 82]), L([82, 18], [18, 82])], // 0  X
    [L([50, 14], [50, 86]), L([14, 50], [86, 50])], // 1  +
    [L([22, 78], [78, 22])], // 2  /
    [L([22, 22], [78, 78])], // 3  backslash
    [L([16, 50], [84, 50])], // 4  horizontal bar
    [L([50, 14], [50, 86])], // 5  vertical bar
    [L([16, 38], [84, 38]), L([16, 62], [84, 62])], // 6  =
    [L([34, 16], [34, 84]), L([66, 16], [66, 84])], // 7  double bar
    [L([20, 68], [50, 30], [80, 68])], // 8  caret
    [L([20, 32], [50, 70], [80, 32])], // 9  vee
    [L([68, 18], [30, 50], [68, 82])], // 10 <
    [L([32, 18], [70, 50], [32, 82])], // 11 >
    [L([16, 22], [84, 22]), L([50, 22], [50, 84])], // 12 T
    [L([16, 78], [84, 78]), L([50, 16], [50, 78])], // 13 inverted T
    [L([26, 16], [26, 80], [86, 80])], // 14 L corner
    [L([74, 16], [74, 80], [14, 80])], // 15 reversed L corner

    // ---- geometric outlines ----
    [C(50, 50, 32)], // 16 circle
    [L([50, 18], [83, 78], [17, 78], [50, 18])], // 17 triangle up
    [L([50, 82], [17, 22], [83, 22], [50, 82])], // 18 triangle down
    [L([50, 16], [84, 50], [50, 84], [16, 50], [50, 16])], // 19 diamond
    [L([20, 20], [80, 20], [80, 80], [20, 80], [20, 20])], // 20 square
    [L([50, 14], [86, 40], [72, 84], [28, 84], [14, 40], [50, 14])], // 21 pentagon
    [L([26, 20], [74, 20], [88, 50], [74, 80], [26, 80], [12, 50], [26, 20])], // 22 hexagon
    [C(50, 50, 34), C(50, 50, 21)], // 23 thick ring
    [C(50, 50, 20)], // 24 small circle

    // ---- filled shapes ----
    [D(50, 50, 30)], // 25 disc
    [D(50, 50, 18)], // 26 small disc
    [P([50, 16], [86, 80], [14, 80])], // 27 filled triangle up
    [P([14, 20], [86, 20], [50, 84])], // 28 filled triangle down
    [P([50, 14], [86, 50], [50, 86], [14, 50])], // 29 filled diamond
    [P([18, 18], [82, 18], [82, 82], [18, 82])], // 30 filled square
    [P([32, 32], [68, 32], [68, 68], [32, 68])], // 31 small filled square
    [P([30, 20], [78, 50], [30, 80])], // 32 filled triangle right
    [P([70, 20], [22, 50], [70, 80])], // 33 filled triangle left

    // ---- composites ----
    [C(50, 50, 34), L([16, 50], [84, 50]), L([50, 16], [50, 84])], // 34 circled plus
    [C(50, 50, 34), L([26, 26], [74, 74]), L([74, 26], [26, 74])], // 35 circled cross
    [C(50, 50, 34), D(50, 50, 15)], // 36 circled disc
    [L([18, 18], [82, 18], [82, 82], [18, 82], [18, 18]), L([50, 18], [50, 82]), L([18, 50], [82, 50])], // 37 windowed square
    [L([18, 18], [82, 18], [82, 82], [18, 82], [18, 18]), L([20, 20], [80, 80]), L([80, 20], [20, 80])], // 38 crossed square
    [L([18, 18], [82, 18], [82, 82], [18, 82], [18, 18]), L([18, 50], [82, 50])], // 39 halved square
    [L([18, 18], [82, 18], [82, 82], [18, 82], [18, 18]), L([50, 18], [50, 82])], // 40 split square
    [L([18, 18], [82, 18], [82, 82], [18, 82], [18, 18]), D(50, 50, 16)], // 41 centred square
    [C(50, 50, 34), L([16, 50], [84, 50])], // 42 circle with bar
    [C(50, 50, 32), D(50, 66, 12)], // 43 circle with low disc
    [C(50, 50, 30), D(50, 34, 12)], // 44 circle with high disc
    [L([20, 20], [80, 80]), D(62, 38, 13)], // 45 crossed with disc

    // ---- dot patterns ----
    [D(32, 50, 13), D(68, 50, 13)], // 46 two discs across
    [D(50, 32, 13), D(50, 68, 13)], // 47 two discs stacked
    [D(26, 26, 11), D(50, 50, 11), D(74, 74, 11)], // 48 three discs diagonal
    [D(30, 30, 11), D(70, 30, 11), D(30, 70, 11), D(70, 70, 11)], // 49 four discs
    [D(50, 26, 12), D(26, 74, 12), D(74, 74, 12)], // 50 three discs pyramid
    [D(30, 50, 12), D(50, 30, 12), D(70, 50, 12), D(50, 70, 12)], // 51 four discs diamond

    // ---- arrows ----
    [L([50, 16], [50, 80]), L([28, 36], [50, 14], [72, 36])], // 52 arrow up
    [L([50, 20], [50, 84]), L([28, 64], [50, 86], [72, 64])], // 53 arrow down
    [L([84, 50], [16, 50]), L([36, 28], [14, 50], [36, 72])], // 54 arrow left
    [L([16, 50], [84, 50]), L([64, 28], [86, 50], [64, 72])], // 55 arrow right

    // ---- letters (highly distinguishable, common in real charts) ----
    [L([22, 84], [50, 18], [78, 84]), L([32, 58], [68, 58])], // 56 A
    [L([22, 18], [50, 82], [78, 18])], // 57 V
    [L([20, 22], [80, 22], [20, 80], [80, 80])], // 58 Z
    [L([24, 82], [24, 18], [76, 82], [76, 18])], // 59 N
    [L([24, 18], [24, 84]), L([76, 18], [76, 84]), L([24, 50], [76, 50])], // 60 H
    [L([18, 18], [32, 82], [50, 40], [68, 82], [82, 18])], // 61 W
    [L([26, 18], [26, 84]), L([74, 18], [30, 52]), L([42, 44], [76, 84])], // 62 K
    [L([76, 30], [62, 20], [38, 20], [24, 32], [24, 44], [62, 52], [78, 62], [78, 76], [62, 84], [38, 84], [24, 74])], // 63 S
    [L([76, 20], [28, 20], [28, 82], [76, 82]), L([28, 50], [66, 50])], // 64 E
  ];

  window.StitchSymbols = {
    count: SYMBOLS.length,
    // Stroke width as a fraction of the cell size, so glyph weight scales with
    // the chart the same way the stitch strands do.
    strokeRatio: 0.055,

    /** Primitives for a glyph index. Wraps, so a bad index can never throw. */
    primitives: function (index) {
      var n = SYMBOLS.length;
      var i = ((index | 0) % n + n) % n;
      return SYMBOLS[i];
    },
  };
})();
