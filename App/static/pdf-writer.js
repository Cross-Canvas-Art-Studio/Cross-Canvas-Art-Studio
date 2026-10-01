/**
 * pdf-writer.js - a minimal, dependency-free PDF generator for stitch charts.
 *
 * Deliberately hand-rolled rather than vendoring jsPDF: no third-party code, no
 * supply-chain surface, and the Flask app's strict CSP is unaffected.
 *
 * Implements the same six-method adapter interface as CanvasAdapter/SvgAdapter
 * in canvas-renderer.js, so the PDF is produced by the exact same drawChart()
 * geometry as the screen, the PNG and the SVG.
 *
 * Why vector rather than a rasterised canvas: a printed chart must stay crisp at
 * any size and tile cleanly across pages. Text uses the base-14 fonts
 * (Helvetica / Courier), which are built into every PDF viewer, so there is no
 * font to embed and glyphs are emitted as vector paths.
 *
 * PDF-specific notes:
 *  - Origin is BOTTOM-LEFT (y up); adapters pass top-left coordinates, so the
 *    page height is subtracted on the way in.
 *  - There is no alpha in the base graphics state, so rgba() colours are
 *    composited onto the page background before being written.
 *  - There are no circles, so they are approximated with four cubic Beziers.
 */
(function () {
  "use strict";

  var KAPPA = 0.5522847498; // circle-to-Bezier constant

  // ---------------------------------------------------------------- colours
  /**
   * Parse '#rgb', '#rrggbb', 'rgb(r,g,b)' or 'rgba(r,g,b,a)'.
   * Alpha is composited over `bg` (white by default) because PDF has no alpha.
   * Returns [r, g, b] normalised to 0..1.
   */
  function parseColor(value, bg) {
    bg = bg || [255, 255, 255];
    var s = String(value == null ? "#000000" : value).trim();
    var r;
    var g;
    var b;
    var a = 1;

    var m = s.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      var parts = m[1].split(",");
      r = parseFloat(parts[0]);
      g = parseFloat(parts[1]);
      b = parseFloat(parts[2]);
      if (parts.length > 3) a = parseFloat(parts[3]);
    } else {
      var h = s.replace("#", "");
      if (h.length === 3) {
        h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      }
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    }
    if (!isFinite(r) || !isFinite(g) || !isFinite(b)) {
      r = g = b = 0;
    }
    if (!isFinite(a)) a = 1;
    r = a * r + (1 - a) * bg[0];
    g = a * g + (1 - a) * bg[1];
    b = a * b + (1 - a) * bg[2];
    return [r / 255, g / 255, b / 255];
  }

  // ------------------------------------------------------------------ fonts
  // Advance widths in 1/1000 em for the base-14 fonts, packed as 3 digits per
  // character for ASCII 32..126. Needed because PDF has no notion of a text
  // anchor: centring has to be computed from the actual string width.
  var HELV_W =
    "278278355556556889667191333333389584278333278278" +
    "556556556556556556556556556556" +
    "2782785845845845561015" +
    "667667722722667611778722278500667556833722778667778722667611722667944667667611" +
    "278278278469556333" +
    "556556500556556278556556222222500222833556556556556333500278556500722500500500" +
    "334260334584";

  var HELV_B_W =
    "278333474556556889722238333333389584278333278278" +
    "556556556556556556556556556556" +
    "333333584584584611975" +
    "722722722722667611778722278556722611833722778667778722667611722667944667667611" +
    "333278333584556333" +
    "556611556611556333611611278278556278889611611611611389556333611556778556556500" +
    "389280389584";

  function widthOf(table, code) {
    if (code < 32 || code > 126) return 556;
    var i = (code - 32) * 3;
    return parseInt(table.substr(i, 3), 10);
  }

  /**
   * Width of a string in points. Courier is a base-14 monospace font with a
   * fixed 600/1000 advance, which is exactly what the renderer's 0.6em
   * assumption expects.
   */
  function measure(str, font, size) {
    str = String(str == null ? "" : str);
    if (font === "courier") return str.length * 0.6 * size;
    var table = font === "helv-bold" ? HELV_B_W : HELV_W;
    var total = 0;
    for (var i = 0; i < str.length; i++) {
      total += widthOf(table, str.charCodeAt(i));
    }
    return (total / 1000) * size;
  }

  /** PDF literal string: escape \ ( ) and drop anything outside WinAnsi. */
  function pdfText(str) {
    var out = "";
    str = String(str == null ? "" : str);
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      var code = str.charCodeAt(i);
      if (ch === "\\") out += "\\\\";
      else if (ch === "(") out += "\\(";
      else if (ch === ")") out += "\\)";
      else if (code < 32) out += " ";
      else if (code > 255) out += "?"; // base-14 fonts are WinAnsi only
      else out += ch;
    }
    return out;
  }

  function n(v) {
    if (!isFinite(v)) v = 0;
    return Math.round(v * 100) / 100;
  }

  // ------------------------------------------------------------------ pages
  function PdfPage(width, height) {
    this.width = width;
    this.height = height;
    this.ops = [];
  }

  /**
   * Adapter implementing the shared render interface.
   * Colours are composited over the page background so translucent grid lines
   * (rgba) survive into a format that has no alpha channel.
   */
  function PdfAdapter(page, background) {
    this.page = page;
    this.bg = background || [255, 255, 255];
    this._stroke = null;
    this._fill = null;
  }
  PdfAdapter.prototype = {
    _strokeColor: function (c) {
      var rgb = parseColor(c, this.bg);
      // Avoid re-emitting RG for every segment (a 500x500 chart has millions).
      if (this._stroke && this._stroke[0] === rgb[0] && this._stroke[1] === rgb[1] &&
          this._stroke[2] === rgb[2]) {
        return;
      }
      this._stroke = rgb;
      this.ops.push(n(rgb[0]) + " " + n(rgb[1]) + " " + n(rgb[2]) + " RG");
    },
    _fillColor: function (c) {
      var rgb = parseColor(c, this.bg);
      if (this._fill && this._fill[0] === rgb[0] && this._fill[1] === rgb[1] &&
          this._fill[2] === rgb[2]) {
        return;
      }
      this._fill = rgb;
      this.ops.push(n(rgb[0]) + " " + n(rgb[1]) + " " + n(rgb[2]) + " rg");
    },
    line: function (pts, st) {
      if (pts.length < 2) return;
      var p = this.page;
      this._strokeColor(st.stroke);
      p.ops.push(n(st.lineWidth || 1) + " w");
      // 1 J = round cap, 2 J = projecting; 1 j = round join.
      p.ops.push((st.lineCap === "round" ? 1 : 0) + " J");
      p.ops.push((st.lineJoin === "round" ? 1 : 0) + " j");
      var y0 = p.height;
      p.ops.push(n(pts[0][0]) + " " + n(y0 - pts[0][1]) + " m");
      for (var i = 1; i < pts.length; i++) {
        p.ops.push(n(pts[i][0]) + " " + n(y0 - pts[i][1]) + " l");
      }
      p.ops.push("S");
    },
    polygon: function (pts, st) {
      if (pts.length < 3) return;
      var p = this.page;
      var y0 = p.height;
      p.ops.push(n(pts[0][0]) + " " + n(y0 - pts[0][1]) + " m");
      for (var i = 1; i < pts.length; i++) {
        p.ops.push(n(pts[i][0]) + " " + n(y0 - pts[i][1]) + " l");
      }
      p.ops.push("h");
      if (st.fill && st.stroke) {
        this._fillColor(st.fill);
        this._strokeColor(st.stroke);
        p.ops.push("B");
      } else if (st.fill) {
        this._fillColor(st.fill);
        p.ops.push("f");
      } else if (st.stroke) {
        this._strokeColor(st.stroke);
        p.ops.push("S");
      }
    },
    circle: function (cx, cy, r, st) {
      if (!(r > 0)) return;
      var p = this.page;
      var y0 = p.height;
      var y = y0 - cy;
      var k = r * KAPPA;
      // Four Bezier quadrants, starting at the rightmost point.
      p.ops.push(n(cx + r) + " " + n(y) + " m");
      p.ops.push(
        n(cx + r) + " " + n(y + k) + " " + n(cx + k) + " " + n(y + r) + " " +
          n(cx) + " " + n(y + r) + " c",
      );
      p.ops.push(
        n(cx - k) + " " + n(y + r) + " " + n(cx - r) + " " + n(y + k) + " " +
          n(cx - r) + " " + n(y) + " c",
      );
      p.ops.push(
        n(cx - r) + " " + n(y - k) + " " + n(cx - k) + " " + n(y - r) + " " +
          n(cx) + " " + n(y - r) + " c",
      );
      p.ops.push(
        n(cx + k) + " " + n(y - r) + " " + n(cx + r) + " " + n(y - k) + " " +
          n(cx + r) + " " + n(y) + " c",
      );
      p.ops.push("h");
      if (st.fill && st.stroke) {
        this._fillColor(st.fill);
        this._strokeColor(st.stroke);
        p.ops.push(n(st.lineWidth || 1) + " w");
        p.ops.push("B");
      } else if (st.fill) {
        this._fillColor(st.fill);
        p.ops.push("f");
      } else if (st.stroke) {
        this._strokeColor(st.stroke);
        p.ops.push(n(st.lineWidth || 1) + " w");
        p.ops.push("S");
      }
    },
    rect: function (x, y, w, h, st) {
      var p = this.page;
      // PDF's `re` takes bottom-left origin.
      var by = p.height - y - h;
      if (st.fill || st.stroke) {
        p.ops.push(n(x) + " " + n(by) + " " + n(w) + " " + n(h) + " re");
      }
      if (st.fill && st.stroke) {
        this._fillColor(st.fill);
        this._strokeColor(st.stroke);
        p.ops.push(n(st.lineWidth || 1) + " w");
        p.ops.push("B");
      } else if (st.fill) {
        this._fillColor(st.fill);
        p.ops.push("f");
      } else if (st.stroke) {
        this._strokeColor(st.stroke);
        p.ops.push(n(st.lineWidth || 1) + " w");
        p.ops.push("S");
      }
    },
    text: function (x, y, str, st) {
      str = String(str == null ? "" : str);
      if (!str) return;
      var size = st.size || 10;
      var mono = (st.family || "").indexOf("monospace") >= 0 ||
        (st.family || "").indexOf("Courier") >= 0;
      var bold = String(st.weight || "").indexOf("bold") >= 0;
      var font = mono ? "courier" : bold ? "helv-bold" : "helv";
      var res = mono ? "F3" : bold ? "F2" : "F1";
      var w = measure(str, font, size);
      var tx = x;
      if (st.anchor === "middle") tx = x - w / 2;
      else if (st.anchor === "end") tx = x - w;
      // PDF's text position IS the baseline, so an alphabetic baseline maps
      // straight through; the em-middle approximation matches SVG 'central'.
      var ty = y;
      if (st.baseline === "middle") ty = y + size * 0.36;
      else if (st.baseline === "top") ty = y + size * 0.8;
      var p = this.page;
      this._fillColor(st.fill);
      p.ops.push("BT /" + res + " " + n(size) + " Tf");
      p.ops.push(n(tx) + " " + n(p.height - ty) + " Td");
      p.ops.push("(" + pdfText(str) + ") Tj");
      p.ops.push("ET");
    },
  };
  Object.defineProperty(PdfAdapter.prototype, "ops", {
    get: function () {
      return this.page.ops;
    },
  });

  // ------------------------------------------------------------- assembling
  function latin1Bytes(str) {
    var out = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) {
      out[i] = str.charCodeAt(i) & 0xff;
    }
    return out;
  }

  /** Deflate a content stream when the browser supports it. */
  function deflate(bytes) {
    if (typeof CompressionStream !== "function") {
      return Promise.resolve(null);
    }
    try {
      var cs = new CompressionStream("deflate");
      var writer = cs.writable.getWriter();
      writer.write(bytes);
      writer.close();
      return new Response(cs.readable)
        .arrayBuffer()
        .then(function (buf) {
          return new Uint8Array(buf);
        })
        .catch(function () {
          return null;
        });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function concat(chunks) {
    var total = 0;
    chunks.forEach(function (c) {
      total += c.length;
    });
    var out = new Uint8Array(total);
    var at = 0;
    chunks.forEach(function (c) {
      out.set(c, at);
      at += c.length;
    });
    return out;
  }

  /**
   * Assemble a PDF from pages.
   *
   * pages: [{ width, height, ops: [string] }]
   * meta:  { title, author, subject, creator }
   * Resolves to a Blob of type application/pdf.
   */
  function buildPdf(pages, meta) {
    meta = meta || {};
    if (!pages.length) {
      return Promise.reject(new Error("PDF needs at least one page"));
    }

    // Compress each content stream independently.
    return Promise.all(
      pages.map(function (p) {
        return deflate(latin1Bytes(p.ops.join("\n")));
      }),
    ).then(function (compressed) {
      // Object numbers are 1-based, so slots[] is sparse with slots[0] unused.
      var slots = [];
      var chunks = [];
      var offsets = [];

      function reserve(num, body) {
        slots[num] = body;
      }

      // Object layout:
      //   1 catalog, 2 pages, then per page: page obj + content obj,
      //   then the three fonts, then the info dictionary.
      var perPage = [];
      var pageCount = pages.length;
      var firstPageObj = 3;
      for (var i = 0; i < pageCount; i++) {
        perPage.push({ page: firstPageObj + i * 2, content: firstPageObj + i * 2 + 1 });
      }
      var fontsBase = firstPageObj + pageCount * 2;
      var infoObj = fontsBase + 3;

      reserve(1, "<< /Type /Catalog /Pages 2 0 R >>");
      reserve(
        2,
        "<< /Type /Pages /Kids [" +
          perPage
            .map(function (p) {
              return p.page + " 0 R";
            })
            .join(" ") +
          "] /Count " +
          pageCount +
          " >>",
      );

      pages.forEach(function (p, idx) {
        var stream = compressed[idx];
        var res =
          "<< /Font << /F1 " + fontsBase + " 0 R /F2 " + (fontsBase + 1) +
          " 0 R /F3 " + (fontsBase + 2) + " 0 R >> >>";
        reserve(
          perPage[idx].page,
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + n(p.width) + " " +
            n(p.height) + "] /Resources " + res + " /Contents " +
            perPage[idx].content + " 0 R >>",
        );
        var body;
        if (stream) {
          // Decompressed length must be stated alongside the filter.
          body = {
            dict:
              "<< /Length " + stream.length + " /Filter /FlateDecode >>",
            bytes: stream,
          };
        } else {
          var raw = latin1Bytes(p.ops.join("\n"));
          body = { dict: "<< /Length " + raw.length + " >>", bytes: raw };
        }
        reserve(perPage[idx].content, body);
      });

      reserve(
        fontsBase,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      );
      reserve(
        fontsBase + 1,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
      );
      reserve(
        fontsBase + 2,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
      );

      var infoParts = [];
      if (meta.title) infoParts.push("/Title (" + pdfText(meta.title) + ")");
      if (meta.author) infoParts.push("/Author (" + pdfText(meta.author) + ")");
      if (meta.subject) infoParts.push("/Subject (" + pdfText(meta.subject) + ")");
      infoParts.push(
        "/Creator (" + pdfText(meta.creator || "Stitchee") + ")",
        "/Producer (" + pdfText(meta.creator || "Stitchee") + ")",
      );
      reserve(infoObj, "<< " + infoParts.join(" ") + " >>");

      // ---- serialise ----
      // Highest object number actually written, so the loop and the xref
      // agree. (Deriving this from a separate list previously drifted.)
      var maxObj = 0;
      slots.forEach(function (v, k) {
        if (v !== undefined && k > maxObj) maxObj = k;
      });
      var size = maxObj + 1;

      var header = latin1Bytes("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
      chunks.push(header);
      var cursor = header.length;

      for (var num = 1; num <= maxObj; num++) {
        var body2 = slots[num];
        if (body2 === undefined) continue;
        offsets[num] = cursor;
        var lead = latin1Bytes(num + " 0 obj\n");
        chunks.push(lead);
        cursor += lead.length;

        if (typeof body2 === "string") {
          var s = latin1Bytes(body2 + "\nendobj\n");
          chunks.push(s);
          cursor += s.length;
        } else {
          var d = latin1Bytes(body2.dict + "\nstream\n");
          chunks.push(d);
          cursor += d.length;
          chunks.push(body2.bytes);
          cursor += body2.bytes.length;
          var tail = latin1Bytes("\nendstream\nendobj\n");
          chunks.push(tail);
          cursor += tail.length;
        }
      }

      var xrefStart = cursor;
      var xref = "xref\n0 " + size + "\n0000000000 65535 f \n";
      for (var o = 1; o < size; o++) {
        var off = offsets[o];
        xref +=
          off === undefined
            ? "0000000000 65535 f \n"
            : String(off).padStart(10, "0") + " 00000 n \n";
      }
      var trailer =
        "trailer\n<< /Size " + size + " /Root 1 0 R /Info " + infoObj +
        " 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF\n";
      chunks.push(latin1Bytes(xref + trailer));

      return new Blob(chunks, { type: "application/pdf" });
    });
  }

  window.StitchPdf = {
    PdfPage: PdfPage,
    PdfAdapter: PdfAdapter,
    buildPdf: buildPdf,
    parseColor: parseColor,
    measure: measure,
    /** Page sizes in PDF points (1/72 inch). */
    PAGE_SIZES: {
      a4: { width: 595.28, height: 841.89 },
      letter: { width: 612, height: 792 },
    },
  };
})();
