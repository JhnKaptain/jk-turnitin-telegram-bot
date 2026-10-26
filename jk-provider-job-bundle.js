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
,
  onQuetextSubmitted = null,
  referenceBoundaryOverrides = file.referenceBoundaryOverrides || []
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

  // JK_STRICT_PROVIDER_IDENTITY_V1
  const submissionId =
    text(
      file.jkSubmissionId
    );

  const reportName =
    text(
      file.reportName
    );

  const institution =
    text(
      file.reportInstitution
    );

  const serviceType =
    text(
      file.type
    )
      .trim()
      .toUpperCase();

  const identitySimilarityMode =
    text(
      file.similarityFilter
    )
      .trim()
      .toUpperCase();

  const requestedSimilarityMode =
    text(
      similarityMode
    )
      .trim()
      .toUpperCase();

  const approvedReportNames =
    [
      "Author Author",
      "User User",
      "Jabbar Mutlaq"
    ];

  const approvedInstitutions =
    [
      "Arsi University",
      "University of Anbar",
      "Oromia State University"
    ];

  if (
    !/^trn:oid:::1:[1-9]\d{9}$/.test(
      submissionId
    )
  ) {
    throw new Error(
      "Provider bundle rejected invalid Submission ID: " +
      submissionId
    );
  }

  if (
    !approvedReportNames.includes(
      reportName
    )
  ) {
    throw new Error(
      "Provider bundle rejected report name: " +
      reportName
    );
  }

  if (
    !approvedInstitutions.includes(
      institution
    )
  ) {
    throw new Error(
      "Provider bundle rejected institution: " +
      institution
    );
  }

  if (
    ![
      "FILTERED",
      "UNFILTERED"
    ].includes(
      identitySimilarityMode
    )
  ) {
    throw new Error(
      "Provider bundle rejected similarity filter: " +
      identitySimilarityMode
    );
  }

  if (
    requestedSimilarityMode !==
    identitySimilarityMode
  ) {
    throw new Error(
      "Provider bundle similarity policy mismatch: file=" +
      identitySimilarityMode +
      ", requested=" +
      requestedSimilarityMode
    );
  }

  if (
    ![
      "CHECK",
      "RECHECK",
      "SIMILARITY",
      "RESALE"
    ].includes(
      serviceType
    )
  ) {
    throw new Error(
      "Provider bundle rejected service type: " +
      serviceType
    );
  }

  const templateProfile = require("./jk-report-template-profiles.cjs").profileFields(file);

  const result =
    await runProviderPipeline({
      sourcePath,
      onQuetextSubmitted,

      similarityMode,

      runSimilarity,
      runAi,

      live,

      outputPath,
      referenceBoundaryOverrides
    });

  /*
    Preserve the exact bot identity fields instead
    of allowing provider data to replace them.
  */
  /*
    Prefer real identity attached to the job
    instead of any historical/generated fallback.
  */


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
    templateProfile,
    /*
      Existing visible submission ID.
    */
    jkSubmissionId:
      submissionId,

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
      identitySimilarityMode,

    serviceType:
      serviceType,

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

  // JK_STRICT_BUNDLE_IDENTITY_V1
  result.reportIdentity.jkSubmissionId =
    submissionId;

  result.reportIdentity.reportName =
    reportName;

  result.reportIdentity.studentName =
    reportName;

  result.reportIdentity.institution =
    institution;

  result.reportIdentity.similarityFilter =
    identitySimilarityMode;

  result.reportIdentity.serviceType =
    serviceType;


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
