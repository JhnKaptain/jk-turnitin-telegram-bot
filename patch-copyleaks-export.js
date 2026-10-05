const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const target = path.resolve(
  process.cwd(),
  'bot.js'
);

if (!fs.existsSync(target)) {
  console.error('bot.js not found.');
  process.exit(1);
}

const original = fs.readFileSync(
  target,
  'utf8'
);

const eol = original.includes('\r\n')
  ? '\r\n'
  : '\n';

let src = original.replace(
  /\r\n/g,
  '\n'
);

if (
  src.includes(
    'JK_COPYLEAKS_EXPORT_PATCH_V1'
  )
) {
  console.log(
    'Copyleaks export patch already applied.'
  );
  process.exit(0);
}

if (
  !src.includes(
    'JK_COPYLEAKS_CONTROL_PATCH_V2'
  )
) {
  console.error(
    'JK_COPYLEAKS_CONTROL_PATCH_V2 was not found.'
  );
  process.exit(1);
}

if (
  !src.includes(
    'JK_MANUAL_FILTER_PATCH_V1'
  )
) {
  console.error(
    'JK_MANUAL_FILTER_PATCH_V1 was not found.'
  );
  process.exit(1);
}

const backup = path.join(
  path.dirname(target),
  `bot.js.backup-before-copyleaks-export-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}`
);

fs.copyFileSync(
  target,
  backup
);

function fail(message) {
  console.error(
    '\nCOPYLEAKS EXPORT PATCH FAILED:',
    message
  );

  console.error(
    'Your real bot.js was NOT replaced.'
  );

  console.error(
    'Backup:',
    backup
  );

  process.exit(1);
}

function insertBefore(
  anchor,
  text,
  label
) {
  const index = src.indexOf(
    anchor
  );

  if (index < 0) {
    fail(
      'Anchor not found: ' +
        (label || anchor)
    );
  }

  src =
    src.slice(0, index) +
    text +
    src.slice(index);
}

// ============================================================
// PATCH MARKER
// ============================================================

src = src.replace(
  '// JK_COPYLEAKS_CONTROL_PATCH_V2',

  '// JK_COPYLEAKS_CONTROL_PATCH_V2\n' +
    '// JK_COPYLEAKS_EXPORT_PATCH_V1'
);

// ============================================================
// ENSURE ADMIN SEES FILTER IN MANUAL MODE
//
// If you already applied the small admin patch this section
// simply does nothing.
// ============================================================

if (
  !src.includes(
    'JK_MANUAL_FILTER_ADMIN_PATCH_V1'
  )
) {
  const oldCaptionBlock = `  const caption = buildAdminDocumentCaption({
    userId,
    name,
    usernameText,
    file,
    fileNumber,
    expectedFiles: sub?.expectedFiles
  });

  try {`;

  const newCaptionBlock = `  let caption = buildAdminDocumentCaption({
    userId,
    name,
    usernameText,
    file,
    fileNumber,
    expectedFiles: sub?.expectedFiles
  });

  // JK_MANUAL_FILTER_ADMIN_PATCH_V1
  // Manual report generation must still show the client's
  // selected similarity filtering preference.
  if (
    reportSettings.reportMode ===
    REPORT_MODE_MANUAL
  ) {
    caption +=
      "\\nSimilarity filter: " +
      similarityFilterLabel(
        effectiveSimilarityFilter(file)
      );
  }

  try {`;

  if (
    src.includes(
      oldCaptionBlock
    )
  ) {
    src = src.replace(
      oldCaptionBlock,
      newCaptionBlock
    );
  }
}

// ============================================================
// EXPORT FEATURE SWITCH
// ============================================================

if (
  !src.includes(
    'const COPYLEAKS_EXPORT_ENABLED'
  )
) {
  insertBefore(
    'let reportSettings = {',

    `const COPYLEAKS_EXPORT_ENABLED = readBoolEnv(
  "COPYLEAKS_EXPORT_ENABLED",
  true
);

`,

    'reportSettings'
  );
}

// ============================================================
// DETAILED EXPORT HELPERS
// ============================================================

