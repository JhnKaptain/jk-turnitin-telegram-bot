"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const bot=fs.readFileSync(path.join(__dirname,"bot.js"),"utf8");
const renderer=fs.readFileSync(path.join(__dirname,"jk-report-renderer-max.js"),"utf8");
const match=bot.match(/const REPORT_NAMES = \[([\s\S]*?)\];/);
assert(match,"report names declaration missing");
const names=vm.runInNewContext("["+match[1]+"]");
assert.deepEqual(Array.from(names),["Author Author","User User"]);
assert(!/• Jabbar Mutlaq/.test(bot),"admin interface still advertises removed name");
assert((bot.match(/One random name \+ one random institution are assigned once per new document\./g)||[]).length===4);
assert(renderer.includes('"Jabbar Mutlaq"'),"historical report identity must remain supported");
const chooser=bot.match(/function chooseReportName\(\) \{[\s\S]*?\n\}/)?.[0];
assert(chooser,"name selection function missing");
for(const random of [0,0.1,0.499,0.5,0.999]) {
  const result=vm.runInNewContext(chooser+"\nchooseReportName()",{REPORT_NAMES:names,Math:{floor:Math.floor,random:()=>random}});
  assert(names.includes(result));
}
console.log("PASS: only Author Author and User User can be selected for new documents.");
console.log("PASS: all admin report-identity screens show two names.");
console.log("PASS: historical Jabbar Mutlaq reports stay accepted by renderer.");
console.log("Offline test: no API requests, messaging, or production changes.");
