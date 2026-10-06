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

if (src.includes('JK_COPYLEAKS_EXPORT_ID_FIX_V1')) {
  console.log('Export ID fix already applied.');
  process.exit(0);
}

const backup = path.join(
  path.dirname(target),
  `bot.js.backup-before-exportid-fix-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}`
);

fs.copyFileSync(target, backup);

function fail(message) {
  console.error('PATCH FAILED:', message);
  console.error('Real bot.js was NOT replaced.');
  console.error('Backup:', backup);
  process.exit(1);
}

const start = src.indexOf(
  'function makeCopyleaksExportId('
);

const end = src.indexOf(
  'function validCopyleaks',
  start
);

if (start < 0 || end < 0) {
  fail('makeCopyleaksExportId function boundaries were not found.');
}

const newFunction = `// JK_COPYLEAKS_EXPORT_ID_FIX_V1
function makeCopyleaksExportId(
  scanId
) {
  /*
    Copyleaks requires Export ID length <= 36 characters.
    Keep it unique but deliberately short.
  */
  const scanPart =
    safeCopyleaksPathPart(
      scanId
    )
      .toLowerCase()
      .slice(0, 12);

  const timePart =
    Date.now()
      .toString(36)
      .slice(-8);

  const randomPart =
    Math.random()
      .toString(36)
      .slice(2, 8);

  return (
    "jk-" +
    scanPart +
    "-" +
    timePart +
    "-" +
    randomPart
  ).slice(0, 36);
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
  `.bot-exportid-candidate-${Date.now()}.js`
);

fs.writeFileSync(
  candidate,
  output,
  'utf8'
);

const check = spawnSync(
  process.execPath,
  ['--check', candidate],
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

  fail('Candidate syntax check failed.');
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
  'Copyleaks Export ID fix applied successfully.'
);

console.log(
  'Candidate syntax check: PASSED'
);

console.log(
  'Backup:',
  backup
);