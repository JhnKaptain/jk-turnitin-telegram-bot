"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {beginOfficeFontAliases,CONFIG}=require("./jk-office-font-alias.cjs");
assert(CONFIG.includes("Arial Regular") && CONFIG.includes("Roboto"));
assert.equal(beginOfficeFontAliases({platform:"win32"}),null);
assert.equal(beginOfficeFontAliases({env:{JK_OFFICE_FONT_ALIAS_ENABLED:"false"}}),null);
assert.equal(beginOfficeFontAliases({env:{FONTCONFIG_FILE:"/existing/conf"}}),null);
const cfg=beginOfficeFontAliases({env:{}});
if (process.platform==="linux" && fs.existsSync("/etc/fonts/fonts.conf")) {
 assert(cfg && fs.existsSync(cfg.configPath));
 assert.equal(cfg.env.FONTCONFIG_FILE,cfg.configPath);
 assert.equal(process.env.FONTCONFIG_FILE,undefined);
 cfg.cleanup();
 assert(!fs.existsSync(cfg.configPath));
}
const docker=fs.readFileSync("./Dockerfile","utf8");
assert(docker.includes("fonts-roboto-unhinted"));
const layout=fs.readFileSync("./jk-original-layout.js","utf8");
assert(layout.includes('require("./jk-office-font-alias.cjs").beginOfficeFontAliases()'));
assert(layout.includes("fontAliases?.cleanup()"));
assert(layout.includes("fontAliases?.env || process.env"));
assert(layout.includes('if (\n    ext === ".pdf"\n  ) {\n    return originalPath;'));
console.log("PASS: isolated fontconfig alias, off-switch, cleanup, PDF bypass and original input safety.");
