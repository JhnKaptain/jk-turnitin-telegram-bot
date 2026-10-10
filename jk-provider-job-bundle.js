"use strict";

const fs = require("fs");
const path = require("path");

const {
  runProviderPipeline
} = require("./jk-provider-pipeline");

function text(value) {
  return String(
    value == null
      ? ""
      : value
  ).trim();
}

function numberOrNull(value) {
  const n = Number(value);

  return Number.isFinite(n) &&
    n > 0
    ? n
    : null;
}

/*
  JK_PROVIDER_JOB_BUNDLE_V1

  Adds bot/job/report identity around the canonical
  provider-neutral Quetext/Sapling result.

  canonicalDocument      = original document truth
  similarityDetection    = Quetext
  aiDetection            = Sapling
*/
async function buildProviderJobBundle({
  sourcePath,
  outputPath,

  job = {},
  file = {},
  reportSettings = {},

  similarityMode = "FILTERED",

  runSimilarity = true,
  runAi = true,

  live = false
} = {}) {
  if (!sourcePath) {
    throw new Error(
      "sourcePath is required."
    );
  }

  sourcePath =
    path.resolve(
      sourcePath
    );

  if (
    !fs.existsSync(
      sourcePath
    )
  ) {
    throw new Error(
      "Source document not found: " +
      sourcePath
    );
  }

  outputPath =
    path.resolve(
      outputPath ||
      path.join(
        path.dirname(sourcePath),
        live
          ? "provider-bundle-live.json"
          : "provider-bundle-dry.json"
      )
    );

  fs.mkdirSync(
    path.dirname(outputPath),
    {
      recursive: true
    }
  );

  const result =
    await runProviderPipeline({
      sourcePath,

      similarityMode,

      runSimilarity,
      runAi,

      live,

      outputPath
    });

  /*
    Preserve the exact bot identity fields instead
    of allowing provider data to replace them.
  */
  /*
    Prefer real identity attached to the job
    instead of any historical/generated fallback.
  */
  const reportName =
    text(
      file.studentName
    ) ||
    text(
      job.name
    ) ||
    text(
      file.reportName
    ) ||
    null;

  const institution =
    text(
      file.reportInstitution
    ) ||
    text(
      reportSettings.institution
    ) ||
    null;

  const submittedAt =
    numberOrNull(
      file.uploadedAt
    ) ||
    numberOrNull(
      job.paidAt
    );

  result.job = {
    jobId:
      text(job.jobId) ||
      null,

    userId:
      job.userId ??
      null,

    paidAt:
      numberOrNull(
        job.paidAt
      ),

    route:
      text(job.route) ||
      null,

    name:
      text(job.name) ||
      null,

    username:
      text(job.username) ||
      null
  };

  result.reportIdentity = {
    /*
      Existing visible submission ID.
    */
    jkSubmissionId:
      text(
        file.jkSubmissionId
      ) ||
      null,

    /*
      Existing report/student name used by
      the renderer.
    */
    reportName,

    /*
      Explicit aliases retained for future
      renderer/UI use as well.
    */
    studentName:
      text(
        file.studentName
      ) ||
      reportName,

    institution,

    filename:
      text(
        file.file_name ||
        file.fileName
      ) ||
      path.basename(
        sourcePath
      ),

    fileSize:
      numberOrNull(
        file.file_size ||
        file.fileSize
      ) ||
      fs.statSync(
        sourcePath
      ).size,

    originalFilePath:
      sourcePath,

    similarityFilter:
      text(
        similarityMode
      ).toUpperCase(),

    serviceType:
      text(
        file.type
      ).toUpperCase() ||
      "CHECK",

    submittedAt,

    paidAt:
      numberOrNull(
        job.paidAt
      ),

    assignment:
      text(
        file.assignment ||
        file.assignmentName
      ) ||
      null,

    course:
      text(
        file.course ||
        file.courseName
      ) ||
      null
  };

  /*
    Rewrite the output because runProviderPipeline()
    writes its initial result before bot identity is
    attached.
  */
  fs.writeFileSync(
    outputPath,

    JSON.stringify(
      result,
      null,
      2
    ),

    "utf8"
  );

  return result;
}

module.exports = {
  buildProviderJobBundle
};