if (
  !src.includes(
    'function startCopyleaksDetailedExport('
  )
) {
  const handlerAnchor =
    'async function handleCopyleaksStatusWebhook(';

  const helpers = `
// ============================================================
// COPYLEAKS DETAILED EXPORT
// ============================================================

function safeCopyleaksPathPart(
  value
) {
  return (
    String(
      value || "unknown"
    )
      .replace(
        /[^A-Za-z0-9._-]/g,
        "_"
      )
      .slice(
        0,
        120
      ) ||
    "unknown"
  );
}

function ensureCopyleaksScanDir(
  scanId
) {
  const dir = path.join(
    COPYLEAKS_DATA_DIR,
    safeCopyleaksPathPart(
      scanId
    )
  );

  if (
    !fs.existsSync(dir)
  ) {
    fs.mkdirSync(
      dir,
      {
        recursive: true
      }
    );
  }

  return dir;
}

function readCopyleaksJsonFile(
  filePath
) {
  try {
    if (
      !filePath ||
      !fs.existsSync(
        filePath
      )
    ) {
      return null;
    }

    return JSON.parse(
      fs.readFileSync(
        filePath,
        "utf8"
      )
    );
  } catch {
    return null;
  }
}

function addCopyleaksResultDescriptor(
  map,
  id,
  sourceType,
  data = {}
) {
  if (
    id === null ||
    id === undefined ||
    String(id).trim() === ""
  ) {
    return;
  }

  const key =
    String(id).trim();

  if (map.has(key)) {
    return;
  }

  map.set(
    key,
    {
      id: key,

      sourceType,

      title:
        data?.title ||
        null,

      introduction:
        data?.introduction ||
        null,

      matchedWords:
        Number(
          data?.matchedWords ||
            0
        ),

      url:
        data?.url ||
        data?.metadata
          ?.finalUrl ||
        data?.metadata
          ?.canonicalUrl ||
        null,

      metadata:
        data?.metadata ||
        null,

      scanId:
        data?.scanId ||
        null,

      repositoryId:
        data?.repositoryId ||
        null,

      tags:
        Array.isArray(
          data?.tags
        )
          ? data.tags
          : []
    }
  );
}

function collectAlertResultIds(
  value,
  map,
  sourceType = "aiDetection"
) {
  if (
    value === null ||
    value === undefined
  ) {
    return;
  }

  if (
    Array.isArray(value)
  ) {
    for (
      const item of value
    ) {
      collectAlertResultIds(
        item,
        map,
        sourceType
      );
    }

    return;
  }

  if (
    typeof value !==
    "object"
  ) {
    return;
  }

  for (
    const [
      key,
      child
    ] of Object.entries(
      value
    )
  ) {
    const normalizedKey =
      String(key)
        .replace(
          /[_-]/g,
          ""
        )
        .toLowerCase();

    if (
      normalizedKey ===
      "resultid"
    ) {
      addCopyleaksResultDescriptor(
        map,
        child,
        sourceType
      );
    }

    if (
      normalizedKey ===
        "resultids" &&
      Array.isArray(child)
    ) {
      for (
        const resultId of child
      ) {
        addCopyleaksResultDescriptor(
          map,
          resultId,
          sourceType
        );
      }
    }

    collectAlertResultIds(
      child,
      map,
      sourceType
    );
  }
}

function collectCopyleaksResultDescriptors(
  payload
) {
  const resultMap =
    new Map();

  const root =
    payload?.results ||
    {};

  const groups = [
    [
      "internet",
      root.internet
    ],

    [
      "database",
      root.database
    ],

    [
      "batch",
      root.batch
    ],

    [
      "repositories",
      root.repositories
    ],

    [
      "internalAIData",
      root.internalAIData
    ]
  ];

  for (
    const [
      sourceType,
      rows
    ] of groups
  ) {
    for (
      const row of
        Array.isArray(rows)
          ? rows
          : []
    ) {
      addCopyleaksResultDescriptor(
        resultMap,
        row?.id,
        sourceType,
        row
      );
    }
  }

  /*
    AI Detection may expose its detailed export result ID
    through the AI alert's additionalData.

    Preserve standard plagiarism result IDs above, then inspect
    AI alert metadata for resultId/resultIds without guessing
    unrelated numeric IDs.
  */
  for (
    const alert of
      payload
        ?.notifications
        ?.alerts ||
      []
  ) {
    let additionalData =
      alert?.additionalData;

    if (
      typeof additionalData ===
      "string"
    ) {
      try {
        additionalData =
          JSON.parse(
            additionalData
          );
      } catch {
        additionalData =
          null;
      }
    }

    if (
      additionalData
    ) {
      collectAlertResultIds(
        additionalData,
        resultMap,
        String(
          alert?.code ||
            ""
        ) ===
          "suspected-ai-text"
          ? "aiDetection"
          : "alertResult"
      );
    }
  }

  return Array.from(
    resultMap.values()
  );
}

function makeCopyleaksExportId(
  scanId
) {
  return (
    "jkexp-" +

    safeCopyleaksPathPart(
      scanId
    ).slice(
      0,
      18
    ) +

    "-" +

    Date.now()
      .toString(36) +

    "-" +

    Math.random()
      .toString(36)
      .slice(
        2,
        8
      )
  ).slice(
    0,
    50
  );
}

function validCopyleaksExportSecret(
  req
) {
  const supplied =
    String(
      req.get(
        "x-jk-copyleaks-secret"
      ) || ""
    );

  return (
    Boolean(
      COPYLEAKS_WEBHOOK_SECRET
    ) &&
    supplied ===
      COPYLEAKS_WEBHOOK_SECRET
  );
}

async function startCopyleaksDetailedExport(
  job,
  file,
  completedPayload
) {
  if (
    !COPYLEAKS_EXPORT_ENABLED
  ) {
    return null;
  }

  if (
    !file?.copyleaksScanId
  ) {
    return null;
  }

  if (
    file.copyleaksExportId &&
    [
      "REQUESTED",
      "RECEIVING",
      "COMPLETE"
    ].includes(
      String(
        file.copyleaksExportStatus ||
          ""
      )
    )
  ) {
    return file.copyleaksExportId;
  }

  const token =
    await getCopyleaksToken();

  const scanId =
    String(
      file.copyleaksScanId
    );

  const exportId =
    makeCopyleaksExportId(
      scanId
    );

  const descriptors =
    collectCopyleaksResultDescriptors(
      completedPayload
    );

  const publicBase =
    String(
      PUBLIC_BASE_URL ||
        ""
    ).replace(
      /\\/+$/,
      ""
    );

  const exportBase =
    publicBase +
    "/copyleaks-export/" +
    encodeURIComponent(
      scanId
    ) +
    "/" +
    encodeURIComponent(
      exportId
    );

  const secureHeaders = [
    [
      "x-jk-copyleaks-secret",
      COPYLEAKS_WEBHOOK_SECRET
    ]
  ];

  const body = {
    completionWebhook:
      exportBase +
      "/completed?secret=" +
      encodeURIComponent(
        COPYLEAKS_WEBHOOK_SECRET
      ),

    maxRetries: 3,

    developerPayload:
      JSON.stringify({
        jobId:
          job?.jobId ||
          null,

        userId:
          job?.userId ||
          null,

        scanId
      }),

    crawledVersion: {
      endpoint:
        exportBase +
        "/crawled",

      verb:
        "PUT",

      headers:
        secureHeaders
    },

    results:
      descriptors.map(
        (descriptor) => ({
          id:
            descriptor.id,

          endpoint:
            exportBase +
            "/result/" +
            encodeURIComponent(
              descriptor.id
            ),

          verb:
            "PUT",

          headers:
            secureHeaders
        })
      )
  };

  await copyleaksJson(
    COPYLEAKS_API_BASE +
      "/v3/downloads/" +
      encodeURIComponent(
        scanId
      ) +
      "/export/" +
      encodeURIComponent(
        exportId
      ),

    {
      method:
        "POST",

      headers: {
        Authorization:
          "Bearer " +
          token,

        "Content-Type":
          "application/json",

        Accept:
          "application/json"
      },

      body:
        JSON.stringify(
          body
        )
    }
  );

  file.copyleaksExportId =
    exportId;

  file.copyleaksExportStatus =
    "REQUESTED";

  file.copyleaksExportRequestedAt =
    Date.now();

  file.copyleaksResultDescriptors =
    descriptors;

  file.copyleaksDetailedResultFiles =
    {};

  savePaidJobs();

  return exportId;
}

function writeCopyleaksBundle(
  scanId
) {
  const found =
    findJobFileByCopyleaksScanId(
      scanId
    );

  if (!found) {
    return null;
  }

  const {
    job,
    file
  } = found;

  const scanDir =
    ensureCopyleaksScanDir(
      scanId
    );

  const completion =
    readCopyleaksJsonFile(
      file.copyleaksCompletedFile
    );

  const crawled =
    readCopyleaksJsonFile(
      file.copyleaksCrawledFile
    );

  const resultDetails =
    (
      file
        .copyleaksResultDescriptors ||
      []
    ).map(
      (descriptor) => {
        const resultPath =
          file
            .copyleaksDetailedResultFiles
            ?.[descriptor.id] ||
          null;

        return {
          descriptor,

          result:
            readCopyleaksJsonFile(
              resultPath
            )
        };
      }
    );

  const bundle = {
    generatedAt:
      new Date()
        .toISOString(),

    scanId,

    exportId:
      file.copyleaksExportId ||
      null,

    job: {
      jobId:
        job.jobId ||
        null,

      userId:
        job.userId ||
        null,

      paidAt:
        job.paidAt ||
        null,

      route:
        job.route ||
        null
    },

    reportIdentity: {
      jkSubmissionId:
        file.jkSubmissionId ||
        null,

      reportName:
        file.reportName ||
        null,

      institution:
        file.reportInstitution ||
        reportSettings
          .institution,

      filename:
        file.file_name ||
        null,

      similarityFilter:
        effectiveSimilarityFilter(
          file
        )
    },

    completion,

    crawled,

    results:
      resultDetails
  };

  const bundlePath =
    path.join(
      scanDir,
      "bundle.json"
    );

  fs.writeFileSync(
    bundlePath,

    JSON.stringify(
      bundle,
      null,
      2
    ),

    "utf8"
  );

  file.copyleaksBundleFile =
    bundlePath;

  file.copyleaksBundleUpdatedAt =
    Date.now();

  savePaidJobs();

  return bundlePath;
}

`;

  insertBefore(
    handlerAnchor,
    helpers,
    'handleCopyleaksStatusWebhook'
  );
}

