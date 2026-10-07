"use strict";

const fs = require("fs");
const path = require("path");
const {
  PDFDocument,
  StandardFonts,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  translate,
  scale
} = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const { prepareOriginalLayout } = require("./jk-original-layout.js");

// JK_PRESERVE_ORIGINAL_LAYOUT_V1

const PAGE_W = 612;
const PAGE_H = 792;

const C = {
  ink: "#191919",
  muted: "#636363",
  iconDark: "#2D2D2D",
  softBlue: "#D1E9FA",
  rule: "#CDCDCD",
  brandBlue: "#0096FF",
  coral: "#F96371",
  orange: "#F78F4A",
  yellow: "#F5E5AB",
  mint: "#C2EDE0",
  ai: "#52C7DB",
  white: "#FEFEFE",
  lightGray: "#F9F9F9",
  magenta: "#CC1476",
  blue: "#225EC7",
  green: "#007546",
  purple: "#7533E8",
  paleMagenta: "#FFDDE8",
  paleBlue: "#D7E6FC",
  paleGreen: "#C2EDE0",
  palePurple: "#EDE0FF"
};

const SOURCE_COLORS = [C.magenta, C.blue, C.green, C.purple];

const zlib = require("zlib");

const ICON_B64 = JSON.parse(
  zlib.gunzipSync(
    Buffer.from([
      "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"
    ].join(""), "base64")
  ).toString("utf8")
);

async function loadReportIcons(doc) {
  const out = {};
  for (const [key, value] of Object.entries(ICON_B64)) {
    out[key] = await doc.embedPng(Buffer.from(value, "base64"));
  }
  return out;
}

function drawPngTop(page, image, x, top, width, height) {
  page.drawImage(image, { x, y: PAGE_H - top - height, width, height });
}

function drawRoundedPill(page, x, top, width, height, fill) {
  const y = PAGE_H - top - height;
  const r = height / 2;
  page.drawRectangle({ x: x + r, y, width: Math.max(0, width - 2 * r), height, color: hex(fill) });
  page.drawCircle({ x: x + r, y: y + r, size: r, color: hex(fill) });
  page.drawCircle({ x: x + width - r, y: y + r, size: r, color: hex(fill) });
}

function paleSourceColour(number) {
  return [C.paleMagenta, C.paleBlue, C.paleGreen, C.palePurple][(Math.max(1, Number(number || 1)) - 1) % 4];
}

function groupIconKey(key) {
  if (key === "MISSING_QUOTATIONS") return "groupMissingQuotes";
  if (key === "MISSING_CITATION") return "groupMissingCitation";
  if (key === "CITED_AND_QUOTED") return "groupCitedQuoted";
  return "groupNotCited";
}

const GROUPS = [
  { key: "NOT_CITED_OR_QUOTED", label: "Not Cited or Quoted", desc: "Matches with neither in-text citation nor quotation marks", fill: C.coral },
  { key: "MISSING_QUOTATIONS", label: "Missing Quotations", desc: "Matches that are still very similar to source material", fill: C.orange },
  { key: "MISSING_CITATION", label: "Missing Citation", desc: "Matches that have quotation marks, but no in-text citation", fill: C.yellow },
  { key: "CITED_AND_QUOTED", label: "Cited and Quoted", desc: "Matches with in-text citation present, but no quotation marks", fill: C.mint }
];

const s = (v) => (v == null ? "" : String(v));

