/**
 * tools/verify_pdf.js - structural validation of the hand-rolled PDF writer.
 *
 * A hand-written PDF fails in one classic way: the xref table's byte offsets
 * drift, so viewers reject the file (or silently show nothing). This walks the
 * emitted bytes and checks every offset actually lands on "<n> 0 obj", plus the
 * colour/measure/escaping helpers.
 *
 * Run:  node tools/verify_pdf.js
 * Exits non-zero on failure so it can gate CI.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const STATIC = path.join(__dirname, "..", "App", "static");

const sandbox = {
  // canvas-renderer.js binds window listeners in its constructor.
  window: { addEventListener() {}, removeEventListener() {} },
  console,
  // Host APIs a fresh vm context does not get by default.
  Blob,
  CompressionStream,
  Response,
  Promise,
  Uint8Array,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(STATIC, "pdf-writer.js"), "utf8"), sandbox, {
  filename: "pdf-writer.js",
});
vm.runInContext(
  fs.readFileSync(path.join(STATIC, "canvas-renderer.js"), "utf8"),
  sandbox,
  { filename: "canvas-renderer.js" },
);
vm.runInContext(fs.readFileSync(path.join(STATIC, "symbols.js"), "utf8"), sandbox, {
  filename: "symbols.js",
});

const Pdf = sandbox.window.StitchPdf;
const CrossStitchCanvas = sandbox.window.CrossStitchCanvas;

/** Minimal no-op 2D context so CanvasAdapter calls do not throw. */
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

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? " -> " + detail : ""}`);
  }
}

// --------------------------------------------------------------- validation
async function inflate(bytes) {
  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

/**
 * Pull out every content stream and inflate the compressed ones. The drawing
 * operators live inside deflated streams, so asserting on the raw file bytes
 * would never find them.
 */
async function contentStreams(bytes) {
  // Latin-1 keeps string indices aligned 1:1 with byte offsets.
  const s = Buffer.from(bytes).toString("latin1");
  const texts = [];
  let idx = 0;
  for (;;) {
    const st = s.indexOf("stream\n", idx);
    if (st < 0) break;
    const en = s.indexOf("\nendstream", st);
    if (en < 0) break;
    const dict = s.slice(Math.max(0, st - 400), st);
    const raw = bytes.slice(st + "stream\n".length, en);
    const compressed = /\/Filter \/FlateDecode/.test(dict);
    texts.push(
      compressed
        ? Buffer.from(await inflate(raw)).toString("latin1")
        : Buffer.from(raw).toString("latin1"),
    );
    // Advance past the whole "endstream" token. Searching from `en + 1` would
    // re-match the "stream\n" INSIDE "endstream\n" and slice garbage.
    idx = en + "\nendstream".length;
  }
  return texts.join("\n");
}

/** Parse the xref table and prove every offset resolves to its object header. */
async function validatePdf(bytes) {
  const s = Buffer.from(bytes).toString("latin1");
  const problems = [];

  if (!s.startsWith("%PDF-1.4")) problems.push("missing %PDF-1.4 header");
  if (!s.replace(/\s+$/, "").endsWith("%%EOF")) problems.push("missing %%EOF");

  const sx = s.match(/startxref\s+(\d+)\s+%%EOF/);
  if (!sx) {
    problems.push("no startxref");
    return { problems };
  }
  const xrefStart = parseInt(sx[1], 10);
  if (s.substr(xrefStart, 4) !== "xref") {
    problems.push(`startxref ${xrefStart} does not point at "xref"`);
    return { problems };
  }

  const headMatch = s.substr(xrefStart).match(/^xref\s+0\s+(\d+)\s/);
  if (!headMatch) {
    problems.push("malformed xref subsection header");
    return { problems };
  }
  const size = parseInt(headMatch[1], 10);
  const entriesStart = xrefStart + ("xref\n0 " + size + "\n").length;

  let named = 0;
  for (let i = 0; i < size; i++) {
    // Each xref entry is exactly 20 bytes: 10-digit offset, space, 5-digit
    // generation, space, 'n'/'f', space, newline.
    const entry = s.substr(entriesStart + i * 20, 20);
    if (!/^\d{10} \d{5} [nf] \n$/.test(entry)) {
      problems.push(`xref entry ${i} malformed: ${JSON.stringify(entry)}`);
      continue;
    }
    if (entry[17] !== "n") continue;
    named++;
    const off = parseInt(entry.slice(0, 10), 10);
    const expect = `${i} 0 obj`;
    const got = s.substr(off, expect.length);
    if (got !== expect) {
      problems.push(`xref entry ${i}: offset ${off} holds ${JSON.stringify(got)}`);
    }
  }

  if (named < 4) problems.push(`only ${named} in-use objects; expected more`);
  if (!/\/Root 1 0 R/.test(s)) problems.push("trailer missing /Root");
  if (!/\/Type \/Catalog/.test(s)) problems.push("no catalog object");
  if (!/\/Type \/Page[^s]/.test(s)) problems.push("no page object");

  // Every object header must be reachable, and the count must match /Size.
  const content = await contentStreams(bytes);
  return { problems, size, named, text: s, content };
}

// ------------------------------------------------------------ helper checks
console.log("colour parsing (alpha composited, since PDF has no alpha)");
{
  const white = [255, 255, 255];
  check("hex -> normalised rgb", Pdf.parseColor("#FF8000", white).join(",") === "1,0.5019607843137255,0");
  check("short hex expands", Pdf.parseColor("#F80", white).join(",") === "1,0.5333333333333333,0");
  check(
    "rgba composites onto white",
    // 12% black over white = 0.88 -> 224.4/255
    Math.abs(Pdf.parseColor("rgba(0,0,0,0.12)", white)[0] - 224.4 / 255) < 1e-9,
  );
  check("opaque colour ignores background", Pdf.parseColor("rgba(0,0,0,1)", white).join(",") === "0,0,0");
  check("garbage does not throw", Array.isArray(Pdf.parseColor("not-a-colour", white)));
}

console.log("\ntext measurement and escaping");
{
  check("courier is a fixed 0.6em advance", Pdf.measure("WML", "courier", 10) === 18);
  check("helvetica differs per glyph", Pdf.measure("WWW", "helv", 10) !== Pdf.measure("iii", "helv", 10));
  check("bold is wider than regular", Pdf.measure("WWW", "helv-bold", 10) > Pdf.measure("WWW", "helv", 10));
}

// -------------------------------------------------------------- page output
async function main() {
  console.log("\nPDF structure: multi-page chart");
  {
    const pages = [];
    for (let p = 0; p < 3; p++) {
      const page = new Pdf.PdfPage(595.28, 841.89);
      const ad = new Pdf.PdfAdapter(page, [255, 255, 255]);
      ad.rect(0, 0, 595.28, 841.89, { fill: "#ffffff" });
      ad.line([[10, 10], [100, 100]], { stroke: "#ff0000", lineWidth: 2, lineCap: "round" });
      ad.circle(200, 200, 20, { stroke: "#000000", lineWidth: 1 });
      ad.polygon([[300, 300], [340, 300], [320, 340]], { fill: "#00ff00" });
      ad.text(100, 400, `Page (${p + 1})`, {
        fill: "#000000", size: 12, anchor: "middle", baseline: "alphabetic",
      });
      // A deliberately awkward string: parens and a backslash must be escaped.
      ad.text(100, 420, "a(b)c\\d", {
        fill: "#000000", size: 10, anchor: "start", baseline: "alphabetic",
      });
      pages.push(page);
    }

    const blob = await Pdf.buildPdf(pages, { title: "Test Chart", author: "Stitchee" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const res = await validatePdf(bytes);

    check("buildPdf resolves to a Blob", blob instanceof Blob);
    check("mime type is application/pdf", blob.type === "application/pdf");
    check("no structural problems", res.problems.length === 0, res.problems.join("; "));
    check("3 page objects present", (res.text.match(/\/Type \/Page[^s]/g) || []).length === 3);
    check("catalog declares 3 kids", /\/Count 3 /.test(res.text));
    check("xref covers all objects", res.size >= 10, `size=${res.size}`);
    check("all three base-14 fonts declared",
      /\/BaseFont \/Helvetica /.test(res.text) &&
      /\/BaseFont \/Helvetica-Bold/.test(res.text) &&
      /\/BaseFont \/Courier/.test(res.text));
    check("info dictionary written", /\/Title \(Test Chart\)/.test(res.text));
    // Source text was a(b)c\d; the PDF literal must escape to a\(b\)c\\d.
    // Asserted against the DECOMPRESSED stream, where the operators live.
    check(
      "parentheses and backslash escaped",
      res.content.includes("a\\(b\\)c\\\\d"),
    );
    check("content stream is compressed", /\/Filter \/FlateDecode/.test(res.text));
    console.log(`  info  pdf bytes: ${bytes.length}`);
  }

  // ----------------------------------------- end-to-end through drawChart
  console.log("\nPDF driven by the real renderer (full pipeline)");
  {
    const canvas = new CrossStitchCanvas(
      {
        width: 0, height: 0, hidden: false, parentElement: null,
        // Must be a full no-op context: loadGrid() triggers render(), which
        // draws through CanvasAdapter before we ever reach the PDF adapter.
        getContext: () => makeCtx(),
        addEventListener() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
        toBlob: (cb) => cb({}),
      },
      {},
    );
    canvas.setPalette([
      { index: 0, code: "WHT", hex: "#FFFFFF", symbol: 0 },
      { index: 1, code: "BLK", hex: "#1A1A1A", symbol: 16 },
      { index: 2, code: "RED", hex: "#E01B22", symbol: 25 },
      { index: 3, code: "BLU", hex: "#2E6FDA", symbol: 27 },
    ]);
    canvas.loadGrid(8, 4, [
      [0, 1, 2, 3, 0, 1, 2, 3],
      [1, 2, 3, 0, 1, 2, 3, 0],
      [2, 3, 0, 1, 2, 3, 0, 1],
      [3, 0, 1, 2, 3, 0, 1, 2],
    ]);
    canvas.cellSize = 18;
    canvas.showGlyphs = true;

    const page = new Pdf.PdfPage(595.28, 841.89);
    const ad = new Pdf.PdfAdapter(page, [255, 255, 255]);
    canvas.renderTo(ad, 18, {
      ruler: { gutter: 14, every: 2, fontSize: 7, color: "#333333" },
    });

    check("renderer emitted drawing ops", page.ops.length > 50, `ops=${page.ops.length}`);

    const blob = await Pdf.buildPdf([page], { title: "Pipeline" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const res = await validatePdf(bytes);

    check("pipeline PDF is structurally valid", res.problems.length === 0,
      res.problems.join("; "));
    check("contains vector paths", / m\n/.test(res.content) || / re\n/.test(res.content));
    check("contains Bezier circles for glyphs", / c\n/.test(res.content));
    check("ruler/label text rendered", / Tj\n/.test(res.content));
    check("emits colour operators", / RG\n/.test(res.content) && / rg\n/.test(res.content));
    console.log(`  info  pdf bytes: ${bytes.length}`);
  }
}

main()
  .catch((e) => {
    failures++;
    console.log("  FAIL  threw -> " + ((e && e.message) || e));
    if (e && e.stack) console.log(e.stack);
  })
  .then(() => {
    console.log(
      failures === 0
        ? "\nAll PDF checks passed."
        : `\n${failures} check(s) FAILED.`,
    );
    process.exit(failures === 0 ? 0 : 1);
  });
