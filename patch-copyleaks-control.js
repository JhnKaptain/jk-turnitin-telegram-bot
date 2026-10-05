const fs = require('fs');
const path = require('path');

const target = path.resolve(process.cwd(), 'bot.js');
if (!fs.existsSync(target)) {
  console.error('bot.js not found in current folder:', process.cwd());
  process.exit(1);
}

const originalText = fs.readFileSync(target, 'utf8');
const originalEol = originalText.includes('\r\n') ? '\r\n' : '\n';
let src = originalText.replace(/\r\n/g, '\n');

if (src.includes('JK_COPYLEAKS_CONTROL_PATCH_V2')) {
  console.log('Patch already applied. Nothing changed.');
  process.exit(0);
}

const backup = path.join(
  path.dirname(target),
  `bot.js.backup-before-copyleaks-${new Date().toISOString().replace(/[:.]/g, '-')}`
);

fs.copyFileSync(target, backup);

function fail(msg) {
  console.error('\nPATCH FAILED:', msg);
  console.error('Backup preserved at:', backup);
  process.exit(1);
}

function replaceOnce(anchor, replacement, label) {
  const i = src.indexOf(anchor);

  if (i < 0) {
    fail(`Anchor not found: ${label || anchor.slice(0, 80)}`);
  }

  if (src.indexOf(anchor, i + anchor.length) >= 0) {
    fail(`Anchor is not unique: ${label || anchor.slice(0, 80)}`);
  }

  src = src.slice(0, i) + replacement + src.slice(i + anchor.length);
}

function replaceAllExact(anchor, replacement, minCount, label) {
  const count = src.split(anchor).length - 1;

  if (count < minCount) {
    fail(
      `Expected at least ${minCount} occurrences for ${
        label || anchor
      }, found ${count}`
    );
  }

  src = src.split(anchor).join(replacement);
}

// -----------------------------------------------------------------------------
// 1) NEW STAGE + PATCH MARKER
// -----------------------------------------------------------------------------

replaceOnce(
  'const STAGE_WAIT_FILE_TYPE = "WAIT_FILE_TYPE";\nconst STAGE_WAIT_RESELLER_CODE = "WAIT_RESELLER_CODE";',
  'const STAGE_WAIT_FILE_TYPE = "WAIT_FILE_TYPE";\nconst STAGE_WAIT_SIM_FILTER = "WAIT_SIM_FILTER";\nconst STAGE_WAIT_RESELLER_CODE = "WAIT_RESELLER_CODE";\n\n// JK_COPYLEAKS_CONTROL_PATCH_V2',
  'stage insertion'
);

// -----------------------------------------------------------------------------
// 2) REPORT SETTINGS + COPYLEAKS ENV
// -----------------------------------------------------------------------------

replaceOnce(
  'const BOT_USERS_FILE = path.join(DATA_DIR, "botUsers.store.json");',
  `const BOT_USERS_FILE = path.join(DATA_DIR, "botUsers.store.json");

const JK_REPORT_SETTINGS_FILE = path.join(
  DATA_DIR,
  "jkReportSettings.store.json"
);

const COPYLEAKS_DATA_DIR = path.join(DATA_DIR, "copyleaks");

try {
  if (!fs.existsSync(COPYLEAKS_DATA_DIR)) {
    fs.mkdirSync(COPYLEAKS_DATA_DIR, { recursive: true });
  }
} catch (err) {
  console.error(
    "Failed to create Copyleaks data dir:",
    err?.message || err
  );
}

const REPORT_MODE_MANUAL = "MANUAL";
const REPORT_MODE_APPROVAL = "ADMIN_APPROVAL";
const REPORT_MODE_AUTO = "AUTO_API";

const FILTER_MODE_CLIENT = "CLIENT_CHOICE";
const FILTER_MODE_FILTERED = "FILTERED";
const FILTER_MODE_UNFILTERED = "UNFILTERED";

const REPORT_NAMES = [
  "Fadhili Masha",
  "William Nzaka",
  "Bornvince Moses"
];

const REPORT_INSTITUTIONS = [
  "University of Embu",
  "Technical University of Mombasa"
];

const COPYLEAKS_ENABLED = readBoolEnv(
  "COPYLEAKS_ENABLED",
  false
);

const COPYLEAKS_SANDBOX = readBoolEnv(
  "COPYLEAKS_SANDBOX",
  true
);

const COPYLEAKS_EMAIL = String(
  process.env.COPYLEAKS_EMAIL || ""
).trim();

const COPYLEAKS_API_KEY = String(
  process.env.COPYLEAKS_API_KEY || ""
).trim();

const COPYLEAKS_WEBHOOK_SECRET = String(
  process.env.COPYLEAKS_WEBHOOK_SECRET || ""
).trim();

const COPYLEAKS_API_BASE =
  "https://api.copyleaks.com";

const COPYLEAKS_LOGIN_URL =
  "https://id.copyleaks.com/v3/account/login/api";

const COPYLEAKS_SENSITIVITY = Math.min(
  5,
  Math.max(
    1,
    readIntEnv("COPYLEAKS_SENSITIVITY", 5)
  )
);

const COPYLEAKS_AI_SENSITIVITY = Math.min(
  3,
  Math.max(
    1,
    readIntEnv("COPYLEAKS_AI_SENSITIVITY", 2)
  )
);

const COPYLEAKS_INDEX_TO_DB = readBoolEnv(
  "COPYLEAKS_INDEX_TO_DB",
  false
);

const COPYLEAKS_SCAN_SHARED_DB = readBoolEnv(
  "COPYLEAKS_SCAN_SHARED_DB",
  true
);

let reportSettings = {
  reportMode: [
    REPORT_MODE_MANUAL,
    REPORT_MODE_APPROVAL,
    REPORT_MODE_AUTO
  ].includes(
    String(
      process.env.REPORT_GENERATION_MODE || ""
    )
      .trim()
      .toUpperCase()
  )
    ? String(
        process.env.REPORT_GENERATION_MODE
      )
        .trim()
        .toUpperCase()
    : REPORT_MODE_MANUAL,

  filterMode: [
    FILTER_MODE_CLIENT,
    FILTER_MODE_FILTERED,
    FILTER_MODE_UNFILTERED
  ].includes(
    String(
      process.env.SIMILARITY_FILTER_MODE || ""
    )
      .trim()
      .toUpperCase()
  )
    ? String(
        process.env.SIMILARITY_FILTER_MODE
      )
        .trim()
        .toUpperCase()
    : FILTER_MODE_CLIENT,

  institution: REPORT_INSTITUTIONS.includes(
    String(
      process.env.REPORT_INSTITUTION || ""
    ).trim()
  )
    ? String(
        process.env.REPORT_INSTITUTION
      ).trim()
    : "University of Embu",

  updatedAt: Date.now()
};

function loadReportSettings() {
  try {
    if (!fs.existsSync(JK_REPORT_SETTINGS_FILE)) {
      return;
    }

    const parsed = JSON.parse(
      fs.readFileSync(
        JK_REPORT_SETTINGS_FILE,
        "utf8"
      )
    );

    if (!parsed || typeof parsed !== "object") {
      return;
    }

    if (
      [
        REPORT_MODE_MANUAL,
        REPORT_MODE_APPROVAL,
        REPORT_MODE_AUTO
      ].includes(parsed.reportMode)
    ) {
      reportSettings.reportMode =
        parsed.reportMode;
    }

    if (
      [
        FILTER_MODE_CLIENT,
        FILTER_MODE_FILTERED,
        FILTER_MODE_UNFILTERED
      ].includes(parsed.filterMode)
    ) {
      reportSettings.filterMode =
        parsed.filterMode;
    }

    if (
      REPORT_INSTITUTIONS.includes(
        parsed.institution
      )
    ) {
      reportSettings.institution =
        parsed.institution;
    }

    reportSettings.updatedAt = Number(
      parsed.updatedAt || Date.now()
    );
  } catch (err) {
    console.error(
      "Failed to load JK report settings:",
      err?.message || err
    );
  }
}

function saveReportSettings() {
  try {
    reportSettings.updatedAt = Date.now();

    fs.writeFileSync(
      JK_REPORT_SETTINGS_FILE,
      JSON.stringify(
        reportSettings,
        null,
        2
      ),
      "utf8"
    );
  } catch (err) {
    console.error(
      "Failed to save JK report settings:",
      err?.message || err
    );
  }
}

function reportModeLabel(
  mode = reportSettings.reportMode
) {
  if (mode === REPORT_MODE_MANUAL) {
    return "MANUAL ONLY";
  }

  if (mode === REPORT_MODE_AUTO) {
    return "AUTOMATIC API";
  }

  return "ADMIN APPROVAL";
}

function filterModeLabel(
  mode = reportSettings.filterMode
) {
  if (mode === FILTER_MODE_FILTERED) {
    return "ALWAYS FILTERED";
  }

  if (mode === FILTER_MODE_UNFILTERED) {
    return "ALWAYS UNFILTERED";
  }

  return "CLIENT CHOICE";
}

function generateJkSubmissionId() {
  let digits = "";

  for (let i = 0; i < 10; i += 1) {
    digits += String(
      Math.floor(Math.random() * 10)
    );
  }

  if (digits[0] === "0") {
    digits =
      String(
        Math.floor(Math.random() * 9) + 1
      ) + digits.slice(1);
  }

  return "jk:oid:::1:" + digits;
}

function chooseReportName() {
  return REPORT_NAMES[
    Math.floor(
      Math.random() * REPORT_NAMES.length
    )
  ];
}

function ensureFileReportIdentity(file) {
  if (!file) return null;

  if (!file.jkSubmissionId) {
    file.jkSubmissionId =
      generateJkSubmissionId();
  }

  if (!file.reportName) {
    file.reportName =
      chooseReportName();
  }

  if (!file.reportInstitution) {
    file.reportInstitution =
      reportSettings.institution;
  }

  return file;
}

function effectiveSimilarityFilter(file) {
  const v = String(
    file?.similarityFilter || ""
  ).toUpperCase();

  if (
    v === FILTER_MODE_FILTERED ||
    v === FILTER_MODE_UNFILTERED
  ) {
    return v;
  }

  if (
    reportSettings.filterMode ===
    FILTER_MODE_UNFILTERED
  ) {
    return FILTER_MODE_UNFILTERED;
  }

  return FILTER_MODE_FILTERED;
}

function similarityFilterLabel(value) {
  return String(
    value || ""
  ).toUpperCase() ===
    FILTER_MODE_UNFILTERED
    ? "UNFILTERED"
    : "Quotes + Bibliography";
}

loadReportSettings();

/*
  SAFETY LOCK:
  If Copyleaks itself is disabled,
  the bot is forced into MANUAL mode
  regardless of an old saved setting.
*/
if (!COPYLEAKS_ENABLED) {
  reportSettings.reportMode =
    REPORT_MODE_MANUAL;
}`,
  'settings constants'
);

