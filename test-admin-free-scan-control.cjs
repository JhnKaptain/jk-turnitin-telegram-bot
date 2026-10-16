"use strict";
const fs=require("fs"),path=require("path"),assert=require("node:assert/strict");
const control=require("./jk-admin-free-scan-control.cjs");
(async()=>{
 const previous=process.env.ADMIN_FREE_SCAN_ENABLED;
 try {
  assert(control.enabled({}));assert(control.enabled({ADMIN_FREE_SCAN_ENABLED:"1"}));
  assert(!control.enabled({ADMIN_FREE_SCAN_ENABLED:"0"}));assert(!control.enabled({ADMIN_FREE_SCAN_ENABLED:"invalid"}));
  const source=fs.readFileSync(path.join(__dirname,"bot.js"),"utf8");
  const keyboard=source.slice(source.indexOf("function adminDashboardKeyboard()"),source.indexOf("function adminBackKeyboard("));
  const Markup={inlineKeyboard:rows=>({reply_markup:{inline_keyboard:rows}}),button:{callback:(text,data)=>({text,callback_data:data})}};
  const render=()=>new Function("require","Markup",keyboard+"\nreturn adminDashboardKeyboard();")((name)=>{assert.equal(name,"./jk-admin-free-scan-control.cjs");return control;},Markup);
  process.env.ADMIN_FREE_SCAN_ENABLED="1";const on=render();assert(JSON.stringify(on).includes("ADMIN_DASH_FREE_SCAN"));
  process.env.ADMIN_FREE_SCAN_ENABLED="0";const off=render();assert(!JSON.stringify(off).includes("ADMIN_DASH_FREE_SCAN"));
  const withoutFree=control.stripButtons(on.reply_markup);assert.deepEqual(off.reply_markup,withoutFree);
  let handler,clears=0,nexts=0,answers=[],edits=[];
  control.registerGuard({use:fn=>handler=fn},{adminId:999,onDisable:()=>clears++});
  const ctx=(data,user=999)=>({from:{id:user},callbackQuery:{data,message:{reply_markup:on.reply_markup}},answerCbQuery:async value=>answers.push(value),editMessageReplyMarkup:async value=>edits.push(value)});
  for(const data of ["ADMIN_DASH_FREE_SCAN","ADMIN_FREE_SCAN_CHECK","ADMIN_FREE_SCAN_SIMILARITY","ADMIN_FREE_SCAN_FILTERED","ADMIN_FREE_SCAN_UNFILTERED","ADMIN_FREE_SCAN_CANCEL"]){await handler(ctx(data),()=>nexts++);}
  assert.equal(nexts,0);assert.equal(clears,6);assert(answers.every(a=>a==="Admin Free Scan is disabled."));
  assert(edits.every(m=>!JSON.stringify(m).includes("ADMIN_DASH_FREE_SCAN")));
  await handler(ctx("ADMIN_FREE_SCAN_CHECK",123),()=>nexts++);assert.equal(clears,6);assert.equal(answers.at(-1),"Admin only.");
  await handler(ctx("PAHL:1234567890"),()=>nexts++);await handler(ctx("REPORT_MODE_AUTO"),()=>nexts++);await handler({from:{id:123}},()=>nexts++);assert.equal(nexts,3);
  process.env.ADMIN_FREE_SCAN_ENABLED="1";await handler(ctx("ADMIN_DASH_FREE_SCAN"),()=>nexts++);assert.equal(nexts,4);
  assert(source.indexOf('require("./jk-admin-free-scan-control.cjs").registerGuard')<source.indexOf('// JK_ADMIN_FREE_SCAN_ACTIONS_V1'));
  // Exercise the real document-handler entry guard with an unfinished free session.
  const begin=source.indexOf('bot.on("document", async (ctx) => {')+'bot.on("document", async (ctx) => {'.length;
  const end=source.indexOf('  if (\n    user.id === ADMIN_ID &&\n    adminFreeScanSession?.stage',begin);
  assert(end>begin);const prefix=source.slice(begin,end);
  const run=new Function("require","ctx","state",`return (async()=>{const ADMIN_ID=999;let adminFreeScanSession=state;${prefix}\nreturn "normal document flow";})();`);
  let replies=0;process.env.ADMIN_FREE_SCAN_ENABLED="0";
  assert.equal(await run(()=>control,{from:{id:999},reply:async()=>replies++},{stage:"WAIT_DOCUMENT"}),undefined);assert.equal(replies,1);
  assert.equal(await run(()=>control,{from:{id:123},reply:async()=>replies++},null),"normal document flow");
  process.env.ADMIN_FREE_SCAN_ENABLED="1";
  assert.equal(await run(()=>control,{from:{id:999},reply:async()=>replies++},{stage:"WAIT_DOCUMENT"}),"normal document flow");
  console.log("PASS: 1/0 switch, default enabled, hidden dashboard button, blocked old callbacks and unfinished sessions.");
  console.log("PASS: other dashboard buttons, client document flow and highlights callbacks preserved. Mock tests only; no provider requests or Telegram deliveries.");
 } finally { if(previous===undefined)delete process.env.ADMIN_FREE_SCAN_ENABLED;else process.env.ADMIN_FREE_SCAN_ENABLED=previous; }
})().catch(error=>{console.error(error);process.exitCode=1;});
