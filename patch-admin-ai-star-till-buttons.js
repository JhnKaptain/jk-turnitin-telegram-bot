
const fs = require("fs");



const path = "bot.js";

let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");



fs.writeFileSync("bot.js.before-admin-ai-star-till-buttons", code, "utf8");



const aiStarNote = `const AI_STAR_NOTE =

  \`⭐ About the AI Report Asterisk



An asterisk (*%) appears when AI detection is below 20%.



In this range, the result is less reliable, so the report may not show an exact percentage or highlighted text. This helps reduce misinterpretation.



Highlights are shown only when the detected AI writing reaches the report threshold. ADD AI CONTENT AT THE END OF THE FILE TO BOOST THE PERCENTAGE TO AT LEAST 20% AND REQUEST FOR A PAID RECHECK IF YOU NEED HIGHLIGHTS.  The revised file must be submitted again as a new paid submission. 



All submissions are paid for.\`;`;



const tillNoticeFunction = `function mpesaTillNoticeMessage() {

  return [

    "🧾 M-Pesa Payment Notice",

    "",

    "The M-Pesa STK prompt gateway is currently experiencing technical issues.",

    "",

    "Please pay manually via Buy Goods Till Number:",

    TILL_NUMBER,

    "",

    "After payment, send the M-Pesa confirmation message or payment screenshot here for verification.",

    "",

    "STK prompts will resume once the gateway is stable."

  ].join("\\n");

}`;



const aiStarRegex = /const AI_STAR_NOTE =\n  `[\s\S]*?`;/;



if (aiStarRegex.test(code)) {

  code = code.replace(aiStarRegex, aiStarNote);

} else {

  const aiUnavailableRegex = /const AI_UNAVAILABLE_NOTE =\n  `[\s\S]*?`;/;



  if (!aiUnavailableRegex.test(code)) {

    throw new Error("AI_UNAVAILABLE_NOTE block not found.");

  }



  code = code.replace(aiUnavailableRegex, (match) => match + "\n\n" + aiStarNote);

}



const tillFnRegex = /function mpesaTillNoticeMessage\(\) \{\n[\s\S]*?\n\}/;



if (tillFnRegex.test(code)) {

  code = code.replace(tillFnRegex, tillNoticeFunction);

} else {

  code = code.replace(aiStarNote, aiStarNote + "\n\n" + tillNoticeFunction);

}



const oldButtonLine = '    rows.push([Markup.button.callback("ℹ️ AI Unavailable Note", `ADMIN_AI_NOTE_${userId}`)]);';



const newButtonLines = [

  '    rows.push([Markup.button.callback("ℹ️ AI Unavailable Note", `ADMIN_AI_NOTE_${userId}`)]);',

  '    rows.push([Markup.button.callback("⭐ AI Star Note", `ADMIN_AI_STAR_NOTE_${userId}`)]);',

  '    rows.push([Markup.button.callback("🧾 Till Payment Notice", `ADMIN_TILL_NOTICE_${userId}`)]);'

].join("\n");



if (!code.includes("ADMIN_AI_STAR_NOTE_")) {

  if (!code.includes(oldButtonLine)) {

    throw new Error("AI unavailable button line not found.");

  }



  code = code.replace(oldButtonLine, newButtonLines);

}



if (!code.includes('bot.action(/^ADMIN_AI_STAR_NOTE_')) {

  const startInlineAnchor = "\n// =====================\n// START INLINE BUTTONS";



  const extraActions = `

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

});

`;



  if (!code.includes(startInlineAnchor)) {

    throw new Error("START INLINE BUTTONS anchor not found.");

  }



  code = code.replace(startInlineAnchor, "\n" + extraActions + startInlineAnchor);

}



fs.writeFileSync(path, code, "utf8");

console.log("AI Star and Till buttons added.");

