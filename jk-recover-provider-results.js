"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");

function normalize(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

function indexedText(value) {
  let text = "";
  const starts = [], ends = [];

  for (const match of value.matchAll(/\S+|\s+/gu)) {
    if (/^\s/u.test(match[0])) {
      text += " ";
      starts.push(match.index);
      ends.push(match.index + match[0].length);
    } else {
      for (let i = 0; i < match[0].length; i++) {
        text += match[0][i];
        starts.push(match.index + i);
        ends.push(match.index + i + 1);
      }
    }
  }

  return { text, starts, ends };
}

function candidates(input, target, reported, radius = 512) {
  const haystack = indexedText(input);
  const needle = normalize(target);
  const found = [];

  if (!needle) return found;

  let at = 0;

  while ((at = haystack.text.indexOf(needle, at)) !== -1) {
    const start = haystack.starts[at];
    const end = haystack.ends[at + needle.length - 1];

    if (Math.abs(start - reported) <= radius) {
      found.push({ start, end });
    }

    at++;
  }

  return found;
}

function dependencies() {
  return {
    ...require("./jk-match-offsets.js"),
    ...require("./jk-ai-match-offsets.js"),
    ...require("./jk-scan-text.js"),
    ...require("./jk-provider-pipeline.js")
  };
}

function recover(checkpoint, selections, deps) {
  assert.equal(checkpoint.version, 1, "Unsupported checkpoint version.");
  assert.equal(typeof checkpoint.canonicalDocument?.text, "string");

  const source = checkpoint.canonicalDocument.text;
  const results = JSON.parse(JSON.stringify(checkpoint.providerResults));
  const issues = [];
  const used = new Set();

  for (const name of ["similarity", "ai"]) {
    const state = results[name];

    if (state?.status !== "fulfilled") continue;

    const prepared = checkpoint.preparedInputs?.[name];

    assert.equal(typeof prepared?.text, "string", "Exact input missing.");
    assert.equal(
      prepared.map?.length,
      prepared.text.length,
      "Invalid input map."
    );

    const entries = name === "similarity"
      ? state.value.matches
      : state.value.ranges;

    assert.ok(Array.isArray(entries), "Stored match list missing.");

    entries.forEach((entry, i) => {
      const key = name + ":" + (i + 1);
      const target = name === "similarity" ? entry.text : entry.sentence;

      try {
        let aligned;

        if (selections.has(key)) {
          // Explicit selections can be distant, but must match exact returned
          // text and subsequently pass the original-source mapping checks.
          // Automatic alignment retains its 512-character search limit.
          aligned = candidates(prepared.text, target, entry.start, Infinity)
            .find(item => item.start === selections.get(key));

          assert.ok(
            aligned,
            "Selection is not a verified text occurrence."
          );

          used.add(key);
        } else {
          aligned = name === "similarity"
            ? deps.alignQuetextMatch(prepared.text, entry)
            : deps.alignSaplingRange(prepared.text, entry);
        }

        assert.equal(
          normalize(prepared.text.slice(aligned.start, aligned.end)),
          normalize(target)
        );

        const mapped = deps.mapProviderRangesToSource(
          prepared,
          [aligned],
          "utf16"
        );

        assert.ok(mapped.length, "Match maps to no source text.");

        assert.equal(
          normalize(
            mapped.map(r => source.slice(r.start, r.end)).join(" ")
          ),
          normalize(target),
          "Source mapping does not agree with returned text."
        );

        entry.start = aligned.start;
        entry.end = aligned.end;

        const verified = prepared.text.slice(aligned.start, aligned.end);

        if (name === "similarity") entry.text = verified;
        else entry.sentence = verified;
      } catch (error) {
        issues.push({
          key,
          error: error.message,
          target,
          reportedStart: entry.start,
          candidates: candidates(prepared.text, target, entry.start)
            .map(range => ({
              ...range,
              context: prepared.text.slice(
                Math.max(0, range.start - 100),
                range.end + 100
              )
            }))
        });
      }
    });
  }

  for (const key of selections.keys()) {
    if (
      !used.has(key) &&
      !issues.some(item => item.key === key)
    ) {
      throw new Error("Unknown selection: " + key);
    }
  }

  if (results.similarity?.status !== "fulfilled") {
    throw new Error(
      "No completed similarity result is stored. " +
      "Recovery cannot create a detector result."
    );
  }

  if (issues.length) return { issues };

  const similarityDetection = deps.normalizeQuetextResult(
    results.similarity.value,
    checkpoint.preparedInputs.similarity
  );

  assert.equal(
    similarityDetection.available,
    true,
    "Similarity score unavailable."
  );

  const aiDetection = results.ai?.status === "fulfilled"
    ? deps.normalizeSaplingResult(
        results.ai.value,
        checkpoint.preparedInputs.ai
      )
    : {
        available: false,
        provider: "sapling",
        percent: null,
        ranges: [],
        reason: results.ai?.error || "No stored AI result"
      };

  return { issues, similarityDetection, aiDetection };
}

function parseArgs(args) {
  const options = { selections: new Map(), rebuild: false };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];

    if (flag === "--send-admin") {
      options.sendAdmin = true;
      options.rebuild = true;
      continue;
    }

    if (flag === "--rebuild") {
      options.rebuild = true;
      continue;
    }

    if (
      !["--checkpoint", "--jobs", "--select"].includes(flag) ||
      !args[i + 1]
    ) {
      throw new Error(
        "Usage: node jk-recover-provider-results.js " +
        "--checkpoint PATH [--jobs PATH] " +
        "[--select similarity:7:6830] [--rebuild]"
      );
    }

    const value = args[++i];

    if (flag === "--select") {
      const match = /^(similarity|ai):([1-9]\d*):(\d+)$/.exec(value);

      assert.ok(
        match,
        "Use --select similarity:INDEX:START or ai:INDEX:START."
      );

      const key = match[1] + ":" + match[2];

      assert.ok(!options.selections.has(key), "Duplicate selection.");
      options.selections.set(key, Number(match[3]));
    } else {
      options[flag.slice(2)] = value;
    }
  }

  assert.ok(options.checkpoint, "--checkpoint is required.");
  return options;
}

