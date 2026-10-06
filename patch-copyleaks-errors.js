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

if (src.includes('JK_COPYLEAKS_ERROR_DIAGNOSTICS_V1')) {
  console.log('Copyleaks error diagnostics already applied.');
  process.exit(0);
}

const backup = path.join(
  path.dirname(target),
  `bot.js.backup-before-copyleaks-errors-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}`
);

fs.copyFileSync(target, backup);

const oldBlock = `  if (!res.ok) {
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
  }`;

const newBlock = `  if (!res.ok) {
    // JK_COPYLEAKS_ERROR_DIAGNOSTICS_V1
    const nestedError =
      body &&
      typeof body.error === "object"
        ? body.error
        : null;

    const details =
      nestedError?.details
        ? JSON.stringify(
            nestedError.details
          )
        : "";

    const bodyText =
      (() => {
        try {
          return JSON.stringify(
            body
          );
        } catch {
          return String(
            text || ""
          );
        }
      })();

    const msg =
      nestedError?.message ||
      body?.message ||
      (
        typeof body?.error === "string"
          ? body.error
          : ""
      ) ||
      body?.raw ||
      bodyText ||
      "No response body";

    throw new Error(
      "Copyleaks HTTP " +
        res.status +
        ": " +
        msg +
        (
          details
            ? " | details=" +
              details
            : ""
        )
    );
  }`;

if (!src.includes(oldBlock)) {
  console.error(
    'Expected copyleaksJson error block not found. Nothing changed.'
  );
  console.error('Backup:', backup);
  process.exit(1);
}

src = src.replace(oldBlock, newBlock);

const output =
  eol === '\r\n'
    ? src.replace(/\n/g, '\r\n')
    : src;

const candidate = path.join(
  path.dirname(target),
  `.bot-copyleaks-errors-${Date.now()}.js`
);

fs.writeFileSync(candidate, output, 'utf8');

const check = spawnSync(
  process.execPath,
  ['--check', candidate],
  {
    encoding: 'utf8'
  }
);

if (check.status !== 0) {
  console.error(check.stderr || check.stdout);
  fs.unlinkSync(candidate);
  console.error('Real bot.js was NOT changed.');
  process.exit(1);
}

fs.writeFileSync(target, output, 'utf8');
fs.unlinkSync(candidate);

console.log('Copyleaks error diagnostics applied successfully.');
console.log('Candidate syntax check: PASSED');
console.log('Backup:', backup);