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
// The renderer source is read twice: once to execute, once so a test can assert
// on constants that only exist as literals (a colour, a threshold).
const RENDERER_SRC = fs.readFileSync(
  path.join(STATIC, "canvas-renderer.js"),
  "utf8",
);

// ---- minimal DOM stubs -----------------------------------------------------
function makeCtx() {
  const ctx = {};
  [
    "beginPath", "closePath", "moveTo", "lineTo", "stroke", "arc", "fill",
    "fillRect", "strokeRect", "fillText", "save", "restore", "clearRect",
    "setLineDash", "getLineDash", "scale", "translate", "rotate", "clip",
    // drawImage, rect, ellipse and strokeText are only ever used for the
    // on-screen substrate/overlay/annotation layers, never by an adapter, so
    // no-ops here cannot mask a leak into an export.
    "drawImage", "rect", "ellipse", "strokeText",
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

console.log("\nLocate / Spotlight");
{
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  c.loadGrid(2, 2, [
    [0, 1],
    [2, 0],
  ]);
  c.setSpotlight({ kind: "colour", value: 0 });
  check(
    "spotlight colour counts its stitches",
    c.spotlightCount() === 2,
    "n=" + c.spotlightCount(),
  );
  check("hasSpotlight is true while locating", c.hasSpotlight() === true);

  // Symbol mode goes through the SAME mechanism: palette entry 1 -> symbol 16.
  c.setSpotlightSymbol(16);
  check(
    "spotlight by symbol finds its stitches",
    c.spotlightCount() === 1,
    "n=" + c.spotlightCount(),
  );

  // Next-unstitched cycles through matching cells, then stops when all done.
  c.setSpotlight({ kind: "colour", value: 0 });
  const a = c.nextUnstitched();
  const b = c.nextUnstitched();
  check(
    "next unstitched visits each matching cell in turn",
    a && b && !(a.r === b.r && a.c === b.c),
    JSON.stringify([a, b]),
  );
  c.progress = Uint8Array.from([1, 0, 0, 1]); // mark both colour-0 stitches
  check("next unstitched skips stitched cells", c.nextUnstitched() === null);

  c.clearSpotlight();
  check(
    "clearSpotlight resets the state",
    c.hasSpotlight() === false && c.spotlightCount() === 0,
  );
}

console.log("\nLocate: cannot leak into any export");
{
  // Same recording-adapter trick as the progress overlay: identical op count
  // proves the spotlight is drawn outside drawChart.
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

  c.setSpotlight({ kind: "colour", value: 0 });
  c.render();

  const svgAfter = c.exportSvg({ scale: 20 });
  const recAfter = new RecordingAdapter();
  c.renderTo(recAfter, 20, {});

  check("SVG export is byte-identical with a spotlight on", svgBefore === svgAfter);
  check(
    "export op count unchanged with a spotlight on",
    recBefore.calls === recAfter.calls,
    `${recBefore.calls} -> ${recAfter.calls}`,
  );
}

console.log("\nChart markup: empty cells become markable");
{
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  c.loadGrid(2, 2, [
    [-1, -1],
    [-1, -1],
  ]);
  c.setProgressOn(true);
  check("pattern mode refuses to mark an empty cell", c._applyMark(0, 0, 1) === false);
  c.setAllCellsStitchable(true);
  check("chart mode marks an empty cell", c._applyMark(0, 0, 1) === true);
  const st = c.progressStats();
  check("chart mode counts every cell as a stitch", st.total === 4, "total=" + st.total);
}

console.log("\nChart substrate mode cannot leak into any export");
{
  // The imported artwork is drawn outside drawChart, so switching the render
  // order must not change a single export byte.
  const c = makeChart();
  const before = c.exportSvg({ scale: 20 });
  c.setOverlayUnder(true);
  const after = c.exportSvg({ scale: 20 });
  check("SVG export identical with the substrate mode on", before === after);
}

console.log("\nRead the chart: palette matching + grid apply");
{
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  c.loadGrid(2, 2, [
    [-1, -1],
    [-1, -1],
  ]);
  check("white snaps to the white entry", c.nearestPaletteIndex(255, 255, 255) === 0);
  check("near-black snaps to the black entry", c.nearestPaletteIndex(20, 20, 20) === 1);
  check("red snaps to the red entry", c.nearestPaletteIndex(230, 20, 30) === 2);
  check("nothing to read without a substrate", c.readSubstrateGrid() === null);
  const g = Int16Array.from([0, 1, 2, 3]);
  check("applyReadGrid replaces the grid", c.applyReadGrid(g) === true && c.cells[3] === 3);
  check(
    "applyReadGrid rejects a wrong-sized grid",
    c.applyReadGrid(new Int16Array(3)) === false,
  );
}

// ---- multi-page charts + stitch-along --------------------------------------
// A chart printed across several sheets is imported page by page onto ONE
// seamless grid. Two things must hold for that to be safe:
//   1. the substrate can never reach an export (it is drawn outside drawChart);
//   2. adding a page later may GROW the canvas but must not move existing markup
//      -- that is the whole point of a stitch-along.
function pageAt(col, row, cols, rows) {
  return { img: null, col, row, cols, rows, rot: 0, crop: null };
}

console.log("\nLegacy single-page charts migrate to a page");
{
  const C = CrossStitchCanvas;
  // 'stretch' fits the artwork to the whole grid, so the page IS the grid.
  const stretch = C.pageFromFit(
    { fit: "stretch", scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 },
    60, 80, 1200, 900,
  );
  check(
    "a stretched legacy chart becomes one full-grid page",
    stretch.col === 0 && stretch.row === 0 && stretch.cols === 60 && stretch.rows === 80,
    JSON.stringify(stretch),
  );
  // 'contain' letterboxes it, so the page is inset and shares the aspect ratio.
  const contain = C.pageFromFit({ fit: "contain" }, 100, 100, 200, 100);
  check(
    "a contained legacy chart keeps its shape",
    Math.abs(contain.cols - 100) < 1e-9 && Math.abs(contain.rows - 50) < 1e-9,
    JSON.stringify(contain),
  );
  check(
    "a contained legacy chart is centred",
    Math.abs(contain.col - 0) < 1e-9 && Math.abs(contain.row - 25) < 1e-9,
    JSON.stringify(contain),
  );
  check(
    "a page is never smaller than one stitch",
    C.pageFromFit({ fit: "stretch" }, 10, 10, 1, 1).cols >= 1,
  );
}

console.log("\nPage bounding box is the seamless canvas");
{
  const C = CrossStitchCanvas;
  check("no pages has no box", C.pageBoundsOf([]) === null);
  const box = C.pageBoundsOf([pageAt(0, 0, 60, 80), pageAt(60, 0, 40, 80)]);
  check(
    "two pages side by side span their combined width",
    box.col === 0 && box.row === 0 && box.cols === 100 && box.rows === 80,
    JSON.stringify(box),
  );
  const neg = C.pageBoundsOf([pageAt(-10, -5, 10, 5), pageAt(0, 0, 20, 20)]);
  check(
    "a page above/left of the origin extends the box",
    neg.col === -10 && neg.row === -5 && neg.cols === 30 && neg.rows === 25,
    JSON.stringify(neg),
  );
}

console.log("\nSTITCH-ALONG: growing the canvas keeps every mark");
{
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  c.loadGrid(4, 2, [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
  ]);
  c.cellSize = 20;
  c.setAllCellsStitchable(true);
  c.setProgressOn(true);
  c._applyMark(1, 3, 1); // bottom-right stitch, the one most at risk
  const before = c.cells[1 * 4 + 3];

  // Append page 2 to the right: the grid doubles in width and NOTHING moves.
  const grew = c.resizeGrid(8, 2, 0, 0);
  check("resizeGrid reports the resize", grew === true);
  check("new columns arrive empty", c.cells[1 * 8 + 7] === -1);
  check(
    "existing markup keeps its cell coordinates",
    c.cells[1 * 8 + 3] === before && before === 0,
    `was ${before}, now ${c.cells[1 * 8 + 3]}`,
  );
  check("progress survives the growth", c.progress[1 * 8 + 3] === 1);
  check("stitch counts are recounted", (c.counts[0] || 0) === 2, JSON.stringify(c.counts));
  check("the grid is the new size", c.width === 8 && c.height === 2);

  // Re-origin (a page pushed above/left) shifts artwork AND markup together.
  c._applyMark(0, 0, 1);
  c.resizeGrid(10, 4, 2, 2);
  check("a re-origin shifts stitches by the same amount", c.cells[2 * 10 + 2] === 0);
  check("a re-origin shifts progress too", c.progress[2 * 10 + 2] === 1);
  check("a no-op resize is refused", c.resizeGrid(10, 4, 0, 0) === false);
}

console.log("\nSubstrate pages draw at their grid offsets");
{
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  c.loadGrid(8, 4, []);
  c.cellSize = 20;
  const calls = [];
  const ctx = {
    save() {},
    restore() {},
    translate(x, y) {
      calls.push(["t", x, y]);
    },
    rotate() {},
    beginPath() {},
    rect() {},
    clip() {},
    drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
      calls.push(["d", sx, sy, sw, sh, dx, dy, dw, dh]);
    },
  };
  const img = { naturalWidth: 10, naturalHeight: 20 };
  c._drawPageOn(ctx, { img, col: 2, row: 1, cols: 3, rows: 2, rot: 0, crop: null });
  const last = calls[calls.length - 1];
  check(
    "an unrotated page lands on its own cell rectangle",
    last[0] === "d" && last[5] === 40 && last[6] === 20 && last[7] === 60 && last[8] === 40,
    JSON.stringify(last),
  );
  check("the whole image is the source", last[1] === 0 && last[4] === 20, JSON.stringify(last));

  calls.length = 0;
  c._drawPageOn(ctx, { img, col: 0, row: 0, cols: 3, rows: 2, rot: 90, crop: null });
  const rot = calls[calls.length - 1];
  check(
    "a quarter-turned page swaps the drawn width and height",
    rot[7] === 40 && rot[8] === 60,
    JSON.stringify(rot),
  );

  calls.length = 0;
  c._drawPageOn(ctx, {
    img,
    col: 0,
    row: 0,
    cols: 3,
    rows: 2,
    rot: 0,
    crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
  });
  const cropped = calls[calls.length - 1];
  check(
    "a crop window selects part of the source image",
    cropped[1] === 5 && cropped[2] === 10 && cropped[3] === 5 && cropped[4] === 10,
    JSON.stringify(cropped),
  );

  // A slice repaint outside the page must not touch it at all.
  calls.length = 0;
  c._drawPageOn(ctx, { img, col: 0, row: 0, cols: 1, rows: 1, rot: 0 }, 500, 500, 20, 20);
  check("a slice far from the page draws nothing", calls.length === 0);
}

console.log("\nSubstrate pages cannot leak into any export");
{
  const c = makeChart();
  const before = c.exportSvg({ scale: 20 });
  c.setSubstratePages([pageAt(0, 0, 4, 2), pageAt(4, 0, 4, 2)]);
  const after = c.exportSvg({ scale: 20 });
  check("SVG export identical with pages joined on the canvas", before === after);
  check("pages switch the canvas into substrate mode", c.overlayUnder === true);
  check("the pages are held in order", c.substratePages().length === 2);
  check("the bounding box follows the joined pages", c.pageBounds().cols === 8);
  c.setSubstratePages([]);
  check("an empty page list leaves substrate mode", c.overlayUnder === false);
}

console.log("\nPage geometry is clamped, never zero-sized");
{
  const c = makeChart();
  c.setSubstratePages([pageAt(0, 0, 4, 2)]);
  check("a partial geometry update applies", c.setPageGeometry(0, { col: 2, rows: 5 }) === true);
  const p = c.substratePages()[0];
  check("col moved and rows grew", p.col === 2 && p.rows === 5, JSON.stringify(p));
  c.setPageGeometry(0, { cols: -3, rows: 0 });
  const q = c.substratePages()[0];
  check("a degenerate page is clamped to one stitch", q.cols === 1 && q.rows === 1, JSON.stringify(q));
  c.setPageGeometry(0, { rot: 95 });
  check("rotation snaps to a quarter turn", c.substratePages()[0].rot === 90);
  check("an out-of-range page index is ignored", c.setPageGeometry(9, { col: 1 }) === false);
}

console.log("\nReading a chart: paper and gaps are not stitches");
{
  // Drive the real read pass against a crafted supersampled buffer: the left
  // half of the chart has no artwork at all (transparent — what an L-shaped set
  // of joined pages leaves behind) and the right half is flat red. Untouched
  // pixels MUST read as empty; treating them as ink once turned every gap into
  // a black stitch.
  const K = 4;
  const W = 2;
  const H = 2;
  const bw = W * K;
  const bh = H * K;
  const data = new Uint8ClampedArray(bw * bh * 4);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = (y * bw + x) * 4;
      if (x < bw / 2) continue; // untouched: alpha stays 0
      data[i] = 230;
      data[i + 1] = 20;
      data[i + 2] = 30;
      data[i + 3] = 255;
    }
  }
  const realCreate = sandbox.document.createElement;
  sandbox.document.createElement = () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      save() {},
      restore() {},
      scale() {},
      drawImage() {},
      getImageData: () => ({ data }),
    }),
  });
  try {
    const c = new CrossStitchCanvas(makeCanvas(), {});
    c.setPalette(PALETTE);
    c.loadGrid(W, H, [
      [-1, -1],
      [-1, -1],
    ]);
    c.cellSize = 4;
    c.setSubstratePages([
      { img: { naturalWidth: 20, naturalHeight: 20 }, col: 0, row: 0, cols: W, rows: H, rot: 0 },
    ]);
    const grid = c.readSubstrateGrid();
    check("the read pass returns a grid", !!grid);
    if (grid) {
      check(
        "an uncovered column stays empty",
        grid[0] === -1 && grid[2] === -1,
        `${grid[0]},${grid[2]}`,
      );
      check(
        "a covered cell takes the artwork's colour",
        grid[1] === 2 && grid[3] === 2,
        `${grid[1]},${grid[3]}`,
      );
      check(
        "the empty cells count as no stitch at all",
        grid.filter((v) => v >= 0).length === 2,
        String(grid.filter((v) => v >= 0).length),
      );
    }
  } finally {
    sandbox.document.createElement = realCreate;
  }
}

