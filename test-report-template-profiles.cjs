"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), assert = require("node:assert/strict"), vm = require("vm");
const profiles = require("./jk-report-template-profiles.cjs");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "jk-template-test-"));
let serial = 1000000000;
function job(n = 1) { const id = ++serial; return { jobId: "batch-" + id, files: Array.from({ length: n }, () => ({ jkSubmissionId: "trn:oid:::1:" + (++serial), reportName: "Author Author", reportInstitution: "Arsi University" })) }; }
function expect(p, template, assignment) { assert.equal(p.template, template); if (assignment) assert.equal(p.assignmentName, assignment); }
(async () => {
 try {
  const sequential = path.join(temporary,"sequential");
  for (let i = 1; i <= 60; i++) {
    const batch = job(); const selected = profiles.assignBatch(batch, sequential);
    const cycle = (i - 1) % 30;
    expect(selected, cycle < 15 ? "QUICK_SUBMIT" : "CLASS", cycle < 15 ? "Quick Submit" : profiles.PROFILES[Math.floor((cycle - 15) / 5)].assignmentName);
    assert.deepEqual(batch.files[0].reportTemplateProfile, batch.reportTemplateProfile);
    assert.equal(batch.files[0].reportInstitution, "Arsi University"); assert.equal(batch.files[0].reportName, "Author Author");
    const state = fs.readFileSync(path.join(sequential,"reportTemplateRotation.store.json"),"utf8");
    profiles.assignBatch(JSON.parse(JSON.stringify(batch)), sequential);
    assert.equal(fs.readFileSync(path.join(sequential,"reportTemplateRotation.store.json"),"utf8"),state);
  }
  assert.equal(profiles.readRotation(sequential).totalFiles, 60);
  const batches = path.join(temporary,"batches");
  const a = job(8), b = job(8), c = job(3), d = job(4), e = job(3), f = job(5), g = job();
  expect(profiles.assignBatch(a,batches),"QUICK_SUBMIT"); expect(profiles.assignBatch(b,batches),"QUICK_SUBMIT");
  expect(profiles.assignBatch(c,batches),"CLASS","Lecture Assignment Two");
  expect(profiles.assignBatch(d,batches),"CLASS","Lecture Assignment Two");
  expect(profiles.assignBatch(e,batches),"CLASS","ASSIGNMENT THREE");
  expect(profiles.assignBatch(f,batches),"CLASS","ASSIGNMENT THREE");
  expect(profiles.assignBatch(g,batches),"QUICK_SUBMIT");
  for (const batch of [a,b,c,d,e,f,g]) assert(batch.files.every(file => JSON.stringify(file.reportTemplateProfile) === JSON.stringify(batch.reportTemplateProfile)));
  const unchanged = profiles.readRotation(batches).totalFiles;
  const changedBatch = JSON.parse(JSON.stringify(a)); changedBatch.files.pop();
  assert.throws(()=>profiles.assignBatch(changedBatch,batches),/contents changed/);
  assert.equal(profiles.readRotation(batches).totalFiles,unchanged);
  const autoBefore=profiles.readRotation(batches);
  profiles.setMode(batches,"CLASS",2); expect(profiles.assignBatch(job(),batches),"CLASS","HOMEWORK");
  profiles.setMode(batches,"QUICK_SUBMIT"); expect(profiles.assignBatch(job(),batches),"QUICK_SUBMIT");
  assert.equal(profiles.readRotation(batches).templateFiles,autoBefore.templateFiles);
  profiles.setMode(batches,"AUTO"); expect(profiles.assignBatch(job(),batches),"QUICK_SUBMIT");
  const legacy = profiles.profileFields({}); expect(legacy,"QUICK_SUBMIT");
  assert.equal(profiles.coverLabels({}).assignment,"Quick Submit");
  assert.equal(profiles.PROFILES[0].className,"BSEE");
  assert.throws(()=>profiles.profileFields({reportTemplateProfile:{version:1,template:"CLASS"}}),/Invalid/);
  // Saved profile snapshots survive a settings change and are not mutated by consumers.
  const firstClass=profiles.assignBatch(job(),path.join(temporary,"fixed"));
  firstClass.assignmentName="Consumer mutation";
  assert.equal(profiles.readRotation(path.join(temporary,"fixed")).batches[Object.keys(profiles.readRotation(path.join(temporary,"fixed")).batches)[0]].profile.assignmentName,"Quick Submit");
  // Exercise the real createPaidJob function, not a replacement assignment path.
  const botSource=fs.readFileSync(path.join(__dirname,"bot.js"),"utf8");
  const createSource=botSource.slice(botSource.indexOf("function createPaidJob("),botSource.indexOf("function getLatestActivePaidJob("));
  const actualDir=path.join(temporary,"actual-bot");
  const context={ Date,Number,String,Array,require:name=>{assert.equal(name,"./jk-report-template-profiles.cjs");return profiles;},DATA_DIR:actualDir,paidJobs:{},JK_PROVIDER_CUTOVER_ENABLED:true,PROVIDER_NEUTRAL_PIPELINE:"PROVIDER",REPORT_PROCESSING_MAX_MINUTES:20,reportSettings:{reportMode:"AUTO"},REPORT_MODE_MANUAL:"MANUAL",effectiveSimilarityFilter:()=>"FILTERED",cleanupPaidJobs:()=>{},savePaidJobs:()=>{} };
  vm.createContext(context);vm.runInContext(createSource,context);
  const payment={userId:123,apiRef:"paid-ref",ref:{batchId:"paid-batch",files:job(2).files}};
  const created=context.createPaidJob(payment);assert(created.files.every(f=>f.reportTemplateProfile.template==="QUICK_SUBMIT"));
  context.createPaidJob(payment);assert.equal(profiles.readRotation(actualDir).totalFiles,2);
  assert(botSource.indexOf('require("./jk-report-template-profiles.cjs").register')<botSource.indexOf('bot.on("text"'));
  // Provider bundle construction carries the same saved snapshot without provider-controlled replacements.
  let calls=0; const bundleModule={exports:{}};
  const bundleRequire=name=>name==="./jk-provider-pipeline"?{runProviderPipeline:async()=>{calls++;return {aiDetection:{percent:42},similarityDetection:{percent:8}};}}:name==="./jk-report-template-profiles.cjs"?profiles:require(name);
  new Function("require","module","exports",fs.readFileSync(path.join(__dirname,"jk-provider-job-bundle.js"),"utf8"))(bundleRequire,bundleModule,bundleModule.exports);
  const source=path.join(temporary,"original.docx");fs.writeFileSync(source,"fixture");
  const file={...job().files[0],file_name:"Example.docx",similarityFilter:"FILTERED",type:"CHECK",reportTemplateProfile:profiles.PROFILES[1]};
  const output=path.join(temporary,"bundle.json");
  const bundle=await bundleModule.exports.buildProviderJobBundle({sourcePath:source,outputPath:output,file,job:{jobId:"build-test",userId:123},similarityMode:"FILTERED"});
  assert.deepEqual(bundle.reportIdentity.templateProfile,profiles.PROFILES[1]);assert.equal(bundle.aiDetection.percent,42);assert.equal(bundle.similarityDetection.percent,8);
  const callsBefore=calls;
  await assert.rejects(()=>bundleModule.exports.buildProviderJobBundle({sourcePath:source,outputPath:output,file:{...file,reportTemplateProfile:{version:99}},similarityMode:"FILTERED"}),/Invalid/);
  assert.equal(calls,callsBefore);
  // Recovery reads the file snapshot and never allocates another rotation slot.
  const checkpointPath=path.join(temporary,"recover","bundle.json.provider-results.json");fs.mkdirSync(path.dirname(checkpointPath));
  const jobsPath=path.join(temporary,"jobs.json");fs.writeFileSync(jobsPath,JSON.stringify({original:{userId:123,files:[{...file,providerBundleFile:checkpointPath.replace(/\.provider-results\.json$/,"" )}]}}));
  const beforeRecovery=fs.readFileSync(path.join(actualDir,"reportTemplateRotation.store.json"),"utf8");
  const identity=require("./jk-recover-provider-results.js").identityFromStore(checkpointPath,jobsPath,{sourcePath:source,similarityMode:"FILTERED"});
  assert.deepEqual(identity.reportIdentity.templateProfile,profiles.PROFILES[1]);
  assert.equal(fs.readFileSync(path.join(actualDir,"reportTemplateRotation.store.json"),"utf8"),beforeRecovery);
  // Admin controls are private/admin-only, and changing mode does not allocate files.
  const commands={},actions=[];profiles.register({command:(name,handler)=>commands[name]=handler,action:(pattern,handler)=>actions.push({pattern,handler})},{dataDir:actualDir,adminId:999});
  let replies=0; const ctx=(user,chat=user)=>({from:{id:user},chat:{id:chat},reply:async()=>replies++,answerCbQuery:async()=>{},editMessageText:async()=>{}});
  await commands.reporttemplate(ctx(123));await commands.reporttemplate(ctx(999,123));assert.equal(replies,0);
  await commands.reporttemplate(ctx(999));assert.equal(replies,1);
  const route=actions.find(a=>a.pattern instanceof RegExp), admin=ctx(999);admin.match=route.pattern.exec("RPTM:CLASS:1");await route.handler(admin);
  assert.equal(profiles.readRotation(actualDir).selection,"CLASS");assert.equal(profiles.readRotation(actualDir).totalFiles,2);
  console.log("PASS: 15-file template / 5-file class rotation, BSEE, batch consistency, restart/idempotency and admin-only controls.");
  console.log("PASS: actual paid-job allocation, provider bundle/recovery snapshots, unchanged names/institutions/results and zero counter changes from recovery.");
  console.log("Mock tests and temporary folders only. No live provider requests, payments or Telegram deliveries.");
 } finally { fs.rmSync(temporary,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
