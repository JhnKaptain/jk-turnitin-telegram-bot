"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const { readApiWordLimit } = require("./jk-api-word-limit.cjs");
const source = fs.readFileSync(path.join(__dirname, "jk-provider-pipeline.js"), "utf8");
const start = source.indexOf("// JK_SHARED_API_WORD_GUARD_V1");
const end = source.indexOf("  const result = {", start);
assert(start >= 0 && end > start, "Shared API word guard missing.");
const validate = new Function("document", "similarityPrepared", "aiPrepared", "runSimilarity", "runAi", "require", source.slice(start, end) + "\nreturn true;");
const words = n => Array(n).fill("word").join(" ");
function check(label, original, similarity, ai, blocked, env = {}, extra = {}) {
  let error;
  try {
    validate({ text: words(original), wordCount: extra.extractor ?? original },
      {text: words(similarity)}, {text: words(ai)}, extra.similarity ?? true,
      extra.ai ?? true, name => {
        assert.equal(name, "./jk-api-word-limit.cjs");
        return { readApiWordLimit: () => readApiWordLimit(env) };
      });
  } catch (caught) { error = caught; }
  if (error && error.code !== "API_MANUAL_REVIEW_REQUIRED") throw error;
  assert.equal(Boolean(error), blocked, label);
  if (error) assert.equal(error.apiBlocked, true);
  console.log("PASS:", label);
}
check("4999 allowed",4999,4999,4999,false);
check("Exactly 5000 allowed",5000,5000,5000,false);
check("5001 blocked",5001,5001,5001,true);
check("Quetext input oversized",4900,5001,4900,true);
check("Sapling input oversized",4900,4900,5001,true);
check("Extractor count oversized",4900,4900,4900,true,{}, {extractor:5001});
check("Empty original blocked",0,100,100,true);
check("Configured boundary allowed",3000,3000,3000,false,{API_MAX_WORDS:"3000"});
check("Configured boundary exceeded",3001,3001,3001,true,{API_MAX_WORDS:"3000"});
check("Configured increase allowed",6000,6000,6000,false,{API_MAX_WORDS:"6000"});
check("Unused provider excluded",100,6000,100,false,{}, {similarity:false});
// Two daily EAT windows, including cross-midnight and exact boundaries.
const {getWordLimitState} = require("./jk-api-word-limit.cjs");
const windowEnv={API_MAX_WORDS:"5000",JK_10K_WINDOW_ENABLED:"1",JK_10K_MAX_WORDS:"10000",
 JK_10K_WINDOW_1_START_EAT:"22:00",JK_10K_WINDOW_1_END_EAT:"02:00",
 JK_10K_WINDOW_2_START_EAT:"11:00",JK_10K_WINDOW_2_END_EAT:"13:00"};
const at=(hhmm)=>new Date("2026-10-26T"+hhmm+":00+03:00");
for(const h of ["22:00","23:59","00:00","01:59","11:00","12:59"]){
 assert.equal(readApiWordLimit(windowEnv,at(h)),10000,h);
 check("Window extended "+h,9999,9999,9999,false,windowEnv);
}
for(const h of ["21:59","02:00","10:59","13:00","16:00"]){
 assert.equal(readApiWordLimit(windowEnv,at(h)),5000,h);
}
assert.equal(getWordLimitState(windowEnv,at("23:00")).window,1);
assert.equal(getWordLimitState(windowEnv,at("12:00")).window,2);
assert.equal(readApiWordLimit({...windowEnv,JK_10K_WINDOW_ENABLED:"0"},at("23:00")),5000);
for(const bad of ["9:00","24:00","23:60","wrong",""]){
 assert.throws(()=>readApiWordLimit({...windowEnv,JK_10K_WINDOW_1_START_EAT:bad},at("23:00")));
}
assert.throws(()=>readApiWordLimit({...windowEnv,JK_10K_MAX_WORDS:"20000"},at("23:00")));
assert.throws(()=>readApiWordLimit({...windowEnv,JK_10K_WINDOW_2_END_EAT:"11:00"},at("23:00")));

for (const value of ["0", "-1", "1.5", "oops", "Infinity", "9007199254740992"]) {
  check("Invalid configuration blocked: " + value,100,100,100,true,{API_MAX_WORDS:value});
}
assert.equal(readApiWordLimit({}),5000);
assert.equal(readApiWordLimit({API_MAX_WORDS:" "}),5000);
assert.equal(readApiWordLimit({API_MAX_WORDS:" 5200 "}),5200);
// Execute the actual credit-retry guard in isolation; no provider is loaded.
const retry = fs.readFileSync(path.join(__dirname,"jk-retry-quetext-credits.cjs"),"utf8");
const rs = retry.indexOf("    const apiWordLimit =");
const re = retry.indexOf("    if (!state.reportId",rs);
assert(rs >= 0 && re > rs);
const retryGuard = new Function("prepared","saved","assert","require",retry.slice(rs,re));
for (const cap of [3000,5000,6000]) {
  for (const n of [cap,cap+1]) {
    const invoke = () => retryGuard({text:words(n)}, {canonicalDocument:{wordCount:n}}, assert,
      () => ({readApiWordLimit:()=>readApiWordLimit({API_MAX_WORDS:String(cap)})}));
    if (n === cap) assert.doesNotThrow(invoke); else assert.throws(invoke);
  }
}
console.log("PASS: credit retry uses the same configurable inclusive limit.");
console.log("ALL WORD-LIMIT TESTS PASSED. No API requests or deliveries.");