function identityFromStore(checkpointPath, jobsPath, checkpoint) {
  const jobs = JSON.parse(fs.readFileSync(jobsPath, "utf8"));
  const bundlePath = checkpointPath.replace(
    /\.provider-results\.json$/,
    ""
  );

  assert.notEqual(
    bundlePath,
    checkpointPath,
    "Unexpected checkpoint filename."
  );

  const found = [];

  for (const job of Object.values(jobs)) {
    for (const file of job?.files || []) {
      if (
        file.providerBundleFile &&
        path.resolve(file.providerBundleFile) === bundlePath
      ) {
        found.push({ job, file });
      }
    }
  }

  assert.equal(
    found.length,
    1,
    "Cannot identify one job. Specify the correct --jobs store."
  );

  const { job, file } = found[0];
  const mode = String(file.similarityFilter).trim().toUpperCase();
  const service = String(file.type).trim().toUpperCase();

  assert.equal(mode, checkpoint.similarityMode, "Policy mismatch.");
  assert.match(
    String(file.jkSubmissionId),
    /^trn:oid:::1:[1-9]\d{9}$/
  );

  assert.ok(
    ["Author Author", "User User", "Jabbar Mutlaq"]
      .includes(file.reportName)
  );

  assert.ok(
    ["Arsi University", "University of Anbar", "Oromia State University"]
      .includes(file.reportInstitution)
  );

  assert.ok(
    ["CHECK", "RECHECK", "SIMILARITY", "RESALE"].includes(service)
  );

  const positive = value =>
    Number(value) > 0 ? Number(value) : null;

  return {
    job: {
      jobId: job.jobId,
      userId: job.userId,
      paidAt: positive(job.paidAt),
      route: job.route,
      name: job.name,
      username: job.username
    },
    reportIdentity: {
      jkSubmissionId: file.jkSubmissionId,
      reportName: file.reportName,
      studentName: file.reportName,
      institution: file.reportInstitution,
      filename: file.file_name || file.fileName ||
        path.basename(checkpoint.sourcePath),
      fileSize: positive(file.file_size || file.fileSize) ||
        fs.statSync(checkpoint.sourcePath).size,
      originalFilePath: checkpoint.sourcePath,
      similarityFilter: mode,
      serviceType: service,
      submittedAt: positive(file.uploadedAt) || positive(job.paidAt),
      paidAt: positive(job.paidAt),
      assignment: file.assignment || file.assignmentName || null,
      course: file.course || file.courseName || null
    }
  };
}

function selfTest() {
  const deps = dependencies();
  const text =
    "Intro. repeated passage. Middle. repeated passage. End.";
  const prepared = {
    text,
    map: Array.from({ length: text.length }, (_, i) => i)
  };

  const checkpoint = {
    version: 1,
    canonicalDocument: { text },
    preparedInputs: { similarity: prepared, ai: prepared },
    providerResults: {
      similarity: {
        status: "fulfilled",
        value: {
          score: 8,
          matches: [{
            id: "test-match",
            start: 8,
            end: 25,
            text: "repeated passage.",
            source: { id: "test-source" }
          }]
        }
      },
      ai: {
        status: "fulfilled",
        value: {
          percent: 24.5,
          aiFraction: 0.245,
          score: 0.9,
          ranges: [],
          sentenceScores: []
        }
      }
    }
  };

  const original = JSON.stringify(checkpoint);
  let result = recover(checkpoint, new Map(), deps);

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].candidates.length, 2);

  const selected = text.lastIndexOf("repeated");

  result = recover(
    checkpoint,
    new Map([["similarity:1", selected]]),
    deps
  );

  assert.equal(result.issues.length, 0);
  assert.equal(result.similarityDetection.percent, 8);
  assert.equal(result.aiDetection.percent, 24.5);
  assert.equal(JSON.stringify(checkpoint), original);

  result = recover(
    checkpoint,
    new Map([["similarity:1", selected - 1]]),
    deps
  );

  assert.equal(result.issues.length, 1);

  assert.throws(() =>
    recover(checkpoint, new Map([["similarity:2", selected]]), deps)
  );

  console.log("PASS: ambiguous occurrences detected.");
  console.log("PASS: explicit verified selection accepted.");
  console.log("PASS: invalid and unknown selections rejected.");
  console.log("PASS: saved results and scores unchanged.");
  console.log("No provider requests or Telegram messages made.");
}

