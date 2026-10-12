"use strict";

/*
  JKW Quetext Plagiarism Provider
  --------------------------------
  Permanent provider module.

  Quetext API v2:
  https://www.quetext.com/api/v2/

  Authentication:
  X-API-Key

  This module performs plagiarism checks only.
  AI detection will be handled independently
  by Sapling.
*/

const QUETEXT_BASE_URL =
  "https://www.quetext.com/api/v2";

const DEFAULT_POLL_MS =
  2500;

const DEFAULT_TIMEOUT_MS =
  12 * 60 * 1000;

/*
  --------------------------------------------------
  Utilities
  --------------------------------------------------
*/

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}

function requireQuetextApiKey() {
  const key =
    String(
      process.env.QUETEXT_API_KEY ||
      ""
    ).trim();

  if (!key) {
    throw new Error(
      "QUETEXT_API_KEY is not configured."
    );
  }

  return key;
}

function safeNumber(value) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

/*
  --------------------------------------------------
  HTTP
  --------------------------------------------------
*/

async function quetextRequest(
  endpoint,
  {
    method = "GET",
    body = null,
    timeoutMs = 30000
  } = {}
) {
  if (
    typeof fetch !==
    "function"
  ) {
    throw new Error(
      "This Quetext client requires Node.js 18 or later."
    );
  }

  const key =
    requireQuetextApiKey();

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
        "Accept":
          "application/json",

        "X-API-Key":
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
        QUETEXT_BASE_URL +
          endpoint,
        options
      );

    const raw =
      await response.text();

    let payload = null;

    if (raw) {
      try {
        payload =
          JSON.parse(raw);
      } catch {
        throw new Error(
          "Quetext returned non-JSON data. HTTP " +
          response.status
        );
      }
    }

    if (
      !response.ok ||
      payload?.status === false
    ) {
      const code =
        payload?.code ||
        response.status;

      let message =
        payload?.message ||
        "Quetext API request failed.";

      /*
        Quetext 402 responses may contain
        the current balance and the amount
        required for the requested scan.
      */
      if (
        Number(code) === 402 &&
        payload?.data
      ) {
        const balance =
          payload
            .data
            .balance_words;

        const needed =
          payload
            .data
            .needed_words;

        message +=
          " Balance words: " +
          String(
            balance ??
            "unknown"
          ) +
          ". Needed words: " +
          String(
            needed ??
            "unknown"
          ) +
          ".";
      }

      const error =
        new Error(
          message
        );

      error.status =
        response.status;

      error.code =
        code;

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
        "Quetext API request timed out."
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
  Free account/authentication check
  --------------------------------------------------
*/

async function getQuetextPlan() {
  return quetextRequest(
    "/plan"
  );
}

/*
  --------------------------------------------------
  Submit plagiarism scan
  --------------------------------------------------
*/

async function createPlagiarismReport({
  text,
  title = "JKW Report"
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
      "Quetext plagiarism text is empty."
    );
  }

  const response =
    await quetextRequest(
      "/report",
      {
        method:
          "POST",

        body: {
          title:
            String(
              title ||
              "JKW Report"
            ),

          text
        }
      }
    );

  const reportId =
    response
      ?.data
      ?.id;

  if (!reportId) {
    throw new Error(
      "Quetext did not return a report ID."
    );
  }

  return {
    reportId:
      String(
        reportId
      ),

    response
  };
}

/*
  --------------------------------------------------
  Progress
  --------------------------------------------------
*/

async function getReportProgress(
  reportId
) {
  if (!reportId) {
    throw new Error(
      "Missing Quetext report ID."
    );
  }

  return quetextRequest(
    "/report-progress/" +
      encodeURIComponent(
        reportId
      )
  );
}

function parseProgress(
  payload
) {
  const data =
    payload?.data;

  let value = null;

  if (
    Array.isArray(data)
  ) {
    value =
      data[0]?.Progress ??
      data[0]?.progress ??
      data[0]?.percentage;
  } else {
    value =
      data?.Progress ??
      data?.progress ??
      data?.percentage;
  }

  value =
    Number(value);

  if (
    !Number.isFinite(
      value
    )
  ) {
    return null;
  }

  /*
    Quetext's progress API normally
    returns a fraction between 0 and 1.

    This also tolerates a percentage
    response if the API changes format.
  */
  if (
    value > 1
  ) {
    value =
      value / 100;
  }

  return Math.max(
    0,
    Math.min(
      1,
      value
    )
  );
}

/*
  --------------------------------------------------
  Retrieve finished report
  --------------------------------------------------
*/

async function getPlagiarismReport(
  reportId
) {
  if (!reportId) {
    throw new Error(
      "Missing Quetext report ID."
    );
  }

  return quetextRequest(
    "/report/" +
      encodeURIComponent(
        reportId
      )
  );
}

/*
  --------------------------------------------------
  Normalize Quetext result into a simple
  provider-neutral structure.

  Later our JKW bundle builder will consume
  this instead of consuming Quetext directly.
  --------------------------------------------------
*/

