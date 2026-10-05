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

if (src.includes('JK_MANUAL_FILTER_ADMIN_PATCH_V1')) {
  console.log('Admin filter display patch already applied.');
  process.exit(0);
}

if (!src.includes('JK_MANUAL_FILTER_PATCH_V1')) {
  console.error(
    'JK_MANUAL_FILTER_PATCH_V1 was not found. Apply the manual filtering patch first.'
  );
  process.exit(1);
}

const backup = path.join(
  path.dirname(target),
  `bot.js.backup-before-manual-filter-admin-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}`
);

fs.copyFileSync(target, backup);

const oldBlock = `  const caption = buildAdminDocumentCaption({
    userId,
    name,
    usernameText,
    file,
    fileNumber,
    expectedFiles: sub?.expectedFiles
  });

  try {`;

const newBlock = `  let caption = buildAdminDocumentCaption({
    userId,
    name,
    usernameText,
    file,
    fileNumber,
    expectedFiles: sub?.expectedFiles
  });

  // JK_MANUAL_FILTER_ADMIN_PATCH_V1
  // In Manual mode the administrator must still know whether
  // the client requested a filtered or unfiltered similarity report.
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

if (!src.includes(oldBlock)) {
  console.error(
    'Expected sendSelectedDocumentToAdmin caption block was not found. Nothing was changed.'
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

console.log(
  'Manual admin filter display patch applied successfully.'
);

console.log(
  'Backup:',
  backup
);

console.log(
  'Next: node --check bot.js'
);