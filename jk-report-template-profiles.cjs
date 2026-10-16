"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const PROFILES = Object.freeze([
  Object.freeze({ version: 1, template: "CLASS", profileId: "CLASS_BSEE_LECTURE_TWO", assignmentName: "Lecture Assignment Two", className: "BSEE" }),
  Object.freeze({ version: 1, template: "CLASS", profileId: "CLASS_BTMD_ASSIGNMENT_THREE", assignmentName: "ASSIGNMENT THREE", className: "BTMD" }),
  Object.freeze({ version: 1, template: "CLASS", profileId: "CLASS_BTMD_HOMEWORK", assignmentName: "HOMEWORK", className: "BTMD" })
]);
const QUICK = Object.freeze({ version: 1, template: "QUICK_SUBMIT", profileId: "QUICK_SUBMIT", assignmentName: "Quick Submit", className: "Quick Submit" });
const clone = value => JSON.parse(JSON.stringify(value));
function profileFields(file) {
  const value = file?.reportTemplateProfile;
  if (value === undefined || value === null) return clone(QUICK);
  if (value.version !== 1 || !["CLASS", "QUICK_SUBMIT"].includes(value.template) ||
      typeof value.profileId !== "string" || !/^[A-Z0-9_]{1,80}$/.test(value.profileId) ||
      !["assignmentName", "className"].every(key => typeof value[key] === "string" && value[key].trim() &&
        value[key].length <= 160 && !/[\r\n\x00-\x1f]/u.test(value[key]))) {
    throw new Error("Invalid saved report template profile.");
  }
  if (value.template === "QUICK_SUBMIT" && (value.profileId !== QUICK.profileId || value.assignmentName !== QUICK.assignmentName || value.className !== QUICK.className)) {
    throw new Error("Invalid Quick Submit profile.");
  }
  return { version: 1, template: value.template, profileId: value.profileId,
    assignmentName: value.assignmentName, className: value.className };
}
function coverLabels(identity) {
  const p = profileFields({ reportTemplateProfile: identity?.templateProfile });
  return { assignment: p.assignmentName, className: p.className };
}
function filename(dataDir) { return path.join(path.resolve(dataDir), "reportTemplateRotation.store.json"); }
function initial() { return { version: 1, selection: "AUTO", fixedProfile: 0, template: "QUICK_SUBMIT", templateFiles: 0,
  classProfile: 0, classFiles: 0, totalFiles: 0, batches: {} }; }
