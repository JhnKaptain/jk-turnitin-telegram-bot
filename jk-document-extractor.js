"use strict";

/*
  JKW Canonical Document Extractor
  --------------------------------
  Copyleaks-independent document processing.

  Purpose:
  - accept PDF and supported Office documents
  - convert Office documents to PDF using the
    existing JKW LibreOffice conversion system
  - extract canonical text
  - preserve page boundaries
  - preserve character offsets
  - preserve PDF coordinates for every text item
  - give Quetext and Sapling exactly the text
    that our renderer can map back to the document
*/

const fs = require("fs");
const path = require("path");

const {
  convertOfficeToPdf
} = require(
  "./jk-original-layout.js"
);

/*
  --------------------------------------------------
  General helpers
  --------------------------------------------------
*/

function safeNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function countWords(text) {
  const clean =
    String(
      text ||
      ""
    ).trim();

  if (!clean) {
    return 0;
  }

  return clean
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function normalizeTextItem(
  value
) {
  return String(
    value ||
    ""
  ).replace(
    /\u00a0/g,
    " "
  );
}

/*
  --------------------------------------------------
  Canonical text spacing

  Avoid:
      wordword

  Also avoid:
      word ,
      ( word

  All generated offsets are then used consistently
  by Quetext, Sapling and the JKW renderer.
  --------------------------------------------------
*/

function needsSpace(
  previous,
  current
) {
  if (
    !previous ||
    !current
  ) {
    return false;
  }

  const left =
    String(previous);

  const right =
    String(current);

  if (
    !left ||
    !right
  ) {
    return false;
  }

  if (
    /\s$/.test(left) ||
    /^\s/.test(right)
  ) {
    return false;
  }

  /*
    No space before common punctuation.
  */
  if (
    /^[,.;:!?%)\]}]/.test(
      right
    )
  ) {
    return false;
  }

  /*
    No space immediately after
    opening punctuation.
  */
  if (
    /[(\[{]$/.test(
      left
    )
  ) {
    return false;
  }

  /*
    Apostrophes, contractions,
    possessives.
  */
  if (
    /^['’]/.test(
      right
    )
  ) {
    return false;
  }

  return true;
}

function sameApproximateLine(
  previous,
  current
) {
  if (
    !previous ||
    !current
  ) {
    return false;
  }

  const previousY =
    safeNumber(
      previous
        .transform?.[5]
    );

  const currentY =
    safeNumber(
      current
        .transform?.[5]
    );

  const previousHeight =
    Math.max(
      1,
      Math.abs(
        safeNumber(
          previous.height,
          1
        )
      )
    );

  const currentHeight =
    Math.max(
      1,
      Math.abs(
        safeNumber(
          current.height,
          1
        )
      )
    );

  const tolerance =
    Math.max(
      2,
      Math.min(
        previousHeight,
        currentHeight
      ) *
        0.45
    );

  return (
    Math.abs(
      previousY -
      currentY
    ) <=
    tolerance
  );
}

function makeSeparator(
  previousItem,
  currentItem,
  isFirstItemOnPage
) {
  if (
    isFirstItemOnPage
  ) {
    return "";
  }

  if (
    previousItem?.hasEOL
  ) {
    return "\n";
  }

  if (
    !sameApproximateLine(
      previousItem,
      currentItem
    )
  ) {
    return "\n";
  }

  if (
    needsSpace(
      previousItem?.str,
      currentItem?.str
    )
  ) {
    return " ";
  }

  return "";
}

/*
  --------------------------------------------------
  PDF.js
  --------------------------------------------------
*/

async function loadPdfJs() {
  return import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );
}

/*
  --------------------------------------------------
  Extract canonical text and coordinates
  from a PDF.
  --------------------------------------------------
*/

async function extractPdfDocument(
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
    await loadPdfJs();

  const data =
    new Uint8Array(
      fs.readFileSync(
        pdfPath
      )
    );

  const loadingTask =
    pdfjs.getDocument({
      data,

      disableWorker:
        true,

      useSystemFonts:
        true
    });

  let pdf = null;

  try {
    pdf =
      await loadingTask
        .promise;

    let canonicalText =
      "";

    const pages = [];

    for (
      let pageNumber = 1;
      pageNumber <=
        pdf.numPages;
      pageNumber += 1
    ) {
      const page =
        await pdf.getPage(
          pageNumber
        );

      const viewport =
        page.getViewport({
          scale: 1
        });

      const textContent =
        await page
          .getTextContent({
            includeMarkedContent:
              false
          });

      /*
        Separate pages in canonical text.
      */
      if (
        pageNumber > 1
      ) {
        canonicalText +=
          "\n\n";
      }

      const pageStart =
        canonicalText.length;

      const items = [];

      let previousItem =
        null;

      for (
        const rawItem of
          textContent.items
      ) {
        if (
          !rawItem ||
          typeof rawItem.str !==
            "string"
        ) {
          continue;
        }

        const itemText =
          normalizeTextItem(
            rawItem.str
          );

        if (
          !itemText
        ) {
          previousItem =
            rawItem;

          continue;
        }

        const separator =
          makeSeparator(
            previousItem,
            rawItem,
            items.length === 0
          );

        if (
          separator
        ) {
          canonicalText +=
            separator;
        }

        const start =
          canonicalText.length;

        canonicalText +=
          itemText;

        const end =
          canonicalText.length;

        const transform =
          Array.isArray(
            rawItem.transform
          )
            ? rawItem
                .transform
                .map(
                  (value) =>
                    safeNumber(
                      value
                    )
                )
            : [
                1,
                0,
                0,
                1,
                0,
                0
              ];

        const x =
          safeNumber(
            transform[4]
          );

        const y =
          safeNumber(
            transform[5]
          );

        const width =
          Math.max(
            0,
            safeNumber(
              rawItem.width
            )
          );

        const height =
          Math.max(
            0,
            Math.abs(
              safeNumber(
                rawItem.height
              )
            )
          );

        items.push({
          text:
            itemText,

          start,

          end,

          pageNumber,

          x,

          y,

          width,

          height,

          transform,

          fontName:
            rawItem.fontName
              ? String(
                  rawItem
                    .fontName
                )
              : null,

          direction:
            rawItem.dir
              ? String(
                  rawItem.dir
                )
              : null,

          hasEOL:
            Boolean(
              rawItem.hasEOL
            )
        });

        previousItem =
          rawItem;
      }

      const pageEnd =
        canonicalText.length;

      pages.push({
        pageNumber,

        start:
          pageStart,

        end:
          pageEnd,

        width:
          viewport.width,

        height:
          viewport.height,

        rotation:
          viewport.rotation,

        itemCount:
          items.length,

        items
      });

      try {
        page.cleanup();
      } catch {}
    }

    /*
      Internal audit:
      every stored item must point to exactly
      the same text in canonicalText.
    */
    let auditedItems = 0;

    for (
      const page of
        pages
    ) {
      for (
        const item of
          page.items
      ) {
        const actual =
          canonicalText.slice(
            item.start,
            item.end
          );

        if (
          actual !==
          item.text
        ) {
          throw new Error(
            "Canonical offset audit failed on page " +
            page.pageNumber +
            " at " +
            item.start +
            "-" +
            item.end
          );
        }

        auditedItems +=
          1;
      }
    }

    return {
      provider:
        "jkw-local",

      version:
        1,

      sourceType:
        "PDF",

      sourcePath:
        pdfPath,

      pdfPath:
        pdfPath,

      generatedAt:
        new Date()
          .toISOString(),

      text:
        canonicalText,

      wordCount:
        countWords(
          canonicalText
        ),

      characterCount:
        canonicalText.length,

      pageCount:
        pages.length,

      auditedItems,

      pages
    };
  } finally {
    /*
      PDF.js 6 cleanup belongs to
      PDFDocumentLoadingTask.
    */
    try {
      await loadingTask.destroy();
    } catch {}
  }
}

/*
  --------------------------------------------------
  Universal JKW document extraction

  PDF:
      extract directly

  DOC / DOCX / ODT / RTF:
      convert to PDF using the existing
      jk-original-layout.js LibreOffice system,
      then use exactly the same PDF extractor.

  This guarantees that Quetext, Sapling and
  the visible report use one coordinate system.
  --------------------------------------------------
*/

async function extractDocument(
  filePath
) {
  const originalPath =
    path.resolve(
      String(
        filePath ||
        ""
      )
    );

  if (
    !fs.existsSync(
      originalPath
    )
  ) {
    throw new Error(
      "Document not found: " +
      originalPath
    );
  }

  const ext =
    path.extname(
      originalPath
    )
      .toLowerCase();

  /*
    PDF does not need conversion.
  */
  if (
    ext === ".pdf"
  ) {
    const result =
      await extractPdfDocument(
        originalPath
      );

    return {
      ...result,

      sourceType:
        "PDF",

      sourcePath:
        originalPath,

      pdfPath:
        originalPath
    };
  }

  /*
    Office documents use the same
    LibreOffice conversion path already
    used by the renderer.
  */
  if (
    [
      ".doc",
      ".docx",
      ".odt",
      ".rtf",
      ".pptx"
    ].includes(
      ext
    )
  ) {
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
      throw new Error(
        "Office document could not be converted to PDF."
      );
    }

    const result =
      await extractPdfDocument(
        pdfPath
      );

    if (ext === ".pptx") {
      // Verify slide order and selectable slide text against source XML.
      const {auditPptxPdf} = require("./jk-pptx-fidelity.cjs");
      auditPptxPdf(originalPath, result);
    }

    return {
      ...result,

      sourceType:
        ext
          .slice(1)
          .toUpperCase(),

      sourcePath:
        originalPath,

      pdfPath:
        path.resolve(
          pdfPath
        )
    };
  }

  throw new Error(
    "Unsupported document type: " +
    (
      ext ||
      "(no extension)"
    )
  );
}