function hex(hexValue) {
  const h = s(hexValue).replace("#", "");
  const n = parseInt(h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function topY(top, size) {
  return PAGE_H - top - size;
}

function safeText(v) {
  return s(v)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ");
}

function fileBase(name) {
  return (s(name || "report").replace(/[\\/:*?"<>|]+/g, "_").trim() || "report").replace(/\.[^.]+$/, "") || "report";
}

function bytesText(v) {
  const n = Number(v || 0);
  if (!n) return "N/A";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function resolveFileSizeBytes(bundle) {
  const values = [
    bundle?.reportIdentity?.fileSize,
    bundle?.reportIdentity?.file_size,
    bundle?.job?.fileSize,
    bundle?.job?.file_size,
    bundle?.file?.fileSize,
    bundle?.file?.file_size,
    bundle?.completion?.scannedDocument?.fileSize,
    bundle?.completion?.scannedDocument?.file_size,
    bundle?.completion?.scannedDocument?.size,
    bundle?.completion?.scannedDocument?.metadata?.fileSize,
    bundle?.completion?.scannedDocument?.metadata?.file_size
  ];

  for (const value of values) {
    const n = Number(value || 0);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return null;
}

// JK_WHOLE_PERCENT_DISPLAY_V1
function fmtPct(v) {
  const n = Number(v);

  if (!Number.isFinite(n)) {
    return "0%";
  }

  const rounded = Math.max(
    0,
    Math.min(
      100,
      Math.round(n)
    )
  );

  return rounded + "%";
}

function fmtDate(v) {
  const d = v ? new Date(v) : new Date();
  if (Number.isNaN(d.getTime())) return "N/A";
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Nairobi"
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${get("month")} ${get("day")}, ${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod")} GMT+3`;
}

function packageDir(pkg) {
  return path.dirname(require.resolve(`${pkg}/package.json`));
}

function findFontFile(pkg, patterns) {
  const dir = path.join(packageDir(pkg), "files");
  const names = fs.readdirSync(dir);
  for (const pattern of patterns) {
    const found = names.find((n) => n.toLowerCase().includes(pattern.toLowerCase()) && /\.woff2?$/.test(n));
    if (found) return path.join(dir, found);
  }
  throw new Error(`Required font not found in ${pkg}: ${patterns.join(", ")}`);
}

async function loadBrandFonts(doc) {
  doc.registerFontkit(fontkit);
  const notoPkg = "@fontsource/noto-sans";
  const lexPkg = "@fontsource/lexend-deca";
  const files = {
    noto: findFontFile(notoPkg, ["latin-400-normal", "400-normal"]),
    notoSemi: findFontFile(notoPkg, ["latin-600-normal", "600-normal"]),
    lexMed: findFontFile(lexPkg, ["latin-500-normal", "500-normal"]),
    lexSemi: findFontFile(lexPkg, ["latin-600-normal", "600-normal"])
  };
  // JK_CUSTOM_LOGO_V1
  const brandLogoPath =
    path.join(
      __dirname,
      "assets",
      "logo.jpg"
    );

  let brandLogo = null;

  if (fs.existsSync(brandLogoPath)) {
    brandLogo =
      await doc.embedJpg(
        fs.readFileSync(
          brandLogoPath
        )
      );
  }
  return {
    noto: await doc.embedFont(fs.readFileSync(files.noto), { subset: true }),
    notoSemi: await doc.embedFont(fs.readFileSync(files.notoSemi), { subset: true }),
    lexMed: await doc.embedFont(fs.readFileSync(files.lexMed), { subset: true }),
    lexSemi: await doc.embedFont(fs.readFileSync(files.lexSemi), { subset: true }),
    helv: await doc.embedFont(StandardFonts.Helvetica),
    brandLogo
  };
}

function drawTextTop(page, text, x, top, size, font, color = C.ink) {
  page.drawText(safeText(text), { x, y: topY(top, size), size, font, color: hex(color) });
}

function drawRule(page, top) {
  const y = PAGE_H - top;
  page.drawLine({ start: { x: 36, y }, end: { x: 576, y }, thickness: 0.5, color: hex(C.rule) });
}

function wrapLines(text, font, size, maxWidth) {
  const words = safeText(text).split(/\s+/).filter(Boolean);
  const out = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (!line || font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

function drawWrappedTop(page, text, x, top, width, size, font, color = C.ink, lineGap = 2, maxLines = 99) {
  const lines = wrapLines(text, font, size, width).slice(0, maxLines);
  lines.forEach((line, i) => drawTextTop(page, line, x, top + i * (size + lineGap), size, font, color));
  return lines.length;
}

const BRAND_MARK = Object.freeze({
  x: 36, width: 55, height: 16.5,
  headerTop: 24, footerTop: 748,
  pageLabelX: 107, submissionLabelX: 467.53, submissionValueX: 512.988,
  headerTextTop: 27.586, footerTextTop: 751.586
});

function drawBrandMark(page, f, top) {
  const x = BRAND_MARK.x;
  const y = PAGE_H - top - BRAND_MARK.height;

  if (f.brandLogo) {
    const maxW =
      BRAND_MARK.width;

    const maxH =
      BRAND_MARK.height;

    const nativeW =
      Number(
        f.brandLogo.width ||
        maxW
      );

    const nativeH =
      Number(
        f.brandLogo.height ||
        maxH
      );

    const logoScale =
      Math.min(
        maxW / nativeW,
        maxH / nativeH
      );

    const logoW =
      nativeW *
      logoScale;

    const logoH =
      nativeH *
      logoScale;

    page.drawImage(
      f.brandLogo,
      {
        x:
          x +
          (
            maxW -
            logoW
          ) / 2,

        y:
          y +
          (
            maxH -
            logoH
          ) / 2,

        width:
          logoW,

        height:
          logoH
      }
    );

    return;
  }
  const iconX = x + 0.5;
  const iconY = y + 1;
  const iconW = 14.5;
  const iconH = 14.5;

  // Original abstract symbol. It is not a copy of a third-party logo.
  page.drawEllipse({
    x: iconX + iconW * 0.48, y: iconY + iconH * 0.53,
    xScale: iconW * 0.40, yScale: iconH * 0.34,
    borderColor: hex(C.brandBlue), borderWidth: 1.45, opacity: 1
  });
  page.drawRectangle({
    x: iconX + iconW * 0.55, y: iconY + iconH * 0.08,
    width: iconW * 0.48, height: iconH * 0.82, color: hex(C.white)
  });
  page.drawLine({
    start: { x: iconX + 1.3, y: iconY + 3 },
    end: { x: iconX + 6.2, y: iconY + 9.5 },
    thickness: 1.45, color: hex(C.brandBlue)
  });
  page.drawLine({
    start: { x: iconX + 6.2, y: iconY + 9.5 },
    end: { x: iconX + 11.4, y: iconY + 5.4 },
    thickness: 1.45, color: hex(C.brandBlue)
  });

  const word = "turnitin";
  const wordX = x + 16.2;
  const wordY = y + 4.15;
  const wordSize = 8.6;
  const maxWordWidth = BRAND_MARK.width - (wordX - x) - 0.5;
  drawFittedText(page, word, wordX, wordY, wordSize, f.lexSemi, maxWordWidth, C.brandBlue);
}

function shell(page, f, identity, pageNo, totalPages, label) {
  const leftText = `Page ${pageNo} of ${totalPages} - ${label}`;
  const placements = [
    [BRAND_MARK.headerTop, BRAND_MARK.headerTextTop],
    [BRAND_MARK.footerTop, BRAND_MARK.footerTextTop]
  ];

  for (const [logoTop, textTop] of placements) {
    drawBrandMark(page, f, logoTop);
    drawTextTop(page, leftText, BRAND_MARK.pageLabelX, textTop, 6, f.noto, C.ink);
    drawTextTop(page, "Submission ID", BRAND_MARK.submissionLabelX, textTop, 6, f.noto, C.ink);
    drawTextTop(page, identity.jkSubmissionId || "", BRAND_MARK.submissionValueX, textTop, 6, f.noto, C.ink);
  }
}

function drawCoverIcon(page, icons, key, top) {
  drawPngTop(page, icons[key], 36, top, 12, 12);
}

function documentPageCount(bundle) {
  const preserved =
    Number(bundle?.__originalPageCount || 0);

  if (preserved > 0) {
    return preserved;
  }

  const html = s(bundle?.crawled?.html?.value);
  const m = html.match(/<div id="pf\d+" class="[^"]*">/g);
  return m?.length || 1;
}

// TURNITIN_LONG_FILENAME_WRAP_V1
function wrapLongFileName(
  text,
  font,
  size,
  maxWidth
) {
  let remaining =
    safeText(text);

  const lines = [];

  if (!remaining) {
    return [""];
  }

  while (remaining) {
    if (
      font.widthOfTextAtSize(
        remaining,
        size
      ) <= maxWidth
    ) {
      lines.push(
        remaining
      );

      break;
    }

    let low = 1;
    let high =
      remaining.length;

    let fit = 1;

    while (
      low <= high
    ) {
      const mid =
        Math.floor(
          (
            low +
            high
          ) /
          2
        );

      const candidate =
        remaining.slice(
          0,
          mid
        );

      if (
        font.widthOfTextAtSize(
          candidate,
          size
        ) <= maxWidth
      ) {
        fit = mid;
        low =
          mid + 1;
      } else {
        high =
          mid - 1;
      }
    }

    let cut = fit;

    const candidate =
      remaining.slice(
        0,
        fit
      );

    const preferredBreak =
      Math.max(
        candidate.lastIndexOf(
          "_"
        ),
        candidate.lastIndexOf(
          "-"
        ),
        candidate.lastIndexOf(
          " "
        ),
        candidate.lastIndexOf(
          "."
        )
      );

    /*
      Prefer a separator only when it
      uses a reasonable amount of the line.
      Otherwise use the measured character
      boundary so we do not create a tiny line.
    */
    if (
      preferredBreak >=
      Math.floor(
        fit * 0.55
      )
    ) {
      cut =
        preferredBreak +
        1;
    }

    if (
      cut <= 0
    ) {
      cut =
        Math.max(
          1,
          fit
        );
    }

    lines.push(
      remaining.slice(
        0,
        cut
      )
    );

    remaining =
      remaining.slice(
        cut
      );
  }

  return lines;
}

function drawCover(
  page,
  f,
  icons,
  bundle,
  pageNo,
  totalPages
) {
  const id =
    bundle.reportIdentity ||
    {};

  shell(
    page,
    f,
    id,
    pageNo,
    totalPages,
    "Cover Page"
  );

  /*
    PERSON / REPORT NAME:
    deliberately unchanged.
  */
  drawTextTop(
    page,
    id.reportName ||
      "turnitin Report",
    36,
    304,
    20,
    f.lexSemi,
    C.ink
  );

  /*
    DOCUMENT TITLE:
    wrap long filenames exactly like
    a normal report cover instead of
    allowing them to leave the page.
  */
  const titleText =
    fileBase(
      id.filename ||
      "Document"
    );

  const titleSize = 17;
  const titleLineGap = 3;
  const titleStep =
    titleSize +
    titleLineGap;

  const titleLines =
    wrapLongFileName(
      titleText,
      f.lexMed,
      titleSize,
      540
    );

  titleLines.forEach(
    (
      line,
      index
    ) => {
      drawTextTop(
        page,
        line,
        36,
        337 +
          index *
            titleStep,
        titleSize,
        f.lexMed,
        C.ink
      );
    }
  );

  const titleShift =
    Math.max(
      0,
      titleLines.length -
        1
    ) *
    titleStep;

  const quickTop =
    365 +
    titleShift;

  drawCoverIcon(
    page,
    icons,
    "coverClipboard",
    quickTop
  );

  drawTextTop(
    page,
    "Quick Submit",
    56,
    quickTop +
      0.448,
    8,
    f.noto,
    C.muted
  );

  drawCoverIcon(
    page,
    icons,
    "coverTray",
    quickTop +
      16
  );

  drawTextTop(
    page,
    "Quick Submit",
    56,
    quickTop +
      16.448,
    8,
    f.noto,
    C.muted
  );

  drawCoverIcon(
    page,
    icons,
    "coverCap",
    quickTop +
      32
  );

  drawTextTop(
    page,
    id.institution ||
      "",
    56,
    quickTop +
      32.448,
    8,
    f.noto,
    C.muted
  );

  const ruleTop =
    425 +
    titleShift;

  drawRule(
    page,
    ruleTop
  );

  drawTextTop(
    page,
    "Document Details",
    36,
    443.31 +
      titleShift,
    10,
    f.notoSemi,
    C.ink
  );

  const details = [
    [
      "Submission ID",
      id.jkSubmissionId ||
        "N/A"
    ],
    [
      "Submission Date",
      fmtDate(
        bundle
          ?.completion
          ?.scannedDocument
          ?.creationTime ||
        bundle
          ?.job
          ?.paidAt
      )
    ],
    [
      "Download Date",
      fmtDate(
        bundle
          ?.generatedAt
      )
    ],
    [
      "File Name",
      id.filename ||
        "N/A"
    ],
    [
      "File Size",
      bytesText(
        resolveFileSizeBytes(
          bundle
        )
      )
    ]
  ];

  let top =
    472.517 +
    titleShift;

  for (
    const [
      label,
      value
    ] of details
  ) {
    drawTextTop(
      page,
      label,
      36,
      top,
      7,
      f.notoSemi,
      C.muted
    );

    if (
      label ===
      "File Name"
    ) {
      const fileLines =
        wrapLongFileName(
          value,
          f.notoSemi,
          7,
          540
        );

      const fileLineStep =
        9;

      fileLines.forEach(
        (
          line,
          index
        ) => {
          drawTextTop(
            page,
            line,
            36,
            top +
              14 +
              index *
                fileLineStep,
            7,
            f.notoSemi,
            C.ink
          );
        }
      );

      top +=
        36 +
        Math.max(
          0,
          fileLines.length -
            1
        ) *
        fileLineStep;
    } else {
      drawTextTop(
        page,
        value,
        36,
        top +
          14,
        7,
        f.notoSemi,
        C.ink
      );

      top += 36;
    }
  }

  /*
    Keep the statistics box aligned
    with the shifted Document Details
    area when the large title wraps.
  */
  page.drawRectangle({
    x: 403,
    y:
      PAGE_H -
      (
        548 +
        titleShift
      ),
    width: 89,
    height: 78,
    color:
      hex(
        C.lightGray
      )
  });

  const pageCount =
    documentPageCount(
      bundle
    );

  const words =
    Number(
      bundle
        ?.completion
        ?.scannedDocument
        ?.totalWords ||
      0
    );

  const chars =
    s(
      bundle
        ?.crawled
        ?.text
        ?.value
    ).length;

  drawTextTop(
    page,
    `${pageCount} Pages`,
    415,
    484.517 +
      titleShift,
    7,
    f.notoSemi,
    C.ink
  );

  drawTextTop(
    page,
    `${words.toLocaleString("en-US")} Words`,
    415,
    506.517 +
      titleShift,
    7,
    f.notoSemi,
    C.ink
  );

  drawTextTop(
    page,
    `${chars.toLocaleString("en-US")} Characters`,
    415,
    528.517 +
      titleShift,
    7,
    f.notoSemi,
    C.ink
  );
}

function sourceList(bundle) {
  const r = bundle?.completion?.results || {};
  const out = [];
  for (const [key, label] of [["internet", "Internet"], ["database", "Publications"], ["repositories", "Submitted works"], ["batch", "Submitted works"]]) {
    for (const item of Array.isArray(r[key]) ? r[key] : []) out.push({ ...item, sourceType: key, sourceLabel: label });
  }
  return out.map((item, i) => ({ ...item, number: i + 1, badge: SOURCE_COLORS[i % SOURCE_COLORS.length] }));
}

function normalizeMap(text) {
  let norm = "";
  const map = [];
  let ws = false;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (!ws) { norm += " "; map.push(i); ws = true; }
    } else { norm += text[i]; map.push(i); ws = false; }
  }
  return { norm, map };
}

function decodeEntities(v) {
  return s(v)
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

function parseStyle(styleText) {
  const o = {};
  for (const k of ["left", "bottom", "width", "height"]) {
    const m = s(styleText).match(new RegExp(`${k}:\\s*(-?[0-9.]+)px`, "i"));
    if (m) o[k] = Number(m[1]);
  }
  return o;
}

function parseCssFontClasses(html) {
  const out = {};
  const re = /\.(f\d+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(html))) {
    const fam = m[2].match(/font-family:\s*"([^"]+)"/i);
    const sz = m[2].match(/font-size:\s*([0-9.]+)px/i);
    const wt = m[2].match(/font-weight:\s*(\d+)/i);
    out[m[1]] = { family: fam?.[1] || null, size: Number(sz?.[1] || 11), weight: Number(wt?.[1] || 400) };
  }
  return out;
}

function parseFontFaces(html) {
  const out = {};
  const re = /@font-face\s*\{([\s\S]*?)\}/g;
  let m;
  while ((m = re.exec(html))) {
    const body = m[1];
    const fam = body.match(/font-family:\s*['"]([^'"]+)['"]/i)?.[1];
    const wt = Number(body.match(/font-weight:\s*(\d+)/i)?.[1] || 400);
    const src = body.match(/src:\s*url\(data:font\/[^;]+;base64,([^)]+)\)/i)?.[1];
    if (fam && src) out[`${fam}|${wt}`] = Buffer.from(src, "base64");
  }
  return out;
}

function pageChunks(html) {
  const starts = [];
  const re = /<div id="pf(\d+)" class="[^"]*">/g;
  let m;
  while ((m = re.exec(html))) starts.push({ id: Number(m[1]), index: m.index });
  return starts.map((p, i) => html.slice(p.index, i + 1 < starts.length ? starts[i + 1].index : html.length));
}

// COPYLEAKS_PARAGRAPH_HTML_FALLBACK_V1

function splitFallbackParagraph(
  value,
  maxChars = 92
) {
  const clean =
    decodeEntities(
      safeText(value)
        .replace(
          /<br\s*\/?>/gi,
          " "
        )
        .replace(
          /<[^>]+>/g,
          ""
        )
    )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  if (!clean) {
    return [];
  }

  const words =
    clean.split(/\s+/);

  const lines = [];

  let line = "";

  for (
    const word of words
  ) {
    const next =
      line
        ? line +
          " " +
          word
        : word;

    if (
      !line ||
      next.length <=
        maxChars
    ) {
      line = next;
    } else {
      lines.push(
        line
      );

      line = word;
    }
  }

  if (line) {
    lines.push(
      line
    );
  }

  return lines;
}

function parseParagraphFallbackPages(
  html
) {
  const bodyMatch =
    safeText(html).match(
      /<body\b[^>]*>([\s\S]*?)<\/body>/i
    );

  const body =
    bodyMatch
      ? bodyMatch[1]
      : safeText(html);

  const paragraphRe =
    /<p\b[^>]*>([\s\S]*?)<\/p>/gi;

  const lines = [];

  let match;

  while (
    (
      match =
        paragraphRe.exec(
          body
        )
    )
  ) {
    const paragraphLines =
      splitFallbackParagraph(
        match[1]
      );

    if (
      paragraphLines.length
    ) {
      lines.push(
        ...paragraphLines
      );

      /*
        Preserve a little paragraph
        separation without inventing
        document content.
      */
      lines.push("");
    }
  }

  /*
    Some simple XHTML exports may not
    use <p>. Fall back to visible body
    text only if needed.
  */
  if (!lines.length) {
    const visible =
      splitFallbackParagraph(
        body.replace(
          /<\/(div|li|tr|h[1-6])>/gi,
          " "
        )
      );

    lines.push(
      ...visible
    );
  }

  while (
    lines.length &&
    !lines[
      lines.length - 1
    ]
  ) {
    lines.pop();
  }

  if (!lines.length) {
    return [];
  }

  /*
    These coordinates deliberately
    leave room for the existing report
    header and footer.

    We do not claim to reproduce Word's
    original pagination when Copyleaks
    did not supply page geometry.
  */
  const LEFT = 68;
  const WIDTH = 476;
  const FIRST_Y = 688;
  const LAST_Y = 82;
  const LINE_STEP = 17;
  const FONT_SIZE = 10;

  const pages = [];

  let current = {
    width: PAGE_W,
    height: PAGE_H,
    bg: null,
    elements: []
  };

  let y =
    FIRST_Y;

  let order =
    0;

  function finishPage() {
    if (
      current.elements.length
    ) {
      pages.push(
        current
      );
    }

    current = {
      width: PAGE_W,
      height: PAGE_H,
      bg: null,
      elements: []
    };

    y =
      FIRST_Y;
  }

  for (
    const line of lines
  ) {
    if (!line) {
      y -= 7;

      if (
        y <
        LAST_Y
      ) {
        finishPage();
      }

      continue;
    }

    if (
      y <
      LAST_Y
    ) {
      finishPage();
    }

    current.elements.push({
      order:
        order++,

      type:
        "fallback",

      text:
        line,

      style: {
        left:
          LEFT,

        bottom:
          y,

        width:
          WIDTH,

        height:
          FONT_SIZE
      },

      fontClass:
        "f0",

      family:
        null,

      size:
        FONT_SIZE,

      weight:
        400
    });

    y -=
      LINE_STEP;
  }

  finishPage();

  return pages;
}

function parseOriginalPages(html) {
  const classes =
    parseCssFontClasses(
      html
    );

  const chunks =
    pageChunks(
      html
    );

  /*
    Existing positioned Copyleaks
    HTML remains completely unchanged.
  */
  if (
    chunks.length
  ) {
    return chunks.map(
      (chunk) => {
        const bg =
          chunk.match(
            /<img\s+width="(\d+)"\s+height="(\d+)"\s+src="data:image\/(png|jpeg);base64,([^"]+)"[^>]*alt="background image"/i
          );

        const elements =
          [];

        const wordRe =
          /<span class="([^"]*\bw\b[^"]*)"[^>]*style="([^"]*)"[^>]*>\s*<span class="wt[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<\/span>/g;

        let m;

        while (
          (
            m =
              wordRe.exec(
                chunk
              )
          )
        ) {
          const value =
            decodeEntities(
              m[3].replace(
                /<[^>]+>/g,
                ""
              )
            );

          if (!value) {
            continue;
          }

          const fontClass =
            m[1].match(
              /\bf\d+\b/
            )?.[0] ||
            "f0";

          const cfg =
            classes[
              fontClass
            ] || {
              family:
                null,
              size:
                11,
              weight:
                400
            };

          elements.push({
            order:
              m.index,

            type:
              "w",

            text:
              value,

            style:
              parseStyle(
                m[2]
              ),

            fontClass,

            ...cfg
          });
        }

        const charRe =
          /<span class="([^"]*\bc\b[^"]*)"[^>]*style="([^"]*)"[^>]*>([\s\S]*?)<\/span>/g;

        while (
          (
            m =
              charRe.exec(
                chunk
              )
          )
        ) {
          const value =
            decodeEntities(
              m[3].replace(
                /<[^>]+>/g,
                ""
              )
            );

          if (!value) {
            continue;
          }

          const fontClass =
            m[1].match(
              /\bf\d+\b/
            )?.[0] ||
            "f0";

          const cfg =
            classes[
              fontClass
            ] || {
              family:
                null,
              size:
                11,
              weight:
                400
            };

          elements.push({
            order:
              m.index,

            type:
              "c",

            text:
              value,

            style:
              parseStyle(
                m[2]
              ),

            fontClass,

            ...cfg
          });
        }

        elements.sort(
          (
            a,
            b
          ) =>
            a.order -
            b.order
        );

        return {
          width:
            Number(
              bg?.[1] ||
              PAGE_W
            ),

          height:
            Number(
              bg?.[2] ||
              PAGE_H
            ),

          bg:
            bg
              ? {
                  type:
                    bg[3]
                      .toLowerCase(),

                  data:
                    bg[4]
                }
              : null,

          elements
        };
      }
    );
  }

  /*
    Legacy/simple .doc XHTML path.
  */
  const fallbackPages =
    parseParagraphFallbackPages(
      html
    );

  if (
    fallbackPages.length
  ) {
    console.log(
      "Using paragraph XHTML fallback:",
      fallbackPages.length,
      "page(s)."
    );
  }

  return fallbackPages;
}

