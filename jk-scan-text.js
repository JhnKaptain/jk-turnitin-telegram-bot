"use strict";

/*
  JKW Provider-Neutral Scan Text Layer
  ------------------------------------

  Responsibilities:

  1. Build canonical provider input from
     locally extracted document text.

  2. FILTERED similarity:
       - exclude quoted text
       - exclude references/bibliography
       - keep inline citations

  3. UNFILTERED similarity:
       - preserve complete canonical text

  4. AI:
       - retain quoted text
       - always exclude references/bibliography
       - keep inline citations

  5. Maintain an exact map from provider
     input positions back to the canonical
     JKW document.

  6. Support:
       - UTF-16 offsets used by normal JS text
       - Unicode code-point offsets used by Sapling
*/

const FILTER_MODE_FILTERED =
  "FILTERED";

const FILTER_MODE_UNFILTERED =
  "UNFILTERED";

/*
  --------------------------------------------------
  General helpers
  --------------------------------------------------
*/

function safeText(value) {
  return String(
    value == null
      ? ""
      : value
  );
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
  --------------------------------------------------
  Find References / Bibliography section

  We deliberately prefer a heading occurring
  later in the document so that a table of
  contents entry named "References" near the
  beginning does not accidentally remove most
  of the paper.
  --------------------------------------------------
*/

function findBibliographyStart(
  text
) {
  const value =
    safeText(
      text
    );

  const matches = [];

  /*
    JK_FLATTENED_BIBLIOGRAPHY_HEADING_V1

    Normal extraction usually preserves a
    bibliography heading on its own line.

    Some PDFs flatten:

      References
      Smith, J. (2025)...

    into:

      References Smith, J. (2025)...

    Preserve the strict standalone-heading rule
    first, then use a conservative fallback for
    flattened headings near the later portion of
    the document.
  */

  const standaloneHeadingRe =
    /(^|\n)[ \t]*(reference list|references?|bibliography|works cited)[ \t]*:?[ \t]*(?=\r?\n|$)/gim;

  let match;

  while (
    (
      match =
        standaloneHeadingRe.exec(
          value
        )
    )
  ) {
    const start =
      match.index +
      (
        match[1]
          ? match[1].length
          : 0
      );

    matches.push(
      start
    );
  }

  /*
    PDF text extraction can remove the line break
    after the heading.

    Require:
      1. sentence/document boundary before heading,
      2. exact approved heading,
      3. reference-like content immediately after it.

    This prevents ordinary prose such as
    "the article references Smith" from becoming
    a bibliography boundary.
  */
  const flattenedHeadingRe =
    /(^|[.!?][ \t]+)(reference list|references?|bibliography|works cited)[ \t]*:?[ \t]*(?:\r?\n[ \t]*|[ \t]+)/gim;

  while (
    (
      match =
        flattenedHeadingRe.exec(
          value
        )
    )
  ) {
    const start =
      match.index +
      (
        match[1]
          ? match[1].length
          : 0
      );

    const evidenceStart =
      flattenedHeadingRe
        .lastIndex;

    const evidence =
      value.slice(
        evidenceStart,
        Math.min(
          value.length,
          evidenceStart + 180
        )
      );

    const looksLikeReference =
      /(?:^(?:\[\d+\][ \t]*|[A-Z][A-Za-z'’.-]{1,50},[ \t]*[A-Z])|\((?:19|20)\d{2}[a-z]?\)|\b(?:19|20)\d{2}[a-z]?\b|https?:\/\/|\bdoi\b)/i.test(
        evidence
      );

    if (
      looksLikeReference
    ) {
      matches.push(
        start
      );
    }
  }

  /*
    Ignore early occurrences such as a table of
    contents entry.

    Choose the last eligible occurrence so the
    actual bibliography near the end wins.
  */
  const eligible =
    matches
      .filter(
        (start) =>
          start >=
          value.length *
            0.30
      )
      .sort(
        (a, b) =>
          a - b
      );

  if (
    eligible.length
  ) {
    return eligible[
      eligible.length - 1
    ];
  }

  return -1;
}

/*
  --------------------------------------------------
  Identity input

  Used for UNFILTERED similarity.

  map[index] tells us which UTF-16 position
  in the canonical source produced that
  provider-input character.
  --------------------------------------------------
*/

function buildIdentityInput(
  rawText
) {
  const source =
    safeText(
      rawText
    );

  const map =
    new Array(
      source.length
    );

  for (
    let i = 0;
    i <
      source.length;
    i += 1
  ) {
    map[i] = i;
  }

  return {
    text:
      source,

    map,

    filtered:
      false,

    bibliographyStart:
      null,

    removedQuoteRanges:
      [],

    originalLength:
      source.length,

    wordCount:
      countWords(
        source
      )
  };
}

/*
  --------------------------------------------------
  Filtered input

  Quotes and bibliography are excluded.

  Inline citations such as:
      (Smith, 2025)
      [4]

  are deliberately left untouched.
  --------------------------------------------------
*/

function buildFilteredInput(
  rawText
) {
  const source =
    safeText(
      rawText
    );

  const bibliographyStart =
    findBibliographyStart(
      source
    );

  const limit =
    bibliographyStart >= 0
      ? bibliographyStart
      : source.length;

  let text = "";

  const map = [];

  const removedQuoteRanges =
    [];

  /*
    Add a synthetic space where removed
    material would otherwise join words.

    Example:

      before "removed quote" after

    must not become:

      beforeafter

    null means that synthetic space does
    not correspond to a real source
    character.
  */
  function addGap() {
    if (
      text.length &&
      !/\s/.test(
        text[
          text.length -
            1
        ]
      )
    ) {
      text += " ";

      map.push(
        null
      );
    }
  }

  for (
    let i = 0;
    i < limit;
    i += 1
  ) {
    const ch =
      source[i];

    /*
      ----------------------------
      Curly double quotes
      ----------------------------
    */
    if (
      ch === "“"
    ) {
      const close =
        source.indexOf(
          "”",
          i + 1
        );

      if (
        close >= 0 &&
        close < limit
      ) {
        const quoteStart =
          i;

        const quoteEnd =
          close + 1;

        removedQuoteRanges.push({
          start:
            quoteStart,

          end:
            quoteEnd,

          type:
            "CURLY_DOUBLE_QUOTE"
        });

        addGap();

        i =
          close;

        addGap();

        continue;
      }
    }

    /*
      ----------------------------
      Straight double quotes

      Only remove the section if we
      actually find a closing quote.

      Single quotation marks and
      apostrophes remain untouched.
      ----------------------------
    */
    if (
      ch === '"' &&
      source[i - 1] !==
        "\\"
    ) {
      let close =
        i + 1;

      while (
        close < limit
      ) {
        close =
          source.indexOf(
            '"',
            close
          );

        if (
          close < 0
        ) {
          break;
        }

        if (
          source[
            close - 1
          ] !== "\\"
        ) {
          break;
        }

        close += 1;
      }

      if (
        close >= 0 &&
        close < limit
      ) {
        const quoteStart =
          i;

        const quoteEnd =
          close + 1;

        removedQuoteRanges.push({
          start:
            quoteStart,

          end:
            quoteEnd,

          type:
            "STRAIGHT_DOUBLE_QUOTE"
        });

        addGap();

        i =
          close;

        addGap();

        continue;
      }
    }

    /*
      Normal source character.
    */
    text += ch;

    map.push(
      i
    );
  }

  /*
    Trim outside whitespace while keeping
    provider text and mapping aligned.
  */
  let first = 0;

  let last =
    text.length;

  while (
    first < last &&
    /\s/.test(
      text[first]
    )
  ) {
    first += 1;
  }

  while (
    last > first &&
    /\s/.test(
      text[
        last - 1
      ]
    )
  ) {
    last -= 1;
  }

  const filteredText =
    text.slice(
      first,
      last
    );

  const filteredMap =
    map.slice(
      first,
      last
    );

  return {
    text:
      filteredText,

    map:
      filteredMap,

    filtered:
      true,

    bibliographyStart:
      bibliographyStart >= 0
        ? bibliographyStart
        : null,

    removedQuoteRanges,

    originalLength:
      source.length,

    wordCount:
      countWords(
        filteredText
      )
  };
}

/*
  --------------------------------------------------
  Similarity input

  FILTERED:
      quotes + bibliography removed

  UNFILTERED:
      complete canonical document
  --------------------------------------------------
*/

function buildSimilarityInputBeforeReferenceSections(
  rawText,
  mode
) {
  const normalizedMode =
    safeText(
      mode
    )
      .trim()
      .toUpperCase();

  if (
    normalizedMode ===
    FILTER_MODE_FILTERED
  ) {
    return buildFilteredInput(
      rawText
    );
  }

  return buildIdentityInput(
    rawText
  );
}

/*
  --------------------------------------------------
  AI input

  AI filtering is intentionally independent
  from similarity filtering.

  AI retains quotes but excludes the bibliography/reference section.
  --------------------------------------------------
*/

// JK_AI_QUOTES_INCLUDED_REFERENCES_EXCLUDED_V1
function buildAiInputBeforeReferenceSections(
  rawText
) {
  const source =
    safeText(
      rawText
    );

  const bibliographyStart =
    findBibliographyStart(
      source
    );

  const limit =
    bibliographyStart >= 0
      ? bibliographyStart
      : source.length;

  const text =
    source.slice(
      0,
      limit
    );

  const map =
    Array.from(
      {
        length:
          text.length
      },
      (
        _,
        index
      ) => index
    );

  return {
    text,
    map,

    filtered:
      true,

    bibliographyStart:
      bibliographyStart >= 0
        ? bibliographyStart
        : null,

    /*
      AI retains quotation text.
    */
    removedQuoteRanges:
      [],

    originalLength:
      source.length,

    wordCount:
      countWords(
        text
      )
  };
}

/*
  --------------------------------------------------
  Convert Sapling Unicode code-point boundary
  to JavaScript UTF-16 boundary.

  Example:

    "A😀B"

  Code points:
    A  = 0
    😀 = 1
    B  = 2

  JavaScript UTF-16 offsets:
    A  = 0
    😀 = 1..3
    B  = 3

  Sapling reports code-point positions,
  while our canonical JKW text/map uses
  normal JavaScript string indexes.
  --------------------------------------------------
*/

function codePointBoundaryToUtf16(
  text,
  codePointIndex
) {
  const value =
    safeText(
      text
    );

  const target =
    Math.max(
      0,
      Number(
        codePointIndex
      ) || 0
    );

  if (
    target === 0
  ) {
    return 0;
  }

  let codePoints =
    0;

  let utf16 =
    0;

  for (
    const symbol of
      value
  ) {
    if (
      codePoints >=
      target
    ) {
      break;
    }

    utf16 +=
      symbol.length;

    codePoints +=
      1;
  }

  return utf16;
}

/*
  --------------------------------------------------
  Map a provider UTF-16 range back to one or
  more canonical source ranges.

  A provider range can cross a removed quotation.

  We MUST split the highlight there rather than
  accidentally painting the excluded quote.

  Example:

      source:
      Hello "excluded words" world

      provider input:
      Hello world

  If a match covers:
      Hello world

  we return two canonical runs rather than
  one large range spanning the removed quote.
  --------------------------------------------------
*/

function mapUtf16RangeToSource(
  prepared,
  start,
  end
) {
  const map =
    Array.isArray(
      prepared?.map
    )
      ? prepared.map
      : [];

  let localStart =
    Number(start);

  let localEnd =
    Number(end);

  if (
    !Number.isFinite(
      localStart
    ) ||
    !Number.isFinite(
      localEnd
    )
  ) {
    return [];
  }

  localStart =
    Math.max(
      0,
      Math.floor(
        localStart
      )
    );

  localEnd =
    Math.min(
      map.length,
      Math.ceil(
        localEnd
      )
    );

  if (
    localEnd <=
    localStart
  ) {
    return [];
  }

  const ranges = [];

  let runStart =
    null;

  let previous =
    null;

  function flush() {
    if (
      runStart ===
        null ||
      previous ===
        null
    ) {
      return;
    }

    ranges.push({
      start:
        runStart,

      end:
        previous + 1
    });

    runStart =
      null;

    previous =
      null;
  }

  for (
    let index =
      localStart;
    index <
      localEnd;
    index += 1
  ) {
    const originalIndex =
      Number(
        map[index]
      );

    /*
      Synthetic gap / excluded material.
    */
    if (
      !Number.isFinite(
        originalIndex
      )
    ) {
      flush();

      continue;
    }

    if (
      runStart ===
      null
    ) {
      runStart =
        originalIndex;

      previous =
        originalIndex;

      continue;
    }

    /*
      Continue contiguous source run.
    */
    if (
      originalIndex ===
      previous + 1
    ) {
      previous =
        originalIndex;

      continue;
    }

    /*
      Discontinuity means some material
      was removed from provider input.
    */
    flush();

    runStart =
      originalIndex;

    previous =
      originalIndex;
  }

  flush();

  return ranges;
}

/*
  --------------------------------------------------
  Map Sapling code-point range back to
  canonical source ranges.
  --------------------------------------------------
*/

function mapCodePointRangeToSource(
  prepared,
  codePointStart,
  codePointEnd
) {
  const providerText =
    safeText(
      prepared?.text
    );

  const utf16Start =
    codePointBoundaryToUtf16(
      providerText,
      codePointStart
    );

  const utf16End =
    codePointBoundaryToUtf16(
      providerText,
      codePointEnd
    );

  return mapUtf16RangeToSource(
    prepared,
    utf16Start,
    utf16End
  );
}

/*
  --------------------------------------------------
  Map many provider ranges.

  offsetType:
      "utf16"      -> Quetext-style input offsets
      "codepoint"  -> Sapling sentence offsets
  --------------------------------------------------
*/

function mapProviderRangesToSource(
  prepared,
  providerRanges,
  offsetType = "utf16"
) {
  const input =
    Array.isArray(
      providerRanges
    )
      ? providerRanges
      : [];

  const mapped = [];

  for (
    const providerRange of
      input
  ) {
    const start =
      Number(
        providerRange?.start
      );

    const end =
      Number(
        providerRange?.end
      );

    if (
      !Number.isFinite(
        start
      ) ||
      !Number.isFinite(
        end
      ) ||
      end <= start
    ) {
      continue;
    }

    const sourceRanges =
      offsetType ===
        "codepoint"
        ? mapCodePointRangeToSource(
            prepared,
            start,
            end
          )
        : mapUtf16RangeToSource(
            prepared,
            start,
            end
          );

    for (
      const sourceRange of
        sourceRanges
    ) {
      mapped.push({
        ...providerRange,

        providerStart:
          start,

        providerEnd:
          end,

        start:
          sourceRange.start,

        end:
          sourceRange.end
      });
    }
  }

  return mapped;
}

/*
  --------------------------------------------------
  Diagnostics
  --------------------------------------------------
*/

function summarizePreparedInput(
  prepared
) {
  return {
    filtered:
      Boolean(
        prepared?.filtered
      ),

    characters:
      safeText(
        prepared?.text
      ).length,

    words:
      countWords(
        prepared?.text
      ),

    bibliographyStart:
      prepared
        ?.bibliographyStart ??
      null,

    removedQuotes:
      Array.isArray(
        prepared
          ?.removedQuoteRanges
      )
        ? prepared
            .removedQuoteRanges
            .length
        : 0,

    mappedCharacters:
      Array.isArray(
        prepared?.map
      )
        ? prepared.map.length
        : 0
  };
}

/*
  --------------------------------------------------
  Exports
  --------------------------------------------------
*/

// JK_AI_RUNNING_METADATA_EXCLUSION_V1
function buildAiInput(rawText, document) {
  const prepared = buildAiInputWithoutRunningMetadata(rawText);
  return require("./jk-ai-running-metadata.js")
    .excludeAiRunningMetadata(prepared, document);
}

// JK_COMPLETE_REFERENCE_SECTIONS_V1
function buildSimilarityInput(rawText, mode) {
  const normalized = safeText(mode).trim().toUpperCase();

  if (normalized !== FILTER_MODE_FILTERED) {
    return buildSimilarityInputBeforeReferenceSections(rawText, mode);
  }

  return require("./jk-reference-sections.js")
    .prepareWithoutReferences(
      rawText,
      text => buildSimilarityInputBeforeReferenceSections(text, mode),
      findBibliographyStart(safeText(rawText))
    );
}

function buildAiInputWithoutRunningMetadata(rawText) {
  return require("./jk-reference-sections.js")
    .prepareWithoutReferences(
      rawText,
      text => buildAiInputBeforeReferenceSections(text),
      findBibliographyStart(safeText(rawText))
    );
}

module.exports = {
  FILTER_MODE_FILTERED,
  FILTER_MODE_UNFILTERED,

  countWords,

  findBibliographyStart,

  buildIdentityInput,
  buildFilteredInput,

  buildSimilarityInput,
  buildAiInput,

  codePointBoundaryToUtf16,

  mapUtf16RangeToSource,
  mapCodePointRangeToSource,
  mapProviderRangesToSource,

  summarizePreparedInput
};

/*
  --------------------------------------------------
  Local self-test

  No API requests.
  No Quetext credits.
  No Sapling credits.
  --------------------------------------------------
*/

if (
  require.main ===
  module
) {
  const sample =
    [
      "Opening sentence.",
      'Before "quoted material should disappear" after.',
      "Inline citation remains (Smith, 2025).",
      "Unicode test 😀 remains.",
      "",
      "References",
      "Smith, J. (2025). Example reference."
    ].join(
      "\n"
    );

  const unfiltered =
    buildSimilarityInput(
      sample,
      FILTER_MODE_UNFILTERED
    );

  const filtered =
    buildSimilarityInput(
      sample,
      FILTER_MODE_FILTERED
    );

  const ai =
    buildAiInput(
      sample
    );

  console.log(
    "\nJKW SCAN TEXT SELF-TEST"
  );

  console.log(
    "\nUNFILTERED:"
  );

  console.log(
    unfiltered.text
  );

  console.log(
    "\nFILTERED:"
  );

  console.log(
    filtered.text
  );

  console.log(
    "\nAI INPUT:"
  );

  console.log(
    ai.text
  );

  console.log(
    "\nFILTERED SUMMARY:"
  );

  console.log(
    summarizePreparedInput(
      filtered
    )
  );

  const afterIndex =
    filtered.text.indexOf(
      "after"
    );

  const mappedAfter =
    mapUtf16RangeToSource(
      filtered,
      afterIndex,
      afterIndex +
        "after".length
    );

  console.log(
    "\nUTF-16 MAPPING TEST:"
  );

  console.log(
    mappedAfter
  );

  if (
    mappedAfter.length !==
      1 ||
    sample.slice(
      mappedAfter[0].start,
      mappedAfter[0].end
    ) !== "after"
  ) {
    throw new Error(
      "UTF-16 mapping self-test failed."
    );
  }

  const emojiProviderStart =
    Array.from(
      filtered.text.slice(
        0,
        filtered.text.indexOf(
          "😀"
        )
      )
    ).length;

  const mappedEmoji =
    mapCodePointRangeToSource(
      filtered,
      emojiProviderStart,
      emojiProviderStart +
        1
    );

  console.log(
    "\nCODE-POINT MAPPING TEST:"
  );

  console.log(
    mappedEmoji
  );

  if (
    mappedEmoji.length !==
      1 ||
    sample.slice(
      mappedEmoji[0].start,
      mappedEmoji[0].end
    ) !== "😀"
  ) {
    throw new Error(
      "Code-point mapping self-test failed."
    );
  }

  if (
    filtered.text.includes(
      "quoted material should disappear"
    )
  ) {
    throw new Error(
      "Quote exclusion self-test failed."
    );
  }

  if (
    filtered.text.includes(
      "Example reference"
    )
  ) {
    throw new Error(
      "Bibliography exclusion self-test failed."
    );
  }

  if (
    !filtered.text.includes(
      "(Smith, 2025)"
    )
  ) {
    throw new Error(
      "Inline citation preservation self-test failed."
    );
  }

  console.log(
    "\nJKW SCAN TEXT SELF-TEST: PASS"
  );

  console.log(
    "No provider request was made."
  );
}