/*
  --------------------------------------------------
  Exports
  --------------------------------------------------
*/

module.exports = {
  extractDocument,
  extractPdfDocument,
  countWords
};

/*
  --------------------------------------------------
  Command-line test

  Examples:

    node jk-document-extractor.js input.pdf

    node jk-document-extractor.js input.docx

    node jk-document-extractor.js input.docx output.json
  --------------------------------------------------
*/

if (
  require.main ===
  module
) {
  (
    async () => {
      const input =
        process.argv[2];

      if (
        !input
      ) {
        console.error(
          "Usage: node jk-document-extractor.js <input.pdf|doc|docx|odt|rtf> [output.json]"
        );

        process.exitCode =
          1;

        return;
      }

      const inputPath =
        path.resolve(
          input
        );

      const outputPath =
        process.argv[3]
          ? path.resolve(
              process.argv[3]
            )
          : path.join(
              path.dirname(
                inputPath
              ),
              path.parse(
                inputPath
              ).name +
                ".jkw-document.json"
            );

      try {
        const result =
          await extractDocument(
            inputPath
          );

        fs.writeFileSync(
          outputPath,
          JSON.stringify(
            result,
            null,
            2
          ),
          "utf8"
        );

        console.log(
          "\nJKW DOCUMENT EXTRACTION: OK"
        );

        console.log(
          "Source type:",
          result.sourceType
        );

        console.log(
          "Source:",
          result.sourcePath
        );

        console.log(
          "PDF:",
          result.pdfPath
        );

        console.log(
          "Pages:",
          result.pageCount
        );

        console.log(
          "Words:",
          result.wordCount
        );

        console.log(
          "Characters:",
          result.characterCount
        );

        console.log(
          "Mapped text items:",
          result.auditedItems
        );

        console.log(
          "Output:",
          outputPath
        );

        console.log(
          "\nFirst 300 characters:"
        );

        console.log(
          result.text.slice(
            0,
            300
          )
        );
      } catch (err) {
        console.error(
          "\nJKW DOCUMENT EXTRACTION FAILED:"
        );

        console.error(
          err?.message ||
          err
        );

        process.exitCode =
          1;
      }
    }
  )();
}