function mapElementsToText(pages, fullText) {
  const nm = normalizeMap(fullText);
  let cursor = 0;
  for (const p of pages) {
    for (const e of p.elements) {
      const needle = e.text.replace(/\s+/g, " ").trim();
      if (!needle) continue;
      let pos = nm.norm.indexOf(needle, cursor);
      if (pos < 0) pos = nm.norm.indexOf(needle);
      if (pos < 0) continue;
      e.start = nm.map[pos];
      e.end = (nm.map[pos + needle.length - 1] ?? e.start) + 1;
      cursor = pos + needle.length;
    }
  }
}

async function embedOriginalFonts(doc, html, brandFonts) {
  const faces = parseFontFaces(html);
  const cache = {};
  for (const [key, bytes] of Object.entries(faces)) {
    try { cache[key] = await doc.embedFont(bytes, { subset: true }); } catch { /* fallback later */ }
  }
  cache.__fallback = brandFonts.noto;
  return cache;
}

function classifyContext(text, start, end) {
  const before = text.slice(Math.max(0, start - 120), start);
  const around = text.slice(Math.max(0, start - 160), Math.min(text.length, end + 180));
  const quoted = ((before.match(/["â€œâ€]/g) || []).length % 2 === 1) || /^\s*["â€œ]/.test(text.slice(Math.max(0, start - 3), start + 2));
  const cited = /\([A-Z][^()\n]{0,100}\b(?:19|20)\d{2}[a-z]?(?:[^()]*)\)/.test(around) || /\[[0-9][0-9,;\s-]*\]/.test(around) || /\b[A-Z][A-Za-z'â€™-]+(?:\s+et\s+al\.)?\s*\((?:19|20)\d{2}[a-z]?\)/.test(around);
  if (quoted && cited) return "CITED_AND_QUOTED";
  if (cited) return "MISSING_QUOTATIONS";
  if (quoted) return "MISSING_CITATION";
  return "NOT_CITED_OR_QUOTED";
}

function simRanges(
  bundle,
  sources,
  fullText
) {
  const byId =
    new Map();

  for (
    const source of
      sources
  ) {
    const id =
      s(
        source?.id
      ).trim();

    if (
      id &&
      !byId.has(id)
    ) {
      byId.set(
        id,
        source
      );
    }
  }

  const out = [];

  for (
    const item of
      bundle?.results || []
  ) {
    const sourceId =
      s(
        item
          ?.descriptor
          ?.id
      ).trim();

    const descriptorSourceType =
      s(
        item
          ?.descriptor
          ?.sourceType
      ).trim();

    const source =
      sourceId
        ? byId.get(
            sourceId
          )
        : null;

    const comparison =
      item
        ?.result
        ?.text
        ?.comparison;

    if (
      !comparison
    ) {
      continue;
    }

    for (
      const kind of
        [
          "identical",
          "minorChanges",
          "relatedMeaning"
        ]
    ) {
      const chars =
        comparison
          ?.[kind]
          ?.suspected
          ?.chars;

      const starts =
        chars?.starts ||
        [];

      const lengths =
        chars?.lengths ||
        [];

      for (
        let i = 0;
        i <
        starts.length;
        i += 1
      ) {
        const start =
          Number(
            starts[i]
          );

        const length =
          Number(
            lengths[i] ||
            0
          );

        if (
          !Number.isFinite(
            start
          ) ||
          length <=
            0
        ) {
          continue;
        }

        out.push({
          start,

          end:
            start +
            length,

          length,

          kind,

          sourceId:
            sourceId ||
            null,

          sourceNumber:
            source
              ? source.number
              : null,

          sourceType:
            source
              ?.sourceType ||
            descriptorSourceType ||
            null,

          sourceLabel:
            source
              ?.sourceLabel ||
            null,

          sourceTitle:
            source
              ?.title ||
            null,

          sourceUrl:
            source
              ?.url ||
            null,

          resolvedSource:
            Boolean(
              source
            ),

          group:
            classifyContext(
              fullText,
              start,
              start +
                length
            )
        });
      }
    }
  }

  return out.sort(
    (
      a,
      b
    ) =>
      a.start -
        b.start ||
      a.end -
        b.end ||
      Number(
        a.sourceNumber ||
        0
      ) -
      Number(
        b.sourceNumber ||
        0
      )
  );
}


// JK_SOURCE_AUDIT_V2
function validateSimilaritySourceMapping(
  bundle,
  sources,
  ranges,
  fullText
) {
  const errors = [];

  const sourceById =
    new Map();

  const sourceByNumber =
    new Map();


  /*
    Validate the source list itself.
  */
  for (
    const source of
      sources
  ) {
    const id =
      s(
        source?.id
      ).trim();

    const number =
      Number(
        source?.number
      );

    if (
      !id &&
      Number(
        source
          ?.matchedWords ||
        0
      ) >
        0
    ) {
      errors.push(
        "Source #" +
        (
          number ||
          "?"
        ) +
        " has matched words but no Copyleaks source ID."
      );
    }

    if (id) {
      if (
        sourceById.has(
          id
        )
      ) {
        errors.push(
          "Duplicate Copyleaks source ID detected: " +
          id +
          "."
        );
      } else {
        sourceById.set(
          id,
          source
        );
      }
    }

    if (
      Number.isFinite(
        number
      ) &&
      number >
        0
    ) {
      if (
        sourceByNumber.has(
          number
        )
      ) {
        errors.push(
          "Duplicate displayed source number detected: " +
          number +
          "."
        );
      } else {
        sourceByNumber.set(
          number,
          source
        );
      }
    }
  }


  /*
    Validate every individual highlighted range.
  */
  for (
    let index = 0;
    index <
    ranges.length;
    index += 1
  ) {
    const range =
      ranges[index];

    const tag =
      "range " +
      (
        index +
        1
      );

    if (
      !Number.isFinite(
        range.start
      ) ||
      !Number.isFinite(
        range.end
      ) ||
      range.end <=
        range.start
    ) {
      errors.push(
        tag +
        ": invalid character range " +
        range.start +
        "-" +
        range.end +
        "."
      );

      continue;
    }

    // JK_SOURCE_COORDINATE_FIX_V1
    if (
      range.start <
        0
    ) {
      errors.push(
        tag +
        ": character range starts below zero: " +
        range.start +
        "."
      );
    }

    /*
      Important:

      Do not reject range.end > fullText.length.

      Copyleaks comparison offsets can use a less-normalized
      coordinate stream than crawled.text.value. The original
      Copyleaks start/end values must stay untouched so that the
      document-layout mapper can place the match where Copyleaks
      detected it.
    */

    if (
      !range.sourceId
    ) {
      errors.push(
        tag +
        ": Copyleaks detailed result did not provide a source ID."
      );

      continue;
    }

    if (
      !range.resolvedSource
    ) {
      errors.push(
        tag +
        ": source ID " +
        range.sourceId +
        " could not be matched to the Copyleaks completion source list."
      );

      continue;
    }

    const sourceFromId =
      sourceById.get(
        range.sourceId
      );

    if (
      !sourceFromId
    ) {
      errors.push(
        tag +
        ": source ID " +
        range.sourceId +
        " is missing from the source map."
      );

      continue;
    }

    const sourceNumber =
      Number(
        range.sourceNumber
      );

    if (
      !Number.isFinite(
        sourceNumber
      ) ||
      sourceNumber <=
        0
    ) {
      errors.push(
        tag +
        ": resolved source " +
        range.sourceId +
        " has no valid displayed source number."
      );

      continue;
    }

    const sourceFromNumber =
      sourceByNumber.get(
        sourceNumber
      );

    if (
      !sourceFromNumber ||
      s(
        sourceFromNumber.id
      ).trim() !==
        range.sourceId
    ) {
      errors.push(
        tag +
        ": source number " +
        sourceNumber +
        " does not point back to source ID " +
        range.sourceId +
        "."
      );
    }

    if (
      !GROUPS.some(
        (
          group
        ) =>
          group.key ===
          range.group
      )
    ) {
      errors.push(
        tag +
        ": unknown match group " +
        range.group +
        "."
      );
    }
  }


  /*
    If even one source connection is uncertain,
    stop generation rather than guessing.
  */
  if (
    errors.length
  ) {
    const shown =
      errors
        .slice(
          0,
          30
        )
        .map(
          (
            error
          ) =>
            "- " +
            error
        )
        .join(
          "\n"
        );

    const more =
      errors.length >
        30
        ? (
            "\n- ...and " +
            (
              errors.length -
              30
            ) +
            " more validation error(s)."
          )
        : "";

    throw new Error(
      "Similarity source mapping validation failed. " +
      "No report was generated because source-to-text matching was not trustworthy.\n" +
      shown +
      more
    );
  }


  const typeCounts = {};

  const rangeCountBySource =
    {};


  for (
    const range of
      ranges
  ) {
    const type =
      range.sourceType ||
      "unknown";

    typeCounts[type] =
      Number(
        typeCounts[type] ||
        0
      ) +
      1;

    const key =
      String(
        range.sourceNumber
      );

    rangeCountBySource[key] =
      Number(
        rangeCountBySource[key] ||
        0
      ) +
      1;
  }


  /*
    Internal audit object.

    This is not sent to customers.
  */
  return {
    schema:
      "JK_SIMILARITY_SOURCE_AUDIT_V2",

    generatedAt:
      new Date()
        .toISOString(),

    submissionId:
      bundle
        ?.reportIdentity
        ?.jkSubmissionId ||
      null,

    fileName:
      bundle
        ?.reportIdentity
        ?.filename ||
      null,

    overallSimilarity:
      Number(
        bundle
          ?.completion
          ?.results
          ?.score
          ?.aggregatedScore ||
        0
      ),

    documentCharacterCount:
      fullText.length,

    sourceCount:
      sources.length,

    matchRangeCount:
      ranges.length,

    unresolvedRangeCount:
      0,

    normalizedTextCoordinateOverflowCount:
      ranges.filter(
        (range) =>
          range.end >
          fullText.length
      ).length,

    coordinatePolicy:
      "Copyleaks comparison start/end values are preserved exactly; crawled.text.value length is not used to clip them.",

    rangeCountBySourceType:
      typeCounts,

    sources:
      sources.map(
        (
          source
        ) => ({
          sourceId:
            s(
              source?.id
            ).trim() ||
            null,

          sourceNumber:
            Number(
              source?.number
            ) ||
            null,

          sourceType:
            source
              ?.sourceType ||
            null,

          sourceLabel:
            source
              ?.sourceLabel ||
            null,

          matchedWords:
            Number(
              source
                ?.matchedWords ||
              0
            ),

          title:
            source
              ?.title ||
            null,

          url:
            source
              ?.url ||
            null,

          domain:
            sourceDomain(
              source
            ),

          mappedRangeCount:
            Number(
              rangeCountBySource[
                String(
                  source?.number
                )
              ] ||
              0
            )
        })
      ),

    matches:
      ranges.map(
        (
          range,
          index
        ) => ({
          matchNumber:
            index +
            1,

          start:
            range.start,

          end:
            range.end,

          length:
            range.end -
            range.start,

          matchKind:
            range.kind,

          matchGroup:
            range.group,

          sourceId:
            range.sourceId,

          sourceNumber:
            range.sourceNumber,

          sourceType:
            range.sourceType,

          sourceLabel:
            range.sourceLabel,

          sourceDomain:
            sourceDomain({
              url:
                range.sourceUrl,

              title:
                range.sourceTitle,

              number:
                range.sourceNumber
            }),

          copyleaksCoordinateStart:
            range.start,

          copyleaksCoordinateEnd:
            range.end,

          crawledTextLength:
            fullText.length,

          extendsPastNormalizedCrawledText:
            range.end >
            fullText.length,

          /*
            This preview uses crawled.text.value only for human
            inspection. It is NOT used to alter the original
            Copyleaks match coordinates.
          */
          textPreview:
            fullText
              .slice(
                Math.min(
                  range.start,
                  fullText.length
                ),
                Math.min(
                  range.end,
                  fullText.length
                )
              )
              .replace(
                /\s+/g,
                " "
              )
              .trim()
              .slice(
                0,
                160
              )
        })
      )
  };
}

function aiInfo(bundle) {
  const alerts = Array.isArray(bundle?.completion?.notifications?.alerts) ? bundle.completion.notifications.alerts : [];
  const unavailable = {
    "ai-detection-failed": "AI detection failed",
    "file-type-not-supported": "File type not supported for AI detection",
    "ai-detection-lang-not-supported": "Language not supported for AI detection",
    "ai-detection-text-too-short": "Text too short for AI detection"
  };
  for (const a of alerts) if (unavailable[s(a?.code)]) return { available: false, reason: unavailable[s(a.code)], percent: null, ranges: [] };

  let percent = 0;
  let detail = null;
  const alert = alerts.find((a) => s(a?.code) === "suspected-ai-text");
  if (alert) {
    let d = alert.additionalData;
    if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = null; } }
    detail = d;
    const raw = Number(d?.summary?.ai);
    if (Number.isFinite(raw)) percent = raw <= 1 ? raw * 100 : raw;
  }
  for (const item of bundle?.results || []) {
    const type = s(item?.descriptor?.sourceType).toLowerCase();
    if (
      type === "aidetection" ||
      type === "ai-detection" ||
      type === "ai_detection"
    ) {
      detail = item.result;
      const raw = Number(detail?.summary?.ai);
      if (Number.isFinite(raw)) percent = raw <= 1 ? raw * 100 : raw;
      break;
    }
  }

  const ranges = [];
  const sections = detail?.result || detail?.results || [];

  if (Array.isArray(sections)) {
    for (const section of sections) {
      if (Number(section?.classification) !== 2) continue;

      for (const m of section?.matches || []) {
        const starts = m?.text?.chars?.starts || [];
        const lengths = m?.text?.chars?.lengths || [];

        for (let i = 0; i < starts.length; i++) {
          const start = Number(starts[i]);
          const len = Number(lengths[i] || 0);
          if (Number.isFinite(start) && len > 0) ranges.push({ start, end: start + len });
        }
      }
    }
  }

  return {
    available: true,
    reason: null,
    percent: Math.max(0, Math.min(100, percent)),
    ranges
  };
}

function overlaps(a, b, c, d) {
  return Math.max(a, c) < Math.min(b, d);
}

function groupStats(ranges, overallScore) {
  const stats = GROUPS.map((g) => ({
    ...g,
    count: ranges.filter((r) => r.group === g.key).length,
    raw: ranges.filter((r) => r.group === g.key).reduce((n, r) => n + (r.end - r.start), 0),
    percent: 0
  }));

  const total = stats.reduce((n, g) => n + g.raw, 0) || 1;

  for (const g of stats) {
    g.percent = overallScore * g.raw / total;
  }

  return stats;
}

function sourceCategoryStats(sources, overallScore) {
  const total = sources.reduce((n, x) => n + Number(x.matchedWords || 0), 0) || 1;

  const sum = (keys) =>
    sources
      .filter((x) => keys.includes(x.sourceType))
      .reduce((n, x) => n + Number(x.matchedWords || 0), 0);

  return {
    internet: overallScore * sum(["internet"]) / total,
    publications: overallScore * sum(["database"]) / total,
    submitted: overallScore * sum(["repositories", "batch"]) / total
  };
}

function drawGroupIcon(page, icons, group, rowTop) {
  const bgTop = rowTop - 0.517;

  page.drawEllipse({
    x: 42.25,
    y: PAGE_H - bgTop - 6,
    xScale: 6.25,
    yScale: 6,
    color: hex(group.fill)
  });

  const key = groupIconKey(group.key);

  if (group.key === "NOT_CITED_OR_QUOTED") {
    drawPngTop(page, icons[key], 39, rowTop + 2.483, 5.5, 6);
  } else if (group.key === "MISSING_QUOTATIONS") {
    drawPngTop(page, icons[key], 39.5, rowTop + 3.983, 5.5, 3.5);
  } else if (group.key === "MISSING_CITATION") {
    drawPngTop(page, icons[key], 39, rowTop + 3.483, 6, 4);
  } else {
    drawPngTop(page, icons[key], 39, rowTop + 2.483, 5.5, 6);
  }
}

function drawSimilaritySummaryBlock(page, f, icons, groups, cats, topBase = 161.81) {
  drawTextTop(page, "Match Groups", 36, topBase, 10, f.notoSemi, C.ink);
  drawTextTop(page, "Top Sources", 298.5, topBase, 10, f.notoSemi, C.ink);

  let top = topBase + 23.207;

  for (const group of groups) {
    drawGroupIcon(page, icons, group, top);
    drawTextTop(page, String(group.count), 53, top, 7, f.notoSemi, C.ink);
    drawTextTop(page, ` ${group.label}  ${fmtPct(group.percent)}`, 57, top, 7, f.noto, C.ink);
    drawTextTop(page, group.desc, 53, top + 10, 7, f.noto, C.muted);
    top += 25;
  }

  const rows = [
    [fmtPct(cats.internet), "Internet sources", "sourceInternet", 322, 1.0, 8.5, 8.5],
    [fmtPct(cats.publications), "Publications", "sourcePublication", 322, 1.48, 9, 6.5],
    [fmtPct(cats.submitted), "Submitted works (Student Papers)", "sourceSubmitted", 323, 1.48, 6.5, 6.5]
  ];

  rows.forEach((row, index) => {
    const rowTop = topBase + 23.207 + index * 14;
    drawTextTop(page, row[0], 298.5, rowTop, 7, f.noto, C.ink);
    drawPngTop(page, icons[row[2]], row[3], rowTop + row[4], row[5], row[6]);
    drawTextTop(page, row[1], 336, rowTop, 7, f.noto, C.ink);
  });
}

function similarityOverviewPage(page, f, icons, bundle, groups, cats, pageNo, totalPages) {
  const id = bundle.reportIdentity || {};
  shell(page, f, id, pageNo, totalPages, "Integrity Overview");

  const score = Number(bundle?.completion?.results?.score?.aggregatedScore || 0);

  drawTextTop(page, `${fmtPct(score)} Overall Similarity`, 36, 55, 17, f.lexMed, C.ink);
  drawTextTop(
    page,
    "The combined total of all matches, including overlapping sources, for each database.",
    36,
    80.017,
    7,
    f.noto,
    C.muted
  );

  let summaryTop = 161.81;

  if (s(id.similarityFilter).toUpperCase() === "FILTERED") {
    drawTextTop(page, "Filtered from the Report", 36, 100.81, 10, f.notoSemi, C.ink);
    drawPngTop(page, icons.filterBullet, 39, 125.5, 2, 3);
    drawTextTop(page, "Quoted Text", 48, 122.017, 7, f.noto, C.ink);
    drawPngTop(page, icons.filterBullet, 39, 139.5, 2, 3);
    drawTextTop(page, "Bibliography", 48, 136.017, 7, f.noto, C.ink);
    summaryTop = 175.81;
  }

  drawSimilaritySummaryBlock(page, f, icons, groups, cats, summaryTop);

  const integrityTop = summaryTop + 140;

  drawTextTop(page, "Integrity Flags", 36, integrityTop, 10, f.notoSemi, C.ink);
  drawTextTop(page, "0 Integrity Flags for Review", 36, integrityTop + 18.21, 7, f.notoSemi, C.ink);
  drawTextTop(page, "No suspicious text manipulations found.", 36, integrityTop + 33.21, 7, f.noto, C.muted);

  page.drawRectangle({
    x: 301,
    y: PAGE_H - (integrityTop + 80.69),
    width: 266,
    height: 64,
    color: hex(C.softBlue)
  });

  drawTextTop(
    page,
    "Our system's algorithms look deeply at a document for any inconsistencies that",
    313,
    integrityTop + 25.29,
    6,
    f.noto,
    C.ink
  );

  drawTextTop(
    page,
    "would set it apart from a normal submission. If we notice something unusual,",
    313,
    integrityTop + 33.29,
    6,
    f.noto,
    C.ink
  );

  drawTextTop(page, "we flag it for review.", 313, integrityTop + 41.29, 6, f.noto, C.ink);

  drawTextTop(
    page,
    "A flag is not necessarily an indicator of a problem. It is a prompt for closer review.",
    313,
    integrityTop + 57.29,
    6,
    f.noto,
    C.ink
  );
}

function sourceRowsPerPage(pageIndex) {
  return pageIndex === 0 ? 10 : 13;
}

function sourcePageCount(sourceCount) {
  if (sourceCount <= 10) return 1;
  return 1 + Math.ceil((sourceCount - 10) / 13);
}

function drawSourceBadge(page, f, source, x, top) {
  const y = PAGE_H - top - 7;

  page.drawCircle({
    x,
    y,
    size: 7,
    color: hex(source.badge)
  });

  const t = String(source.number);

  page.drawText(t, {
    x: x - f.notoSemi.widthOfTextAtSize(t, 6) / 2,
    y: y - 2.2,
    size: 6,
    font: f.notoSemi,
    color: hex(C.white)
  });
}

function sourceOverviewPages(doc, f, icons, bundle, groups, cats, sources, startPageNo, totalPages) {
  let pageNo = startPageNo;
  let offset = 0;
  let pageIndex = 0;

  do {
    const page = doc.addPage([PAGE_W, PAGE_H]);

    shell(page, f, bundle.reportIdentity || {}, pageNo, totalPages, "Integrity Overview");

    let rowTop;

    if (pageIndex === 0) {
      drawSimilaritySummaryBlock(page, f, icons, groups, cats, 53.31);
      drawRule(page, 187.5);
      drawTextTop(page, "Top Sources", 36, 205.81, 10, f.notoSemi, C.ink);
      drawTextTop(
        page,
        "The sources with the highest number of matches within the submission. Overlapping sources will not be displayed.",
        36,
        224.017,
        7,
        f.noto,
        C.muted
      );

      rowTop = 248.017;
    } else {
      rowTop = 56.017;
    }

    const take = sourceRowsPerPage(pageIndex);
    const chunk = sources.slice(offset, offset + take);

    chunk.forEach((source, index) => {
      const top = rowTop + index * 48;
      const pillTop = top - 2.517;

      drawRoundedPill(page, 36, pillTop, 24.5, 15, sourceColour(source.number));
      drawRoundedPill(page, 66, pillTop, 70, 15, paleSourceColour(source.number));

      const label = String(source.number);
      const labelSize = label.length >= 2 ? 6.2 : 7;

      page.drawText(label, {
        x: 48.25 - f.notoSemi.widthOfTextAtSize(label, labelSize) / 2,
        y: PAGE_H - top - labelSize + 0.8,
        size: labelSize,
        font: f.notoSemi,
        color: hex(C.white)
      });

      const typeLabel =
        source.sourceType === "internet"
          ? "Internet"
          : source.sourceType === "database"
            ? "Publication"
            : "Student papers";

      drawTextTop(page, typeLabel, 86.7655, top, 7, f.notoSemi, C.ink);
      drawTextTop(page, sourceDomain(source), 36, top + 16.931, 8, f.notoSemi, C.ink);

      const totalMatched =
        sources.reduce((n, item) => n + Number(item.matchedWords || 0), 0) || 1;

      const score =
        Number(bundle?.completion?.results?.score?.aggregatedScore || 0);

      const sourcePercent =
        score * Number(source.matchedWords || 0) / totalMatched;

      drawTextTop(
        page,
        sourcePercent > 0 && sourcePercent < 1
          ? "<1%"
          : fmtPct(sourcePercent),
        386,
        top + 16.931,
        8,
        f.notoSemi,
        C.ink
      );
    });

    offset += chunk.length;
    pageIndex += 1;
    pageNo += 1;
  } while (offset < sources.length);

  return pageNo;
}

function aiOverviewPage(page, f, icons, bundle, ai, pageNo, totalPages) {
  const id = bundle.reportIdentity || {};

  shell(page, f, id, pageNo, totalPages, "AI Writing Overview");

  const value = Number(ai?.percent || 0);
  const low = ai.available && value > 0 && value < 20;

  const headline =
    !ai.available
      ? "AI detection unavailable"
      : low
        ? "*% detected as AI"
        : `${fmtPct(value)} detected as AI`;

  drawTextTop(page, headline, 36, 81, 17, f.lexMed, C.ink);

  const description =
    !ai.available
      ? (ai.reason || "AI detection could not be completed.")
      : low
        ? "AI detection includes the possibility of false positives. Although some text in this submission is likely AI generated, scores below the 20% threshold are not surfaced because they have a higher likelihood of false positives."
        : "The percentage indicates the combined amount of likely AI-generated text as well as likely AI-generated text that was also likely revised by AI.";

  drawWrappedTop(page, description, 36, 100.517, 256, 7, f.noto, C.ink, 3, low ? 4 : 3);

  page.drawRectangle({
    x: 306,
    y: PAGE_H - 132,
    width: 273,
    height: 56,
    color: hex(C.softBlue)
  });

  drawTextTop(page, "Caution: Review required.", 318, 85.586, 6, f.notoSemi, C.ink);
  drawTextTop(
    page,
    "It is essential to understand the limitations of AI detection before making decisions",
    318,
    101.586,
    6,
    f.noto,
    C.ink
  );
  drawTextTop(
    page,
    "about a student's work. Review the highlighted text and apply human judgment together",
    318,
    109.586,
    6,
    f.noto,
    C.ink
  );
  drawTextTop(
    page,
    "with the relevant academic policy before reaching a conclusion.",
    318,
    117.586,
    6,
    f.noto,
    C.ink
  );

  if (!low && ai.available) {
    const count = value >= 20 ? Math.max(1, ai.ranges.length) : 0;

    drawPngTop(page, icons.aiRobot, 36, 168, 12, 12);
    drawTextTop(page, String(count), 52, 166.517, 7, f.noto, C.ink);
    drawTextTop(page, `AI-generated  ${fmtPct(value)}`, count >= 10 ? 61 : 60, 166.517, 7, f.noto, C.ink);
    drawTextTop(
      page,
      "Likely generated or likely generated and revised by AI.",
      52,
      176.517,
      7,
      f.noto,
      C.muted
    );
  }

  const disclaimerTop = low ? 165.586 : 217.586;

  drawTextTop(page, "Disclaimer", 36, disclaimerTop, 6, f.notoSemi, C.muted);

  drawTextTop(
    page,
    "This AI writing assessment is designed to help reviewers identify text that might be prepared by a generative AI tool. AI assessment may not always be accurate, so it should not",
    36,
    disclaimerTop + 8,
    6,
    f.noto,
    C.muted
  );

  drawTextTop(
    page,
    "be used as the sole basis for adverse action. Further scrutiny and human judgment, together with the applicable institutional policy, are required before determining whether",
    36,
    disclaimerTop + 16,
    6,
    f.noto,
    C.muted
  );

  drawTextTop(
    page,
    "academic misconduct or inappropriate AI use has occurred.",
    36,
    disclaimerTop + 24,
    6,
    f.noto,
    C.muted
  );
}

function sourceDomain(source) {
  const value = s(source?.url || source?.title || `Source ${source?.number || ""}`);

  try {
    const url = new URL(value);
    return url.hostname;
  } catch {
    return value
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .slice(0, 80);
  }
}

function fittedScale(font, value, size, targetWidth) {
  try {
    const raw = font.widthOfTextAtSize(value, size);

    if (!raw || !Number.isFinite(raw) || !targetWidth || !Number.isFinite(targetWidth)) {
      return 1;
    }

    return Math.max(0.65, Math.min(1.35, targetWidth / raw));
  } catch {
    return 1;
  }
}

function drawFittedText(page, value, x, y, size, font, targetWidth, color = C.ink) {
  const clean = s(value);
  const sx = fittedScale(font, clean, size, targetWidth);

  if (Math.abs(sx - 1) < 0.0005) {
    page.drawText(clean, {
      x,
      y,
      size,
      font,
      color: hex(color)
    });

    return sx;
  }

  page.pushOperators(
    pushGraphicsState(),
    translate(x, 0),
    scale(sx, 1),
    translate(-x, 0)
  );

  page.drawText(clean, {
    x,
    y,
    size,
    font,
    color: hex(color)
  });

  page.pushOperators(popGraphicsState());

  return sx;
}

function sourceColour(number) {
  return SOURCE_COLORS[
    (Math.max(1, Number(number || 1)) - 1) %
    SOURCE_COLORS.length
  ];
}

function groupForKey(key) {
  return GROUPS.find((g) => g.key === key) || GROUPS[0];
}

function drawMatchTypeBadge(page, icons, groupKey, x, y) {
  const group = groupForKey(groupKey);

  page.drawEllipse({
    x,
    y,
    xScale: 7.755,
    yScale: 7.755,
    color: hex(group.fill)
  });

  const key = groupIconKey(groupKey);

  const dims =
    groupKey === "MISSING_QUOTATIONS"
      ? [6.1, 3.9]
      : groupKey === "MISSING_CITATION"
        ? [6.1, 4.0]
        : [6.1, 6.1];

  page.drawImage(icons[key], {
    x: x - dims[0] / 2,
    y: y - dims[1] / 2,
    width: dims[0],
    height: dims[1]
  });
}

function drawSourceNumberBadge(page, f, number, x, y) {
  const width = 17.72;
  const height = 15.51;
  const top = PAGE_H - y - height / 2;

  drawRoundedPill(
    page,
    x - width / 2,
    top,
    width,
    height,
    sourceColour(number)
  );

  const label = String(number);
  const size = label.length >= 2 ? 6.6 : 7.754;

  page.drawText(label, {
    x: x - f.notoSemi.widthOfTextAtSize(label, size) / 2,
    y: y - size * 0.34,
    size,
    font: f.notoSemi,
    color: hex(C.white)
  });
}

function elementFont(cache, e) {
  return (
    cache[`${e.family}|${e.weight}`] ||
    cache[`${e.family}|400`] ||
    cache.__fallback
  );
}

function localTextIndex(element, absoluteIndex) {
  const span = Math.max(
    1,
    (element.end ?? 0) - (element.start ?? 0)
  );

  const ratio = Math.max(
    0,
    Math.min(
      1,
      (absoluteIndex - element.start) / span
    )
  );

  return Math.round(element.text.length * ratio);
}

async function drawOriginalPages(
  doc,
  f,
  icons,
  bundle,
  originalPages,
  originalFontCache,
  ranges,
  kind,
  startPageNo,
  totalPages
) {
  const id = bundle.reportIdentity || {};
  let pageNo = startPageNo;

  for (const original of originalPages) {
    const page = doc.addPage([PAGE_W, PAGE_H]);

    let sourceScale = 1;
    let sourceX = 0;
    let sourceY = 0;

    if (original.embeddedPage) {
      const sourceWidth =
        Number(
          original.width ||
          original.embeddedPage.width ||
          PAGE_W
        );

      const sourceHeight =
        Number(
          original.height ||
          original.embeddedPage.height ||
          PAGE_H
        );

      sourceScale =
        Math.min(
          PAGE_W / sourceWidth,
          PAGE_H / sourceHeight
        );

      sourceX =
        (PAGE_W -
          sourceWidth *
            sourceScale) /
        2;

      sourceY =
        (PAGE_H -
          sourceHeight *
            sourceScale) /
        2;

      page.drawPage(
        original.embeddedPage,
        {
          x: sourceX,
          y: sourceY,
          width:
            sourceWidth *
            sourceScale,
          height:
            sourceHeight *
            sourceScale
        }
      );
    }

    if (original.bg) {
      try {
        const bytes = Buffer.from(original.bg.data, "base64");

        const image =
          original.bg.type === "jpeg"
            ? await doc.embedJpg(bytes)
            : await doc.embedPng(bytes);

        page.drawImage(image, {
          x: 0,
          y: 0,
          width: PAGE_W,
          height: PAGE_H
        });
      } catch {}
    }

    const markerPlaced = new Set();

    for (const element of original.elements) {
      const x =
        sourceX +
        Number(
          element.style.left ||
          0
        ) *
        sourceScale;

      const y =
        sourceY +
        Number(
          element.style.bottom ||
          0
        ) *
        sourceScale;

      const targetWidth =
        Number(
          element.style.width ||
          0
        ) *
        sourceScale;

      const height =
        Number(
          element.style.height ||
          element.size ||
          11
        ) *
        sourceScale;

      const size =
        Number(
          element.size ||
          11
        ) *
        sourceScale;
      const font = elementFont(originalFontCache, element);

      const relevant =
        Number.isFinite(element.start) &&
        Number.isFinite(element.end)
          ? ranges.filter((range) =>
              overlaps(
                element.start,
                element.end,
                range.start,
                range.end
              )
            )
          : [];

      const sx = fittedScale(
        font,
        s(element.text),
        size,
        targetWidth
      );

      for (const range of relevant) {
        const a = Math.max(element.start, range.start);
        const b = Math.min(element.end, range.end);

        const i0 = localTextIndex(element, a);
        const i1 = localTextIndex(element, b);

        let dx0 = 0;
        let dx1 = targetWidth;

        try {
          dx0 =
            font.widthOfTextAtSize(
              s(element.text).slice(0, i0),
              size
            ) * sx;

          dx1 =
            font.widthOfTextAtSize(
              s(element.text).slice(0, i1),
              size
            ) * sx;
        } catch {
          const span = Math.max(
            1,
            element.end - element.start
          );

          dx0 =
            targetWidth *
            (a - element.start) /
            span;

          dx1 =
            targetWidth *
            (b - element.start) /
            span;
        }

        page.drawRectangle({
          x: x + dx0,
          y: y - 1.1,
          width: Math.max(1, dx1 - dx0),
          height: Math.max(7, height + 1.9),
          color: hex(
            kind === "AI"
              ? C.ai
              : groupForKey(range.group).fill
          ),
          opacity: kind === "AI" ? 0.40 : 0.76
        });

        if (kind === "SIMILARITY") {
          const key =
            `${range.start}:${range.end}:${range.sourceNumber}:${range.group}`;

          if (
            !markerPlaced.has(key) &&
            range.start >= element.start &&
            range.start < element.end
          ) {
            markerPlaced.add(key);

            const markerY =
              y +
              Math.max(
                4.8,
                Math.min(
                  8,
                  height * 0.55
                )
              );

            drawMatchTypeBadge(
              page,
              icons,
              range.group,
              15.235,
              markerY
            );

            drawSourceNumberBadge(
              page,
              f,
              range.sourceNumber,
              32.96,
              markerY
            );
          }
        }
      }

      if (
        original.preserveSourcePage
      ) {
        continue;
      }

      try {
        drawFittedText(
          page,
          element.text,
          x,
          y,
          size,
          font,
          targetWidth,
          C.ink
        );
      } catch {
        drawFittedText(
          page,
          safeText(element.text),
          x,
          y,
          size,
          f.noto,
          targetWidth,
          C.ink
        );
      }
    }

    shell(
      page,
      f,
      id,
      pageNo,
      totalPages,
      kind === "AI"
        ? "AI Writing Submission"
        : "Integrity Submission"
    );

    pageNo += 1;
  }

  return pageNo;
}

async function renderSimilarity(bundle, outputPath) {
  const fullText =
    s(
      bundle
        ?.crawled
        ?.text
        ?.value
    );

  const doc = await PDFDocument.create();

  doc.setTitle("turnitin Similarity Report");
  doc.setSubject("turnitin Similarity Report");

  const f = await loadBrandFonts(doc);
  const icons = await loadReportIcons(doc);

  const html =
    s(
      bundle
        ?.crawled
        ?.html
        ?.value
    );

  const text =
    s(
      bundle
        ?.crawled
        ?.text
        ?.value
    );

  let preservedOriginal = null;

  try {
    preservedOriginal =
      await prepareOriginalLayout(
        bundle
      );
  } catch (err) {
    console.warn(
      "Preserved original layout unavailable; using Copyleaks HTML fallback:",
      err?.message || err
    );
  }

  const originalPages =
    preservedOriginal?.pages?.length
      ? preservedOriginal.pages
      : parseOriginalPages(html);

  const parsedTextElements =
    originalPages.reduce(
      (n, p) =>
        n +
        p.elements.length,
      0
    );

  if (
    !originalPages.length ||
    !parsedTextElements
  ) {
    throw new Error(
      `Document parsing produced no content (pages=${originalPages.length}, elements=${parsedTextElements}).`
    );
  }

  mapElementsToText(
    originalPages,
    text
  );

  bundle.__originalPageCount =
    originalPages.length;

  if (
    preservedOriginal?.pdfPath &&
    originalPages.length
  ) {
    const sourcePdfBytes =
      fs.readFileSync(
        preservedOriginal.pdfPath
      );

    const embeddedPages =
      await doc.embedPdf(
        sourcePdfBytes,
        originalPages.map(
          (_, index) =>
            index
        )
      );

    for (
      let index = 0;
      index < originalPages.length;
      index += 1
    ) {
      originalPages[index].embeddedPage =
        embeddedPages[index];
      originalPages[index].preserveSourcePage =
        true;
    }

    console.log(
      "Using preserved original document layout:",
      originalPages.length,
      "page(s)."
    );
  }

  const originalFonts =
    await embedOriginalFonts(
      doc,
      html,
      f
    );

  const sources =
    sourceList(bundle);

  const score =
    Number(
      bundle
        ?.completion
        ?.results
        ?.score
        ?.aggregatedScore ||
      0
    );

  const ranges =
    simRanges(
      bundle,
      sources,
      fullText
    );

  const sourceAudit =
    validateSimilaritySourceMapping(
      bundle,
      sources,
      ranges,
      fullText
    );

  const sourceAuditPath =
    path.join(
      path.dirname(outputPath),
      path.parse(outputPath).name +
        ".source-audit.json"
    );

  fs.writeFileSync(
    sourceAuditPath,
    JSON.stringify(
      sourceAudit,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    "Similarity source audit passed:",
    sourceAudit.sourceCount + " source(s),",
    sourceAudit.matchRangeCount + " mapped range(s),",
    "0 unresolved."
  );

  const groups =
    groupStats(
      ranges,
      score
    );

  const cats =
    sourceCategoryStats(
      sources,
      score
    );

  const sourcePages =
    sourcePageCount(
      sources.length
    );

  const totalPages =
    1 +
    1 +
    sourcePages +
    originalPages.length;

  drawCover(
    doc.addPage([PAGE_W, PAGE_H]),
    f,
    icons,
    bundle,
    1,
    totalPages
  );

  similarityOverviewPage(
    doc.addPage([PAGE_W, PAGE_H]),
    f,
    icons,
    bundle,
    groups,
    cats,
    2,
    totalPages
  );

  const next =
    sourceOverviewPages(
      doc,
      f,
      icons,
      bundle,
      groups,
      cats,
      sources,
      3,
      totalPages
    );

  await drawOriginalPages(
    doc,
    f,
    icons,
    bundle,
    originalPages,
    originalFonts,
    ranges,
    "SIMILARITY",
    next,
    totalPages
  );

  fs.writeFileSync(
    outputPath,
    await doc.save()
  );

  return {
    path: outputPath,
    score,
    sourceCount: sources.length
  };
}

async function renderAi(bundle, outputPath) {
  const ai = aiInfo(bundle);

  if (!ai.available) {
    return {
      path: null,
      ai
    };
  }

  const doc = await PDFDocument.create();

  doc.setTitle("turnitin AI Writing Report");
  doc.setSubject("turnitin AI Writing Report");

  const f = await loadBrandFonts(doc);
  const icons = await loadReportIcons(doc);

  const html =
    s(
      bundle
        ?.crawled
        ?.html
        ?.value
    );

  const text =
    s(
      bundle
        ?.crawled
        ?.text
        ?.value
    );

  let preservedOriginal = null;

  try {
    preservedOriginal =
      await prepareOriginalLayout(
        bundle
      );
  } catch (err) {
    console.warn(
      "Preserved original layout unavailable; using Copyleaks HTML fallback:",
      err?.message || err
    );
  }

  const originalPages =
    preservedOriginal?.pages?.length
      ? preservedOriginal.pages
      : parseOriginalPages(html);

  const parsedTextElements =
    originalPages.reduce(
      (n, p) =>
        n +
        p.elements.length,
      0
    );

  if (
    !originalPages.length ||
    !parsedTextElements
  ) {
    throw new Error(
      `Document parsing produced no content (pages=${originalPages.length}, elements=${parsedTextElements}).`
    );
  }

  mapElementsToText(
    originalPages,
    text
  );

  bundle.__originalPageCount =
    originalPages.length;

  if (
    preservedOriginal?.pdfPath &&
    originalPages.length
  ) {
    const sourcePdfBytes =
      fs.readFileSync(
        preservedOriginal.pdfPath
      );

    const embeddedPages =
      await doc.embedPdf(
        sourcePdfBytes,
        originalPages.map(
          (_, index) =>
            index
        )
      );

    for (
      let index = 0;
      index < originalPages.length;
      index += 1
    ) {
      originalPages[index].embeddedPage =
        embeddedPages[index];
      originalPages[index].preserveSourcePage =
        true;
    }

    console.log(
      "Using preserved original document layout:",
      originalPages.length,
      "page(s)."
    );
  }

  const originalFonts =
    await embedOriginalFonts(
      doc,
      html,
      f
    );

  const totalPages =
    2 +
    originalPages.length;

  drawCover(
    doc.addPage([PAGE_W, PAGE_H]),
    f,
    icons,
    bundle,
    1,
    totalPages
  );

  aiOverviewPage(
    doc.addPage([PAGE_W, PAGE_H]),
    f,
    icons,
    bundle,
    ai,
    2,
    totalPages
  );

  await drawOriginalPages(
    doc,
    f,
    icons,
    bundle,
    originalPages,
    originalFonts,
    ai.percent >= 20
      ? ai.ranges
      : [],
    "AI",
    3,
    totalPages
  );

  fs.writeFileSync(
    outputPath,
    await doc.save()
  );

  return {
    path: outputPath,
    ai
  };
}

async function renderJkReports({
  bundlePath = "bundle.json",
  outputDir
} = {}) {
  bundlePath =
    path.resolve(bundlePath);

  outputDir =
    path.resolve(
      outputDir ||
      path.dirname(bundlePath)
    );

  if (
    !fs.existsSync(bundlePath)
  ) {
    throw new Error(
      `Bundle not found: ${bundlePath}`
    );
  }

  fs.mkdirSync(
    outputDir,
    {
      recursive: true
    }
  );

  const bundle =
    JSON.parse(
      fs.readFileSync(
        bundlePath,
        "utf8"
      )
    );

  bundle.__bundlePath =
    bundlePath;

  const base =
    fileBase(
      bundle
        ?.reportIdentity
        ?.filename ||
      "report"
    );

  const simName =
    `${base}.pdf`;

  const aiName =
    `${base} (1).pdf`;

  const sim =
    await renderSimilarity(
      bundle,
      path.join(
        outputDir,
        simName
      )
    );

  let ai = {
    path: null,
    ai: {
      available: false,
      reason: "Similarity-only service",
      percent: null
    }
  };

  if (
    s(
      bundle
        ?.reportIdentity
        ?.serviceType ||
      "CHECK"
    )
      .toUpperCase() !==
    "SIMILARITY"
  ) {
    ai =
      await renderAi(
        bundle,
        path.join(
          outputDir,
          aiName
        )
      );
  }

  if (
    ai.path &&
    fs.existsSync(ai.path) &&
    fs.existsSync(sim.path)
  ) {
    const crypto =
      require("crypto");

    const digest = (p) =>
      crypto
        .createHash("sha256")
        .update(
          fs.readFileSync(p)
        )
        .digest("hex");

    if (
      digest(ai.path) ===
      digest(sim.path)
    ) {
      throw new Error(
        "Renderer safety check failed: AI and similarity PDFs are byte-for-byte identical."
      );
    }
  }

  return {
    bundlePath,
    outputDir,
    similarityPath: sim.path,
    similarityFileName: simName,
    aiPath: ai.path,
    aiFileName: ai.path ? aiName : null,
    similarityScore: sim.score,
    sourceCount: sim.sourceCount,
    aiAvailable: Boolean(ai?.ai?.available),
    aiPercent: ai?.ai?.percent ?? null,
    aiUnavailableReason: ai?.ai?.reason || null
  };
}

module.exports = {
  renderJkReports,
  aiInfo,
  sourceList,
  simRanges
};

if (require.main === module) {
  const bundlePath =
    process.argv[2] ||
    path.join(
      process.cwd(),
      "bundle.json"
    );

  const outputDir =
    process.argv[3] ||
    path.join(
      process.cwd(),
      "jk-test-output-final"
    );

  renderJkReports({
    bundlePath,
    outputDir
  })
    .then((r) => {
      console.log(
        "turnitin reports generated successfully."
      );

      console.log(
        "Similarity:",
        r.similarityPath
      );

      console.log(
        "AI:",
        r.aiPath ||
        `Unavailable (${r.aiUnavailableReason || "N/A"})`
      );
    })
    .catch((err) => {
      console.error(
        "turnitin rendering failed:",
        err?.stack ||
        err
      );

      process.exit(1);
    });
}