// -----------------------------------------------------------------------------
// 3) ADMIN DASHBOARD + SETTINGS KEYBOARDS
// -----------------------------------------------------------------------------

replaceOnce(
`function adminDashboardKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("📢 Broadcast", "ADMIN_DASH_BROADCAST"),
      Markup.button.callback("🏷️ Discount", "ADMIN_DASH_DISCOUNT")
    ],
    [
      Markup.button.callback("📊 Broadcast Stats", "ADMIN_DASH_STATS"),
      Markup.button.callback("⚙️ Bot Status", "ADMIN_DASH_MODE")
    ],
    [
      Markup.button.callback("💬 User Support", "ADMIN_DASH_SUPPORT"),
      Markup.button.callback("📦 File Delivery", "ADMIN_DASH_DELIVERY")
    ],
    [
      Markup.button.callback("💳 Payments", "ADMIN_DASH_PAYMENTS"),
      Markup.button.callback("📋 All Commands", "ADMIN_DASH_COMMANDS")
    ],
    [Markup.button.callback("🔄 Sync Bot Name", "ADMIN_DASH_SYNCNAME")]
  ]);
}`,
`function adminDashboardKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "📢 Broadcast",
        "ADMIN_DASH_BROADCAST"
      ),
      Markup.button.callback(
        "🏷️ Discount",
        "ADMIN_DASH_DISCOUNT"
      )
    ],
    [
      Markup.button.callback(
        "📊 Broadcast Stats",
        "ADMIN_DASH_STATS"
      ),
      Markup.button.callback(
        "⚙️ Bot Status",
        "ADMIN_DASH_MODE"
      )
    ],
    [
      Markup.button.callback(
        "💬 User Support",
        "ADMIN_DASH_SUPPORT"
      ),
      Markup.button.callback(
        "📦 File Delivery",
        "ADMIN_DASH_DELIVERY"
      )
    ],
    [
      Markup.button.callback(
        "⚡ Report Generation",
        "ADMIN_DASH_REPORTS"
      ),
      Markup.button.callback(
        "🔎 Similarity Filter",
        "ADMIN_DASH_FILTERS"
      )
    ],
    [
      Markup.button.callback(
        "🏫 Institution",
        "ADMIN_DASH_INSTITUTION"
      ),
      Markup.button.callback(
        "💳 Payments",
        "ADMIN_DASH_PAYMENTS"
      )
    ],
    [
      Markup.button.callback(
        "📋 All Commands",
        "ADMIN_DASH_COMMANDS"
      )
    ],
    [
      Markup.button.callback(
        "🔄 Sync Bot Name",
        "ADMIN_DASH_SYNCNAME"
      )
    ]
  ]);
}`,
  'adminDashboardKeyboard'
);

replaceOnce(
`function adminDiscountKeyboard() {
  const rows = [];

  if (DISCOUNT_START_EAT && DISCOUNT_END_EAT && isDiscountPublicActive()) {
    rows.push([
      Markup.button.callback("🏷️ Create Discount Preview", "ADMIN_DASH_DISCOUNT_PREVIEW")
    ]);
  }

  return adminBackKeyboard(rows);
}`,
`function adminDiscountKeyboard() {
  const rows = [];

  if (
    DISCOUNT_START_EAT &&
    DISCOUNT_END_EAT &&
    isDiscountPublicActive()
  ) {
    rows.push([
      Markup.button.callback(
        "🏷️ Create Discount Preview",
        "ADMIN_DASH_DISCOUNT_PREVIEW"
      )
    ]);
  }

  return adminBackKeyboard(rows);
}

function reportModeKeyboard() {
  return adminBackKeyboard([
    [
      Markup.button.callback(
        "🧑‍💻 Manual Only",
        "REPORT_MODE_MANUAL"
      )
    ],
    [
      Markup.button.callback(
        "✅ Admin Approval",
        "REPORT_MODE_APPROVAL"
      )
    ],
    [
      Markup.button.callback(
        "⚡ Automatic API",
        "REPORT_MODE_AUTO"
      )
    ]
  ]);
}

function reportModeAutoConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "✅ ENABLE AUTO API",
        "REPORT_MODE_AUTO_CONFIRM"
      )
    ],
    [
      Markup.button.callback(
        "❌ CANCEL",
        "REPORT_MODE_AUTO_CANCEL"
      )
    ]
  ]);
}

function similarityFilterModeKeyboard() {
  return adminBackKeyboard([
    [
      Markup.button.callback(
        "👤 Client Choice",
        "FILTER_MODE_CLIENT"
      )
    ],
    [
      Markup.button.callback(
        "✅ Always Filtered",
        "FILTER_MODE_FILTERED"
      )
    ],
    [
      Markup.button.callback(
        "📄 Always Unfiltered",
        "FILTER_MODE_UNFILTERED"
      )
    ]
  ]);
}

function institutionKeyboard() {
  return adminBackKeyboard([
    [
      Markup.button.callback(
        "University of Embu",
        "INSTITUTION_EMBU"
      )
    ],
    [
      Markup.button.callback(
        "Technical University of Mombasa",
        "INSTITUTION_TUM"
      )
    ]
  ]);
}

function clientSimilarityFilterKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "✅ FILTER QUOTES + BIBLIOGRAPHY",
        "SIM_FILTER_FILTERED"
      )
    ],
    [
      Markup.button.callback(
        "📄 DO NOT FILTER",
        "SIM_FILTER_UNFILTERED"
      )
    ],
    [
      Markup.button.callback(
        "❌ Cancel document",
        "TYPE_CANCEL"
      )
    ]
  ]);
}`,
  'settings keyboards'
);

