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

if (src.includes('JK_COPYLEAKS_FAILURE_STATUS_V1')) {
  console.log('Failure-status patch already applied.');
  process.exit(0);
}

const backup = path.join(
  path.dirname(target),
  `bot.js.backup-before-copyleaks-failure-status-${new Date()
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
  'async function submitPaidJobToCopyleaks('
);

const end = src.indexOf(
  'function extractCopyleaksAiPercent(',
  start
);

if (start < 0 || end < 0) {
  fail('Copyleaks submission function boundaries not found.');
}

let section = src.slice(start, end);

const saveAnchor = `  savePaidJobs();

  for (`;

if (!section.includes(saveAnchor)) {
  fail('Submission loop anchor not found.');
}

section = section.replace(
  saveAnchor,
  `  savePaidJobs();

  // JK_COPYLEAKS_FAILURE_STATUS_V1
  let submittedCount = 0;
  let failedCount = 0;
  const submissionErrors = [];

  for (`
);

const successAnchor = `      file.appliedFilter =
        filter;

      savePaidJobs();
    } catch (err) {`;

if (!section.includes(successAnchor)) {
  fail('Successful submission anchor not found.');
}

section = section.replace(
  successAnchor,
  `      file.appliedFilter =
        filter;

      submittedCount += 1;

      savePaidJobs();
    } catch (err) {`
);

const failureAnchor = `      file.copyleaksFailedAt =
        Date.now();

      savePaidJobs();

      await sendAdminMessage(`;

if (!section.includes(failureAnchor)) {
  fail('Failure block anchor not found.');
}

section = section.replace(
  failureAnchor,
  `      file.copyleaksFailedAt =
        Date.now();

      failedCount += 1;

      submissionErrors.push(
        safeText(
          file.file_name ||
            ("File " + (i + 1))
        ) +
          ": " +
          String(
            err?.message || err
          )
      );

      savePaidJobs();

      await sendAdminMessage(`
);

const returnAnchor = `  }

  return job;
}`;

if (!section.includes(returnAnchor)) {
  fail('Function return anchor not found.');
}

section = section.replace(
  returnAnchor,
  `  }

  if (failedCount > 0) {
    job.status =
      submittedCount > 0
        ? "API_PARTIAL_FAILURE"
        : "API_FAILED";

    savePaidJobs();

    throw new Error(
      failedCount +
        " Copyleaks submission(s) failed: " +
        submissionErrors.join(" | ")
    );
  }

  return job;
}`
);

src =
  src.slice(0, start) +
  section +
  src.slice(end);

const output =
  eol === '\r\n'
    ? src.replace(/\n/g, '\r\n')
    : src;

const candidate = path.join(
  path.dirname(target),
  `.bot-failure-status-candidate-${Date.now()}.js`
);

fs.writeFileSync(candidate, output, 'utf8');

const check = spawnSync(
  process.execPath,
  ['--check', candidate],
  { encoding: 'utf8' }
);

if (check.status !== 0) {
  console.error(check.stderr || check.stdout);

  try {
    fs.unlinkSync(candidate);
  } catch {}

  fail('Candidate syntax validation failed.');
}

fs.writeFileSync(target, output, 'utf8');

try {
  fs.unlinkSync(candidate);
} catch {}

console.log(
  'Copyleaks failure-status patch applied successfully.'
);

console.log(
  'Candidate syntax check: PASSED'
);

console.log(
  'Backup:',
  backup
);