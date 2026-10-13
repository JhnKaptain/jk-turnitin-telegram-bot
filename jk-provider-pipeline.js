"use strict";

/*
  JKW Provider Pipeline
  ---------------------

  Independent replacement-provider pipeline.

  Flow:

  source PDF/DOCX
      ↓
  JKW canonical extraction
      ↓
  similarity / AI filtering
      ↓
  Quetext plagiarism
      ↓
  Sapling AI
      ↓
  provider offsets mapped back
  to canonical JKW coordinates

  IMPORTANT:
  - default CLI mode is DRY RUN
  - --live performs real provider requests
*/

const fs =
  require("fs");

const path =
  require("path");

const {
  extractDocument
} =
  require(
    "./jk-document-extractor.js"
  );

const {
  FILTER_MODE_FILTERED,
  FILTER_MODE_UNFILTERED,
  buildSimilarityInput,
  buildAiInput,
  mapProviderRangesToSource,
  summarizePreparedInput
} =
  require(
    "./jk-scan-text.js"
  );

const {
  checkPlagiarism
} =
  require(
    "./providers/quetext.js"
  );

const {
  checkAi,
  codePointLength,
  SAPLING_MAX_CHARACTERS
} =
  require(
    "./providers/sapling.js"
  );

/*
  --------------------------------------------------
  Product policy
  --------------------------------------------------
*/

const AI_MIN_WORDS =
  300;

const AI_MAX_WORDS =
  30000;

/*
  --------------------------------------------------
  Helpers
  --------------------------------------------------
*/

function safeText(
  value
) {
  return String(
    value == null
      ? ""
      : value
  );
}

function safeNumber(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : null;
}

function clampPercent(
  value
) {
  const number =
    safeNumber(
      value
    );

  if (
    number === null
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.min(
      100,
      number
    )
  );
}