async function main() {
  if (process.argv[2] === "--self-test") {
    selfTest();
    return;
  }

  const options = parseArgs(process.argv.slice(2));

  if (options.sendAdmin) {
    assert.ok(process.env.BOT_TOKEN, "BOT_TOKEN is missing.");
    const adminId = Number(process.env.ADMIN_ID || "6569201830");
    assert.ok(
      Number.isSafeInteger(adminId) && adminId > 0,
      "Invalid ADMIN_ID."
    );
  }
  const checkpointPath = path.resolve(options.checkpoint);
  const checkpoint = JSON.parse(
    fs.readFileSync(checkpointPath, "utf8")
  );

  const deps = dependencies();
  const recovered = recover(checkpoint, options.selections, deps);

  if (recovered.issues.length) {
    for (const issue of recovered.issues) {
      console.log(JSON.stringify(issue, null, 2));
      console.log(
        "After reviewing context, select with --select " +
        issue.key + ":START"
      );
    }

    console.log(
      "REVIEW REQUIRED. No reports written or provider requests made."
    );

    process.exitCode = 2;
    return;
  }

  console.log("PASS: all stored positive ranges verified.");
  console.log(
    "Similarity:", recovered.similarityDetection.percent,
    "AI:", recovered.aiDetection.percent
  );

  if (!options.rebuild) {
    console.log(
      "Audit only. Add --rebuild to create PDFs. No provider requests."
    );
    return;
  }

  const jobsPath = path.resolve(
    options.jobs || path.join(
      process.env.DATA_DIR || "/var/data",
      "paidJobs.store.json"
    )
  );

  const identity = identityFromStore(
    checkpointPath,
    jobsPath,
    checkpoint
  );

  const document = checkpoint.canonicalDocument;

  const bundle = {
    generatedAt: new Date().toISOString(),
    ...identity,
    source: {
      path: checkpoint.sourcePath,
      filename: path.basename(checkpoint.sourcePath),
      type: document.sourceType,
      pdfPath: document.pdfPath,
      pages: document.pageCount,
      words: document.wordCount,
      characters: document.characterCount
    },
    canonicalDocument: document,
    preparation: {
      similarityMode: checkpoint.similarityMode,
      similarity: deps.summarizePreparedInput(
        checkpoint.preparedInputs.similarity
      ),
      ai: deps.summarizePreparedInput(checkpoint.preparedInputs.ai),
      aiEligibility: deps.aiEligibility(checkpoint.preparedInputs.ai)
    },
    similarityDetection: recovered.similarityDetection,
    aiDetection: recovered.aiDetection,
    recovery: {
      checkpointPath,
      selections: Object.fromEntries(options.selections),
      noProviderRequests: true
    }
  };

  const outputDir = fs.mkdtempSync(
    path.join(path.dirname(checkpointPath), "recovery-preview-")
  );

  const bundlePath = path.join(outputDir, "bundle.recovered.json");

  fs.writeFileSync(
    bundlePath,
    JSON.stringify(bundle, null, 2),
    "utf8"
  );

  const result = await require("./jk-report-renderer-max.js")
    .renderJkReports({ bundlePath, outputDir });

  assert.ok(
    result.similarityPath && fs.existsSync(result.similarityPath),
    "Similarity PDF not generated."
  );

  // JK_RECOVERY_SEND_ADMIN_V1
  if (options.sendAdmin) {
    const { Telegraf } = require("telegraf");
    const telegram = new Telegraf(process.env.BOT_TOKEN).telegram;
    const adminId = Number(process.env.ADMIN_ID || "6569201830");

    for (const filename of [
      result.similarityPath,
      result.aiPath
    ].filter(Boolean)) {
      assert.ok(fs.existsSync(filename), "Preview PDF missing.");

      await telegram.sendDocument(
        adminId,
        {
          source: fs.createReadStream(filename),
          filename: path.basename(filename)
        },
        {
          caption:
            "Recovered preview for admin review. Client delivery has not been triggered."
        }
      );
    }

    console.log("Recovered PDFs sent only to admin chat.");
  }

  console.log("Similarity PDF:", result.similarityPath);
  console.log(
    "AI PDF:",
    result.aiPath || result.aiUnavailableReason || "Unavailable"
  );

  console.log(
    "Preview only. Original results and job store unchanged. " +
    "No provider requests. Client delivery was not triggered."
  );
}

module.exports = { recover, candidates, parseArgs, identityFromStore };

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
