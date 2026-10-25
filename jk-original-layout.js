"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { pathToFileURL } = require("url");
const { spawnSync } = require("child_process");

let pdfJsPromise = null;

/*
  --------------------------------------------------
  General helpers
  --------------------------------------------------
*/

function safeString(value) {
  return String(
    value == null
      ? ""
      : value
  );
}

/*
  --------------------------------------------------
  Find the original uploaded document
  --------------------------------------------------
*/

function resolveOriginalPath(bundle) {
  const direct =
    safeString(
      bundle
        ?.reportIdentity
        ?.originalFilePath
    ).trim();

  if (
    direct &&
    fs.existsSync(
      direct
    )
  ) {
    return direct;
  }

  const bundlePath =
    safeString(
      bundle?.__bundlePath
    ).trim();

  const dir =
    bundlePath
      ? path.dirname(
          bundlePath
        )
      : "";

  if (
    !dir ||
    !fs.existsSync(
      dir
    )
  ) {
    return null;
  }

  const matches =
    fs
      .readdirSync(
        dir
      )
      .filter(
        (name) =>
          /^original\.[A-Za-z0-9]+$/i.test(
            name
          )
      )
      .map(
        (name) =>
          path.join(
            dir,
            name
          )
      );

  return (
    matches.find(
      (filePath) =>
        fs.existsSync(
          filePath
        )
    ) ||
    null
  );
}

/*
  --------------------------------------------------
  Convert supported Office documents to PDF.

  PDF files are returned directly.

  DOC / DOCX / ODT / RTF use LibreOffice.
  --------------------------------------------------
*/

// JK_SOFFICE_RESOLVER_V1
//
// Resolve LibreOffice without requiring somebody
// to manually modify PATH after a restart.
//
// Priority:
// 1. explicit SOFFICE_PATH
// 2. standard Windows installations
// 3. "soffice" from PATH (Linux/Render/etc.)
function resolveSofficeExecutable() {
  const configured =
    safeString(
      process.env.SOFFICE_PATH
    ).trim();

  if (configured) {
    if (
      fs.existsSync(
        configured
      )
    ) {
      return configured;
    }

    throw new Error(
      "SOFFICE_PATH does not exist: " +
      configured
    );
  }

  if (
    process.platform ===
    "win32"
  ) {
    const programFiles =
      safeString(
        process.env.ProgramFiles
      ).trim() ||
      "C:\\Program Files";

    const programFilesX86 =
      safeString(
        process.env["ProgramFiles(x86)"]
      ).trim() ||
      "C:\\Program Files (x86)";

    const candidates = [
      path.join(
        programFiles,
        "LibreOffice",
        "program",
        "soffice.exe"
      ),

      path.join(
        programFilesX86,
        "LibreOffice",
        "program",
        "soffice.exe"
      )
    ];

    for (
      const candidate of
      candidates
    ) {
      if (
        fs.existsSync(
          candidate
        )
      ) {
        return candidate;
      }
    }
  }

  return "soffice";
}

function convertOfficeToPdf(
  originalPath
) {
  originalPath =
    path.resolve(
      String(
        originalPath ||
        ""
      )
    );

  if (
    !fs.existsSync(
      originalPath
    )
  ) {
    throw new Error(
      "Original document does not exist: " +
      originalPath
    );
  }

  const ext =
    path
      .extname(
        originalPath
      )
      .toLowerCase();

  if (
    ext === ".pdf"
  ) {
    return originalPath;
  }

  if (
    ![
      ".doc",
      ".docx",
      ".odt",
      ".rtf",
      ".pptx"
    ].includes(
      ext
    )
  ) {
    return null;
  }

  const dir =
    path.dirname(
      originalPath
    );

  const pdfPath =
    path.join(
      dir,
      path.basename(
        originalPath,
        ext
      ) + ".pdf"
    );

  /*
    Reuse an existing converted PDF.

    In production each report is stored in
    its own working directory, so this also
    prevents unnecessary repeated conversion.
  */
  if (
    fs.existsSync(
      pdfPath
    )
  ) {
    return pdfPath;
  }

  /*
    Use a unique LibreOffice user profile.

    os.tmpdir() makes this work on:
    - Render/Linux
    - Windows development machines
  */
  const profile =
    path.join(
      os.tmpdir(),
      "jk-lo-" +
        process.pid +
        "-" +
        Date.now() +
        "-" +
        Math.random()
          .toString(36)
          .slice(2)
    );

  const profileUrl =
    pathToFileURL(
      profile
    ).href;

  // WPS compatibility is isolated to a temporary copy of eligible DOCX files.
  // Unaffected files and all other file formats retain their original paths.
  let compatibilityDir = null;
  let inputPath = originalPath;
  if (ext === ".docx" && process.env.JK_OFFICE_BLANK_COMPAT !== "0") {
    try {
      compatibilityDir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-office-layout-"));
      const compatibilityPath = path.join(compatibilityDir, path.basename(originalPath));
      const compatibility = spawnSync("python3", [
        path.join(__dirname, "jk-office-empty-paragraph-compat.py"),
        originalPath, compatibilityPath
      ], { encoding: "utf8", timeout: 20000 });
      if (compatibility.status === 0) {
        if (fs.existsSync(compatibilityPath)) inputPath = compatibilityPath;
      } else {
        console.warn("Office paragraph compatibility skipped; using original source.",
          compatibility.stderr || compatibility.error?.message || "");
      }
    } catch (error) {
      console.warn("Office compatibility skipped:", error.message);
    }
  }
  let fontAliases = null;
  let result;
  try {
    fontAliases = require("./jk-office-font-alias.cjs").beginOfficeFontAliases();
    result = spawnSync(
      resolveSofficeExecutable(),
      [
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--nofirststartwizard",

        "-env:UserInstallation=" +
          profileUrl,

        "--convert-to",
        ext === ".pptx" ? "pdf:impress_pdf_Export" : "pdf:writer_pdf_Export",

        "--outdir",
        dir,

        inputPath
      ],
      {
        encoding:
          "utf8",

        timeout:
          120000,
        env: fontAliases?.env || process.env
      }
    );
  } finally {
    try { fontAliases?.cleanup(); } finally {
      if (compatibilityDir) fs.rmSync(compatibilityDir, { recursive: true, force: true });
    }
  }

  if (
    result.error ||
    result.status !== 0 ||
    !fs.existsSync(
      pdfPath
    )
  ) {
    const reason =
      result.error?.message ||
      result.stderr ||
      result.stdout ||
      "LibreOffice conversion failed.";

    throw new Error(
      "Could not convert original document to PDF: " +
      safeString(
        reason
      ).trim()
    );
  }

  return pdfPath;
}