replaceOnce(
`    "🤖 Bot mode: " + (inactive ? "OFFLINE WINDOW" : "ONLINE"),
    "🏷️ Discount: " + (discountActive ? "OPEN • " + RESALE_PRICE_KES + " KES" : "CLOSED"),
    "👥 Broadcast users: " + stats.active + " active",`,
`    "🤖 Bot mode: " + (inactive ? "OFFLINE WINDOW" : "ONLINE"),
    "⚡ Reports: " + reportModeLabel(),
    "🔎 Similarity: " + filterModeLabel(),
    "🏫 Institution: " + reportSettings.institution,
    "🏷️ Discount: " + (discountActive ? "OPEN • " + RESALE_PRICE_KES + " KES" : "CLOSED"),
    "👥 Broadcast users: " + stats.active + " active",`,
  'admin dashboard status lines'
);

// -----------------------------------------------------------------------------
// 4) STORED FILE IDENTITY
// -----------------------------------------------------------------------------

replaceOnce(
`    recheckEligible: eligibility.eligible,
    recheckMatchedAt: eligibility.matchedAt,
    recheckHoursLeft: eligibility.hoursLeft
  };`,
`    recheckEligible: eligibility.eligible,
    recheckMatchedAt: eligibility.matchedAt,
    recheckHoursLeft: eligibility.hoursLeft,
    similarityFilter: null,
    pendingType: null,
    jkSubmissionId: generateJkSubmissionId(),
    reportName: chooseReportName(),
    reportInstitution: reportSettings.institution
  };`,
  'stored file fields'
);

replaceOnce(
`    "Price: " + price,
    "Filename: " + fileName
  ];`,
`    "Price: " + price,
    "Filename: " + fileName
  ];

  /*
    Do not alter the existing manual admin message
    while MANUAL mode is active.
  */
  if (
    reportSettings.reportMode !==
    REPORT_MODE_MANUAL
  ) {
    lines.push(
      "Similarity filter: " +
        similarityFilterLabel(
          effectiveSimilarityFilter(file)
        ),
      "JK Submission ID: " +
        safeText(
          file?.jkSubmissionId || "N/A"
        ),
      "Report name: " +
        safeText(
          file?.reportName || "N/A"
        ),
      "Institution: " +
        safeText(
          file?.reportInstitution ||
            reportSettings.institution
        )
    );
  }`,
  'admin document caption details'
);

// -----------------------------------------------------------------------------
// 5) CLIENT FILTERING STEP
// -----------------------------------------------------------------------------

replaceOnce(
`async function finalizeFileTypeSelection(ctx, sub, kind) {
  const file = getCurrentPendingFile(sub);`,
`async function finalizeFileTypeSelection(ctx, sub, kind) {
  const file = getCurrentPendingFile(sub);`,
  'finalize function marker'
);

replaceOnce(
`  file.type = kind;
  if (kind === "CHECK") file.price = CHECK_PRICE_KES;`,
`  ensureFileReportIdentity(file);

  file.type = kind;
  file.pendingType = null;

  if (!file.similarityFilter) {
    file.similarityFilter =
      effectiveSimilarityFilter(file);
  }

  if (kind === "CHECK") {
    file.price = CHECK_PRICE_KES;
  }`,
  'finalize file identity'
);

replaceOnce(
`async function handleFileTypeSelected(ctx, kind) {`,
`async function finalizeTypeWithFilterSelection(
  ctx,
  sub,
  kind
) {
  const file =
    getCurrentPendingFile(sub);

  if (!file) return;

  ensureFileReportIdentity(file);

  /*
    MANUAL MODE:
    preserve the current customer workflow.
    Do not ask the client a filtering question.
  */
  if (
    reportSettings.reportMode ===
    REPORT_MODE_MANUAL
  ) {
    file.similarityFilter =
      FILTER_MODE_FILTERED;

    await finalizeFileTypeSelection(
      ctx,
      sub,
      kind
    );

    return;
  }

  if (
    reportSettings.filterMode ===
    FILTER_MODE_CLIENT
  ) {
    file.pendingType = kind;
    sub.stage = STAGE_WAIT_SIM_FILTER;

    await ctx.reply(
      "🔎 *Choose similarity filtering*\\n\\n" +
      "*Filter Quotes + Bibliography*\\n" +
      "Quotations and the reference/bibliography section will not count toward the similarity percentage.\\n\\n" +
      "*Do Not Filter*\\n" +
      "All detected matching text will count toward the similarity percentage.",
      {
        parse_mode: "Markdown",
        reply_markup:
          clientSimilarityFilterKeyboard()
            .reply_markup
      }
    );

    return;
  }

  file.similarityFilter =
    reportSettings.filterMode ===
    FILTER_MODE_UNFILTERED
      ? FILTER_MODE_UNFILTERED
      : FILTER_MODE_FILTERED;

  await finalizeFileTypeSelection(
    ctx,
    sub,
    kind
  );
}

async function handleFileTypeSelected(ctx, kind) {`,
  'filter-selection helper'
);

replaceOnce(
  '      await ctx.reply(`✅ ${RESALE_LABEL_TITLE} Applied`);\n      await finalizeFileTypeSelection(ctx, sub, "RESALE");\n      return;',
  '      await ctx.reply(`✅ ${RESALE_LABEL_TITLE} Applied`);\n      await finalizeTypeWithFilterSelection(ctx, sub, "RESALE");\n      return;',
  'public resale finalization'
);

replaceOnce(
  '    sub.resellerVerified = true;\n    await ctx.reply(`✅ ${RESALE_LABEL_TITLE} Applied`);\n    await finalizeFileTypeSelection(ctx, sub, "RESALE");\n    return;',
  '    sub.resellerVerified = true;\n    await ctx.reply(`✅ ${RESALE_LABEL_TITLE} Applied`);\n    await finalizeTypeWithFilterSelection(ctx, sub, "RESALE");\n    return;',
  'reseller code filter finalization'
);

replaceOnce(
  '  } else {\n    await ctx.answerCbQuery(`${kind} selected`);\n  }\n\n  await finalizeFileTypeSelection(ctx, sub, kind);\n}',
  '  } else {\n    await ctx.answerCbQuery(`${kind} selected`);\n  }\n\n  await finalizeTypeWithFilterSelection(ctx, sub, kind);\n}',
  'normal type finalization'
);

replaceOnce(
`bot.action("TYPE_RESALE", async (ctx) => {
  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);
  await handleFileTypeSelected(ctx, "RESALE");
});

bot.action("DONE_UPLOADING", async (ctx) => {`,
`bot.action("TYPE_RESALE", async (ctx) => {
  if (isBotInactivePeriod()) {
    return notifyInactivePeriod(ctx);
  }

  await handleFileTypeSelected(
    ctx,
    "RESALE"
  );
});

bot.action(
  "SIM_FILTER_FILTERED",
  async (ctx) => {
    if (isBotInactivePeriod()) {
      return notifyInactivePeriod(ctx);
    }

    const sub =
      submissions[ctx.from.id];

    if (
      !sub ||
      sub.stage !== STAGE_WAIT_SIM_FILTER
    ) {
      return ctx.answerCbQuery(
        "No filter selection pending."
      );
    }

    const file =
      getCurrentPendingFile(sub);

    if (
      !file ||
      !file.pendingType
    ) {
      return ctx.answerCbQuery(
        "No pending file."
      );
    }

    file.similarityFilter =
      FILTER_MODE_FILTERED;

    const kind =
      file.pendingType;

    await ctx.answerCbQuery(
      "Quotes + bibliography will be filtered"
    );

    await finalizeFileTypeSelection(
      ctx,
      sub,
      kind
    );
  }
);

bot.action(
  "SIM_FILTER_UNFILTERED",
  async (ctx) => {
    if (isBotInactivePeriod()) {
      return notifyInactivePeriod(ctx);
    }

    const sub =
      submissions[ctx.from.id];

    if (
      !sub ||
      sub.stage !== STAGE_WAIT_SIM_FILTER
    ) {
      return ctx.answerCbQuery(
        "No filter selection pending."
      );
    }

    const file =
      getCurrentPendingFile(sub);

    if (
      !file ||
      !file.pendingType
    ) {
      return ctx.answerCbQuery(
        "No pending file."
      );
    }

    file.similarityFilter =
      FILTER_MODE_UNFILTERED;

    const kind =
      file.pendingType;

    await ctx.answerCbQuery(
      "Unfiltered similarity selected"
    );

    await finalizeFileTypeSelection(
      ctx,
      sub,
      kind
    );
  }
);

bot.action("DONE_UPLOADING", async (ctx) => {`,
  'filter callbacks'
);