// ============================================================
// START DETAILED EXPORT AFTER COMPLETED WEBHOOK
// ============================================================

if (
  !src.includes(
    'JK_COPYLEAKS_START_EXPORT_ON_COMPLETE'
  )
) {
  const functionStart =
    src.indexOf(
      'async function handleCopyleaksStatusWebhook('
    );

  if (
    functionStart < 0
  ) {
    fail(
      'Copyleaks status handler not found.'
    );
  }

  const completedMessageIndex =
    src.indexOf(
      'COPYLEAKS SCAN COMPLETE',
      functionStart
    );

  if (
    completedMessageIndex < 0
  ) {
    fail(
      'COPYLEAKS SCAN COMPLETE message not found.'
    );
  }

  const adminMessageStart =
    src.lastIndexOf(
      'await sendAdminMessage(',
      completedMessageIndex
    );

  if (
    adminMessageStart < 0 ||
    adminMessageStart <
      functionStart
  ) {
    fail(
      'Completed admin notification anchor not found.'
    );
  }

  const exportStartBlock = `    // JK_COPYLEAKS_START_EXPORT_ON_COMPLETE
    if (
      COPYLEAKS_EXPORT_ENABLED
    ) {
      try {
        await startCopyleaksDetailedExport(
          job,
          file,
          payload
        );
      } catch (err) {
        file.copyleaksExportStatus =
          "FAILED";

        file.copyleaksExportError =
          String(
            err?.message ||
              err
          );

        savePaidJobs();

        await sendAdminMessage(
          "Copyleaks detailed export could not start.\\n" +
          "File: " +
          safeText(
            file.file_name ||
              "N/A"
          ) +
          "\\nError: " +
          safeText(
            err?.message ||
              err
          )
        );
      }
    }

`;

  src =
    src.slice(
      0,
      adminMessageStart
    ) +
    exportStartBlock +
    src.slice(
      adminMessageStart
    );
}