// ------------------------------------------------------------- selections
console.log("\nStitch types: flag + edge geometry is orientation-correct");
{
  const C = CrossStitchCanvas;
  const F = C.FRAC;
  const B = C.BACK;
  // Mirroring a diagonal does NOT leave it alone: "/" becomes "\".
  check("a mirrored half stitch flips its diagonal",
    C.mapFrac(F.HALF_SLASH, "h") === F.HALF_BACKSLASH &&
    C.mapFrac(F.HALF_BACKSLASH, "h") === F.HALF_SLASH);
  check("a left-right mirror swaps the NW and NE arms",
    C.mapFrac(F.QUARTER_NW, "h") === F.QUARTER_NE &&
    C.mapFrac(F.QUARTER_SE, "h") === F.QUARTER_SW);
  check("a top-bottom mirror swaps the NW and SW arms",
    C.mapFrac(F.QUARTER_NW, "v") === F.QUARTER_SW &&
    C.mapFrac(F.QUARTER_NE, "v") === F.QUARTER_SE);
  check("rotating clockwise sends NW to NE",
    C.mapFrac(F.QUARTER_NW, "cw") === F.QUARTER_NE &&
    C.mapFrac(F.QUARTER_NE, "cw") === F.QUARTER_SE);
  check("rotating counter-clockwise sends NW to SW",
    C.mapFrac(F.QUARTER_NW, "ccw") === F.QUARTER_SW);
  check("a three-quarter stitch keeps three arms after a mirror",
    C.fracLabel(C.mapFrac(F.THREEQ_NW, "h")) === "three-quarter (NE \\)",
    C.fracLabel(C.mapFrac(F.THREEQ_NW, "h")));
  check("an unset flag stays unset", C.mapFrac(0, "cw") === 0);

  check("a mirrored border swaps its north and south sides",
    C.mapBackEdge(B.N, "v") === B.S && C.mapBackEdge(B.S, "v") === B.N);
  check("a mirrored border swaps its west and east sides",
    C.mapBackEdge(B.W, "h") === B.E && C.mapBackEdge(B.E, "h") === B.W);
  check("rotating a border clockwise steps it round",
    C.mapBackEdge(B.N, "cw") === B.E && C.mapBackEdge(B.W, "cw") === B.N);

  check("the labels name the partials", C.fracLabel(F.HALF_SLASH) === "half (/)",
    C.fracLabel(F.HALF_SLASH));
  check("a quarter is named by its corner",
    C.fracLabel(F.QUARTER_SW) === "quarter (SW)", C.fracLabel(F.QUARTER_SW));
  check("a full cross reports as full", C.fracLabel(0) === "full");
  check("the three-quarter preset really covers three arms",
    C.fracLabel(F.THREEQ_SE).indexOf("three-quarter") === 0,
    C.fracLabel(F.THREEQ_SE));
}

