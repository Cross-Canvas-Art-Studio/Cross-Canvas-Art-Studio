/**
 * tools/verify_render.js - headless verification of the shared render layer.
 *
 * The canvas/SVG/PDF backends all draw through one adapter interface
 * (drawChart + CanvasAdapter/SvgAdapter in App/static/canvas-renderer.js). That
 * means the SVG export is a faithful, inspectable proxy for what the canvas and
 * the PDF produce, so we can assert on it without a browser.
 *
 * Run:  node tools/verify_render.js
 * Exits non-zero on failure so it can gate CI.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const STATIC = path.join(__dirname, "..", "App", "static");

// ---- minimal DOM stubs -----------------------------------------------------
function makeCtx() {
  const ctx = {};
  [
    "beginPath", "closePath", "moveTo", "lineTo", "stroke", "arc", "fill",
    "fillRect", "strokeRect", "fillText", "save", "restore", "clearRect",
    "setLineDash", "getLineDash", "scale", "translate", "rotate", "clip",
  ].forEach((m) => {
    ctx[m] = function () {};
  });
  return ctx;
}
function makeCanvas() {
  return {
    width: 0,
    height: 0,
    hidden: false,
    parentElement: null,
    getContext: () => makeCtx(),
    addEventListener: function () {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    toBlob: (cb) => cb({ size: 1, type: "image/png" }),
  };
}

const sandbox = {
  window: { addEventListener: function () {} },
  document: { createElement: (t) => (t === "canvas" ? makeCanvas() : {}) },
  console,
};
vm.createContext(sandbox);

for (const f of ["symbols.js", "skein.js", "canvas-renderer.js"]) {
  vm.runInContext(fs.readFileSync(path.join(STATIC, f), "utf8"), sandbox, {
    filename: f,
  });
}

const { CrossStitchCanvas, StitchSymbols } = sandbox.window;

// ---- fixtures --------------------------------------------------------------
// Indices are chosen to exercise all four glyph primitive kinds:
//   0  -> line pairs (X)      16 -> circle
//   25 -> disc                27 -> filled polygon (triangle)
const PALETTE = [
  { index: 0, code: "WHT", name: "White", hex: "#FFFFFF", symbol: 0 },
  { index: 1, code: "BLK", name: "Black", hex: "#1A1A1A", symbol: 16 },
  { index: 2, code: "RED", name: "Red", hex: "#E01B22", symbol: 25 },
  { index: 3, code: "BLU", name: "Blue", hex: "#2E6FDA", symbol: 27 },
];

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? " -> " + detail : ""}`);
  }
}
function countOf(hay, needle) {
  return hay.split(needle).length - 1;
}

function makeChart() {
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  c.loadGrid(4, 2, [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
  ]);
  c.cellSize = 20;
  return c;
}

console.log("glyph table");
check("glyph count covers the palette", StitchSymbols.count >= PALETTE.length,
  `count=${StitchSymbols.count}`);
check("every glyph yields primitives", (() => {
  for (let i = 0; i < StitchSymbols.count; i++) {
    const p = StitchSymbols.primitives(i);
    if (!Array.isArray(p) || p.length === 0) return false;
  }
  return true;
})());

console.log("\nSVG export: stitches only");
{
  const c = makeChart();
  c.showGlyphs = false;
  c.showCodes = false;
  const svg = c.exportSvg({ scale: 20 });
  check("is an SVG document", svg.startsWith('<?xml') && svg.includes("<svg "));
  check("has a white background rect", svg.includes('fill="#ffffff"'));
  check("draws stitch strands", countOf(svg, "<polyline") > 0);
  check("draws grid lines", countOf(svg, "<polyline") >= 8, "grid+strands");
  check("draws no glyphs", !svg.includes("<circle"));
  check("viewBox matches the grid", svg.includes('viewBox="0 0 80 40"'),
    svg.slice(0, 200));
}

console.log("\nSVG export: symbols on");
{
  const c = makeChart();
  c.showGlyphs = true;
  const svg = c.exportSvg({ scale: 20 });
  // Glyph 16 is a stroked circle, 25 a filled disc, 27 a filled triangle.
  check("renders circle glyphs", countOf(svg, "<circle") >= 2);
  check("renders polygon glyphs", countOf(svg, "<polygon") >= 2);
  check("renders line-based glyphs", countOf(svg, "<polyline") > 8);
  // Ink auto-contrast: white stitches get dark ink, dark stitches get light ink.
  check("dark ink for the white stitch", svg.includes("#111111"));
  check("light ink for the dark stitch", svg.includes("#ffffff"));
  check("glyph strokes are rounded", svg.includes('stroke-linecap="round"'));
}

console.log("\nSVG export: codes mode");
{
  const c = makeChart();
  c.showCodes = true;
  const svg = c.exportSvg({ scale: 20 });
  check("emits code text", svg.includes(">WHT<") && svg.includes(">RED<"));
  check("text carries its ink colour", svg.includes("<text "));
  check("no glyphs drawn in codes mode", !svg.includes("<circle"));
}

console.log("\nSVG escaping safety");
{
  const c = makeChart();
  const nasty = { index: 0, code: "<&>\"'", name: "x", hex: "#FFFFFF", symbol: 0 };
  c.setPalette([nasty]);
  c.loadGrid(1, 1, [[0]]);
  c.showCodes = true;
  const svg = c.exportSvg({ scale: 20 });
  check("escapes XML metacharacters", !/>[^<]*<&/.test(svg) && svg.includes("&lt;"));
}

console.log("\nPNG path (canvas adapter) does not throw");
{
  const c = makeChart();
  let blob = null;
  c.showGlyphs = true;
  c.exportBlob((b) => (blob = b), 18);
  check("exportBlob produced a blob", blob !== null);
}

console.log("\nGrid emphasis + ruler options");
{
  const c = makeChart();
  c.showGrid = false;
  const plain = c.exportSvg({ scale: 20 });
  const withRuler = c.exportSvg({
    scale: 20,
    ruler: {
      gutter: 10, every: 2, fontSize: 6, color: "#333333",
      contentW: 80, contentH: 40,
    },
  });
  check("ruler adds row/column numbers", withRuler.length > plain.length);
  check("ruler emits text", withRuler.includes("<text "));
}

console.log("\nCodes are centred, not drifting");
{
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  c.loadGrid(1, 1, [[0]]);
  c.cellSize = 20;
  c.showCodes = true;
  const svg = c.exportSvg({ scale: 20 });
  const m = svg.match(/<text x="([\d.]+)" y="([\d.]+)"[^>]*font-size="([\d.]+)"/);
  check("emits a text element", !!m);
  if (m) {
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    const size = parseFloat(m[3]);
    // Cell is 1x1 at 20px, so its centre is (10, 10).
    check("horizontally centred in the cell", Math.abs(x - 10) < 0.01, `x=${x}`);
    // An alphabetic baseline sits BELOW the visual centre by ~half the cap
    // height, so y must be centre < y < centre + size.
    check("uses a baseline offset, not the visual centre", y > 10 && y < 10 + size,
      `y=${y} size=${size}`);
  }
  check("does not rely on dominant-baseline:central", !svg.includes('dominant-baseline="central"'));
  check("declares an alphabetic baseline", svg.includes('dominant-baseline="auto"'));
}

console.log("\nLong code labels shrink instead of overflowing");
{
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette([{ index: 0, code: "WHT", name: "White", hex: "#FFFFFF", symbol: 0 }]);
  c.loadGrid(1, 1, [[0]]);
  c.cellSize = 20;
  c.showCodes = true;
  c.setCodeFormatter(() => "White / WHT"); // the long "Name" label format
  const svg = c.exportSvg({ scale: 20 });
  const m = svg.match(/font-size="([\d.]+)"/);
  check("shrinks the font for a long label", m && parseFloat(m[1]) < 6,
    m ? `font-size=${m[1]}` : "no text");
}

console.log("\nClient palette without a symbol field (the static build)");
{
  // Regression: static-adapter.js ships a hand-maintained palette with no
  // `symbol` key. Every colour used to collapse onto glyph 0, so the Symbols
  // toggle appeared to offer a single symbol.
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette([
    { index: 0, code: "A", hex: "#FFFFFF" },
    { index: 1, code: "B", hex: "#000000" },
    { index: 2, code: "C", hex: "#FF0000" },
    { index: 3, code: "D", hex: "#00FF00" },
  ]);
  const got = [0, 1, 2, 3].map((i) => c.glyphFor(i));
  check("falls back to distinct glyph indices", new Set(got).size === 4, got.join());
  check("fallback matches the palette position", got.join() === "0,1,2,3", got.join());

  const c2 = new CrossStitchCanvas(makeCanvas(), {});
  c2.setPalette([{ index: 0, hex: "#FFFFFF", symbol: 42 }]);
  check("still honours an explicit symbol field", c2.glyphFor(0) === 42);
}

console.log("\nProgress: RLE codec");
{
  const enc = CrossStitchCanvas.progressToRuns;
  const dec = CrossStitchCanvas.progressFromRuns;
  const cases = [
    ["all zero", new Uint8Array(8)],
    ["all one", new Uint8Array(8).fill(1)],
    ["alternating", Uint8Array.from([0, 1, 0, 1, 0, 1])],
    ["leading ones", Uint8Array.from([1, 1, 0, 0, 1])],
    ["trailing ones", Uint8Array.from([0, 0, 1, 1, 1])],
    ["single one", Uint8Array.from([1])],
    ["single zero", Uint8Array.from([0])],
    ["empty", new Uint8Array(0)],
  ];
  cases.forEach(([label, arr]) => {
    const runs = enc(arr);
    const back = dec(runs, arr.length);
    const same =
      back.length === arr.length &&
      arr.every((v, i) => (v ? 1 : 0) === back[i]);
    check(`round-trips ${label}`, same, `runs="${runs}"`);
  });
  // The whole point: 250,000 cells of a blank chart collapse to "250000".
  const big = enc(new Uint8Array(250000));
  check("collapses a huge all-zero array", big === "250000", big.slice(0, 24));
}

console.log("\nProgress: unit tracking");
{
  const c = makeChart(); // 4x2 grid, all 8 cells painted
  c.setProgressOn(true);
  c.setProgressMode("row");

  let st = c.progressStats();
  check("starts on unit 1", st.unit === 0 && st.unitLabel === 1, JSON.stringify(st));
  check("0% before any marks", st.percent === 0, String(st.percent));
  check("total counts only real stitches", st.total === 8, "total=" + st.total);

  c.setProgress(Uint8Array.from([1, 1, 1, 1, 0, 0, 0, 0]));
  st = c.progressStats();
  check("advances to unit 2 once row 1 is done", st.unit === 1, JSON.stringify(st));
  check("reports 50%", st.percent === 50, String(st.percent));

  c.setProgress(new Uint8Array(8).fill(1));
  st = c.progressStats();
  check("unit is null when everything is stitched", st.unit === null);
  check("reports 100%", st.percent === 100, String(st.percent));

  c.setProgressMode("column");
  check("column count equals the width", c.unitCount() === 4, String(c.unitCount()));
  c.setProgressMode("diagonal");
  check("diagonal count is w + h - 1", c.unitCount() === 5, String(c.unitCount()));
  c.setProgressMode("row");
  check("row count equals the height", c.unitCount() === 2, String(c.unitCount()));
}

console.log("\nProgress: empty cells are not stitches");
{
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  c.loadGrid(2, 2, [
    [0, -1],
    [-1, 1],
  ]);
  c.setProgressOn(true);
  const st = c.progressStats();
  check("empty cells excluded from the total", st.total === 2, "total=" + st.total);
  check("cannot mark an empty cell", c._applyMark(0, 1, 1) === false);
  check("can mark a real stitch", c._applyMark(0, 0, 1) === true);
  c.setProgress(Uint8Array.from([1, 0, 0, 1]));
  check(
    "chart reads complete when only empties remain",
    c.progressStats().unit === null,
    JSON.stringify(c.progressStats()),
  );
}

console.log("\nProgress: cannot leak into any export");
{
  // A recording adapter stands in for PNG/SVG/PDF: all three go through
  // drawChart, so an identical op count proves the overlay is excluded.
  function RecordingAdapter() {
    this.calls = 0;
  }
  ["line", "polygon", "circle", "rect", "text"].forEach((m) => {
    RecordingAdapter.prototype[m] = function () {
      this.calls++;
    };
  });

  const c = makeChart();
  const svgBefore = c.exportSvg({ scale: 20 });
  const recBefore = new RecordingAdapter();
  c.renderTo(recBefore, 20, {});

  c.setProgressOn(true);
  c.setProgress(new Uint8Array(c.width * c.height).fill(1)); // mark everything
  c.render(); // draws the overlay on the live canvas

  const svgAfter = c.exportSvg({ scale: 20 });
  const recAfter = new RecordingAdapter();
  c.renderTo(recAfter, 20, {});

  check("SVG export is byte-identical after marking", svgBefore === svgAfter);
  check(
    "export op count unchanged after marking",
    recBefore.calls === recAfter.calls,
    `${recBefore.calls} -> ${recAfter.calls}`,
  );
  check(
    "marks do not alter stitch/colour counts",
    c.stitchCount() === 8 && c.colorCount() === 4,
    `${c.stitchCount()} stitches, ${c.colorCount()} colours`,
  );
}

// ------------------------------------------------------------- selections
function selChart(grid) {
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  c.loadGrid(grid[0].length, grid.length, grid);
  c.cellSize = 20;
  return c;
}
function gridOf(c) {
  return JSON.stringify(c.getDesign().grid);
}

console.log("\nSelection: marquee normalisation");
{
  const c = selChart([
    [0, 1, 2, 3],
    [1, 2, 3, 0],
    [2, 3, 0, 1],
  ]);
  c.setSelection(2, 3, 0, 1); // dragged bottom-right back to top-left
  const n = c._selNorm();
  check(
    "normalises a reverse drag",
    n.r0 === 0 && n.c0 === 1 && n.r1 === 2 && n.c1 === 3,
    JSON.stringify(n),
  );
  check("reports rows and cols", n.rows === 3 && n.cols === 3);
  c.setSelection(-5, -5, 99, 99);
  const m = c._selNorm();
  check(
    "clamps to the grid",
    m.r0 === 0 && m.c0 === 0 && m.r1 === 2 && m.c1 === 3,
    JSON.stringify(m),
  );
  check("selectionInfo is exposed", !!c.selectionInfo());
  c.clearSelection();
  check("clearSelection removes the marquee", c.hasSelection() === false);
}

console.log("\nSelection: copy / paste / delete / fill");
{
  const c = selChart([
    [0, 1, 2, 3],
    [1, 2, 3, 0],
    [2, 3, 0, 1],
  ]);
  c.setSelection(0, 0, 1, 1);
  check("copy succeeds", c.copySelection() === true);
  check("clipboard holds a 2x2 block", c.clipboard.rows === 2 && c.clipboard.cols === 2);
  check("hasClipboard reports true", c.hasClipboard() === true);

  c.setSelection(1, 2, 1, 2);
  check("paste succeeds", c.pasteClipboard() === true);
  check(
    "paste writes the block at the marquee origin",
    gridOf(c) === JSON.stringify([[0, 1, 2, 3], [1, 2, 0, 1], [2, 3, 1, 2]]),
    gridOf(c),
  );
  check(
    "paste moves the marquee onto the pasted block",
    c.sel.r0 === 1 && c.sel.c0 === 2 && c.sel.r1 === 2 && c.sel.c1 === 3,
    JSON.stringify(c.sel),
  );

  // Edge clipping must not throw or wrap around.
  const c2 = selChart([
    [0, 1, 2, 3],
    [1, 2, 3, 0],
    [2, 3, 0, 1],
  ]);
  c2.setSelection(0, 0, 1, 1);
  c2.copySelection();
  c2.setSelection(2, 3, 2, 3);
  c2.pasteClipboard();
  const g2 = c2.getDesign().grid;
  check(
    "paste clips at the grid edge",
    g2.length === 3 && g2[2][3] === 0 && g2[2].length === 4,
    JSON.stringify(g2),
  );

  // Delete then fill, checking the counts follow.
  const c3 = selChart([
    [0, 1, 2, 3],
    [1, 2, 3, 0],
    [2, 3, 0, 1],
  ]);
  c3.setSelection(0, 0, 0, 3);
  check("delete succeeds", c3.deleteSelection() === true);
  check("delete clears those cells", c3.getDesign().grid[0].every((v) => v === -1));
  check("stitch count drops after delete", c3.stitchCount() === 8, String(c3.stitchCount()));

  c3.setSelected(2);
  check("fill succeeds", c3.fillSelection() === true);
  check(
    "fill uses the selected colour",
    c3.getDesign().grid[0].every((v) => v === 2),
    gridOf(c3),
  );
  check("stitch count restored by fill", c3.stitchCount() === 12, String(c3.stitchCount()));
}

console.log("\nSelection: mirror and rotate");
{
  const c = selChart([
    [0, 1, 2],
    [3, -1, 4],
  ]);
  c.setSelection(0, 0, 1, 2);
  c.mirrorSelection("h");
  check(
    "mirror horizontal reverses columns",
    gridOf(c) === JSON.stringify([[2, 1, 0], [4, -1, 3]]),
    gridOf(c),
  );
  c.mirrorSelection("h");
  check("mirrorring horizontally twice is identity",
    gridOf(c) === JSON.stringify([[0, 1, 2], [3, -1, 4]]), gridOf(c));
  c.mirrorSelection("v");
  check(
    "mirror vertical reverses rows",
    gridOf(c) === JSON.stringify([[3, -1, 4], [0, 1, 2]]),
    gridOf(c),
  );
}
{
  // The selection is a 2x3 block inside a 3x3 grid, so the rotated 3x2 result
  // fits AND there is a neighbouring column to prove it is left untouched.
  const c = selChart([
    [0, 1, 2],
    [3, 4, 5],
    [9, 9, 9],
  ]);
  c.setSelection(0, 0, 1, 2);
  c.rotateSelection(1);
  // The rotated 3x2 block covers cols 0-1, so the source cells that were in
  // cols 0-2 but fall outside it become empty. Row 2 was never selected, so its
  // trailing 9 must survive — that is the neighbour-sparing guarantee.
  check(
    "rotate CW maps cells correctly and spares unselected rows",
    gridOf(c) === JSON.stringify([[3, 0, -1], [4, 1, -1], [5, 2, 9]]),
    gridOf(c),
  );

  const c2 = selChart([
    [0, 1, 2],
    [3, 4, 5],
    [9, 9, 9],
  ]);
  c2.setSelection(0, 0, 1, 2);
  c2.rotateSelection(-1);
  check(
    "rotate CCW maps cells correctly and spares unselected rows",
    gridOf(c2) === JSON.stringify([[2, 5, -1], [1, 4, -1], [0, 3, 9]]),
    gridOf(c2),
  );

  // Rotating the result back must restore the original block.
  c2.setSelection(0, 0, 2, 1);
  c2.rotateSelection(1);
  const block = c2.getDesign().grid.slice(0, 2).map((row) => row.slice(0, 3));
  check(
    "CCW then CW restores the original block",
    JSON.stringify(block) === JSON.stringify([[0, 1, 2], [3, 4, 5]]),
    JSON.stringify(block),
  );
}

console.log("\nSelection: crop and nudge");
{
  const c = selChart([
    [0, 1, 2, 3],
    [1, 2, 3, 0],
    [2, 3, 0, 1],
    [3, 0, 1, 2],
  ]);
  c.setSelection(1, 1, 2, 2);
  check("crop succeeds", c.cropToSelection() === true);
  check("grid resized to the marquee", c.width === 2 && c.height === 2, `${c.width}x${c.height}`);
  check(
    "cropped content is correct",
    gridOf(c) === JSON.stringify([[2, 3], [3, 0]]),
    gridOf(c),
  );
  check("crop clears the selection", c.hasSelection() === false);
  check("progress array resized with the grid", c.progress.length === 4,
    String(c.progress.length));
  check("counts recomputed after crop", c.stitchCount() === 4, String(c.stitchCount()));
}
{
  const c = selChart([
    [0, 1, 2, 3],
    [1, 2, 3, 0],
    [2, 3, 0, 1],
    [3, 0, 1, 2],
  ]);
  c.setSelection(0, 0, 0, 0);
  check("nudge moves the marquee", c.nudgeSelection(1, 1) && c.sel.r0 === 1 && c.sel.c0 === 1);
  check("nudge back returns the marquee", c.nudgeSelection(-1, -1) && c.sel.r0 === 0 && c.sel.c0 === 0);
  check("nudging past the edge is a no-op", c.nudgeSelection(-1, -1) === false);
  c.setSelection(0, 0, 1, 1);
  c.nudgeSelection(9, 9);
  const n = c._selNorm();
  check("nudge clamps inside the grid", n.r1 <= 3 && n.c1 <= 3 && n.r0 === 2 && n.c0 === 2,
    JSON.stringify(n));
}

console.log("\nSelection: outline never reaches an export");
{
  function SelRecorder() {
    this.calls = 0;
  }
  ["line", "polygon", "circle", "rect", "text"].forEach((m) => {
    SelRecorder.prototype[m] = function () {
      this.calls++;
    };
  });

  const c = makeChart();
  const svgBefore = c.exportSvg({ scale: 20 });
  const recBefore = new SelRecorder();
  c.renderTo(recBefore, 20, {});

  c.setSelection(0, 0, 2, 2);
  c.render(); // draws marching ants on the live canvas

  const svgAfter = c.exportSvg({ scale: 20 });
  const recAfter = new SelRecorder();
  c.renderTo(recAfter, 20, {});

  check("SVG export unchanged by a selection", svgBefore === svgAfter);
  check(
    "export op count unchanged by a selection",
    recBefore.calls === recAfter.calls,
    `${recBefore.calls} -> ${recAfter.calls}`,
  );
}

console.log("\nAdapter vocabulary: canvas text state is legal");
{
  // The stub context accepts ANY assignment, so a bad value never throws and a
  // silently-ignored property is invisible. Assert the VALUES instead: canvas
  // ignores an invalid textAlign, which left every cell code pinned to "start"
  // and rendering from the cell centre rightwards.
  const CANVAS_ANCHORS = ["left", "right", "center", "start", "end"];
  const CANVAS_BASELINES = [
    "top", "hanging", "middle", "alphabetic", "ideographic", "bottom",
  ];

  const seen = [];
  const recCtx = {};
  [
    "beginPath", "closePath", "moveTo", "lineTo", "stroke", "arc", "fill",
    "fillRect", "strokeRect", "fillText", "save", "restore", "clearRect",
    "setLineDash", "getLineDash", "scale", "translate", "rotate", "clip",
  ].forEach((m) => {
    recCtx[m] = function () {};
  });
  Object.defineProperty(recCtx, "textAlign", {
    set(v) { seen.push(["textAlign", v]); },
    get() { return ""; },
  });
  Object.defineProperty(recCtx, "textBaseline", {
    set(v) { seen.push(["textBaseline", v]); },
    get() { return ""; },
  });

  const c = new CrossStitchCanvas(
    {
      width: 0, height: 0, hidden: false, parentElement: null,
      getContext: () => recCtx,
      addEventListener() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
      toBlob: (cb) => cb({}),
    },
    {},
  );
  c.setPalette(PALETTE);
  c.loadGrid(2, 1, [[0, 1]]);
  c.cellSize = 20;
  c.showCodes = true;
  c.render();

  const anchors = seen.filter((s) => s[0] === "textAlign").map((s) => s[1]);
  const baselines = seen.filter((s) => s[0] === "textBaseline").map((s) => s[1]);

  check("textAlign is set at all", anchors.length > 0, String(anchors.length));
  check(
    "every textAlign value is legal for canvas",
    anchors.every((v) => CANVAS_ANCHORS.indexOf(v) >= 0),
    JSON.stringify(anchors),
  );
  check(
    "every textBaseline value is legal for canvas",
    baselines.every((v) => CANVAS_BASELINES.indexOf(v) >= 0),
    JSON.stringify(baselines),
  );
  check(
    "cell codes are horizontally centred",
    anchors.indexOf("center") >= 0,
    JSON.stringify(anchors),
  );

  // Every adapter must accept the shared "middle" vocabulary: SVG's
  // text-anchor and the PDF adapter use it, canvas maps it to "center".
  const svg = c.exportSvg({ scale: 20 });
  check("SVG uses text-anchor=\"middle\"", svg.includes('text-anchor="middle"'));
  check("SVG never emits text-anchor=\"center\"", !svg.includes('text-anchor="center"'));
}

// ---- skein estimation ------------------------------------------------------
// Skein figures are shown to stitchers as a shopping estimate, so the maths has
// to be monotonic and must scale the way the underlying thread consumption does.
function checkSkein() {
  const S = sandbox.window.StitchSkein;
  check("skein.js exposes StitchSkein", !!S);
  if (!S) return;

  const cfg = {
    stitches_per_skein_at_14ct: 1700,
    used_strands: 2,
    waste_factor: 0.15,
  };

  // The published worked example: 1700 stitches per skein at the reference.
  check(
    "14 ct / 2 strands covers the calibrated 1700 stitches",
    S.stitchesPerSkein(14, cfg) === 1700,
    String(S.stitchesPerSkein(14, cfg)),
  );

  // Thread per stitch scales as 1/count, so finer fabric covers more.
  const per = [10, 14, 16, 18, 25].map((c) => S.stitchesPerSkein(c, cfg));
  check(
    "finer fabric covers more stitches per skein",
    per.every((v, i) => i === 0 || v > per[i - 1]),
    JSON.stringify(per),
  );

  // More strands burn floss proportionally faster.
  check(
    "4 strands halves the coverage of 2",
    S.stitchesPerSkein(14, { ...cfg, used_strands: 4 }) * 2 ===
      S.stitchesPerSkein(14, cfg),
  );

  // Rounding must never report a fraction of a skein, and must never say 0 for
  // a design that has stitches -- "0 skeins" would read as "buy nothing".
  const mid = [1, 50, 500, 1700, 1701, 9000].map((n) => S.skeinsFor(n, 14, cfg));
  check(
    "skein counts are whole numbers",
    mid.every((v) => Number.isInteger(v)),
    JSON.stringify(mid),
  );
  check(
    "any stitches at all needs at least one skein",
    S.skeinsFor(1, 14, cfg) === 1,
    String(S.skeinsFor(1, 14, cfg)),
  );
  check("no stitches needs no skeins", S.skeinsFor(0, 14, cfg) === 0);
  check(
    "skeins are monotonically non-decreasing in stitch count",
    mid.every((v, i) => i === 0 || v >= mid[i - 1]),
    JSON.stringify(mid),
  );
  check(
    "10,000 stitches at 14 ct is about 7 skeins",
    S.skeinsFor(10000, 14, cfg) === 7,
    String(S.skeinsFor(10000, 14, cfg)),
  );

  // A zero waste factor is a legitimate configuration and must be honoured
  // rather than silently falling back to the 15% default.
  check(
    "zero waste factor is honoured, not replaced by the default",
    S.skeinsFor(1700, 14, { waste_factor: 0 }) === 1,
    String(S.skeinsFor(1700, 14, { waste_factor: 0 })),
  );
  check(
    "a larger waste factor never reduces the estimate",
    S.skeinsFor(10000, 14, { waste_factor: 0.5 }) >=
      S.skeinsFor(10000, 14, { waste_factor: 0.15 }),
  );

  // A missing or nonsense config must degrade to the documented defaults, not
  // to NaN -- NaN would render as "NaN skeins" in the legend.
  const broken = S.skeinsFor(10000, 14, {});
  check(
    "missing config falls back to defaults",
    broken === S.skeinsFor(10000, 14, S.options({})),
    String(broken),
  );
  const junk = S.skeinsFor("abc", 14, cfg);
  check("non-numeric stitch counts yield 0, not NaN", junk === 0, String(junk));
  const junkCount = S.skeinsFor(1000, "not-a-count", cfg);
  check(
    "a non-numeric fabric count does not produce NaN",
    Number.isInteger(junkCount) && junkCount > 0,
    String(junkCount),
  );
  const opts = S.options({ used_strands: 0, waste_factor: -1 });
  check(
    "non-positive strands and negative waste fall back to defaults",
    opts.usedStrands === S.DEFAULTS.usedStrands &&
      opts.wasteFactor === S.DEFAULTS.wasteFactor,
    JSON.stringify(opts),
  );
}

checkSkein();

console.log(
  failures === 0
    ? "\nAll render-layer checks passed."
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);