// ============================================================
// RECEIVE CRAWLED VERSION + EACH DETAILED RESULT
// ============================================================

if (
  !src.includes(
    '/copyleaks-export/:scanId/:exportId/crawled'
  )
) {
  const rootRouteRegex =
    /app\.get\(\s*["']\/["']\s*,/;

  const routeMatch =
    rootRouteRegex.exec(src);

  if (!routeMatch) {
    fail(
      'Express root route was not found.'
    );
  }

  const routeIndex =
    routeMatch.index;

  const exportRoutes = `
app.put(
  "/copyleaks-export/:scanId/:exportId/crawled",
  (req, res) => {
    if (
      !validCopyleaksExportSecret(
        req
      )
    ) {
      return res
        .status(401)
        .json({
          ok: false
        });
    }

    const scanId =
      String(
        req.params.scanId ||
          ""
      );

    const exportId =
      String(
        req.params.exportId ||
          ""
      );

    const found =
      findJobFileByCopyleaksScanId(
        scanId
      );

    if (!found) {
      return res
        .status(404)
        .json({
          ok: false,
          error:
            "Unknown scan"
        });
    }

    try {
      const scanDir =
        ensureCopyleaksScanDir(
          scanId
        );

      const crawledPath =
        path.join(
          scanDir,
          "crawled.json"
        );

      fs.writeFileSync(
        crawledPath,

        JSON.stringify(
          req.body || {},
          null,
          2
        ),

        "utf8"
      );

      found.file
        .copyleaksCrawledFile =
        crawledPath;

      found.file
        .copyleaksExportId =
        exportId;

      found.file
        .copyleaksExportStatus =
        "RECEIVING";

      savePaidJobs();

      writeCopyleaksBundle(
        scanId
      );

      return res
        .status(200)
        .json({
          ok: true
        });
    } catch (err) {
      console.error(
        "Copyleaks crawled export save failed:",
        err?.message ||
          err
      );

      return res
        .status(500)
        .json({
          ok: false
        });
    }
  }
);

app.put(
  "/copyleaks-export/:scanId/:exportId/result/:resultId",
  (req, res) => {
    if (
      !validCopyleaksExportSecret(
        req
      )
    ) {
      return res
        .status(401)
        .json({
          ok: false
        });
    }

    const scanId =
      String(
        req.params.scanId ||
          ""
      );

    const exportId =
      String(
        req.params.exportId ||
          ""
      );

    const resultId =
      String(
        req.params.resultId ||
          ""
      );

    const found =
      findJobFileByCopyleaksScanId(
        scanId
      );

    if (!found) {
      return res
        .status(404)
        .json({
          ok: false,
          error:
            "Unknown scan"
        });
    }

    try {
      const scanDir =
        ensureCopyleaksScanDir(
          scanId
        );

      const resultPath =
        path.join(
          scanDir,

          "result-" +
            safeCopyleaksPathPart(
              resultId
            ) +
            ".json"
        );

      fs.writeFileSync(
        resultPath,

        JSON.stringify(
          req.body || {},
          null,
          2
        ),

        "utf8"
      );

      found.file
        .copyleaksExportId =
        exportId;

      found.file
        .copyleaksExportStatus =
        "RECEIVING";

      found.file
        .copyleaksDetailedResultFiles =
        found.file
          .copyleaksDetailedResultFiles ||
        {};

      found.file
        .copyleaksDetailedResultFiles[
          resultId
        ] =
        resultPath;

      savePaidJobs();

      writeCopyleaksBundle(
        scanId
      );

      return res
        .status(200)
        .json({
          ok: true
        });
    } catch (err) {
      console.error(
        "Copyleaks result export save failed:",
        err?.message ||
          err
      );

      return res
        .status(500)
        .json({
          ok: false
        });
    }
  }
);

app.post(
  "/copyleaks-export/:scanId/:exportId/completed",
  (req, res) => {
    const suppliedSecret =
      String(
        req.query.secret ||
          ""
      );

    if (
      !COPYLEAKS_WEBHOOK_SECRET ||
      suppliedSecret !==
        COPYLEAKS_WEBHOOK_SECRET
    ) {
      return res
        .status(401)
        .json({
          ok: false
        });
    }

    const scanId =
      String(
        req.params.scanId ||
          ""
      );

    const exportId =
      String(
        req.params.exportId ||
          ""
      );

    const found =
      findJobFileByCopyleaksScanId(
        scanId
      );

    /*
      Respond immediately so Copyleaks does not wait while
      we create/update the local bundle.
    */
    res
      .status(200)
      .json({
        ok: true
      });

    setImmediate(
      async () => {
        if (!found) {
          return;
        }

        try {
          const payload =
            req.body ||
            {};

          const tasks =
            Array.isArray(
              payload?.tasks
            )
              ? payload.tasks
              : [];

          const tasksHealthy =
            tasks.every(
              (task) => {
                const statusCode =
                  Number(
                    task
                      ?.httpStatusCode
                  );

                return (
                  task?.isHealthy ===
                    true &&
                  statusCode >= 200 &&
                  statusCode < 300
                );
              }
            );

          const exportHealthy =
            payload?.completed ===
              true &&
            tasksHealthy;

          found.file
            .copyleaksExportId =
            exportId;

          found.file
            .copyleaksExportCompletedAt =
            Date.now();

          found.file
            .copyleaksExportStatus =
            exportHealthy
              ? "COMPLETE"
              : "FAILED";

          found.file
            .copyleaksExportCompletion =
            payload;

          const bundlePath =
            writeCopyleaksBundle(
              scanId
            );

          savePaidJobs();

          await sendAdminMessage(
            (
              exportHealthy
                ? "COPYLEAKS DETAILED DATA COMPLETE"
                : "COPYLEAKS DETAILED DATA FAILED"
            ) +
              "\\nFile: " +
              safeText(
                found.file
                  .file_name ||
                  "N/A"
              ) +
              "\\nBundle ready: " +
              (
                bundlePath
                  ? "YES"
                  : "NO"
              )
          );
        } catch (err) {
          console.error(
            "Copyleaks export completion processing failed:",
            err?.message ||
              err
          );
        }
      }
    );
  }
);

`;

  src =
    src.slice(
      0,
      routeIndex
    ) +
    exportRoutes +
    src.slice(
      routeIndex
    );
}

// ============================================================
// BUILD CANDIDATE FILE
// ============================================================

const output =
  eol === '\r\n'
    ? src.replace(
        /\n/g,
        '\r\n'
      )
    : src;

const candidatePath =
  path.join(
    path.dirname(target),
    `.bot-copyleaks-export-candidate-${Date.now()}.js`
  );

fs.writeFileSync(
  candidatePath,
  output,
  'utf8'
);

// ============================================================
// IMPORTANT SAFETY CHECK
//
// The real bot.js is NOT touched unless Node confirms that the
// entire patched candidate is syntactically valid.
// ============================================================

const syntaxCheck =
  spawnSync(
    process.execPath,
    [
      '--check',
      candidatePath
    ],
    {
      encoding:
        'utf8'
    }
  );

if (
  syntaxCheck.status !== 0
) {
  console.error(
    '\nCandidate bot failed syntax validation.'
  );

  if (
    syntaxCheck.stdout
  ) {
    console.error(
      syntaxCheck.stdout
    );
  }

  if (
    syntaxCheck.stderr
  ) {
    console.error(
      syntaxCheck.stderr
    );
  }

  try {
    fs.unlinkSync(
      candidatePath
    );
  } catch {}

  fail(
    'Candidate syntax check failed.'
  );
}

// ============================================================
// ONLY NOW REPLACE REAL BOT.JS
// ============================================================

fs.writeFileSync(
  target,
  output,
  'utf8'
);

try {
  fs.unlinkSync(
    candidatePath
  );
} catch {}

console.log(
  'Copyleaks detailed export patch applied successfully.'
);

console.log(
  'Candidate syntax check: PASSED'
);

console.log(
  'Backup:',
  backup
);

console.log(
  'COPYLEAKS_ENABLED=false means this integration remains dormant.'
);

console.log(
  'Next: node --check bot.js'
);