"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "jk-empty-compat-test-"));
const script = path.join(__dirname, "jk-office-empty-paragraph-compat.py");
try {
 const before = Buffer.from("test".repeat(20));
 const unchanged = path.join(root, "source.docx");
 fs.writeFileSync(unchanged, before);
 const dest = path.join(root, "converted.docx");
 const result = spawnSync("python3", [script, unchanged, dest], { encoding: "utf8", timeout: 10000 });
 assert.notEqual(result.status, 0, "Invalid DOCX must be rejected");
 assert.deepEqual(fs.readFileSync(unchanged), before, "Original bytes cannot change");
 assert(!fs.existsSync(dest), "Invalid DOCX must not be promoted");
 const source = fs.readFileSync("./jk-original-layout.js", "utf8");
 assert(source.includes('process.env.JK_OFFICE_BLANK_COMPAT !== "0"'));
 assert(source.includes("compatibilityDir"));
 assert(source.includes("fs.rmSync(compatibilityDir, { recursive: true, force: true })"));
 const docker = fs.readFileSync("./Dockerfile", "utf8");
 assert(docker.includes("python3-minimal") || docker.includes("       python3 \\"));
 console.log("PASS: conversion-only feature flag, cleanup, immutable source and python availability.");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