console.log("\nStitch types: the layer codec round-trips and never explodes");
{
  const C = CrossStitchCanvas;
  const src = new Uint8Array([0, 0, 0, 5, 5, 0, 0, 0, 0, 0, 0, 9, 9, 9]);
  const text = C.bytesToRuns(src);
  check("runs are value:count pairs", /^0:3,5:2,0:6,9:3$/.test(text), text);
  const back = C.runsToBytes(text, src.length);
  check("the codec round-trips exactly",
    back.length === src.length && back.every((v, i) => v === src[i]));
  check("an empty layer encodes to nothing", C.bytesToRuns(new Uint8Array(0)) === "");
  check("a null layer encodes to nothing", C.bytesToRuns(null) === "");
  // A hand-edited document must not be able to make us allocate or loop wildly.
  const junk = C.runsToBytes("nonsense,,7:x,-3:2,4:1000000000", 4);
  check("junk decodes to a correctly sized buffer", junk.length === 4, String(junk.length));
  check("junk never produces an out-of-range value",
    Array.from(junk).every((v) => v >= 0 && v <= 255), JSON.stringify(Array.from(junk)));
  const short = C.runsToBytes("1:1", 6);
  check("a truncated layer pads with zeros", short[0] === 1 && short[5] === 0);
  check("a missing layer decodes to zeros", C.runsToBytes("", 3).every((v) => v === 0));
}