replaceAllExact(
  'STAGE_WAIT_FILE_TYPE,\n    STAGE_WAIT_PAYMENT_METHOD,',
  'STAGE_WAIT_FILE_TYPE,\n    STAGE_WAIT_SIM_FILTER,\n    STAGE_WAIT_PAYMENT_METHOD,',
  1,
  'active submission stages'
);

replaceOnce(
`  if (sub.stage === STAGE_WAIT_FILE_TYPE || sub.stage === STAGE_WAIT_RESELLER_CODE) {
    return ctx.reply("⚠️ Choose type for the previous file first.", {`,
`  if (
    sub.stage ===
    STAGE_WAIT_SIM_FILTER
  ) {
    return ctx.reply(
      "⚠️ Choose similarity filtering for the previous file first.",
      {
        parse_mode: "Markdown",
        reply_markup:
          clientSimilarityFilterKeyboard()
            .reply_markup
      }
    );
  }

  if (sub.stage === STAGE_WAIT_FILE_TYPE || sub.stage === STAGE_WAIT_RESELLER_CODE) {
    return ctx.reply("⚠️ Choose type for the previous file first.", {`,
  'document handler filter block'
);

replaceOnce(
`  if (sub && [STAGE_WAIT_BATCH_SIZE, STAGE_WAIT_UPLOADS, STAGE_WAIT_FILE_TYPE, STAGE_WAIT_RESELLER_CODE].includes(sub.stage)) {`,
`  if (sub && [STAGE_WAIT_BATCH_SIZE, STAGE_WAIT_UPLOADS, STAGE_WAIT_FILE_TYPE, STAGE_WAIT_SIM_FILTER, STAGE_WAIT_RESELLER_CODE].includes(sub.stage)) {`,
  'photo handler stage list'
);

// -----------------------------------------------------------------------------
// 6) PERSIST IDENTITY + FILTER IN PAYMENT REFS
// -----------------------------------------------------------------------------

replaceAllExact(
`      recheckEligible: Boolean(file.recheckEligible)
    }))`,
`      recheckEligible: Boolean(file.recheckEligible),
      similarityFilter:
        effectiveSimilarityFilter(file),
      jkSubmissionId:
        file.jkSubmissionId || null,
      reportName:
        file.reportName || null,
      reportInstitution:
        file.reportInstitution ||
        reportSettings.institution
    }))`,
  3,
  'payment file mappings'
);

// -----------------------------------------------------------------------------
// 7) PAID JOBS KEEP FILES + MODE SNAPSHOT
// -----------------------------------------------------------------------------

replaceOnce(
`    phone: ref?.phone || null,
    paidAt: now,
    cancelAllowedAt,`,
`    phone: ref?.phone || null,

    files:
      Array.isArray(ref?.files)
        ? ref.files.map(
            (file, index) => ({
              ...file,
              fileIndex: index,

              similarityFilter:
                effectiveSimilarityFilter(
                  file
                ),

              jkSubmissionId:
                file.jkSubmissionId ||
                generateJkSubmissionId(),

              reportName:
                file.reportName ||
                chooseReportName(),

              reportInstitution:
                file.reportInstitution ||
                reportSettings.institution,

              copyleaksStatus:
                "NOT_SUBMITTED",

              copyleaksScanId:
                null
            })
          )
        : [],

    reportModeSnapshot:
      reportSettings.reportMode,

    route:
      reportSettings.reportMode ===
      REPORT_MODE_MANUAL
        ? "MANUAL"
        : "PENDING",

    paidAt: now,
    cancelAllowedAt,`,
  'paid job fields'
);

replaceOnce(
`  if (sub && sub.stage === STAGE_WAIT_PAYMENT_METHOD) {
    return ctx.reply("Choose payment method.", {`,
`  if (
    sub &&
    sub.stage ===
      STAGE_WAIT_SIM_FILTER
  ) {
    return ctx.reply(
      "⚠️ Choose similarity filtering first.",
      {
        reply_markup:
          clientSimilarityFilterKeyboard()
            .reply_markup
      }
    );
  }

  if (sub && sub.stage === STAGE_WAIT_PAYMENT_METHOD) {
    return ctx.reply("Choose payment method.", {`,
  'text handler filter wait'
);

// -----------------------------------------------------------------------------
// 8) PAID ADMIN BUTTONS + MANUAL/API ROUTES
// -----------------------------------------------------------------------------

replaceOnce(
`  } else if (variant === "paid") {
    rows.push([Markup.button.callback("📦 Filebatch", \`ADMIN_FILEBATCH_\${userId}\`)]);
    rows.push([Markup.button.callback("💬 Reply", \`ADMIN_REPLY_\${userId}\`)]);`,
`  } else if (variant === "paid") {
    const latestJob =
      getLatestActivePaidJob(userId);

    const paidMode =
      latestJob?.reportModeSnapshot ||
      reportSettings.reportMode;

    /*
      MANUAL mode deliberately preserves
      the existing Filebatch button.
    */
    if (
      paidMode ===
      REPORT_MODE_MANUAL
    ) {
      rows.push([
        Markup.button.callback(
          "📦 Filebatch",
          \`ADMIN_FILEBATCH_\${userId}\`
        )
      ]);
    } else if (
      paidMode ===
      REPORT_MODE_APPROVAL
    ) {
      rows.push([
        Markup.button.callback(
          "🧑‍💻 Manual",
          \`ADMIN_MANUAL_\${userId}\`
        ),
        Markup.button.callback(
          "⚡ Copyleaks API",
          \`ADMIN_COPYLEAKS_\${userId}\`
        )
      ]);

      rows.push([
        Markup.button.callback(
          "🔎 Filters",
          \`ADMIN_JOB_FILTERS_\${userId}\`
        )
      ]);
    } else {
      rows.push([
        Markup.button.callback(
          "⚡ API Status",
          \`ADMIN_COPYLEAKS_STATUS_\${userId}\`
        ),
        Markup.button.callback(
          "🧑‍💻 Manual Fallback",
          \`ADMIN_MANUAL_\${userId}\`
        )
      ]);
    }

    rows.push([
      Markup.button.callback(
        "💬 Reply",
        \`ADMIN_REPLY_\${userId}\`
      )
    ]);`,
  'paid action keyboard'
);