function readRotation(dataDir) {
  const file = filename(dataDir);
  if (!fs.existsSync(file)) return initial();
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  if (state.version !== 1 || !["AUTO", "QUICK_SUBMIT", "CLASS"].includes(state.selection) ||
      !["QUICK_SUBMIT", "CLASS"].includes(state.template) ||
      !["templateFiles", "classFiles", "totalFiles", "fixedProfile", "classProfile"].every(key => Number.isSafeInteger(state[key]) && state[key] >= 0) ||
      state.fixedProfile >= PROFILES.length || state.classProfile >= PROFILES.length || !state.batches || Array.isArray(state.batches)) {
    throw new Error("Invalid template rotation store. Restore its backup before allocating new reports.");
  }
  return state;
}
function save(dataDir, state) {
  fs.mkdirSync(path.resolve(dataDir), { recursive: true });
  const file = filename(dataDir), temporary = file + ".tmp-" + crypto.randomBytes(6).toString("hex");
  try { fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600, flag: "wx" }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function assignBatch(job, dataDir) {
  const key = String(job?.jobId || job?.batchId || "");
  if (!key || !Array.isArray(job.files) || !job.files.length) throw new Error("Template allocation needs a stored batch and files.");
  const ids = job.files.map(file => String(file.jkSubmissionId || "")).sort();
  if (!ids.every(id => /^trn:oid:::1:[1-9]\d{9}$/.test(id)) || new Set(ids).size !== ids.length) throw new Error("Template allocation requires unique saved document IDs.");
  const state = readRotation(dataDir);
  let allocation = Object.hasOwn(state.batches, key) ? state.batches[key] : null;
  if (allocation) {
    if (JSON.stringify(ids) !== JSON.stringify(allocation.ids)) throw new Error("Stored template batch contents changed; review required.");
    allocation.profile = profileFields({ reportTemplateProfile: allocation.profile });
  } else {
    let profile;
    if (state.selection === "QUICK_SUBMIT") profile = QUICK;
    else if (state.selection === "CLASS") profile = PROFILES[state.fixedProfile];
    else {
      if (state.templateFiles >= 15) {
        state.template = state.template === "QUICK_SUBMIT" ? "CLASS" : "QUICK_SUBMIT";
        state.templateFiles = 0; state.classProfile = 0; state.classFiles = 0;
      }
      if (state.template === "CLASS" && state.classFiles >= 5) {
        state.classProfile = (state.classProfile + 1) % PROFILES.length; state.classFiles = 0;
      }
      profile = state.template === "CLASS" ? PROFILES[state.classProfile] : QUICK;
      state.templateFiles += ids.length;
      if (state.template === "CLASS") state.classFiles += ids.length;
    }
    allocation = { ids, profile: clone(profile), allocatedAt: Date.now(), selection: state.selection };
    Object.defineProperty(state.batches, key, { value: allocation, enumerable: true, writable: true, configurable: true });
    state.totalFiles += ids.length;
    // Commit the allocation before touching the job: retries reuse the same record.
    save(dataDir, state);
  }
  job.reportTemplateProfile = clone(allocation.profile);
  for (const file of job.files) file.reportTemplateProfile = clone(allocation.profile);
  return clone(allocation.profile);
}
function setMode(dataDir, selection, fixedProfile = 0) {
  if (!["AUTO", "QUICK_SUBMIT", "CLASS"].includes(selection) || !Number.isInteger(fixedProfile) || fixedProfile < 0 || fixedProfile >= PROFILES.length) throw new Error("Invalid template mode.");
  const state = readRotation(dataDir); state.selection = selection; state.fixedProfile = fixedProfile; save(dataDir, state); return state;
}
function screen(state) {
  const mode = state.selection === "AUTO" ? "Automatic rotation" : state.selection === "QUICK_SUBMIT" ? "Quick Submit only" : "Fixed class: " + PROFILES[state.fixedProfile].assignmentName;
  return ["REPORT TEMPLATE", "", "Mode: " + mode,
    "Automatic session: " + (state.template === "CLASS" ? "Class" : "Quick Submit") + " - " + state.templateFiles + "/15 files",
    ...(state.template === "CLASS" ? ["Class profile: " + PROFILES[state.classProfile].assignmentName + " / " + PROFILES[state.classProfile].className,
      "Profile files: " + state.classFiles + "/5"] : []),
    "", "Templates rotate after 15 files; class profiles after 5.", "Each batch finishes on its starting profile.",
    "Rebuilds and recovery retain their saved profile.", "Fixed modes pause automatic rotation; AUTO resumes it.", "Changes apply to new batches."].join("\n");
}
function keyboard() { return { reply_markup: { inline_keyboard: [
  [{ text: "Automatic rotation - 15 / 5", callback_data: "RPTM:AUTO" }],
  [{ text: "Quick Submit only", callback_data: "RPTM:QUICK_SUBMIT" }],
  ...PROFILES.map((p, i) => [{ text: p.assignmentName + " / " + p.className, callback_data: "RPTM:CLASS:" + i }])
] } }; }
function register(bot, { dataDir, adminId }) {
  const allowed = ctx => Number(ctx.from?.id) === Number(adminId) && Number(ctx.chat?.id) === Number(adminId);
  bot.command("reporttemplate", async ctx => { if (!allowed(ctx)) return; await ctx.reply(screen(readRotation(dataDir)), keyboard()); });
  bot.action("RPTM:OPEN", async ctx => {
    if (!allowed(ctx)) return ctx.answerCbQuery("Admin private chat only.");
    await ctx.answerCbQuery(); await ctx.reply(screen(readRotation(dataDir)), keyboard());
  });
  bot.action(/^RPTM:(AUTO|QUICK_SUBMIT|CLASS)(?::([0-2]))?$/, async ctx => {
    if (!allowed(ctx)) return ctx.answerCbQuery("Admin private chat only.");
    const state = setMode(dataDir, ctx.match[1], Number(ctx.match[2] || 0));
    await ctx.answerCbQuery("Template setting saved for new batches.");
    try { await ctx.editMessageText(screen(state), keyboard()); }
    catch (error) {
      if (/message is not modified/i.test(String(error.description || error.message))) return;
      await ctx.reply(screen(state), keyboard());
    }
  });
}
module.exports = { PROFILES, QUICK, profileFields, coverLabels, assignBatch, readRotation, setMode, register, screen };
