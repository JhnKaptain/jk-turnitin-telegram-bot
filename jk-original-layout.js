"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

let pdfJsPromise = null;

function safeString(value) {
  return String(value == null ? "" : value);
}

function resolveOriginalPath(bundle) {
  const direct = safeString(bundle?.reportIdentity?.originalFilePath).trim();
  if (direct && fs.existsSync(direct)) return direct;

  const bundlePath = safeString(bundle?.__bundlePath).trim();
  const dir = bundlePath ? path.dirname(bundlePath) : "";
  if (!dir || !fs.existsSync(dir)) return null;

  const matches = fs.readdirSync(dir)
    .filter((name) => /^original\.[A-Za-z0-9]+$/i.test(name))
    .map((name) => path.join(dir, name));

  return matches.find((p) => fs.existsSync(p)) || null;
}

function convertOfficeToPdf(originalPath) {
  const ext = path.extname(originalPath).toLowerCase();
  if (ext === ".pdf") return originalPath;

  if (![".doc", ".docx", ".odt", ".rtf"].includes(ext)) {
    return null;
  }

  const dir = path.dirname(originalPath);
  const pdfPath = path.join(
    dir,
    path.basename(originalPath, ext) + ".pdf"
  );

  if (fs.existsSync(pdfPath)) return pdfPath;

  const profile =
    "/tmp/jk-lo-" +
    process.pid +
    "-" +
    Date.now() +
    "-" +
    Math.random().toString(36).slice(2);

  const result = spawnSync(
    "soffice",
    [
      "--headless",
      "--nologo",
      "--nodefault",
      "--nolockcheck",
      "--nofirststartwizard",
      "-env:UserInstallation=file://" + profile,
      "--convert-to",
      "pdf:writer_pdf_Export",
      "--outdir",
      dir,
      originalPath
    ],
    {
      encoding: "utf8",
      timeout: 120000
    }
  );

  if (result.error || result.status !== 0 || !fs.existsSync(pdfPath)) {
    const reason =
      result.error?.message ||
      result.stderr ||
      result.stdout ||
      "LibreOffice conversion failed.";

    throw new Error(
      "Could not convert original document to PDF: " +
      safeString(reason).trim()
    );
  }

  return pdfPath;
}

async function pdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfJsPromise;
}

async function extractPdfPages(pdfPath) {
  const pdfjs = await pdfJs();
  const bytes = fs.readFileSync(pdfPath);

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    useSystemFonts: true
  });

  const pdf = await loadingTask.promise;
  const pages = [];
  let elementCount = 0;

  try {
    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      const pdfPage = await pdf.getPage(pageIndex);
      const viewport = pdfPage.getViewport({ scale: 1 });
      const textContent = await pdfPage.getTextContent({
        disableNormalization: false
      });

      const elements = [];
      let order = 0;

      for (const item of textContent.items || []) {
        if (!item || typeof item.str !== "string" || !item.str.trim()) continue;
        if (!Array.isArray(item.transform) || item.transform.length < 6) continue;

        const size = Math.max(
          1,
          Math.abs(Number(item.height || item.transform[3] || 10))
        );

        const width = Math.max(
          0.1,
          Math.abs(Number(item.width || 0.1))
        );

        elements.push({
          order: order++,
          type: "pdf-original",
          text: item.str,
          style: {
            left: Number(item.transform[4] || 0),
            bottom: Number(item.transform[5] || 0),
            width,
            height: size
          },
          fontClass: "f0",
          family: null,
          size,
          weight: 400
        });
      }

      elementCount += elements.length;

      pages.push({
        width: Number(viewport.width || 612),
        height: Number(viewport.height || 792),
        bg: null,
        elements,
        preserveSourcePage: true,
        sourcePdfPageIndex: pageIndex - 1
      });
    }
  } finally {
    try {
      await pdf.destroy();
    } catch {}
  }

  if (!pages.length || !elementCount) return null;

  return {
    pdfPath,
    pages,
    pageCount: pages.length,
    elementCount
  };
}

async function prepareOriginalLayout(bundle) {
  const originalPath = resolveOriginalPath(bundle);
  if (!originalPath) return null;

  const pdfPath = convertOfficeToPdf(originalPath);
  if (!pdfPath || !fs.existsSync(pdfPath)) return null;

  return extractPdfPages(pdfPath);
}

module.exports = {
  prepareOriginalLayout
};