replaceOnce(
`bot.action(/^ADMIN_REPLY_(\\d+)$/, async (ctx) => {`,
`bot.action(
  /^ADMIN_MANUAL_(\\d+)$/,
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    const userId = ctx.match[1];

    const job =
      getLatestActivePaidJob(
        userId
      );

    if (job) {
      job.route = "MANUAL";
      job.status = "PROCESSING";
      savePaidJobs();
    }

    pendingFileTargets[
      ADMIN_ID
    ] = {
      userId,
      caption: "",
      sentCount: 0,
      sentItemKeys: {},
      inProgressItemKeys: {}
    };

    await ctx.answerCbQuery(
      "Manual delivery opened"
    );

    await ctx.reply(
      batchOpenedMessage(userId)
    );
  }
);

bot.action(
  /^ADMIN_COPYLEAKS_(\\d+)$/,
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    const userId =
      ctx.match[1];

    const job =
      getLatestActivePaidJob(
        userId
      );

    if (!job) {
      return ctx.answerCbQuery(
        "No active paid job.",
        {
          show_alert: true
        }
      );
    }

    await ctx.answerCbQuery(
      "Starting Copyleaks..."
    );

    try {
      await submitPaidJobToCopyleaks(
        job.jobId
      );

      await ctx.reply(
        "✅ Copyleaks submission started for user " +
          userId +
          "."
      );
    } catch (err) {
      await ctx.reply(
        "❌ Copyleaks submission failed: " +
          safeText(
            err?.message || err
          )
      );
    }
  }
);

bot.action(
  /^ADMIN_COPYLEAKS_STATUS_(\\d+)$/,
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    const userId =
      ctx.match[1];

    const job =
      getLatestActivePaidJob(
        userId
      );

    await ctx.answerCbQuery();

    if (!job) {
      return ctx.reply(
        "No active paid job for " +
          userId +
          "."
      );
    }

    const rows =
      (job.files || []).map(
        (f, i) =>
          \`File \${i + 1}: \${safeText(
            f.file_name || "N/A"
          )} — \${safeText(
            f.copyleaksStatus ||
              "NOT_SUBMITTED"
          )}\`
      );

    await ctx.reply(
      "⚡ COPYLEAKS STATUS\\n\\n" +
        rows.join("\\n")
    );
  }
);

bot.action(
  /^ADMIN_JOB_FILTERS_(\\d+)$/,
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    const userId =
      ctx.match[1];

    const job =
      getLatestActivePaidJob(
        userId
      );

    if (!job) {
      return ctx.answerCbQuery(
        "No active paid job.",
        {
          show_alert: true
        }
      );
    }

    const rows = [];

    for (
      let i = 0;
      i <
      (job.files || []).length;
      i += 1
    ) {
      const file =
        job.files[i];

      const current =
        effectiveSimilarityFilter(
          file
        );

      rows.push([
        Markup.button.callback(
          (
            current ===
            FILTER_MODE_FILTERED
              ? "✅ "
              : ""
          ) +
            "F" +
            (i + 1) +
            " Filtered",
          \`JOB_FILTER_F_\${userId}_\${i}\`
        ),

        Markup.button.callback(
          (
            current ===
            FILTER_MODE_UNFILTERED
              ? "✅ "
              : ""
          ) +
            "F" +
            (i + 1) +
            " Unfiltered",
          \`JOB_FILTER_U_\${userId}_\${i}\`
        )
      ]);
    }

    rows.push([
      Markup.button.callback(
        "✖ Close",
        \`ADMIN_COPYLEAKS_STATUS_\${userId}\`
      )
    ]);

    await ctx.answerCbQuery();

    await ctx.reply(
      "🔎 FILTER OVERRIDE\\n\\n" +
      "Changes are allowed only before the file is submitted to Copyleaks.",
      {
        reply_markup:
          Markup.inlineKeyboard(
            rows
          ).reply_markup
      }
    );
  }
);

bot.action(
  /^JOB_FILTER_([FU])_(\\d+)_(\\d+)$/,
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    const choice =
      ctx.match[1];

    const userId =
      ctx.match[2];

    const index =
      Number(ctx.match[3]);

    const job =
      getLatestActivePaidJob(
        userId
      );

    const file =
      job?.files?.[index];

    if (!job || !file) {
      return ctx.answerCbQuery(
        "Job/file not found.",
        {
          show_alert: true
        }
      );
    }

    if (file.copyleaksScanId) {
      return ctx.answerCbQuery(
        "Already submitted to Copyleaks.",
        {
          show_alert: true
        }
      );
    }

    file.similarityFilter =
      choice === "F"
        ? FILTER_MODE_FILTERED
        : FILTER_MODE_UNFILTERED;

    savePaidJobs();

    await ctx.answerCbQuery(
      "Filter updated"
    );

    await ctx.reply(
      "✅ File " +
        (index + 1) +
        " filter: " +
        similarityFilterLabel(
          file.similarityFilter
        )
    );
  }
);

bot.action(/^ADMIN_REPLY_(\\d+)$/, async (ctx) => {`,
  'paid route callbacks'
);

// -----------------------------------------------------------------------------
// 9) COPYLEAKS API
// -----------------------------------------------------------------------------

const expressMarker =
  '// =====================\n' +
  '// EXPRESS SERVER + WEBHOOKS\n' +
  '// =====================\n' +
  'const app = express();';