console.log("\nStitch types: a shared border is ONE segment");
{
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  // One column, two rows: the border between the two cells is the shared one.
  c.loadGrid(1, 2, [[0], [0]]);
  c.cellSize = 20;
  // The border between the two cells, painted from each side in turn.
  c.setBackEdge(0, 0, CrossStitchCanvas.BACK.S, 2);
  const painted = c.backSegmentCount();
  c.setBackEdge(1, 0, CrossStitchCanvas.BACK.N, 2);
  check("painting the same border from either side does not duplicate it",
    painted === 1 && c.backSegmentCount() === 1, String(c.backSegmentCount()));
  check("either side reads the same segment",
    c.backEdgeAt(0, 0, CrossStitchCanvas.BACK.S) === 2 &&
    c.backEdgeAt(1, 0, CrossStitchCanvas.BACK.N) === 2);
  c.setBackEdge(1, 0, CrossStitchCanvas.BACK.N, -1);
  check("erasing from the far side removes the shared segment",
    c.backSegmentCount() === 0);
  check("a border cannot escape the grid",
    c.setBackEdge(-1, 0, CrossStitchCanvas.BACK.N, 1) === false &&
    c.setBackEdge(0, 9, CrossStitchCanvas.BACK.N, 1) === false);
  check("a bare border reads as -1", c.backEdgeAt(0, 0, CrossStitchCanvas.BACK.W) === -1);
}

console.log("\nStitch types: partials and outlines reach every export");
{
  const C = CrossStitchCanvas;
  const F = C.FRAC;
  const polylines = (svg) => (svg.match(/<polyline/g) || []).length;
  // Grid off so the only polylines are stitches and outlines.
  const svgOf = (c) => c.exportSvg({ scale: 20, showGrid: false });

  const full = new CrossStitchCanvas(makeCanvas(), {});
  full.setPalette(PALETTE);
  full.loadGrid(1, 1, [[0]]);
  full.cellSize = 20;
  check("a full cross is two strands", polylines(svgOf(full)) === 2,
    String(polylines(svgOf(full))));

  full.setFracAt(0, 0, F.HALF_SLASH);
  check("a half stitch is ONE strand, not a squashed cross",
    polylines(svgOf(full)) === 1, String(polylines(svgOf(full))));
  full.setFracAt(0, 0, F.QUARTER_NW);
  check("a quarter stitch is one short arm", polylines(svgOf(full)) === 1,
    String(polylines(svgOf(full))));
  full.setFracAt(0, 0, F.THREEQ_NW);
  check("a three-quarter stitch is a strand plus one arm",
    polylines(svgOf(full)) === 2, String(polylines(svgOf(full))));
  full.setFracAt(0, 0, 0);
  check("clearing the flags restores the full cross",
    polylines(svgOf(full)) === 2);

  const outlined = new CrossStitchCanvas(makeCanvas(), {});
  outlined.setPalette(PALETTE);
  outlined.loadGrid(1, 1, [[0]]);
  outlined.cellSize = 20;
  outlined.setBackEdge(0, 0, C.BACK.N, 1);
  check("a backstitch segment reaches the export",
    polylines(svgOf(outlined)) === 3, String(polylines(svgOf(outlined))));
  const svg = svgOf(outlined);
  check("the outline is drawn in its own colour",
    svg.indexOf(PALETTE[1].hex) >= 0, PALETTE[1].hex);

  // A 2x1 chart with the shared border set once: exactly one outline stroke.
  const shared = new CrossStitchCanvas(makeCanvas(), {});
  shared.setPalette(PALETTE);
  shared.loadGrid(2, 1, [[-1, -1]]);
  shared.cellSize = 20;
  shared.setBackEdge(0, 0, C.BACK.S, 2);
  check("an outline over empty cells exports exactly one stroke",
    polylines(svgOf(shared)) === 1, String(polylines(svgOf(shared))));
}

