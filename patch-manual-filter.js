const fs = require('fs');
const path = require('path');

const target = path.resolve(process.cwd(), 'bot.js');

if (!fs.existsSync(target)) {
  console.error('bot.js not found.');
  process.exit(1);
}

const original = fs.readFileSync(target, 'utf8');
const eol = original.includes('\r\n') ? '\r\n' : '\n';

let src = original.replace(/\r\n/g, '\n');

if (src.includes('JK_MANUAL_FILTER_PATCH_V1')) {
  console.log('Manual filtering patch already applied.');
  process.exit(0);
}

if (!src.includes('JK_COPYLEAKS_CONTROL_PATCH_V2')) {
  console.error('Expected JK_COPYLEAKS_CONTROL_PATCH_V2 was not found.');
  process.exit(1);
}

const backup = path.join(
  path.dirname(target),
  `bot.js.backup-before-manual-filter-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}`
);

fs.copyFileSync(target, backup);

const oldBlock = `  /*
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

`;

const newBlock = `  // JK_MANUAL_FILTER_PATCH_V1
  // Similarity filtering applies in Manual, Admin Approval,
  // and Automatic API modes. Delivery mode does not change
  // the client's filtering preference.

`;

if (!src.includes(oldBlock)) {
  console.error(
    'Expected Manual-mode bypass block was not found. Nothing was changed.'
  );
  console.error('Backup preserved at:', backup);
  process.exit(1);
}

src = src.replace(
  oldBlock,
  newBlock
);

const output =
  eol === '\r\n'
    ? src.replace(/\n/g, '\r\n')
    : src;

fs.writeFileSync(
  target,
  output,
  'utf8'
);

console.log('Manual filtering patch applied successfully.');
console.log('Backup:', backup);
console.log('Next: node --check bot.js');