function countWords(
  text
) {
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

function fileTitle(
  sourcePath
) {
  return path.basename(
    sourcePath
  );
}

/*
  --------------------------------------------------
  AI eligibility

  JKW product rule:
  300–30,000 qualifying words AFTER
  reference filtering while quoted text is retained.
  --------------------------------------------------
*/

function aiEligibility(
  prepared
) {
  const words =
    countWords(
      prepared?.text
    );

  const characters =
    codePointLength(
      safeText(
        prepared?.text
      )
    );

  if (
    words <
    AI_MIN_WORDS
  ) {
    return {
      eligible:
        false,

      reason:
        "AI text too short",

      words,

      characters
    };
  }

  if (
    words >
    AI_MAX_WORDS
  ) {
    return {
      eligible:
        false,

      reason:
        "AI text exceeds JKW word limit",

      words,

      characters
    };
  }

  if (
    characters >
    SAPLING_MAX_CHARACTERS
  ) {
    return {
      eligible:
        false,

      reason:
        "AI text exceeds Sapling character limit",

      words,

      characters
    };
  }

  return {
    eligible:
      true,

    reason:
      null,

    words,

    characters
  };
}

/*
  --------------------------------------------------
  Quetext normalization
  --------------------------------------------------
*/

function normalizeQuetextResult(
  result,
  prepared
) {
  const matches =
    (Array.isArray(result?.matches) ? result.matches : [])
      .map(match =>
        require("./jk-match-offsets.js")
          .alignQuetextMatch(prepared.text, match)
      );

  const mappedRanges =
    [];

  const sourceMap =
    new Map();

  for (
    let index = 0;
    index <
      matches.length;
    index += 1
  ) {
    const match =
      matches[index];

    const start =
      safeNumber(
        match?.start
      );

    const end =
      safeNumber(
        match?.end
      );

    if (
      start === null ||
      end === null ||
      end <= start
    ) {
      continue;
    }

    const sourceId =
      safeText(
        match
          ?.source
          ?.id ||
        match
          ?.source
          ?.url ||
        "source-" +
          (
            index +
            1
          )
      );

    const sourceUrl =
      safeText(
        match
          ?.source
          ?.url
      );

    if (
      !sourceMap.has(
        sourceId
      )
    ) {
      sourceMap.set(
        sourceId,
        {
          id:
            sourceId,

          url:
            sourceUrl ||
            null,

          matchedWords:
            0,

          matchCount:
            0,

          ranges:
            []
        }
      );
    }

    const mapped =
      mapProviderRangesToSource(
        prepared,
        [
          {
            start,
            end,

            matchId:
              match?.id ||
              null,

            text:
              match?.text ||
              null,

            percentSimilar:
              safeNumber(
                match
                  ?.percentSimilar
              ),

            inputTokenCount:
              safeNumber(
                match
                  ?.inputTokenCount
              ),

            highlightedSnippet:
              match
                ?.highlightedSnippet ||
              null,

            sourceId,

            sourceUrl:
              sourceUrl ||
              null
          }
        ],
        "utf16"
      );

    const sourceRecord =
      sourceMap.get(
        sourceId
      );

    for (
      const range of
        mapped
    ) {
      const canonicalText =
        safeText(
          range?.text
        );

      const wordCount =
        safeNumber(
          range
            ?.inputTokenCount
        );

      const normalizedRange = {
        start:
          range.start,

        end:
          range.end,

        providerStart:
          range.providerStart,

        providerEnd:
          range.providerEnd,

        matchId:
          range.matchId ||
          null,

        text:
          canonicalText ||
          null,

        percentSimilar:
          range
            .percentSimilar ??
          null,

        sourceId,

        sourceUrl:
          sourceUrl ||
          null
      };

      mappedRanges.push(
        normalizedRange
      );

      sourceRecord
        .ranges
        .push(
          normalizedRange
        );

      sourceRecord
        .matchCount +=
        1;

      if (
        wordCount !==
        null
      ) {
        sourceRecord
          .matchedWords +=
          wordCount;
      }
    }
  }

  /*
    Rank sources by matched words,
    then by number of mapped ranges.
  */
  const sources =
    Array.from(
      sourceMap.values()
    )
      .sort(
        (
          a,
          b
        ) =>
          b.matchedWords -
            a.matchedWords ||
          b.matchCount -
            a.matchCount
      )
      .map(
        (
          source,
          index
        ) => ({
          ...source,

          rank:
            index + 1
        })
      );

  const score =
    clampPercent(
      result?.score
    );

  return {
    available:
      score !== null,

    provider:
      "quetext",

    percent:
      score,

    score,

    wordCount:
      safeNumber(
        result?.wordCount
      ) ??
      countWords(
        prepared.text
      ),

    sourceCount:
      sources.length,

    matchCount:
      mappedRanges.length,

    ranges:
      mappedRanges,

    sources,

    excluded: {
      quotes:
        Boolean(
          prepared?.filtered
        ),

      references:
        Boolean(
          prepared?.filtered
        ),

      citations:
        false
    }
  };
}

/*
  --------------------------------------------------
  Sapling normalization
  --------------------------------------------------
*/

function normalizeSaplingResult(
  result,
  prepared
) {
  const percent =
    clampPercent(
      result?.percent
    );

  const aiFraction =
    safeNumber(
      result?.aiFraction
    );

  const score =
    safeNumber(
      result?.score
    );

  /*
    providers/sapling.js already leaves
    only AI-positive sentence ranges in
    result.ranges.

    Returned sentence text is verified before UTF-16 source mapping.
  */
  const providerRanges =
    (Array.isArray(result?.ranges) ? result.ranges : [])
      .map(range =>
        require("./jk-ai-match-offsets.js")
          .alignSaplingRange(prepared.text, range)
      );

  const mappedRanges =
    mapProviderRangesToSource(
      prepared,
      providerRanges, "utf16"
    );

  return {
    available:
      percent !== null &&
      aiFraction !== null,

    provider:
      "sapling",

    percent,

    score,

    aiFraction,

    detectorVersion:
      result?.version ||
      null,

    language:
      result?.language ||
      null,

    ranges:
      mappedRanges,

    sentenceScores:
      Array.isArray(
        result?.sentenceScores
      )
        ? result
            .sentenceScores
        : [],

    excluded: {
      quotes:
        false,

      references:
        true,

      citations:
        false
    },

    analyzedWords:
      countWords(
        prepared.text
      ),

    analyzedCharacters:
      codePointLength(
        prepared.text
      )
  };
}

/*
  --------------------------------------------------
  Main pipeline
  --------------------------------------------------
*/

async function runProviderPipeline({
  sourcePath,

  similarityMode =
    FILTER_MODE_FILTERED,

  runSimilarity =
    true,

  runAi =
    true,

  live =
    false,

  outputPath =
    null,

  onQuetextProgress =
    null
,
  onQuetextSubmitted = null
}) {
  sourcePath =
    path.resolve(
      sourcePath
    );

  // JK_PROVIDER_RESULTS_CHECKPOINT_V1
  const providerResultsPath = path.resolve(
    (outputPath || sourcePath) + ".provider-results.json"
  );

  if (live && fs.existsSync(providerResultsPath)) {
    const error = new Error(
      "Stored provider results already exist. Review or rebuild them; do not resubmit."
    );
    error.code = "PROVIDER_RESULTS_REVIEW_REQUIRED";
    error.providerResultsPath = providerResultsPath;
    error.noProviderResubmission = true;
    throw error;
  }

  /*
    1. Canonical extraction.
  */
  const document =
    await extractDocument(
      sourcePath
    );

  /*
    2. Prepare provider inputs.
  */
  const similarityPrepared =
    buildSimilarityInput(
      document.text,
      similarityMode
    );

  const aiPrepared =
    buildAiInput(document.text, document);

  const eligibility =
    aiEligibility(
      aiPrepared
    );

  // JK_SHARED_API_WORD_GUARD_V1
  // Block BOTH providers before any paid API request.

  const API_WORD_LIMIT_EXCLUSIVE = 4800;

  function countApiInputWords(value) {
    const content = String(value ?? "")
      .normalize("NFKC")
      .trim();

    if (!content) return 0;

    const whitespaceWords =
      (content.match(/\S+/gu) || []).length;

    const lexicalWords =
      (content.match(/[\p{L}\p{N}]+/gu) || []).length;

    return Math.max(
      whitespaceWords,
      lexicalWords
    );
  }

  const apiTextChecks = [
    {
      name: "Original document",
      content: document.text
    }
  ];

  if (runSimilarity) {
    apiTextChecks.push({
      name: "Quetext",
      content: similarityPrepared.text
    });
  }

  if (runAi) {
    apiTextChecks.push({
      name: "Sapling",
      content: aiPrepared.text
    });
  }

  const apiWordCounts = apiTextChecks.map(
    item => ({
      name: item.name,
      words: countApiInputWords(item.content)
    })
  );

  const extractorWordCount =
    Number(document.wordCount);

  const largestWordCount = Math.max(
    ...apiWordCounts.map(item => item.words),
    Number.isFinite(extractorWordCount)
      ? extractorWordCount
      : 0
  );

  const emptyInput = apiWordCounts.find(
    item => item.words === 0 &&
    item.name !== "Sapling"
  );

  if (
    largestWordCount >= API_WORD_LIMIT_EXCLUSIVE ||
    emptyInput
  ) {
    const reason = emptyInput
      ? "Document text could not be verified."
      : "Document exceeds automatic API word limit.";

    const error = new Error(
      reason +
      " Count: " + largestWordCount +
      " words. API requires fewer than 4800."
    );

    error.code = "API_MANUAL_REVIEW_REQUIRED";
    error.wordCount = largestWordCount;
    error.apiWordCounts = apiWordCounts;
    error.apiBlocked = true;

    throw error;
  }

  const result = {
    generatedAt:
      new Date()
        .toISOString(),

    source: {
      path:
        sourcePath,

      filename:
        path.basename(
          sourcePath
        ),

      type:
        document.sourceType,

      pdfPath:
        document.pdfPath,

      pages:
        document.pageCount,

      words:
        document.wordCount,

      characters:
        document.characterCount
    },

    canonicalDocument:
      document,

    preparation: {
      similarityMode:
        similarityMode,

      similarity:
        summarizePreparedInput(
          similarityPrepared
        ),

      ai:
        summarizePreparedInput(
          aiPrepared
        ),

      aiEligibility:
        eligibility
    },

    similarityDetection:
      null,

    aiDetection:
      null
  };

  /*
    DRY RUN stops here.

    This is deliberately the default.
  */
  if (
    !live
  ) {
    result.similarityDetection = {
      available:
        false,

      provider:
        "quetext",

      reason:
        runSimilarity
          ? "DRY_RUN"
          : "NOT_REQUESTED",

      percent:
        null,

      ranges:
        [],

      sources:
        []
    };

    result.aiDetection = {
      available:
        false,

      provider:
        "sapling",

      reason:
        !runAi
          ? "NOT_REQUESTED"
          : eligibility
              .eligible
            ? "DRY_RUN"
            : eligibility
                .reason,

      percent:
        null,

      ranges:
        []
    };

    if (
      outputPath
    ) {
      fs.writeFileSync(
        outputPath,
        JSON.stringify(
          result,
          null,
          2
        ),
        "utf8"
      );
    }

    return result;
  }

  /*
    3. Quetext and Sapling can run
       independently.

    Promise.allSettled means one provider
    failure does not erase the other's
    successful result.
  */

  const tasks = [];

  const taskNames = [];

  if (
    runSimilarity
  ) {
    taskNames.push(
      "similarity"
    );

    tasks.push(
      checkPlagiarism({
        text:
          similarityPrepared
            .text,

        title:
          fileTitle(
            sourcePath
          ),

        onSubmitted: onQuetextSubmitted,

        onProgress:
          typeof onQuetextProgress ===
          "function"
            ? onQuetextProgress
            : undefined
      })
    );
  }

  if (
    runAi &&
    eligibility.eligible
  ) {
    taskNames.push(
      "ai"
    );

    tasks.push(
      checkAi({
        text:
          aiPrepared.text
      })
    );
  }

  const settled =
    await Promise.allSettled(
      tasks
    );

  const checkpoint = {
    version: 1,
    savedAt: new Date().toISOString(),
    sourcePath,
    similarityMode,
    runSimilarity,
    runAi,
    canonicalDocument: document,
    preparedInputs: {
      similarity: similarityPrepared,
      ai: aiPrepared
    },
    providerResults: Object.fromEntries(
      taskNames.map((name, i) => [
        name,
        settled[i].status === "fulfilled"
          ? {
              status: "fulfilled",
              value: settled[i].value
            }
          : {
              status: "rejected",
              error: safeText(
                settled[i].reason?.message || settled[i].reason
              )
            }
      ])
    )
  };

  fs.mkdirSync(path.dirname(providerResultsPath), { recursive: true });

  fs.writeFileSync(
    providerResultsPath,
    JSON.stringify(checkpoint, null, 2),
    { encoding: "utf8", flag: "wx" }
  );

  try {

  for (
    let i = 0;
    i <
      settled.length;
    i += 1
  ) {
    const providerName =
      taskNames[i];

    const state =
      settled[i];

    if (
      providerName ===
      "similarity"
    ) {
      if (
        state.status ===
        "fulfilled"
      ) {
        result
          .similarityDetection =
          normalizeQuetextResult(
            state.value,
            similarityPrepared
          );
      } else {
        result
          .similarityDetection = {
          available:
            false,

          provider:
            "quetext",

          reason:
            "Similarity detection failed",

          percent:
            null,

          ranges:
            [],

          sources:
            [],

          error:
            safeText(
              state
                .reason
                ?.message ||
              state.reason
            )
        };
      }
    }

    if (
      providerName ===
      "ai"
    ) {
      if (
        state.status ===
        "fulfilled"
      ) {
        result
          .aiDetection =
          normalizeSaplingResult(
            state.value,
            aiPrepared
          );
      } else {
        result
          .aiDetection = {
          available:
            false,

          provider:
            "sapling",

          reason:
            "AI detection failed",

          percent:
            null,

          ranges:
            [],

          error:
            safeText(
              state
                .reason
                ?.message ||
              state.reason
            )
        };
      }
    }
  }

  } catch (error) {
    const review = new Error(
      "Provider result processing requires review: " +
      safeText(error?.message || error)
    );
    review.code = "PROVIDER_RESULTS_REVIEW_REQUIRED";
    review.providerResultsPath = providerResultsPath;
    review.noProviderResubmission = true;
    throw review;
  }

  /*
    Fill intentionally skipped services.
  */

  if (
    !runSimilarity
  ) {
    result.similarityDetection = {
      available:
        false,

      provider:
        "quetext",

      reason:
        "NOT_REQUESTED",

      percent:
        null,

      ranges:
        [],

      sources:
        []
    };
  }

  if (
    !runAi
  ) {
    result.aiDetection = {
      available:
        false,

      provider:
        "sapling",

      reason:
        "NOT_REQUESTED",

      percent:
        null,

      ranges:
        []
    };
  } else if (
    !eligibility.eligible
  ) {
    result.aiDetection = {
      available:
        false,

      provider:
        "sapling",

      reason:
        eligibility
          .reason,

      percent:
        null,

      ranges:
        [],

      analyzedWords:
        eligibility.words,

      analyzedCharacters:
        eligibility.characters
    };
  }

  if (
    outputPath
  ) {
    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        result,
        null,
        2
      ),
      "utf8"
    );
  }

  return result;
}

