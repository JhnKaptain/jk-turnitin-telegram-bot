const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const target = path.resolve(process.cwd(), 'bot.js');

if (!fs.existsSync(target)) {
  console.error('bot.js not found.');
  process.exit(1);
}

const original = fs.readFileSync(target, 'utf8');
const eol = original.includes('\r\n') ? '\r\n' : '\n';

let src = original.replace(/\r\n/g, '\n');

if (src.includes('JK_COPYLEAKS_HTTP_ERROR_PATCH_V1')) {
  console.log('Copyleaks HTTP error patch already applied.');
  process.exit(0);
}

const backup = path.join(
  path.dirname(target),
  `bot.js.backup-before-copyleaks-http-error-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}`
);

fs.copyFileSync(target, backup);

function fail(message) {
  console.error('\nPATCH FAILED:', message);
  console.error('Real bot.js was NOT replaced.');
  console.error('Backup:', backup);
  process.exit(1);
}

const startMarker = 'async function copyleaksJson(';
const endMarker = 'async function getCopyleaksToken()';

const start = src.indexOf(startMarker);

if (start < 0) {
  fail('copyleaksJson() was not found.');
}

const end = src.indexOf(endMarker, start);

if (end < 0) {
  fail('getCopyleaksToken() was not found.');
}

const newFunction = `// JK_COPYLEAKS_HTTP_ERROR_PATCH_V1
async function copyleaksJson(
  url,
  options = {}
) {
  const res =
    await fetch(
      url,
      options
    );

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
    const nestedError =
      body &&
      typeof body.error === "object" &&
      body.error !== null
        ? body.error
        : null;

    let fullBody = "";

    try {
      fullBody =
        JSON.stringify(body);
    } catch {
      fullBody =
        String(text || "");
    }

    let details = "";

    if (
      nestedError?.details !==
      undefined
    ) {
      try {
        details =
          JSON.stringify(
            nestedError.details
          );
      } catch {
        details =
          String(
            nestedError.details
          );
      }
    }

    const message =
      nestedError?.message ||
      body?.message ||
      (
        typeof body?.error ===
        "string"
          ? body.error
          : ""
      ) ||
      body?.raw ||
      fullBody ||
      "No response body";

    const idText =
      nestedError?.id
        ? " | id=" +
          nestedError.id
        : "";

    const codeText =
      nestedError?.code !==
        undefined
        ? " | code=" +
          nestedError.code
        : "";

    const detailsText =
      details
        ? " | details=" +
          details
        : "";

    const fullBodyText =
      fullBody &&
      fullBody !== message
        ? " | response=" +
          fullBody
        : "";

    throw new Error(
      "Copyleaks HTTP " +
        res.status +
        ": " +
        message +
        idText +
        codeText +
        detailsText +
        fullBodyText
    );
  }

  return body;
}

`;

src =
  src.slice(0, start) +
  newFunction +
  src.slice(end);

const output =
  eol === '\r\n'
    ? src.replace(/\n/g, '\r\n')
    : src;

const candidate = path.join(
  path.dirname(target),
  `.bot-copyleaks-http-error-candidate-${Date.now()}.js`
);

fs.writeFileSync(
  candidate,
  output,
  'utf8'
);

const check = spawnSync(
  process.execPath,
  [
    '--check',
    candidate
  ],
  {
    encoding: 'utf8'
  }
);

if (check.status !== 0) {
  console.error(
    check.stderr ||
    check.stdout
  );

  try {
    fs.unlinkSync(candidate);
  } catch {}

  fail(
    'Candidate syntax check failed.'
  );
}

fs.writeFileSync(
  target,
  output,
  'utf8'
);

try {
  fs.unlinkSync(candidate);
} catch {}

console.log(
  'Copyleaks HTTP error patch applied successfully.'
);

console.log(
  'Candidate syntax check: PASSED'
);

console.log(
  'Backup:',
  backup
);

console.log(
  'Next: node --check bot.js'
);