replaceOnce(
  expressMarker,
`// =====================
// COPYLEAKS API
// =====================

let copyleaksTokenCache = {
  token: null,
  expiresAt: 0
};

function assertCopyleaksConfigured() {
  if (!COPYLEAKS_ENABLED) {
    throw new Error(
      "COPYLEAKS_ENABLED is false."
    );
  }

  if (
    !COPYLEAKS_EMAIL ||
    !COPYLEAKS_API_KEY
  ) {
    throw new Error(
      "COPYLEAKS_EMAIL or COPYLEAKS_API_KEY is missing."
    );
  }

  if (
    !COPYLEAKS_WEBHOOK_SECRET
  ) {
    throw new Error(
      "COPYLEAKS_WEBHOOK_SECRET is missing."
    );
  }
}

async function copyleaksJson(
  url,
  options = {}
) {
  const res =
    await fetch(url, options);

  const text =
    await res.text();

  let body = null;

  try {
    body =
      text
        ? JSON.parse(text)
        : {};
  } catch {
    body = {
      raw: text
    };
  }

  if (!res.ok) {
    const msg =
      body?.message ||
      body?.error ||
      body?.raw ||
      (
        "HTTP " +
        res.status
      );

    throw new Error(
      "Copyleaks: " + msg
    );
  }

  return body;
}

async function getCopyleaksToken() {
  assertCopyleaksConfigured();

  const now = Date.now();

  if (
    copyleaksTokenCache.token &&
    copyleaksTokenCache.expiresAt >
      now +
        5 *
          60 *
          1000
  ) {
    return copyleaksTokenCache.token;
  }

  const data =
    await copyleaksJson(
      COPYLEAKS_LOGIN_URL,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
          Accept:
            "application/json"
        },

        body: JSON.stringify({
          email:
            COPYLEAKS_EMAIL,
          key:
            COPYLEAKS_API_KEY
        })
      }
    );

  const token = String(
    data?.access_token || ""
  ).trim();

  if (!token) {
    throw new Error(
      "Copyleaks login returned no access_token."
    );
  }

  let expiresAt =
    now +
    47 *
      60 *
      60 *
      1000;

  const expiresRaw =
    data?.[".expires"];

  if (expiresRaw) {
    const parsed =
      Date.parse(expiresRaw);

    if (
      Number.isFinite(parsed)
    ) {
      expiresAt = parsed;
    }
  }

  copyleaksTokenCache = {
    token,
    expiresAt
  };

  return token;
}

function makeCopyleaksScanId(
  job,
  fileIndex
) {
  const stamp =
    Date.now().toString(36);

  const rand =
    Math.random()
      .toString(36)
      .slice(2, 8);

  return (
    "jk-" +
    job.userId +
    "-" +
    stamp +
    "-" +
    fileIndex +
    "-" +
    rand
  )
    .toLowerCase()
    .slice(0, 36);
}

async function downloadTelegramFileBuffer(
  fileId
) {
  const link =
    await bot.telegram.getFileLink(
      fileId
    );

  const res =
    await fetch(String(link));

  if (!res.ok) {
    throw new Error(
      "Telegram file download failed: HTTP " +
        res.status
    );
  }

  return Buffer.from(
    await res.arrayBuffer()
  );
}

function shouldRunAiForFile(file) {
  return String(
    file?.type || ""
  ).toUpperCase() !==
    "SIMILARITY";
}

async function submitPaidJobToCopyleaks(
  jobId
) {
  assertCopyleaksConfigured();

  const job =
    paidJobs[jobId];

  if (!job) {
    throw new Error(
      "Paid job not found."
    );
  }

  if (
    !Array.isArray(job.files) ||
    job.files.length === 0
  ) {
    throw new Error(
      "Paid job has no stored files."
    );
  }

  const token =
    await getCopyleaksToken();

  job.route =
    "COPYLEAKS";

  job.status =
    "API_PROCESSING";

  savePaidJobs();

  for (
    let i = 0;
    i < job.files.length;
    i += 1
  ) {
    const file =
      job.files[i];

    if (
      file.copyleaksScanId &&
      [
        "SUBMITTED",
        "PROCESSING",
        "COMPLETED"
      ].includes(
        String(
          file.copyleaksStatus ||
            ""
        )
      )
    ) {
      continue;
    }

    try {
      const buffer =
        await downloadTelegramFileBuffer(
          file.file_id
        );

      const scanId =
        makeCopyleaksScanId(
          job,
          i
        );

      const filter =
        effectiveSimilarityFilter(
          file
        );

      const filtered =
        filter ===
        FILTER_MODE_FILTERED;

      const statusUrl =
        PUBLIC_BASE_URL +
        "/copyleaks/{STATUS}/" +
        encodeURIComponent(
          scanId
        );

      const payload = {
        base64:
          buffer.toString(
            "base64"
          ),

        filename:
          file.file_name ||
          (
            "submission-" +
            (i + 1) +
            ".docx"
          ),

        properties: {
          webhooks: {
            status:
              statusUrl,

            statusHeaders: [
              [
                "x-jk-copyleaks-secret",
                COPYLEAKS_WEBHOOK_SECRET
              ]
            ]
          },

          developerPayload:
            JSON.stringify({
              jobId:
                job.jobId,
              fileIndex: i,
              userId:
                job.userId
            }),

          sandbox:
            COPYLEAKS_SANDBOX,

          includeHtml: true,

          scanTimeZone:
            "Africa/Nairobi",

          sensitivityLevel:
            COPYLEAKS_SENSITIVITY,

          scanning: {
            internet: true,

            copyleaksDb: {
              includeMySubmissions:
                false,

              includeOthersSubmissions:
                COPYLEAKS_SCAN_SHARED_DB
            }
          },

          /*
            We search the Shared Data Hub
            but DO NOT add client documents
            to it unless explicitly enabled.
          */
          indexing: {
            copyleaksDb:
              COPYLEAKS_INDEX_TO_DB
          },

          /*
            FILTERED mode:
            - quotes excluded
            - bibliography/references excluded
            - citations themselves remain included
          */
          exclude: {
            quotes:
              filtered,

            references:
              filtered,

            citations:
              false
          },

          aiGeneratedText: {
            detect:
              shouldRunAiForFile(
                file
              ),

            sensitivity:
              COPYLEAKS_AI_SENSITIVITY
          }
        }
      };

      await copyleaksJson(
        COPYLEAKS_API_BASE +
          "/v3/scans/submit/file/" +
          encodeURIComponent(
            scanId
          ),
        {
          method: "PUT",

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
              payload
            )
        }
      );

      file.copyleaksScanId =
        scanId;

      file.copyleaksStatus =
        "SUBMITTED";

      file.copyleaksSubmittedAt =
        Date.now();

      file.appliedFilter =
        filter;

      savePaidJobs();
    } catch (err) {
      file.copyleaksStatus =
        "FAILED";

      file.copyleaksError =
        String(
          err?.message || err
        );

      file.copyleaksFailedAt =
        Date.now();

      savePaidJobs();

      await sendAdminMessage(
        "❌ Copyleaks submission failed\\n" +
        "User: " +
        job.userId +
        "\\nFile: " +
        safeText(
          file.file_name ||
            (
              "File " +
              (i + 1)
            )
        ) +
        "\\nError: " +
        safeText(
          err?.message || err
        )
      );
    }
  }

  return job;
}

function extractCopyleaksAiPercent(
  payload
) {
  const alert =
    (
      payload
        ?.notifications
        ?.alerts || []
    ).find(
      (a) =>
        String(
          a?.code || ""
        ) ===
        "suspected-ai-text"
    );

  if (!alert) {
    return 0;
  }

  let data =
    alert.additionalData;

  if (
    typeof data === "string"
  ) {
    try {
      data =
        JSON.parse(data);
    } catch {
      data = null;
    }
  }

  const raw =
    Number(
      data?.summary?.ai
    );

  if (
    !Number.isFinite(raw)
  ) {
    return null;
  }

  const percent =
    raw <= 1
      ? raw * 100
      : raw;

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        percent * 10
      ) / 10
    )
  );
}

function findJobFileByCopyleaksScanId(
  scanId
) {
  for (
    const job of
      Object.values(
        paidJobs || {}
      )
  ) {
    for (
      const file of
        job.files || []
    ) {
      if (
        String(
          file.copyleaksScanId ||
            ""
        ) ===
        String(
          scanId || ""
        )
      ) {
        return {
          job,
          file
        };
      }
    }
  }

  return null;
}

async function handleCopyleaksStatusWebhook(
  status,
  scanId,
  payload
) {
  const found =
    findJobFileByCopyleaksScanId(
      scanId
    );

  if (!found) {
    await sendAdminMessage(
      "⚠️ Unmatched Copyleaks webhook\\n" +
      "Scan: " +
      safeText(scanId) +
      "\\nStatus: " +
      safeText(status)
    );

    return;
  }

  const {
    job,
    file
  } = found;

  const normalized =
    String(
      status || ""
    ).toUpperCase();

  if (
    normalized ===
    "COMPLETED"
  ) {
    file.copyleaksStatus =
      "COMPLETED";

    file.copyleaksCompletedAt =
      Date.now();

    file.copyleaksSummary = {
      similarity:
        Number(
          payload
            ?.results
            ?.score
            ?.aggregatedScore ||
            0
        ),

      totalWords:
        Number(
          payload
            ?.scannedDocument
            ?.totalWords ||
            0
        ),

      totalExcluded:
        Number(
          payload
            ?.scannedDocument
            ?.totalExcluded ||
            0
        ),

      internetSources:
        Array.isArray(
          payload
            ?.results
            ?.internet
        )
          ? payload
              .results
              .internet
              .length
          : 0,

      databaseSources:
        Array.isArray(
          payload
            ?.results
            ?.database
        )
          ? payload
              .results
              .database
              .length
          : 0,

      repositorySources:
        Array.isArray(
          payload
            ?.results
            ?.repositories
        )
          ? payload
              .results
              .repositories
              .length
          : 0,

      aiAlert:
        Boolean(
          (
            payload
              ?.notifications
              ?.alerts || []
          ).some(
            (a) =>
              String(
                a?.code || ""
              ) ===
              "suspected-ai-text"
          )
        ),

      aiPercent:
        extractCopyleaksAiPercent(
          payload
        )
    };

    try {
      const rawPath =
        path.join(
          COPYLEAKS_DATA_DIR,
          scanId +
            ".completed.json"
        );

      fs.writeFileSync(
        rawPath,
        JSON.stringify(
          payload,
          null,
          2
        ),
        "utf8"
      );

      file.copyleaksCompletedFile =
        rawPath;
    } catch (err) {
      file.copyleaksStorageError =
        String(
          err?.message || err
        );
    }

    const everyDone =
      (
        job.files || []
      ).every(
        (f) =>
          String(
            f.copyleaksStatus ||
              ""
          ) ===
          "COMPLETED"
      );

    if (everyDone) {
      job.status =
        "API_SCAN_COMPLETE";
    }

    savePaidJobs();

    await sendAdminMessage(
      "✅ COPYLEAKS SCAN COMPLETE\\n" +
      "User: " +
      job.userId +
      "\\n" +
      "File: " +
      safeText(
        file.file_name || "N/A"
      ) +
      "\\n" +
      "Similarity: " +
      Number(
        file
          .copyleaksSummary
          .similarity
      )
        .toFixed(1)
        .replace(
          /\\.0$/,
          ""
        ) +
      "%\\n" +
      "Filter: " +
      similarityFilterLabel(
        file.appliedFilter
      ) +
      "\\n" +
      "AI: " +
      (
        file
          .copyleaksSummary
          .aiPercent === null
          ? "N/A"
          : String(
              file
                .copyleaksSummary
                .aiPercent
            ) + "%"
      ) +
      "\\n\\n" +
      "Raw API data has been stored for JK report rendering."
    );

    return;
  }

  if (
    normalized ===
    "ERROR"
  ) {
    file.copyleaksStatus =
      "FAILED";

    file.copyleaksFailedAt =
      Date.now();

    file.copyleaksErrorPayload =
      payload;

    savePaidJobs();

    await sendAdminMessage(
      "❌ COPYLEAKS SCAN ERROR\\n" +
      "User: " +
      job.userId +
      "\\nFile: " +
      safeText(
        file.file_name ||
          "N/A"
      )
    );

    return;
  }

  file.copyleaksStatus =
    normalized ||
    "PROCESSING";

  file.copyleaksLastWebhookAt =
    Date.now();

  savePaidJobs();
}

// =====================
// EXPRESS SERVER + WEBHOOKS
// =====================
const app = express();`,
  'Copyleaks helper insertion'
);