/*
  --------------------------------------------------
  Exports
  --------------------------------------------------
*/

module.exports = {
  AI_MIN_WORDS,
  AI_MAX_WORDS,

  aiEligibility,

  normalizeQuetextResult,
  normalizeSaplingResult,

  runProviderPipeline
};

/*
  --------------------------------------------------
  Command-line test

  DRY RUN:
    node jk-provider-pipeline.js file.docx

  REAL PROVIDER TEST:
    node jk-provider-pipeline.js file.docx --live

  UNFILTERED similarity:
    node jk-provider-pipeline.js file.docx --live --unfiltered

  Similarity only:
    node jk-provider-pipeline.js file.docx --live --no-ai

  AI only:
    node jk-provider-pipeline.js file.docx --live --no-similarity
  --------------------------------------------------
*/

if (
  require.main ===
  module
) {
  (
    async () => {
      const args =
        process.argv
          .slice(2);

      const sourceArg =
        args.find(
          (arg) =>
            !arg.startsWith(
              "--"
            )
        );

      if (
        !sourceArg
      ) {
        console.error(
          "Usage: node jk-provider-pipeline.js <document> [--live] [--unfiltered] [--no-ai] [--no-similarity]"
        );

        process.exitCode =
          1;

        return;
      }

      const live =
        args.includes(
          "--live"
        );

      const similarityMode =
        args.includes(
          "--unfiltered"
        )
          ? FILTER_MODE_UNFILTERED
          : FILTER_MODE_FILTERED;

      const runAi =
        !args.includes(
          "--no-ai"
        );

      const runSimilarity =
        !args.includes(
          "--no-similarity"
        );

      const sourcePath =
        path.resolve(
          sourceArg
        );

      const outputPath =
        path.resolve(
          live
            ? "jkw-provider-result-live.json"
            : "jkw-provider-result-dry-run.json"
        );

      console.log(
        "\nJKW PROVIDER PIPELINE"
      );

      console.log(
        "Mode:",
        live
          ? "LIVE"
          : "DRY RUN"
      );

      console.log(
        "Document:",
        sourcePath
      );

      console.log(
        "Similarity:",
        runSimilarity
          ? similarityMode
          : "NOT REQUESTED"
      );

      console.log(
        "AI:",
        runAi
          ? "REQUESTED"
          : "NOT REQUESTED"
      );

      if (
        !live
      ) {
        console.log(
          "\nNo provider request will be made."
        );
      } else {
        console.log(
          "\nLIVE MODE: provider requests WILL be made."
        );
      }

      const result =
        await runProviderPipeline({
          sourcePath,

          similarityMode,

          runSimilarity,

          runAi,

          live,

          outputPath,

          onQuetextProgress:
            (progress) => {
              console.log(
                "Quetext progress:",
                progress
              );
            }
        });

      console.log(
        "\nCANONICAL"
      );

      console.log(
        "Pages:",
        result.source.pages
      );

      console.log(
        "Words:",
        result.source.words
      );

      console.log(
        "Characters:",
        result.source.characters
      );

      console.log(
        "\nSIMILARITY PREPARATION"
      );

      console.log(
        result
          .preparation
          .similarity
      );

      console.log(
        "\nAI PREPARATION"
      );

      console.log(
        result
          .preparation
          .ai
      );

      console.log(
        "\nAI ELIGIBILITY"
      );

      console.log(
        result
          .preparation
          .aiEligibility
      );

      console.log(
        "\nSIMILARITY RESULT"
      );

      console.log({
        available:
          result
            .similarityDetection
            ?.available,

        percent:
          result
            .similarityDetection
            ?.percent,

        matches:
          result
            .similarityDetection
            ?.matchCount ??
          0,

        sources:
          result
            .similarityDetection
            ?.sourceCount ??
          0,

        reason:
          result
            .similarityDetection
            ?.reason ??
          null
      });

      console.log(
        "\nAI RESULT"
      );

      console.log({
        available:
          result
            .aiDetection
            ?.available,

        percent:
          result
            .aiDetection
            ?.percent,

        ranges:
          Array.isArray(
            result
              .aiDetection
              ?.ranges
          )
            ? result
                .aiDetection
                .ranges
                .length
            : 0,

        reason:
          result
            .aiDetection
            ?.reason ??
          null
      });

      console.log(
        "\nOutput:",
        outputPath
      );

      console.log(
        "\nJKW PROVIDER PIPELINE COMPLETE"
      );
    }
  )()
    .catch(
      (err) => {
        console.error(
          "\nJKW PROVIDER PIPELINE FAILED:"
        );

        console.error(
          err?.stack ||
          err?.message ||
          err
        );

        process.exitCode =
          1;
      }
    );
}