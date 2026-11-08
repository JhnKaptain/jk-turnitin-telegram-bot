"use strict";

/*
  Plagiarism provider switch
  --------------------------
  Chooses which service checks similarity: Quetext or JK SimilarityCheck.

  Which one is used (first match wins):
    1. The admin's choice from Telegram (/plagiarism), saved in
       DATA_DIR/plagiarismProvider.store.json so it survives restarts.
    2. The Render environment variable PLAGIARISM_PROVIDER
       ("quetext" or "jksimilarity").
    3. Quetext.

  Optional: PLAGIARISM_FALLBACK=quetext makes a failed JK SimilarityCheck scan
  retry once on Quetext (uses Quetext credit), so customers still get a report.

  Both providers return the same result shape, so nothing downstream changes.
*/

const fs = require("fs");
const path = require("path");

const PROVIDERS = {
  quetext: { label: "Quetext", load: () => require("./quetext.js") },
  jksimilarity: { label: "JK SimilarityCheck", load: () => require("./jksimilarity.js") }
};

function storeFile(env = process.env) {
  const dir = String(env.DATA_DIR || path.join(__dirname, "..")).trim();
  return path.join(dir, "plagiarismProvider.store.json");
}

function normalizeName(value) {
  const name = String(value || "").trim().toLowerCase().replace(/[\s_-]+/gu, "");
  if (name === "jk" || name === "jksimilaritycheck") return "jksimilarity";
  return PROVIDERS[name] ? name : null;
}

function savedChoice(env = process.env) {
  try {
    const data = JSON.parse(fs.readFileSync(storeFile(env), "utf8"));
    return normalizeName(data?.provider);
  } catch {
    return null;
  }
}

function envChoice(env = process.env) {
  return normalizeName(env.PLAGIARISM_PROVIDER);
}

/* { name, label, source: "admin" | "render" | "default" } */
function currentProvider(env = process.env) {
  const saved = savedChoice(env);
  if (saved) return { name: saved, label: PROVIDERS[saved].label, source: "admin" };
  const fromEnv = envChoice(env);
  if (fromEnv) return { name: fromEnv, label: PROVIDERS[fromEnv].label, source: "render" };
  return { name: "quetext", label: PROVIDERS.quetext.label, source: "default" };
}

/* Save the admin's choice; null clears it (back to the Render setting). */
function setProvider(name, { by = null, env = process.env } = {}) {
  const file = storeFile(env);
  if (name === null) {
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
    return currentProvider(env);
  }
  const provider = normalizeName(name);
  if (!provider) throw new Error("Unknown plagiarism provider: " + name);
  const temporary = file + ".write-" + process.pid;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify({ provider, by, at: new Date().toISOString() }, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
  return currentProvider(env);
}

async function checkPlagiarism(args) {
  const chosen = currentProvider();
  try {
    return await PROVIDERS[chosen.name].load().checkPlagiarism(args);
  } catch (error) {
    const fallback = normalizeName(process.env.PLAGIARISM_FALLBACK);
    if (chosen.name === "jksimilarity" && fallback === "quetext") {
      console.error("JK SimilarityCheck failed; retrying on Quetext:", error?.message || error);
      return PROVIDERS.quetext.load().checkPlagiarism(args);
    }
    throw error;
  }
}

module.exports = { PROVIDERS, currentProvider, setProvider, normalizeName, storeFile, checkPlagiarism };
