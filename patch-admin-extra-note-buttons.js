
const fs = require("fs");



const path = "bot.js";

let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");



fs.writeFileSync("bot.js.before-admin-extra-note-buttons", code, "utf8");



const aiNoteAnchor = `const AI_UNAVAILABLE_NOTE =

  \`ℹ️ AI Writing Report Unavailable



📌 Turnitin AI may not show when:



📝 Essay/prose content is below 300 words or above 30,000 words

🌐 File language is not English, Spanish, or Japanese

📄 File type is not .docx, .pdf, .txt, or .rtf



✅ If AI is unavailable, only the similarity report may be provided.\`;`;



const extraNotes = aiNoteAnchor + `



const AI_STAR_NOTE =

  \`⭐ About the AI Report Asterisk



An asterisk (*%) appears when AI detection is below 20%.



In this range, the result is less reliable, so the report may not show an exact percentage or highlighted text. ADD PURELY GENERATED AI CONTENT AT THE END OF YOUR FILE ENOUGH TO BOOST THE PERCENTAGE TO ABOVE 20% TO GET HIGHLIGHTS. 



If you need a new report, please submit the updated document as a new paid submission. 



All submissions are paid for.\`;



function mpesaTillNoticeMessage() {

  return (

    "🧾 M-Pesa Payment Notice\\n\\n" +

    "The M-Pesa STK prompt gateway is currently experiencing technical issues.\\n\\n" +

    "Please pay manually via Buy Goods Till Number:\\n" +

    TILL_NUMBER + "\\n\\n" +

    "After payment, send the M-Pesa confirmation message or payment screenshot here for verification.\\n\\n" +

    "STK prompts will resume once the gateway is stable."

  );

}`;



if (!code.includes("const AI_STAR_NOTE")) {

  if (!code.includes(aiNoteAnchor)) throw new Error("AI unavailable note anchor not found.");

  code = code.replace(aiNoteAnchor, extraNotes);

}



const oldButtonLine = '    rows.push([Markup.button.callback("ℹ️ AI Unavailable Note", `ADMIN_AI_NOTE_${userId}`)]);';

const newButtonLines = `    rows.push([Markup.button.callback("ℹ️ AI Unavailable Note", \`ADMIN_AI_NOTE_\${userId}\`)]);

    rows.push([Markup.button.callback("⭐ AI * Note", \`ADMIN_AI_STAR_NOTE_\${userId}\`)]);

    rows.push([Markup.button.callback("🧾 Pay via Till", \`ADMIN_TILL_NOTICE_\${userId}\`)]);`;



if (!code.includes("ADMIN_AI_STAR_NOTE_")) {

  if (!code.includes(oldButtonLine)) throw new Error("AI note button line not found.");

  code = code.replace(oldButtonLine, newButtonLines);

}



const aiActionAnchor = `bot.action(/^ADMIN_AI_NOTE_(\\d+)$/, async (ctx) => {

  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");



  const userId = ctx.match[1];



  try {

    await bot.telegram.sendMessage(userId, AI_UNAVAILABLE_NOTE, { parse_mode: "Markdown" });

    await ctx.answerCbQuery("AI note sent");

    await ctx.reply(\`✅ AI unavailable note sent to \${userId}\`);

  } catch (err) {

    await ctx.answerCbQuery("Failed");

    await ctx.reply("❌ Failed: " + (err?.message || err));

  }

});`;



const extraActions = aiActionAnchor + `



bot.action(/^ADMIN_AI_STAR_NOTE_(\\d+)$/, async (ctx) => {

  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");



  const userId = ctx.match[1];



  try {

    await bot.telegram.sendMessage(userId, AI_STAR_NOTE);

    await ctx.answerCbQuery("AI star note sent");

    await ctx.reply("✅ AI star note sent to " + userId);

  } catch (err) {

    await ctx.answerCbQuery("Failed");

    await ctx.reply("❌ Failed: " + (err?.message || err));

  }

});



bot.action(/^ADMIN_TILL_NOTICE_(\\d+)$/, async (ctx) => {

  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");



  const userId = ctx.match[1];



  try {

    await bot.telegram.sendMessage(userId, mpesaTillNoticeMessage());

    await ctx.answerCbQuery("Till notice sent");

    await ctx.reply("✅ Till payment notice sent to " + userId);

  } catch (err) {

    await ctx.answerCbQuery("Failed");

    await ctx.reply("❌ Failed: " + (err?.message || err));

  }

});`;



if (!code.includes('bot.action(/^ADMIN_AI_STAR_NOTE_')) {

  if (!code.includes(aiActionAnchor)) throw new Error("AI note action anchor not found.");

  code = code.replace(aiActionAnchor, extraActions);

}



fs.writeFileSync(path, code, "utf8");

console.log("Added AI star and Till notice buttons to admin document card.");