console.log("\nStitch types: layers survive every geometry change");
{
  const C = CrossStitchCanvas;
  const F = C.FRAC;
  const B = C.BACK;
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  c.loadGrid(2, 2, [[0, 0], [0, 0]]);
  c.cellSize = 20;
  c.setFracAt(1, 1, F.HALF_BACKSLASH);
  c.setBackEdge(1, 1, B.N, 3);

  // STITCH-ALONG: growing the canvas must carry the new layers too.
  c.resizeGrid(4, 2, 0, 0);
  check("a partial stitch survives growing the canvas",
    c.fracAt(1, 1) === F.HALF_BACKSLASH, String(c.fracAt(1, 1)));
  check("an outline survives growing the canvas",
    c.backEdgeAt(1, 1, B.N) === 3, String(c.backEdgeAt(1, 1, B.N)));

  // Re-origin: both layers move with their cells.
  c.resizeGrid(6, 4, 2, 2);
  check("a partial stitch follows a re-origin", c.fracAt(3, 3) === F.HALF_BACKSLASH);
  check("an outline follows a re-origin", c.backEdgeAt(3, 3, B.N) === 3);
  check("nothing is left behind at the old position", c.fracAt(1, 1) === 0);

  // Crop: the layers are sliced with the grid and re-canonicalised.
  c.setSelection(3, 3, 3, 3);
  c.cropToSelection();
  check("the grid is now the selection", c.width === 1 && c.height === 1);
  check("a crop keeps the partial stitch", c.fracAt(0, 0) === F.HALF_BACKSLASH);
  check("a crop keeps the outline on its own border",
    c.backEdgeAt(0, 0, B.N) === 3, String(c.backEdgeAt(0, 0, B.N)));

  // Loading a document restores both layers, and rejects a wrong-sized one.
  const d = new CrossStitchCanvas(makeCanvas(), {});
  d.setPalette(PALETTE);
  d.loadGrid(1, 1, [[0]], Uint8Array.from([F.HALF_SLASH]),
    Uint8Array.from([1, 0, 0, 0]));
  check("loadGrid restores the flags", d.fracAt(0, 0) === F.HALF_SLASH);
  check("loadGrid restores the outline", d.backEdgeAt(0, 0, B.N) === 0);
  d.loadGrid(1, 1, [[0]], Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 0]));
  check("a wrong-sized layer is discarded, not trusted",
    d.fracAt(0, 0) === 0 && d.backSegmentCount() === 0);

  // A read REPLACES the marks, so stale partials must go with it.
  const r = new CrossStitchCanvas(makeCanvas(), {});
  r.setPalette(PALETTE);
  r.loadGrid(2, 2, [[-1, -1], [-1, -1]]);
  r.setFracAt(0, 0, F.HALF_SLASH);
  r.setBackEdge(0, 0, B.N, 1);
  r.applyReadGrid(Int16Array.from([0, 1, 2, 3]));
  check("a chart read clears stale partial stitches", r.fracAt(0, 0) === 0);
  check("a chart read clears a stale outline", r.backSegmentCount() === 0);
}

console.log("\nStitch types: the legend counts outline-only flosses");
{
  const C = CrossStitchCanvas;
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  // One stitched cell in colour 0, and an outline in colour 1 that NO cell uses:
  // the shopping list has to mention colour 1 or the user never buys it.
  c.loadGrid(1, 2, [[0], [-1]]);
  c.cellSize = 20;
  c.setBackEdge(0, 0, C.BACK.W, 1);
  c.setBackEdge(1, 0, C.BACK.W, 1);
  c.setBackEdge(1, 0, C.BACK.N, 1);
  const counts = c.getCounts();
  const backs = c.backCounts();
  check("stitch counts are unchanged by the outline",
    Object.keys(counts).length === 1 && counts[0] === 1, JSON.stringify(counts));
  check("an outline-only colour is counted per floss",
    backs[1] === 3, JSON.stringify(backs));
  check("the outline colour never appears as a stitch count",
    counts[1] === undefined, JSON.stringify(counts));
  check("the two numbers agree on the total",
    c.backSegmentCount() === 3, String(c.backSegmentCount()));
  check("no outline means no rows", (() => {
    const e = new CrossStitchCanvas(makeCanvas(), {});
    e.setPalette(PALETTE);
    e.loadGrid(1, 1, [[0]]);
    return Object.keys(e.backCounts()).length === 0;
  })());
  // Erasing the whole outline must remove the row again.
  c.setBackEdge(0, 0, C.BACK.W, -1);
  c.setBackEdge(1, 0, C.BACK.W, -1);
  c.setBackEdge(1, 0, C.BACK.N, -1);
  check("clearing the outline empties its row", c.backSegmentCount() === 0);
}