function normalizePlagiarismReport(
  payload
) {
  const data =
    payload?.data ||
    {};

  const matches =
    Array.isArray(
      data.matches
    )
      ? data.matches
      : [];

  const normalizedMatches =
    matches.map(
      (
        match,
        index
      ) => {
        const text =
          String(
            match
              ?.input_text_match ||
            ""
          );

        const start =
          safeNumber(
            match
              ?.input_text_offset
          );

        const end =
          start !== null
            ? start +
              text.length
            : null;

        return {
          id:
            String(
              match?.id ||
              "match-" +
                (
                  index +
                  1
                )
            ),

          start,

          end,

          text,

          inputTokenCount:
            safeNumber(
              match
                ?.input_token_count
            ),

          percentSimilar:
            safeNumber(
              match
                ?.percent_similar
            ),

          highlightedSnippet:
            String(
              match
                ?.highlighted_snippet ||
              ""
            ),

          source: {
            id:
              match
                ?.source
                ?.id !==
              undefined
                ? String(
                    match
                      .source
                      .id
                  )
                : null,

            url:
              match
                ?.source
                ?.url
                ? String(
                    match
                      .source
                      .url
                  )
                : null
          }
        };
      }
    );

  return {
    provider:
      "quetext",

    reportId:
      data?.id
        ? String(
            data.id
          )
        : null,

    status:
      String(
        data?.status ||
        ""
      ),

    score:
      safeNumber(
        data?.score
      ),

    wordCount:
      safeNumber(
        data
          ?.word_count
      ),

    sentenceCount:
      safeNumber(
        data
          ?.sentence_count
      ),

    inputText:
      String(
        data?.input_text ||
        ""
      ),

    matches:
      normalizedMatches,

    raw:
      payload
  };
}

/*
  --------------------------------------------------
  Poll until complete
  --------------------------------------------------
*/

async function waitForPlagiarismReport(
  reportId,
  {
    pollMs =
      DEFAULT_POLL_MS,

    timeoutMs =
      DEFAULT_TIMEOUT_MS,

    onProgress = null
  } = {}
) {
  const startedAt =
    Date.now();

  let lastProgress =
    null;

  while (true) {
    if (
      Date.now() -
        startedAt >
      timeoutMs
    ) {
      throw new Error(
        "Quetext plagiarism scan timed out."
      );
    }

    const progressPayload =
      await getReportProgress(
        reportId
      );

    const progress =
      parseProgress(
        progressPayload
      );

    if (
      progress !==
        lastProgress &&
      typeof onProgress ===
        "function"
    ) {
      onProgress(
        progress
      );
    }

    lastProgress =
      progress;

    if (
      progress !== null &&
      progress >= 1
    ) {
      break;
    }

    /*
      If progress cannot be parsed,
      attempt the report endpoint.

      A completed report can be returned
      directly; an in-progress report will
      simply continue polling.
    */
    if (
      progress === null
    ) {
      try {
        const candidate =
          await getPlagiarismReport(
            reportId
          );

        const status =
          String(
            candidate
              ?.data
              ?.status ||
            ""
          )
            .trim()
            .toLowerCase();

        const percentage =
          safeNumber(
            candidate
              ?.data
              ?.percentage
          );

        if (
          status ===
            "completed" ||
          (
            percentage !==
              null &&
            percentage >= 100
          )
        ) {
          return candidate;
        }
      } catch (err) {
        /*
          HTTP 409 means Quetext is still
          processing. That is normal here.
        */
        if (
          Number(
            err?.status
          ) !== 409
        ) {
          throw err;
        }
      }
    }

    await sleep(
      pollMs
    );
  }

  return getPlagiarismReport(
    reportId
  );
}

/*
  --------------------------------------------------
  One-call convenience function
  --------------------------------------------------
*/

async function checkPlagiarism({
  text,
  title,
  pollMs,
  timeoutMs,
  onProgress
}) {
  const created =
    await createPlagiarismReport({
      text,
      title
    });

  const raw =
    await waitForPlagiarismReport(
      created.reportId,
      {
        pollMs,
        timeoutMs,
        onProgress
      }
    );

  return normalizePlagiarismReport(
    raw
  );
}

/*
  --------------------------------------------------
  Optional cleanup
  --------------------------------------------------
*/

async function deletePlagiarismReport(
  reportId
) {
  if (!reportId) {
    return null;
  }

  return quetextRequest(
    "/report/" +
      encodeURIComponent(
        reportId
      ),
    {
      method:
        "DELETE"
    }
  );
}

/*
  --------------------------------------------------
  Exports
  --------------------------------------------------
*/

module.exports = {
  QUETEXT_BASE_URL,

  getQuetextPlan,

  createPlagiarismReport,

  getReportProgress,

  getPlagiarismReport,

  waitForPlagiarismReport,

  normalizePlagiarismReport,

  checkPlagiarism,

  deletePlagiarismReport
};

/*
  --------------------------------------------------
  Running this file directly performs ONLY a
  free authentication/account test.

  It does NOT start a plagiarism scan and
  therefore does not intentionally consume
  plagiarism words.
  --------------------------------------------------
*/

if (
  require.main ===
  module
) {
  (
    async () => {
      try {
        const response =
          await getQuetextPlan();

        const data =
          response?.data ||
          {};

        console.log(
          "\nQUETEXT API AUTHENTICATION: OK"
        );

        console.log(
          "Plan:",
          data
            ?.plan
            ?.name ||
          "Available"
        );

        console.log(
          "Quetext API v2 is reachable."
        );

        console.log(
          "No plagiarism scan was started."
        );
      } catch (err) {
        console.error(
          "\nQUETEXT API TEST FAILED:"
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