/*
  --------------------------------------------------
  Load PDF.js once
  --------------------------------------------------
*/

async function pdfJs() {
  if (
    !pdfJsPromise
  ) {
    pdfJsPromise =
      import(
        "pdfjs-dist/legacy/build/pdf.mjs"
      );
  }

  return pdfJsPromise;
}

/*
  --------------------------------------------------
  Extract page layout from PDF.

  These coordinates are used by the renderer
  to preserve the original visible document.
  --------------------------------------------------
*/

async function extractPdfPages(
  pdfPath
) {
  pdfPath =
    path.resolve(
      String(
        pdfPath ||
        ""
      )
    );

  if (
    !fs.existsSync(
      pdfPath
    )
  ) {
    throw new Error(
      "PDF not found: " +
      pdfPath
    );
  }

  const pdfjs =
    await pdfJs();

  const bytes =
    fs.readFileSync(
      pdfPath
    );

  const loadingTask =
    pdfjs.getDocument({
      data:
        new Uint8Array(
          bytes
        ),

      disableWorker:
        true,

      useSystemFonts:
        true
    });

  const pdf =
    await loadingTask
      .promise;

  const pages = [];

  let elementCount =
    0;

  try {
    for (
      let pageIndex = 1;
      pageIndex <=
        pdf.numPages;
      pageIndex += 1
    ) {
      const pdfPage =
        await pdf.getPage(
          pageIndex
        );

      const viewport =
        pdfPage.getViewport({
          scale: 1
        });

      const textContent =
        await pdfPage
          .getTextContent({
            disableNormalization:
              false
          });

      const elements =
        [];

      let order = 0;

      for (
        const item of
          textContent.items ||
          []
      ) {
        if (
          !item ||
          typeof item.str !==
            "string" ||
          !item.str.trim()
        ) {
          continue;
        }

        if (
          !Array.isArray(
            item.transform
          ) ||
          item.transform.length <
            6
        ) {
          continue;
        }

        const size =
          Math.max(
            1,
            Math.abs(
              Number(
                item.height ||
                  item
                    .transform[3] ||
                  10
              )
            )
          );

        const width =
          Math.max(
            0.1,
            Math.abs(
              Number(
                item.width ||
                  0.1
              )
            )
          );

        elements.push({
          order:
            order++,

          type:
            "pdf-original",

          text:
            item.str,

          style: {
            left:
              Number(
                item
                  .transform[4] ||
                  0
              ),

            bottom:
              Number(
                item
                  .transform[5] ||
                  0
              ),

            width,

            height:
              size
          },

          fontClass:
            "f0",

          family:
            null,

          size,

          weight:
            400
        });
      }

      elementCount +=
        elements.length;

      pages.push({
        width:
          Number(
            viewport.width ||
              612
          ),

        height:
          Number(
            viewport.height ||
              792
          ),

        bg:
          null,

        elements,

        preserveSourcePage:
          true,

        sourcePdfPageIndex:
          pageIndex - 1
      });

      try {
        pdfPage.cleanup();
      } catch {}
    }
  } finally {
    /*
      PDF.js 6 cleanup belongs to the
      PDFDocumentLoadingTask.
    */
    try {
      await loadingTask.destroy();
    } catch {}
  }

  if (
    !pages.length ||
    !elementCount
  ) {
    return null;
  }

  return {
    pdfPath,

    pages,

    pageCount:
      pages.length,

    elementCount
  };
}

/*
  --------------------------------------------------
  Prepare the visible original-document layout.

  Original Office file
        ↓
  PDF conversion
        ↓
  PDF page extraction
        ↓
  renderer
  --------------------------------------------------
*/

async function prepareOriginalLayout(
  bundle
) {
  const originalPath =
    resolveOriginalPath(
      bundle
    );

  if (
    !originalPath
  ) {
    return null;
  }

  const pdfPath =
    convertOfficeToPdf(
      originalPath
    );

  if (
    !pdfPath ||
    !fs.existsSync(
      pdfPath
    )
  ) {
    return null;
  }

  return extractPdfPages(
    pdfPath
  );
}

/*
  --------------------------------------------------
  Exports

  convertOfficeToPdf is now exported so that
  jk-document-extractor.js can use exactly the
  same DOCX → PDF conversion pathway.
  --------------------------------------------------
*/

module.exports = {
  prepareOriginalLayout,
  convertOfficeToPdf,
  extractPdfPages
};