console.log("\nBlended threads: two flosses, one stitch");
{
  const C = CrossStitchCanvas;
  // Grid off so the only polylines are strands.
  const svgOf = (c) => c.exportSvg({ scale: 20, showGrid: false });
  const polylines = (svg) => (svg.match(/<polyline/g) || []).length;

  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  c.loadGrid(1, 1, [[0]]);
  c.cellSize = 20;
  check("a fresh cell has no partner", c.blendAt(0, 0) === C.BLEND_NONE);
  check("no blends means an empty count map",
    Object.keys(c.blendCounts()).length === 0);

  // Colour 0 stitched with colour 1: the cell is drawn as one leg in each.
  c.setBlendAt(0, 0, 1);
  check("the partner is stored", c.blendAt(0, 0) === 1, String(c.blendAt(0, 0)));
  const svg = svgOf(c);
  check("it is still one full cross, not two stitches",
    polylines(svg) === 2, String(polylines(svg)));
  check("the export draws the primary floss",
    svg.indexOf(PALETTE[0].hex) >= 0, PALETTE[0].hex);
  check("the export draws the partner floss",
    svg.indexOf(PALETTE[1].hex) >= 0, PALETTE[1].hex);
  check("a solid stitch of the same colour would NOT show the partner", (() => {
    const s = new CrossStitchCanvas(makeCanvas(), {});
    s.setPalette(PALETTE);
    s.loadGrid(1, 1, [[0]]);
    s.cellSize = 20;
    return svgOf(s).indexOf(PALETTE[1].hex) < 0;
  })());

  // A partner equal to the cell's own colour is not a blend at all.
  c.setBlendAt(0, 0, 0);
  check("a cell blended with its own colour stores nothing",
    c.blendAt(0, 0) === C.BLEND_NONE && c.blendCount() === 0);
  c.setBlendAt(0, 0, 1);

  // The pair is the legend's unit: both flosses are on the order.
  c.loadGrid(3, 1, [[0, 1, -1]]);
  c.setBlendAt(0, 0, 1);
  c.setBlendAt(0, 1, 2);
  const pairs = c.blendCounts();
  check("blends are grouped by the PAIR of flosses",
    pairs["0,1"] === 1 && pairs["1,2"] === 1, JSON.stringify(pairs));
  check("a blended cell still counts once in its own colour",
    c.getCounts()[0] === 1 && c.getCounts()[1] === 1,
    JSON.stringify(c.getCounts()));
  check("an empty cell never reports a blend",
    c.blendAt(0, 2) === C.BLEND_NONE);

  // The codec is the same one the other layers use, so it round-trips.
  const runs = C.bytesToRuns(c.getBlend());
  check("the blend layer round-trips through the layer codec",
    (() => {
      const back = C.runsToBytes(runs, 3);
      const d = new CrossStitchCanvas(makeCanvas(), {});
      d.setPalette(PALETTE);
      d.loadGrid(3, 1, [[0, 1, -1]], null, null, back);
      return d.blendAt(0, 0) === 1 && d.blendAt(0, 1) === 2 &&
        d.blendAt(0, 2) === C.BLEND_NONE;
    })(), String(runs));

  // A layer that does not match the grid is junk, not a blend.
  const bad = new CrossStitchCanvas(makeCanvas(), {});
  bad.setPalette(PALETTE);
  bad.loadGrid(1, 1, [[0]], null, null, Uint8Array.from([2, 2, 2]));
  check("a wrong-sized blend layer is discarded, not trusted",
    bad.blendAt(0, 0) === C.BLEND_NONE && !bad.hasBlends());
}

console.log("\nBlended threads: painting, geometry, undo, clear");
{
  const C = CrossStitchCanvas;
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  c.loadGrid(2, 2, [[-1, -1], [-1, -1]]);
  c.cellSize = 20;
  const clean = c.history.length;

  // The paint tool lays down the colour AND its blend partner in one stroke.
  c.setBlendPartner(1);
  c._applyCell(0, 0, 0);
  c._pushHistory();
  check("painting with a partner sets the blend",
    c.blendAt(0, 0) === 1, String(c.blendAt(0, 0)));
  check("the history grew by exactly the one edit",
    c.history.length === clean + 1, String(c.history.length - clean));
  c.undo();
  check("undo takes the blend back with the colour",
    c.blendAt(0, 0) === C.BLEND_NONE, String(c.blendAt(0, 0)));
  c.redo();
  check("redo puts the blend back", c.blendAt(0, 0) === 1);

  // An erase has to clear the partner, or it survives the colour it describes.
  c._applyCell(0, 0, -1);
  check("erasing a cell clears its blend",
    c.blendAt(0, 0) === C.BLEND_NONE && !c.hasBlends());

  // Blends travel with their cell through every geometry change.
  c._applyCell(0, 0, 0);
  c.setBlendAt(0, 0, 2);
  c.resizeGrid(4, 2, 0, 0);
  check("a blend survives growing the canvas", c.blendAt(0, 0) === 2);
  c.resizeGrid(6, 4, 2, 2);
  check("a blend follows a re-origin", c.blendAt(2, 2) === 2);
  check("nothing is left behind at the old position",
    c.blendAt(0, 0) === C.BLEND_NONE);
  c.setSelection(2, 2, 2, 2);
  c.cropToSelection();
  check("a crop keeps the blend",
    c.width === 1 && c.height === 1 && c.blendAt(0, 0) === 2);

  // Mirror / rotate move the whole cell, so the partner travels with it.
  const m = new CrossStitchCanvas(makeCanvas(), {});
  m.setPalette(PALETTE);
  m.loadGrid(2, 1, [[0, 1]]);
  m.setBlendAt(0, 1, 2);
  m.setSelection(0, 0, 0, 1);
  m.mirrorSelection("h");
  check("a mirror carries the blend to the cell it lands on",
    m.blendAt(0, 0) === 2 && m.blendAt(0, 1) === C.BLEND_NONE,
    JSON.stringify([m.blendAt(0, 0), m.blendAt(0, 1)]));

  // Copy / paste keeps the blend with the colour.
  const p = new CrossStitchCanvas(makeCanvas(), {});
  p.setPalette(PALETTE);
  p.setSelected(3);
  p.loadGrid(2, 1, [[0, -1]]);
  p.setBlendAt(0, 0, 3);
  p.setSelection(0, 0, 0, 0);
  p.copySelection();
  p.setSelection(0, 1, 0, 1);
  p.pasteClipboard();
  check("a pasted stitch keeps its blend",
    p.blendAt(0, 1) === 3, String(p.blendAt(0, 1)));

  // Clearing the canvas means every layer, or a phantom blend survives.
  const k = new CrossStitchCanvas(makeCanvas(), {});
  k.setPalette(PALETTE);
  k.loadGrid(1, 1, [[0]]);
  k.setBlendAt(0, 0, 1);
  k.clearAll();
  check("clearing the canvas drops the blend layer",
    !k.getBlend() && !k.hasBlends() && k.blendCount() === 0);
}

