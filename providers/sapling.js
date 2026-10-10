"use strict";

/*
  JKW Sapling AI Provider
  -----------------------
  Permanent AI provider module.

  Sapling AI Detector:
  POST https://api.sapling.ai/api/v1/aidetect

  This module handles AI detection only.
  Plagiarism is handled independently
  by Quetext.
*/

const SAPLING_BASE_URL =
  "https://api.sapling.ai";

const SAPLING_AI_ENDPOINT =
  "/api/v1/aidetect";

const SAPLING_ACCOUNT_STATUS_ENDPOINT =
  "/api/v1/account/status";

const SAPLING_MAX_CHARACTERS =
  200000;

const DEFAULT_TIMEOUT_MS =
  60000;

/*
  --------------------------------------------------
  Utilities
  --------------------------------------------------
*/

function requireSaplingApiKey() {
  const key =
    String(
      process.env.SAPLING_API_KEY ||
      ""
    ).trim();

  if (!key) {
    throw new Error(
      "SAPLING_API_KEY is not configured."
    );
  }

  return key;
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

function codePointLength(text) {
  return Array.from(
    String(
      text ||
      ""
    )
  ).length;
}

/*
  Sapling offsets are handled as Unicode
  code points rather than assuming UTF-16
  string indexes.
*/
function sliceByCodePoints(
  text,
  start,
  end
) {
  return Array.from(
    String(
      text ||
      ""
    )
  )
    .slice(
      start,
      end
    )
    .join("");
}

/*
  --------------------------------------------------
  HTTP helper
  --------------------------------------------------
*/

async function saplingRequest(
  endpoint,
  {
    method = "GET",
    body = null,
    timeoutMs =
      DEFAULT_TIMEOUT_MS
  } = {}
) {
  if (
    typeof fetch !==
    "function"
  ) {
    throw new Error(
      "This Sapling client requires Node.js 18 or later."
    );
  }

  const key =
    requireSaplingApiKey();

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    const options = {
      method,

      headers: {
        Accept:
          "application/json",

        Authorization:
          "Bearer " +
          key
      },

      signal:
        controller.signal
    };

    if (
      body !== null &&
      body !== undefined
    ) {
      options.headers[
        "Content-Type"
      ] =
        "application/json";

      options.body =
        JSON.stringify(
          body
        );
    }

    const response =
      await fetch(
        SAPLING_BASE_URL +
          endpoint,
        options
      );

    const raw =
      await response.text();

    let payload = null;

    if (raw) {
      try {
        payload =
          JSON.parse(
            raw
          );
      } catch {
        throw new Error(
          "Sapling returned non-JSON data. HTTP " +
          response.status
        );
      }
    }

    if (
      !response.ok
    ) {
      const message =
        payload?.msg ||
        payload?.message ||
        "Sapling API request failed.";

      const error =
        new Error(
          message
        );

      error.status =
        response.status;

      error.payload =
        payload;

      throw error;
    }

    return payload;
  } catch (err) {
    if (
      err?.name ===
      "AbortError"
    ) {
      throw new Error(
        "Sapling API request timed out."
      );
    }

    throw err;
  } finally {
    clearTimeout(
      timer
    );
  }
}

/*
  --------------------------------------------------
  Free account/API-key check
  --------------------------------------------------
*/

async function getSaplingAccountStatus() {
  return saplingRequest(
    SAPLING_ACCOUNT_STATUS_ENDPOINT
  );
}

/*
  --------------------------------------------------
  Run AI detection
  --------------------------------------------------
*/

async function detectAi({
  text,
  sentScores = true,
  scoreString = false,
  version = null
}) {
  text =
    String(
      text ||
      ""
    );

  if (
    !text.trim()
  ) {
    throw new Error(
      "Sapling AI text is empty."
    );
  }

  const characterCount =
    codePointLength(
      text
    );

  if (
    characterCount >
    SAPLING_MAX_CHARACTERS
  ) {
    throw new Error(
      "Sapling AI input exceeds " +
      SAPLING_MAX_CHARACTERS +
      " characters. Received: " +
      characterCount
    );
  }

  const body = {
    text,

    sent_scores:
      Boolean(
        sentScores
      ),

    score_string:
      Boolean(
        scoreString
      )
  };

  if (
    version
  ) {
    body.version =
      String(version);
  }

  return saplingRequest(
    SAPLING_AI_ENDPOINT,
    {
      method:
        "POST",

      body
    }
  );
}

/*
  --------------------------------------------------
  Normalize AI result into a provider-neutral
  JKW structure.

  Important:
  - Keep all sentence scores for diagnostics.
  - Only expose sentences >= 0.5 as AI-positive
    ranges for highlighting.
  --------------------------------------------------
*/