replaceOnce(
  'limit: "2mb",',
  'limit: "15mb",',
  'Express JSON body limit'
);

// -----------------------------------------------------------------------------
// COPYLEAKS STATUS WEBHOOK
// -----------------------------------------------------------------------------

replaceOnce(
`app.get("/", (req, res) => res.status(200).send("OK"));`,
`app.post(
  "/copyleaks/:status/:scanId",
  (req, res) => {
    const suppliedSecret =
      String(
        req.get(
          "x-jk-copyleaks-secret"
        ) || ""
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

    res
      .status(200)
      .json({
        ok: true
      });

    const status =
      req.params.status;

    const scanId =
      req.params.scanId;

    const payload =
      req.body || {};

    setImmediate(
      async () => {
        try {
          await handleCopyleaksStatusWebhook(
            status,
            scanId,
            payload
          );
        } catch (err) {
          console.error(
            "Copyleaks webhook processing failed:",
            err?.message ||
              err
          );
        }
      }
    );
  }
);

app.get("/", (req, res) => res.status(200).send("OK"));`,
  'Copyleaks webhook route'
);

// -----------------------------------------------------------------------------
// HEALTH INFO
// -----------------------------------------------------------------------------

replaceOnce(
`    paidJobs: Object.keys(paidJobs).length,`,
`    paidJobs: Object.keys(paidJobs).length,

    reportGenerationMode:
      reportSettings.reportMode,

    similarityFilterMode:
      reportSettings.filterMode,

    reportInstitution:
      reportSettings.institution,

    copyleaksEnabled:
      COPYLEAKS_ENABLED,

    copyleaksSandbox:
      COPYLEAKS_SANDBOX,

    copyleaksScanSharedDb:
      COPYLEAKS_SCAN_SHARED_DB,

    copyleaksIndexToDb:
      COPYLEAKS_INDEX_TO_DB,

    copyleaksConfigured:
      Boolean(
        COPYLEAKS_EMAIL &&
        COPYLEAKS_API_KEY &&
        COPYLEAKS_WEBHOOK_SECRET
      ),`,
  'health diagnostics'
);

// -----------------------------------------------------------------------------
// 10) ADMIN COMMANDS
// -----------------------------------------------------------------------------

replaceOnce(
`    "Discount + bot",
    "/discountmode - Check discount mode",
    "/mode - Check bot operating status",
    "/syncname - Force bot display-name sync",`,
`    "Discount + bot",
    "/discountmode - Check discount mode",
    "/mode - Check bot operating status",
    "/syncname - Force bot display-name sync",
    "",
    "Report generation",
    "/reportmode - Manual / Admin Approval / Automatic API",
    "/filtermode - Client choice / Always filtered / Always unfiltered",
    "/institution - Select report institution",
    "/copyleaksstatus - Show Copyleaks configuration status",`,
  'admin commands text'
);

replaceOnce(
`    { command: "syncname", description: "Sync bot display name" },
    { command: "reply", description: "Reply to a user" },`,
`    { command: "syncname", description: "Sync bot display name" },
    { command: "reportmode", description: "Set report generation mode" },
    { command: "filtermode", description: "Set similarity filtering mode" },
    { command: "institution", description: "Set report institution" },
    { command: "copyleaksstatus", description: "Check Copyleaks API status" },
    { command: "reply", description: "Reply to a user" },`,
  'Telegram admin command menu'
);

replaceOnce(
`bot.action("ADMIN_DASH_HOME", async (ctx) => {`,
`bot.command(
  "reportmode",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return;
    }

    await ctx.reply(
      "⚙️ REPORT GENERATION\\n\\n" +
      "Current Mode: " +
      reportModeLabel(),
      {
        reply_markup:
          reportModeKeyboard()
            .reply_markup
      }
    );
  }
);

bot.command(
  "filtermode",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return;
    }

    await ctx.reply(
      "🔎 SIMILARITY FILTERING\\n\\n" +
      "Current Mode: " +
      filterModeLabel(),
      {
        reply_markup:
          similarityFilterModeKeyboard()
            .reply_markup
      }
    );
  }
);

bot.command(
  "institution",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return;
    }

    await ctx.reply(
      "🏫 REPORT INSTITUTION\\n\\n" +
      "Current: " +
      reportSettings.institution,
      {
        reply_markup:
          institutionKeyboard()
            .reply_markup
      }
    );
  }
);

bot.command(
  "copyleaksstatus",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return;
    }

    await ctx.reply(
      [
        "⚡ COPYLEAKS STATUS",
        "",
        "Enabled: " +
          (
            COPYLEAKS_ENABLED
              ? "YES"
              : "NO"
          ),

        "Configured: " +
          (
            COPYLEAKS_EMAIL &&
            COPYLEAKS_API_KEY &&
            COPYLEAKS_WEBHOOK_SECRET
              ? "YES"
              : "NO"
          ),

        "Sandbox: " +
          (
            COPYLEAKS_SANDBOX
              ? "YES"
              : "NO"
          ),

        "Shared Data Hub scan: " +
          (
            COPYLEAKS_SCAN_SHARED_DB
              ? "YES"
              : "NO"
          ),

        "Index submitted docs: " +
          (
            COPYLEAKS_INDEX_TO_DB
              ? "YES"
              : "NO"
          ),

        "Report mode: " +
          reportModeLabel(),

        "Filter mode: " +
          filterModeLabel(),

        "Institution: " +
          reportSettings.institution
      ].join("\\n")
    );
  }
);

bot.action("ADMIN_DASH_HOME", async (ctx) => {`,
  'admin report commands'
);

