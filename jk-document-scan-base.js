"use strict";

/*
  JKW Document Scan Base
  ----------------------

  Removes document-layout artifacts BEFORE
  provider filtering while preserving an exact
  map back to canonical JKW character offsets.

  Currently removes:
  - standalone page numbers located in the
    top or bottom page margin

  It deliberately DOES NOT remove:
  - numbered lists inside the document body
  - inline numbers
  - citations
  - headings
  - body text

  Canonical source text itself is never changed.
*/

function safeText(value) {
  return String(
    value == null
      ? ""
      : value
  );
}

function safeNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function countWords(text) {
  const value =
    safeText(
      text
    ).trim();

  if (!value) {
    return 0;
  }

  return value
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

/*
  Arabic page numbers:
      1
      2
      12

  Roman page numbers:
      i
      ii
      iv
      x
*/
function isPageNumberText(
  value
) {
  const text =
    safeText(
      value
    ).trim();

  if (!text) {
    return false;
  }

  if (
    /^\d{1,4}$/.test(
      text
    )
  ) {
    return true;
  }

  if (
    /^[ivxlcdm]{1,8}$/i.test(
      text
    )
  ) {
    return true;
  }

  return false;
}

/*
  We only remove page-number-looking text
  if PDF coordinates place it inside a
  normal header/footer margin.

  This protects legitimate numbered content
  appearing inside the main document body.
*/
function isMarginItem(
  page,
  item
) {
  const pageHeight =
    safeNumber(
      page?.height
    );

  const y =
    safeNumber(
      item?.y
    ) ??
    safeNumber(
      item
        ?.transform
        ?.[5]
    );

  if (
    pageHeight === null ||
    y === null
  ) {
    return false;
  }

  /*
    Between roughly 54 and 84 PDF points,
    scaled slightly to the page height.
  */
  const margin =
    Math.max(
      54,
      Math.min(
        84,
        pageHeight *
          0.09
      )
    );

  const nearBottom =
    y <= margin;

  const nearTop =
    y >=
    pageHeight -
      margin;

  return (
    nearBottom ||
    nearTop
  );
}

/*
  --------------------------------------------------
  Detect removable document artifacts
  --------------------------------------------------
*/

function findDocumentArtifacts(
  document
) {
  const source =
    safeText(
      document?.text
    );

  const pages =
    Array.isArray(
      document?.pages
    )
      ? document.pages
      : [];

  const ranges = [];

  for (
    const page of pages
  ) {
    const items =
      Array.isArray(
        page?.items
      )
        ? page.items
        : [];

    for (
      const item of items
    ) {
      if (
        !isPageNumberText(
          item?.text
        )
      ) {
        continue;
      }

      if (
        !isMarginItem(
          page,
          item
        )
      ) {
        continue;
      }

      const start =
        safeNumber(
          item?.start
        );

      const end =
        safeNumber(
          item?.end
        );

      if (
        start === null ||
        end === null ||
        end <= start ||
        start < 0 ||
        end >
          source.length
      ) {
        continue;
      }

      const actual =
        source.slice(
          start,
          end
        );

      /*
        Final safety audit:
        stored coordinates must still point
        to the exact item text.
      */
      if (
        actual !==
        item.text
      ) {
        continue;
      }

      ranges.push({
        start,

        end,

        pageNumber:
          page.pageNumber,

        text:
          item.text,

        type:
          "PAGE_NUMBER",

        x:
          item.x ?? null,

        y:
          item.y ?? null
      });
    }
  }

  ranges.sort(
    (a, b) =>
      a.start -
        b.start ||
      a.end -
        b.end
  );

  return ranges;
}

/*
  --------------------------------------------------
  Build provider-neutral clean base

  map[index] =
      canonical-document UTF-16 position

  Provider text can therefore be cleaned
  without losing original report coordinates.
  --------------------------------------------------
*/

function buildDocumentScanBase(
  document
) {
  const source =
    safeText(
      document?.text
    );

  if (!source) {
    throw new Error(
      "Canonical document text is empty."
    );
  }

  const removedArtifacts =
    findDocumentArtifacts(
      document
    );

  let text = "";

  const map = [];

  let rangeIndex = 0;

  for (
    let sourceIndex = 0;
    sourceIndex <
      source.length;
    sourceIndex += 1
  ) {
    while (
      rangeIndex <
        removedArtifacts.length &&
      sourceIndex >=
        removedArtifacts[
          rangeIndex
        ].end
    ) {
      rangeIndex += 1;
    }

    const range =
      removedArtifacts[
        rangeIndex
      ];

    if (
      range &&
      sourceIndex >=
        range.start &&
      sourceIndex <
        range.end
    ) {
      /*
        Skip layout artifact.

        Surrounding newlines remain intact,
        which prevents adjacent body text from
        accidentally being joined together.
      */
      continue;
    }

    text +=
      source[
        sourceIndex
      ];

    map.push(
      sourceIndex
    );
  }

  return {
    text,

    map,

    originalLength:
      source.length,

    characterCount:
      text.length,

    wordCount:
      countWords(
        text
      ),

    removedArtifacts
  };
}

/*
  --------------------------------------------------
  Map a range in clean-base coordinates
  back to canonical coordinates.
  --------------------------------------------------
*/

function baseRangeToCanonical(
  base,
  start,
  end
) {
  const map =
    Array.isArray(
      base?.map
    )
      ? base.map
      : [];

  start =
    Math.max(
      0,
      Math.floor(
        Number(start) ||
        0
      )
    );

  end =
    Math.min(
      map.length,
      Math.ceil(
        Number(end) ||
        0
      )
    );

  let first =
    null;

  let last =
    null;

  for (
    let i = start;
    i < end;
    i += 1
  ) {
    const position =
      safeNumber(
        map[i]
      );

    if (
      position === null
    ) {
      continue;
    }

    if (
      first === null
    ) {
      first =
        position;
    }

    last =
      position;
  }

  if (
    first === null ||
    last === null
  ) {
    return null;
  }

  return {
    start:
      first,

    end:
      last + 1
  };
}

function baseBoundaryToCanonical(
  base,
  boundary
) {
  const map =
    Array.isArray(
      base?.map
    )
      ? base.map
      : [];

  let position =
    Math.max(
      0,
      Math.floor(
        Number(boundary) ||
        0
      )
    );

  /*
    Prefer the first real character
    at or after the boundary.
  */
  for (
    let i = position;
    i <
      map.length;
    i += 1
  ) {
    const canonical =
      safeNumber(
        map[i]
      );

    if (
      canonical !== null
    ) {
      return canonical;
    }
  }

  /*
    Otherwise use the previous real
    character boundary.
  */
  for (
    let i =
      Math.min(
        position - 1,
        map.length - 1
      );
    i >= 0;
    i -= 1
  ) {
    const canonical =
      safeNumber(
        map[i]
      );

    if (
      canonical !== null
    ) {
      return (
        canonical +
        1
      );
    }
  }

  return null;
}

/*
  --------------------------------------------------
  Compose jk-scan-text.js mapping with
  document-cleanup mapping.

  Before composition:

      provider input
          ↓
      clean scan base

  After composition:

      provider input
          ↓
      canonical document

  This is the map the renderer needs.
  --------------------------------------------------
*/

function composePreparedWithBase(
  prepared,
  base
) {
  const preparedMap =
    Array.isArray(
      prepared?.map
    )
      ? prepared.map
      : [];

  const baseMap =
    Array.isArray(
      base?.map
    )
      ? base.map
      : [];

  const map =
    preparedMap.map(
      (localIndex) => {
        const local =
          safeNumber(
            localIndex
          );

        if (
          local === null ||
          local < 0 ||
          local >=
            baseMap.length
        ) {
          return null;
        }

        const canonical =
          safeNumber(
            baseMap[
              local
            ]
          );

        return canonical;
      }
    );

  /*
    Quote ranges returned by jk-scan-text.js
    are currently relative to clean-base text.

    Convert them to canonical coordinates.
  */
  const removedQuoteRanges =
    Array.isArray(
      prepared
        ?.removedQuoteRanges
    )
      ? prepared
          .removedQuoteRanges
          .map(
            (range) => {
              const canonical =
                baseRangeToCanonical(
                  base,
                  range.start,
                  range.end
                );

              if (!canonical) {
                return null;
              }

              return {
                ...range,

                start:
                  canonical.start,

                end:
                  canonical.end
              };
            }
          )
          .filter(Boolean)
      : [];

  const bibliographyStart =
    prepared
      ?.bibliographyStart !==
        null &&
    prepared
      ?.bibliographyStart !==
        undefined
      ? baseBoundaryToCanonical(
          base,
          prepared
            .bibliographyStart
        )
      : null;

  return {
    ...prepared,

    map,

    bibliographyStart,

    removedQuoteRanges,

    originalLength:
      base.originalLength,

    removedArtifacts:
      base.removedArtifacts
  };
}

/*
  --------------------------------------------------
  Exports
  --------------------------------------------------
*/

module.exports = {
  isPageNumberText,
  isMarginItem,
  findDocumentArtifacts,
  buildDocumentScanBase,
  baseRangeToCanonical,
  baseBoundaryToCanonical,
  composePreparedWithBase
};

/*
  --------------------------------------------------
  Free command-line audit

  Usage:

    node jk-document-scan-base.js file.jkw-document.json
  --------------------------------------------------
*/

if (
  require.main ===
  module
) {
  const fs =
    require("fs");

  const path =
    require("path");

  const input =
    process.argv[2];

  if (!input) {
    console.error(
      "Usage: node jk-document-scan-base.js <jkw-document.json>"
    );

    process.exitCode =
      1;
  } else {
    const inputPath =
      path.resolve(
        input
      );

    const document =
      JSON.parse(
        fs.readFileSync(
          inputPath,
          "utf8"
        )
      );

    const base =
      buildDocumentScanBase(
        document
      );

    console.log(
      "\nJKW DOCUMENT SCAN BASE"
    );

    console.log(
      "Original characters:",
      document.text.length
    );

    console.log(
      "Clean characters:",
      base.characterCount
    );

    console.log(
      "Original words:",
      document.wordCount
    );

    console.log(
      "Clean words:",
      base.wordCount
    );

    console.log(
      "\nREMOVED ARTIFACTS"
    );

    console.log(
      base.removedArtifacts
    );

    const pageThree =
      base
        .removedArtifacts
        .find(
          (item) =>
            item.text ===
              "3"
        );

    if (!pageThree) {
      throw new Error(
        "Expected page number 3 was not identified."
      );
    }

    console.log(
      "\nPAGE NUMBER 3: REMOVED"
    );

    console.log(
      "\nJKW DOCUMENT SCAN BASE: PASS"
    );

    console.log(
      "No provider request was made."
    );
  }
}