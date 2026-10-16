"use strict";

const fs = require("fs");
const path = require("path");

const RETENTION_MS = 24 * 60 * 60 * 1000;

function inspectTree(directory) {
  let latest = 0;
  let bytes = 0;

  function walk(filename) {
    const stat = fs.lstatSync(filename);

    if (stat.isSymbolicLink()) {
      throw new Error("Symbolic link found; folder skipped.");
    }

    latest = Math.max(latest, stat.mtimeMs);

    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(filename)) {
        walk(path.join(filename, name));
      }
    } else if (stat.isFile()) {
      bytes += stat.size;
    } else {
      throw new Error("Unsupported file type; folder skipped.");
    }
  }

  walk(directory);
  return { latest, bytes };
}

function processing(file) {
  const provider = String(file.providerStatus || "").toUpperCase();
  const delivery = String(file.apiReportDeliveryStatus || "").toUpperCase();

  return ["DOWNLOADING", "SCANNING", "PROCESSING"].includes(provider) ||
    ["HOLDING", "DELIVERING"].includes(delivery);
}

function cleanFiles({
  dataDir,
  paidJobs,
  persist,
  now = Date.now(),
  apply = false
}) {
  const root = path.resolve(dataDir, "provider-runs");
  const report = { eligible: [], deleted: [], skipped: [] };

  if (!fs.existsSync(root)) return report;

  if (fs.lstatSync(root).isSymbolicLink()) {
    throw new Error("Cleanup root cannot be a symbolic link.");
  }

  const groups = new Map();

  for (const job of Object.values(paidJobs || {})) {
    for (const file of job?.files || []) {
      if (!file?.providerBundleFile) continue;

      const relative = path.relative(
        root,
        path.resolve(file.providerBundleFile)
      );

      if (
        !relative ||
        relative === ".." ||
        relative.startsWith(".." + path.sep) ||
        path.isAbsolute(relative)
      ) continue;

      const parts = relative.split(path.sep);
      if (parts.length < 2) continue;

      const directory = path.join(root, parts[0]);

      if (!groups.has(directory)) groups.set(directory, []);
      groups.get(directory).push(file);
    }
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const directory = path.join(root, entry.name);
    const owners = groups.get(directory);

    if (!entry.isDirectory() || !owners?.length) {
      report.skipped.push({
        directory,
        reason: "Untracked folder or non-directory"
      });
      continue;
    }

    if (require("./jk-client-ai-highlights.cjs").hasProtectedPurchase(dataDir, directory, now)) {
      report.skipped.push({ directory, reason: "AI highlights payment, preparation or delivery unresolved" });
      continue;
    }

    if (owners.some(processing)) {
      report.skipped.push({
        directory,
        reason: "Processing or delivery still active"
      });
      continue;
    }

    let stats;

    try {
      stats = inspectTree(directory);
    } catch (error) {
      report.skipped.push({ directory, reason: error.message });
      continue;
    }

    if (now - stats.latest < RETENTION_MS) {
      report.skipped.push({
        directory,
        reason: "Less than 24 hours since last file change"
      });
      continue;
    }

    report.eligible.push({
      directory,
      bytes: stats.bytes,
      lastChangedAt: new Date(stats.latest).toISOString()
    });

    if (!apply) continue;

    const previous = owners.map(file => ({ ...file }));

    // Save the no-resubmission protection before deleting anything.
    for (const file of owners) {
      file.providerAutoResubmitBlocked = true;
      file.providerFilesPurgedAt = now;
      file.providerFilesRetentionHours = 24;
    }

    try {
      persist();
    } catch (error) {
      owners.forEach((file, index) => {
        for (const key of Object.keys(file)) delete file[key];
        Object.assign(file, previous[index]);
      });

      throw new Error(
        "Records could not be saved; files were not deleted: " +
        error.message
      );
    }

    fs.rmSync(directory, { recursive: true, force: false });
    report.deleted.push(directory);
  }

  return report;
}

let cleanupTimer;