console.log("\nBlended threads: cannot leak where it should not");
{
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  c.loadGrid(1, 1, [[0]]);
  c.cellSize = 20;
  c.setBlendAt(0, 0, 1);
  // A blend is a REAL stitching instruction, so unlike the markup layers it is
  // expected in every export - that is the whole point of it.
  const svg = c.exportSvg({ scale: 20 });
  check("a blend is in the SVG", svg.indexOf(PALETTE[1].hex) >= 0);
  let blob = null;
  c.exportBlob((b) => (blob = b), 18);
  check("a blend does not break the PNG path", blob !== null);
}

console.log("\nStitch types: undo covers every layer, not just colours");
{
  const C = CrossStitchCanvas;
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  c.loadGrid(1, 1, [[0]]);
  c.cellSize = 20;
  const clean = c.history.length;

  c.setStitchPart(C.FRAC.HALF_SLASH);
  c._applyCell(0, 0, 1);
  c._pushHistory();
  check("painting a half stitch sets the flag", c.fracAt(0, 0) === C.FRAC.HALF_SLASH);
  c.undo();
  check("undo takes the partial stitch back with the colour",
    c.fracAt(0, 0) === 0, String(c.fracAt(0, 0)));
  c.redo();
  check("redo puts the partial stitch back",
    c.fracAt(0, 0) === C.FRAC.HALF_SLASH);
  check("the history grew by exactly the one edit",
    c.history.length === clean + 1, String(c.history.length - clean));

  // An erase has to clear the cell's outline too, or it survives as an orphan.
  c.setBackEdge(0, 0, C.BACK.N, 2);
  check("the outline is placed", c.backSegmentCount() === 1);
  c._applyCell(0, 0, -1);
  check("erasing a cell clears its partial stitch", c.fracAt(0, 0) === 0);
  check("erasing a cell clears its outline", c.backSegmentCount() === 0);
  check("clearing everything drops both layers", (() => {
    c.setFracAt(0, 0, C.FRAC.SW);
    c.setBackEdge(0, 0, C.BACK.W, 1);
    c.clearAll();
    return !c.getFrac() && !c.getBack() && c.backSegmentCount() === 0;
  })());
}

// ---- annotations + per-cell notes (Phase 5) --------------------------------
// Your own reminders about the chart. They persist with the document but they
// are ON-SCREEN ONLY: like the progress wash and the spotlight they are drawn
// outside drawChart, so a chart printed for someone else never carries them.
console.log("\nAnnotations and notes cannot leak into any export");
{
  const c = makeChart();
  const before = c.exportSvg({ scale: 20 });
  c.addAnnotation({ k: "arrow", a: [0, 0], b: [3, 1], colour: 1 });
  c.addAnnotation({ k: "ellipse", a: [1, 1], b: [2, 2], colour: 2 });
  c.addAnnotation({ k: "rect", a: [0.5, 0.5], b: [2, 1.5], colour: 0 });
  c.addAnnotation({ k: "text", a: [0, 1], b: [0, 1], t: "check here", colour: 1 });
  c.setCellNote(1, 2, "blue is a substitute");
  const after = c.exportSvg({ scale: 20 });
  check("SVG export identical with every annotation and note on", before === after);
  check("the annotations are held on the canvas", c.annotationCount() === 4);
  check("the note is held on the canvas", c.cellNoteAt(1, 2) === "blue is a substitute");
  check("no note text reaches the export", before.indexOf("check here") < 0);
}

