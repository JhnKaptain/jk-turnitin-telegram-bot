"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {inspectReferenceSections}=require("./jk-reference-sections.js");
const body="The review compares outcomes and ethical safeguards across psychological studies. ".repeat(12);
const source=[body,"References","Lambert, J. (2022). Social media breaks and well-being.","Publisher details with an unresolved section boundary.","Task 4 Evidence vs Misinformation - Can People Be Born Evil?","This section discusses different kinds of psychological evidence and competing explanations.","References","Thomson, J. (2023). The moral mystery of serial killers.","https://bigthink.com/thinking/are-we-born-evil/","Task 5: Written - Academic Skills Reflection","This semester I developed critical thinking skills through research and collaborative learning."].join("\n");
const inspected=inspectReferenceSections(source);
const bot=fs.readFileSync(require.resolve("./bot.js"),"utf8");
assert(bot.includes("if (!review.hasFollowingReferenceSection && !review.hasFollowingSubstantiveSection)"));
assert(bot.includes('return ctx.answerCbQuery("Later assignment content must be preserved."'));
assert(bot.includes("review.autoResolvedAt = now"));
assert(bot.includes('timeout.makeTreatRemainderAsReferencesOverride(review, now)'));
const ambiguities=inspected.reviews;
for(const review of ambiguities){
 assert(review.hasFollowingSubstantiveSection===true,"Later Task section should block exclude-to-end");
}
console.log("PASS: later task headings guard manual end action; pending timeout still resumes as configured.");