function normalizeAiResult(
  payload
) {
  const text =
    String(
      payload?.text ||
      ""
    );

  const rawSentenceScores =
    Array.isArray(
      payload
        ?.sentence_scores
    )
      ? payload
          .sentence_scores
      : [];

  const sentenceScores =
    rawSentenceScores
      .map(
        (
          sentence,
          index
        ) => {
          const start =
            safeNumber(
              sentence?.start
            );

          const end =
            safeNumber(
              sentence?.end
            );

          const score =
            safeNumber(
              sentence?.score
            );

          return {
            id:
              "sentence-" +
              (
                index +
                1
              ),

            start,

            end,

            score,

            sentence:
              String(
                sentence?.sentence ||
                (
                  start !== null &&
                  end !== null
                    ? sliceByCodePoints(
                        text,
                        start,
                        end
                      )
                    : ""
                )
              )
          };
        }
      )
      .filter(
        (item) =>
          item.start !== null &&
          item.end !== null &&
          item.end >
            item.start
      );

  /*
    Sapling treats sentence scores >= 0.5
    as AI-positive.
  */
  const ranges =
    sentenceScores.filter(
      (item) =>
        item.score !== null &&
        item.score >= 0.5
    );

  const score =
    safeNumber(
      payload?.score
    );

  const aiFraction =
    safeNumber(
      payload
        ?.ai_fraction
    );

  return {
    provider:
      "sapling",

    available:
      score !== null ||
      aiFraction !== null,

    /*
      Whole-document AI probability.
      Keep for diagnostics.
    */
    score,

    /*
      Fraction of the document Sapling
      classifies as AI-generated.
    */
    aiFraction,

    /*
      Candidate percentage for our AI report.
    */
    percent:
      aiFraction !== null
        ? Math.round(
            aiFraction *
            1000
          ) /
          10
        : null,

    version:
      payload?.version
        ? String(
            payload.version
          )
        : null,

    language:
      payload?.language ||
      null,

    characters:
      codePointLength(
        text
      ),

    /*
      Only AI-positive ranges.
    */
    ranges,

    /*
      All sentence-level scores retained
      for diagnostics and benchmarking.
    */
    sentenceScores,

    tokens:
      Array.isArray(
        payload?.tokens
      )
        ? payload.tokens
        : [],

    tokenProbabilities:
      Array.isArray(
        payload
          ?.token_probs
      )
        ? payload
            .token_probs
        : [],

    raw:
      payload
  };
}

/*
  --------------------------------------------------
  Convenience function
  --------------------------------------------------
*/

async function checkAi({
  text,
  version = null
}) {
  const raw =
    await detectAi({
      text,

      sentScores:
        true,

      scoreString:
        false,

      version
    });

  return normalizeAiResult(
    raw
  );
}

/*
  --------------------------------------------------
  Exports
  --------------------------------------------------
*/

module.exports = {
  SAPLING_BASE_URL,

  SAPLING_AI_ENDPOINT,

  SAPLING_MAX_CHARACTERS,

  getSaplingAccountStatus,

  detectAi,

  normalizeAiResult,

  checkAi,

  sliceByCodePoints,

  codePointLength
};

/*
  --------------------------------------------------
  Running this file directly performs ONLY
  the free account/API-key status check.

  It does NOT run AI detection.
  --------------------------------------------------
*/

if (
  require.main ===
  module
) {
  (
    async () => {
      try {
        const status =
          await getSaplingAccountStatus();

        console.log(
          "\nSAPLING API AUTHENTICATION: OK"
        );

        console.log(
          "API access:",
          status?.api_access
            ? "YES"
            : "NO"
        );

        if (
          status?.blocked_reason
        ) {
          console.log(
            "Blocked reason:",
            status
              .blocked_reason
          );
        }

        if (
          status?.message
        ) {
          console.log(
            "Message:",
            status.message
          );
        }

        const monthlyQuota =
          status
            ?.usage
            ?.monthly_quota_chars;

        if (
          monthlyQuota !==
            undefined &&
          monthlyQuota !== null
        ) {
          console.log(
            "Monthly quota:",
            monthlyQuota,
            "characters"
          );
        }

        const used =
          status
            ?.usage
            ?.chars_this_month;

        if (
          used !==
            undefined &&
          used !== null
        ) {
          console.log(
            "Used this month:",
            used,
            "characters"
          );
        }

        console.log(
          "No AI detection request was started."
        );
      } catch (err) {
        console.error(
          "\nSAPLING API TEST FAILED:"
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