console.log("\nAnnotations: normalised, removable, and anchored to cells");
{
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  c.loadGrid(4, 4, [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  c.cellSize = 20;
  check("nothing to start with", c.annotationCount() === 0);
  c.addAnnotation({ k: "arrow", a: [0, 0], b: [2, 2], colour: 2 });
  check("an annotation is added", c.annotationCount() === 1);
  c.addAnnotation({ k: "splat", a: ["x", "y"], b: null, t: 123 });
  const junk = c.annotations()[1];
  check(
    "a nonsense annotation is normalised, not trusted",
    junk.k === "arrow" && junk.a[0] === 0 && junk.a[1] === 0 && junk.t === "",
    JSON.stringify(junk),
  );
  c.clearAnnotations();
  check("clearAnnotations empties the layer", c.annotationCount() === 0);

  // Right-click deletes whatever mark is under the pointer.
  c.addAnnotation({ k: "rect", a: [1, 1], b: [3, 3], colour: 0 });
  check("a hit inside a mark removes it", c.removeAnnotationNear(2 * 20, 2 * 20, 10) === true);
  check("the layer is empty again", c.annotationCount() === 0);
  c.addAnnotation({ k: "rect", a: [1, 1], b: [3, 3], colour: 0 });
  check("a click far from every mark leaves them alone",
    c.removeAnnotationNear(19 * 20, 19 * 20, 10) === false);
  check("the mark is still there", c.annotationCount() === 1);

  // Cell units mean a re-origin carries the marks with the stitches, instead of
  // leaving them pointing at the wrong place.
  c.resizeGrid(6, 6, 1, 1);
  const moved = c.annotations()[0];
  check(
    "an annotation follows a re-origin",
    moved.a[0] === 2 && moved.a[1] === 2 && moved.b[0] === 4 && moved.b[1] === 4,
    JSON.stringify(moved),
  );
}

console.log("\nPer-cell notes: sparse, clamped, and copy-safe");
{
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  c.loadGrid(2, 2, [
    [0, -1],
    [-1, 0],
  ]);
  c.cellSize = 20;
  check("no notes to start with", c.cellNoteCount() === 0);
  check("setting a note reports the change", c.setCellNote(0, 0, "first") === true);
  check("the note reads back", c.cellNoteAt(0, 0) === "first");
  check("setting the same note again is a no-op", c.setCellNote(0, 0, "first") === false);
  check(
    "a note is trimmed",
    c.setCellNote(1, 1, "  spaced  ") === true && c.cellNoteAt(1, 1) === "spaced",
    c.cellNoteAt(1, 1),
  );
  check("clearing a note reports the change", c.setCellNote(0, 0, "") === true);
  check("clearing a note that is not there is a no-op", c.setCellNote(0, 0, "") === false);
  check("the count follows", c.cellNoteCount() === 1, String(c.cellNoteCount()));
  check("a note cannot escape the grid", c.setCellNote(9, 9, "nope") === false);
  check("reading an unset cell is empty, not undefined", c.cellNoteAt(0, 1) === "");
  const map = c.cellNotesMap();
  map["0,0"] = "hack";
  check("the map is a copy, not the live object", c.cellNoteAt(0, 0) === "");

  // Loading a document round-trips both layers, and clears when asked.
  const d = new CrossStitchCanvas(makeCanvas(), {});
  d.setPalette(PALETTE);
  d.loadGrid(2, 2, [[0, -1], [-1, 0]]);
  d.setAnnotations([{ k: "text", a: [0, 0], b: [0, 0], t: "hi", colour: 1 }]);
  d.setCellNotes({ "1,1": "deep" });
  check("annotations load from a document", d.annotationCount() === 1);
  check("notes load from a document", d.cellNoteAt(1, 1) === "deep");
  d.setAnnotations([]);
  d.setCellNotes(null);
  check(
    "the loader can clear both layers",
    d.annotationCount() === 0 && d.cellNoteCount() === 0,
  );
  // A note that names a cell outside the grid is dropped, not kept as a ghost.
  d.setCellNotes({ "9,9": "off-grid", "0,0": "ok" });
  check(
    "an off-grid note is discarded on load",
    d.cellNoteCount() === 1 && d.cellNoteAt(0, 0) === "ok",
    String(d.cellNoteCount()),
  );
}

console.log("\nUndo covers the markup layers too");
{
  const c = new CrossStitchCanvas(makeCanvas(), {});
  c.setPalette(PALETTE);
  c.loadGrid(2, 2, [
    [0, 0],
    [0, 0],
  ]);
  c.cellSize = 20;
  c.addAnnotation({ k: "arrow", a: [0, 0], b: [1, 1], colour: 1 });
  c._pushHistory();
  c.setCellNote(0, 0, "remember");
  c._pushHistory();
  check(
    "both markup layers are set",
    c.annotationCount() === 1 && c.cellNoteCount() === 1,
  );
  c.undo();
  check("undo takes the note back", c.cellNoteCount() === 0, String(c.cellNoteCount()));
  check("undo leaves the annotation in place", c.annotationCount() === 1);
  c.undo();
  check("a second undo takes the annotation back", c.annotationCount() === 0);
  c.redo();
  check("redo puts the annotation back", c.annotationCount() === 1);
  // A snapshot must be a COPY: editing after pushing cannot change history.
  c.clearAnnotations();
  c._pushHistory();
  c.undo();
  check("undo restores a cleared annotation", c.annotationCount() === 1);
}

// ---- progress visual -------------------------------------------------------
// "Can't see the progress" is a REAL bug class here, not a matter of taste: the
// tracker originally dimmed finished stitches with a DARK wash on a dark canvas,
// so completed work read as holes punched in the chart.
console.log("\nProgress: finished must read as finished, not as a hole");
{
  const m = /var PROGRESS_DONE = "rgba\((\d+),\s*(\d+),\s*(\d+),/.exec(RENDERER_SRC);
  check("the finished-stitch wash is defined", !!m);
  if (m) {
    const lum = (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255;
    check(
      "a finished stitch is washed LIGHT, so done cannot look like empty",
      lum > 0.7,
      "luminance " + Math.round(lum * 100) / 100,
    );
  }
  check("the old dark progress wash is gone", !/PROGRESS_DIM/.test(RENDERER_SRC));
  check(
    "the current unit has a visible leading edge",
    /var PROGRESS_BAND_EDGE =/.test(RENDERER_SRC) && /_progressBandEdge\(\)/.test(RENDERER_SRC),
  );
  const tickMin = /var PROGRESS_TICK_MIN_CELL = (\d+);/.exec(RENDERER_SRC);
  check(
    "a per-stitch tick is only drawn when a cell is big enough to read",
    !!tickMin && +tickMin[1] >= 8,
    tickMin && tickMin[1],
  );
  // Progress stays a VIEW aid: drawn from render(), never from drawChart.
  const drawChartBody = RENDERER_SRC.split("function drawChart(o) {")[1].split("function drawRulers")[0];
  check(
    "progress never reaches drawChart, so it cannot be exported",
    drawChartBody.indexOf("_drawProgressOverlay") < 0 &&
      drawChartBody.indexOf("_progressTick") < 0,
  );
  // The incremental repaint has to agree with the full pass, or marking one cell
  // would leave it looking different from its neighbours.
  check(
    "an incremental repaint draws the same wash and tick",
    /_paintProgressCell\(r, c\) \{[\s\S]*?PROGRESS_DONE[\s\S]*?_progressTick\(r, c\)/.test(
      RENDERER_SRC,
    ),
  );
}

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