function startFileCleanup({ dataDir, getPaidJobs, persist }) {
  if (cleanupTimer) return;

  const run = () => {
    try {
      const result = cleanFiles({
        dataDir,
        paidJobs: getPaidJobs(),
        persist,
        apply: true
      });

      if (result.deleted.length) {
        console.log(
          "24-hour file cleanup:",
          result.deleted.length,
          "scan folder(s) removed."
        );
      }
    } catch (error) {
      console.error("File cleanup failed:", error.message);
    }
  };

  cleanupTimer = setInterval(run, 60 * 60 * 1000);
  cleanupTimer.unref?.();

  const firstRun = setTimeout(run, 60 * 1000);
  firstRun.unref?.();
}

function selfTest() {
  const assert = require("node:assert/strict");
  const os = require("os");

  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "jk-retention-test-")
  );

  const root = path.join(dataDir, "provider-runs");
  fs.mkdirSync(root);

  const now = Date.now();
  const old = new Date(now - 25 * 60 * 60 * 1000);
  const paidJobs = { test: { files: [] } };

  for (const name of ["expired", "recent", "active"]) {
    const directory = path.join(root, name);
    fs.mkdirSync(directory);

    const bundle = path.join(directory, "bundle.json");
    fs.writeFileSync(bundle, "test");

    if (name !== "recent") {
      fs.utimesSync(bundle, old, old);
      fs.utimesSync(directory, old, old);
    }

    paidJobs.test.files.push({
      providerBundleFile: bundle,
      providerStatus: name === "active" ? "SCANNING" : "COMPLETE"
    });
  }

  const ledger = path.join(dataDir, "dailySalesLedger.store.json");
  fs.writeFileSync(ledger, "KEEP PAYMENT RECORDS");

  let saved = 0;

  let result = cleanFiles({
    dataDir,
    paidJobs,
    now,
    persist: () => saved++
  });

  assert.equal(result.eligible.length, 1);
  assert.equal(saved, 0);
  assert.ok(fs.existsSync(path.join(root, "expired")));

  assert.throws(() => cleanFiles({
    dataDir,
    paidJobs,
    now,
    apply: true,
    persist: () => { throw new Error("Mock write failure"); }
  }));

  assert.ok(fs.existsSync(path.join(root, "expired")));
  assert.equal(
    paidJobs.test.files[0].providerAutoResubmitBlocked,
    undefined
  );

  result = cleanFiles({
    dataDir,
    paidJobs,
    now,
    apply: true,
    persist: () => {
      assert.equal(
        paidJobs.test.files[0].providerAutoResubmitBlocked,
        true
      );
      saved++;
    }
  });

  assert.equal(result.deleted.length, 1);
  assert.ok(!fs.existsSync(path.join(root, "expired")));
  assert.ok(fs.existsSync(path.join(root, "recent")));
  assert.ok(fs.existsSync(path.join(root, "active")));
  assert.equal(fs.readFileSync(ledger, "utf8"), "KEEP PAYMENT RECORDS");
  assert.equal(paidJobs.test.files.length, 3);

  console.log("PASS: 24-hour expiry and preview mode.");
  console.log("PASS: active and recent files protected.");
  console.log("PASS: payment and job records retained.");
  console.log("PASS: resubmission block saved before deletion.");
  console.log("PASS: failed record writes prevent deletion.");
  console.log("Tests used temporary folders only.");
}

module.exports = { cleanFiles, startFileCleanup };

if (require.main === module) {
  try {
    if (process.argv[2] === "--self-test") {
      selfTest();
    } else if (
      process.argv.length <= 2 ||
      process.argv[2] === "--preview"
    ) {
      const dataDir = process.env.DATA_DIR || "/var/data";
      const paidJobs = JSON.parse(
        fs.readFileSync(path.join(dataDir, "paidJobs.store.json"), "utf8")
      );

      console.log(JSON.stringify(
        cleanFiles({ dataDir, paidJobs, apply: false }),
        null,
        2
      ));

      console.log("PREVIEW ONLY. Nothing deleted.");
    } else {
      throw new Error(
        "Use --preview or --self-test. Deletion runs only inside the bot."
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