replaceOnce(
`bot.action("ADMIN_DASH_COMMANDS", async (ctx) => {`,
`bot.action(
  "ADMIN_DASH_REPORTS",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    await ctx.answerCbQuery();

    await showAdminScreen(
      ctx,
      "⚙️ REPORT GENERATION\\n\\n" +
        "Current Mode: " +
        reportModeLabel(),
      reportModeKeyboard(),
      true
    );
  }
);

bot.action(
  "ADMIN_DASH_FILTERS",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    await ctx.answerCbQuery();

    await showAdminScreen(
      ctx,
      "🔎 SIMILARITY FILTERING\\n\\n" +
        "Current Mode: " +
        filterModeLabel(),
      similarityFilterModeKeyboard(),
      true
    );
  }
);

bot.action(
  "ADMIN_DASH_INSTITUTION",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    await ctx.answerCbQuery();

    await showAdminScreen(
      ctx,
      "🏫 REPORT INSTITUTION\\n\\n" +
        "Current: " +
        reportSettings.institution,
      institutionKeyboard(),
      true
    );
  }
);

bot.action(
  "REPORT_MODE_MANUAL",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    reportSettings.reportMode =
      REPORT_MODE_MANUAL;

    saveReportSettings();

    await ctx.answerCbQuery(
      "Manual Only enabled"
    );

    await showAdminScreen(
      ctx,
      "⚙️ REPORT GENERATION\\n\\n" +
        "Current Mode: " +
        reportModeLabel(),
      reportModeKeyboard(),
      true
    );
  }
);

bot.action(
  "REPORT_MODE_APPROVAL",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    if (
      !COPYLEAKS_ENABLED ||
      !COPYLEAKS_EMAIL ||
      !COPYLEAKS_API_KEY ||
      !COPYLEAKS_WEBHOOK_SECRET
    ) {
      return ctx.answerCbQuery(
        "Configure and enable Copyleaks first.",
        {
          show_alert: true
        }
      );
    }

    reportSettings.reportMode =
      REPORT_MODE_APPROVAL;

    saveReportSettings();

    await ctx.answerCbQuery(
      "Admin Approval enabled"
    );

    await showAdminScreen(
      ctx,
      "⚙️ REPORT GENERATION\\n\\n" +
        "Current Mode: " +
        reportModeLabel(),
      reportModeKeyboard(),
      true
    );
  }
);

bot.action(
  "REPORT_MODE_AUTO",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    if (
      !COPYLEAKS_ENABLED ||
      !COPYLEAKS_EMAIL ||
      !COPYLEAKS_API_KEY ||
      !COPYLEAKS_WEBHOOK_SECRET
    ) {
      return ctx.answerCbQuery(
        "Configure and enable Copyleaks first.",
        {
          show_alert: true
        }
      );
    }

    await ctx.answerCbQuery();

    await showAdminScreen(
      ctx,
      "⚠️ ENABLE AUTOMATIC API?\\n\\n" +
      "Every newly paid eligible document will be submitted to Copyleaks automatically and may consume API credits. Existing jobs are not changed.",
      reportModeAutoConfirmKeyboard(),
      true
    );
  }
);

bot.action(
  "REPORT_MODE_AUTO_CONFIRM",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    if (
      !COPYLEAKS_ENABLED ||
      !COPYLEAKS_EMAIL ||
      !COPYLEAKS_API_KEY ||
      !COPYLEAKS_WEBHOOK_SECRET
    ) {
      return ctx.answerCbQuery(
        "Configure and enable Copyleaks first.",
        {
          show_alert: true
        }
      );
    }

    reportSettings.reportMode =
      REPORT_MODE_AUTO;

    saveReportSettings();

    await ctx.answerCbQuery(
      "Automatic API enabled"
    );

    await showAdminScreen(
      ctx,
      "⚙️ REPORT GENERATION\\n\\n" +
        "Current Mode: " +
        reportModeLabel(),
      reportModeKeyboard(),
      true
    );
  }
);

bot.action(
  "REPORT_MODE_AUTO_CANCEL",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    await ctx.answerCbQuery(
      "No change"
    );

    await showAdminScreen(
      ctx,
      "⚙️ REPORT GENERATION\\n\\n" +
        "Current Mode: " +
        reportModeLabel(),
      reportModeKeyboard(),
      true
    );
  }
);

bot.action(
  "FILTER_MODE_CLIENT",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    reportSettings.filterMode =
      FILTER_MODE_CLIENT;

    saveReportSettings();

    await ctx.answerCbQuery(
      "Client Choice enabled"
    );

    await showAdminScreen(
      ctx,
      "🔎 SIMILARITY FILTERING\\n\\n" +
        "Current Mode: " +
        filterModeLabel(),
      similarityFilterModeKeyboard(),
      true
    );
  }
);

bot.action(
  "FILTER_MODE_FILTERED",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    reportSettings.filterMode =
      FILTER_MODE_FILTERED;

    saveReportSettings();

    await ctx.answerCbQuery(
      "Always Filtered enabled"
    );

    await showAdminScreen(
      ctx,
      "🔎 SIMILARITY FILTERING\\n\\n" +
        "Current Mode: " +
        filterModeLabel(),
      similarityFilterModeKeyboard(),
      true
    );
  }
);

bot.action(
  "FILTER_MODE_UNFILTERED",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    reportSettings.filterMode =
      FILTER_MODE_UNFILTERED;

    saveReportSettings();

    await ctx.answerCbQuery(
      "Always Unfiltered enabled"
    );

    await showAdminScreen(
      ctx,
      "🔎 SIMILARITY FILTERING\\n\\n" +
        "Current Mode: " +
        filterModeLabel(),
      similarityFilterModeKeyboard(),
      true
    );
  }
);

bot.action(
  "INSTITUTION_EMBU",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    reportSettings.institution =
      "University of Embu";

    saveReportSettings();

    await ctx.answerCbQuery(
      "Institution updated"
    );

    await showAdminScreen(
      ctx,
      "🏫 REPORT INSTITUTION\\n\\n" +
        "Current: " +
        reportSettings.institution,
      institutionKeyboard(),
      true
    );
  }
);

bot.action(
  "INSTITUTION_TUM",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    reportSettings.institution =
      "Technical University of Mombasa";

    saveReportSettings();

    await ctx.answerCbQuery(
      "Institution updated"
    );

    await showAdminScreen(
      ctx,
      "🏫 REPORT INSTITUTION\\n\\n" +
        "Current: " +
        reportSettings.institution,
      institutionKeyboard(),
      true
    );
  }
);

bot.action("ADMIN_DASH_COMMANDS", async (ctx) => {`,
  'admin setting actions'
);

// -----------------------------------------------------------------------------
// 11) AUTO-SUBMIT AFTER PAYMENT
// -----------------------------------------------------------------------------

replaceOnce(
`  createPaidJob({ userId, apiRef, ref: completedRef, invoiceId, source });`,
`  const paidJob = createPaidJob({
    userId,
    apiRef,
    ref: completedRef,
    invoiceId,
    source
  });`,
  'capture paid job'
);

replaceOnce(
`  resetSubmission(userId);
  return true;`,
`  if (
    paidJob &&
    paidJob.reportModeSnapshot ===
      REPORT_MODE_AUTO
  ) {
    setImmediate(
      async () => {
        try {
          await submitPaidJobToCopyleaks(
            paidJob.jobId
          );
        } catch (err) {
          await sendAdminMessage(
            "❌ Automatic Copyleaks submission failed\\n" +
            "User: " +
            userId +
            "\\nError: " +
            safeText(
              err?.message || err
            )
          );
        }
      }
    );
  }

  resetSubmission(userId);
  return true;`,
  'auto submit after payment'
);

// -----------------------------------------------------------------------------
// 12) STARTUP DIAGNOSTICS
// -----------------------------------------------------------------------------

replaceOnce(
`  console.log(\`Payment polling: every \${STATUS_POLL_INTERVAL_MS / 1000}s, max \${STATUS_POLL_MAX_ATTEMPTS} attempts\`);`,
`  console.log(
    \`Payment polling: every \${STATUS_POLL_INTERVAL_MS / 1000}s, max \${STATUS_POLL_MAX_ATTEMPTS} attempts\`
  );

  console.log(
    \`Report generation mode: \${reportModeLabel()}\`
  );

  console.log(
    \`Similarity filter mode: \${filterModeLabel()}\`
  );

  console.log(
    \`Report institution: \${reportSettings.institution}\`
  );

  console.log(
    \`Copyleaks enabled/configured/sandbox: \${COPYLEAKS_ENABLED ? "YES" : "NO"}/\${COPYLEAKS_EMAIL && COPYLEAKS_API_KEY && COPYLEAKS_WEBHOOK_SECRET ? "YES" : "NO"}/\${COPYLEAKS_SANDBOX ? "YES" : "NO"}\`
  );`,
  'startup diagnostics'
);

// -----------------------------------------------------------------------------
// WRITE PATCHED BOT
// -----------------------------------------------------------------------------

const output =
  originalEol === '\r\n'
    ? src.replace(
        /\n/g,
        '\r\n'
      )
    : src;

fs.writeFileSync(
  target,
  output,
  'utf8'
);

console.log(
  'Patch applied successfully.'
);

console.log(
  'Backup:',
  backup
);

console.log(
  'Next: node --check bot.js'
);