"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pay = require("./jk-international-manual-payment.cjs");

assert.deepEqual(pay.SUPPORTED_METHODS, [pay.METHOD_MPESA, pay.METHOD_BINANCE]);
assert.deepEqual(pay.quoteForMethod(pay.METHOD_MPESA, 250, 2), {amount:250,currency:"KES"});
assert.deepEqual(pay.quoteForMethod(pay.METHOD_BINANCE, 250, 2), {amount:2,currency:"USDT"});
assert.throws(()=>pay.quoteForMethod("CARD",250,2));
assert.throws(()=>pay.quoteForMethod(pay.METHOD_BINANCE, 250, 0));
assert.equal(pay.extractTransactionId("Transaction ID: 1234567890ABCDEF"),"1234567890ABCDEF");
assert.equal(pay.extractTransactionId("M-PESA code: TTK36A4X9Y"),"TTK36A4X9Y");
assert.equal(pay.extractTransactionId("I have paid"),"");
assert.equal(pay.normalizeTransactionId("SHORT"),"");
assert.match(pay.manualApprovalBlock({paymentMethod:pay.METHOD_BINANCE,pendingProof:{}},()=>false),/required/);
assert.match(pay.manualApprovalBlock({paymentMethod:pay.METHOD_BINANCE,pendingProof:{code:"1234567890ABCDEF"}},()=>true),/already been used/);
assert.equal(pay.manualApprovalBlock({paymentMethod:pay.METHOD_BINANCE,pendingProof:{code:"1234567890ABCDEF"}},()=>false),"");
assert.equal(pay.manualApprovalBlock({paymentMethod:"MPESA",pendingProof:{}},()=>true),"");
const data={amount:2,currency:"USDT",reference:"JK123456",method:pay.METHOD_BINANCE,binanceId:"1203517288",binanceName:"JohnKaptain",mpesaNumber:"+254741924396"};
assert.match(pay.paymentInstructions(data),/USDT/);
assert.match(pay.paymentInstructions(data),/1203517288/);
assert.match(pay.paymentInstructions({...data,method:pay.METHOD_MPESA,amount:250,currency:"KES"}),/\+254741924396/);

const bot=fs.readFileSync(path.join(__dirname,"bot.js"),"utf8");
assert.match(bot,/PAYMENT_METHOD_WORLDWIDE/);
assert.match(bot,/WORLDWIDE_BINANCE/);
assert.match(bot,/WORLDWIDE_MPESA/);
assert.match(bot,/manualApprovalBlock\(ref, isProofCodeUsed\)/);
assert.match(bot,/Binance Pay collected:/);
assert.match(bot,/const worldwidePay = require\("\.\/jk-international-manual-payment\.cjs"\)/);
const oldBankButton=bot.match(/bot\.action\("PAYMENT_METHOD_INTL",[\s\S]*?\n\}\);/)?.[0]||"";
const oldTzButton=bot.match(/bot\.action\("PAYMENT_METHOD_TZ_OTHER",[\s\S]*?\n\}\);/)?.[0]||"";
assert(oldBankButton.includes("worldwidePaymentKeyboard()"));
assert(!oldBankButton.includes("startInternationalPayment(ctx"));
assert(oldTzButton.includes("worldwidePaymentKeyboard()"));
assert(!oldTzButton.includes("startTzOtherPayment(ctx"));
assert.match(bot,/bot\.action\("PAYMENT_METHOD_MPESA",/); // Kenya STK remains.
assert(bot.includes('MESSAGES.paidMsgBatch(completedRef.amount, completedRef.summary || "Batch payment", completedRef.currency || "KES")'));
assert(bot.includes('const priorCode = apiRef ? String(getPaymentRef(apiRef)?.pendingProof?.code || "") : ""'));

assert.equal(pay.kesToUsdt(120,130),0.93);
assert.equal(pay.kesToUsdt(260,130),2);
assert.throws(()=>pay.kesToUsdt(120,0));
const sample="JKPAY6385887728179266263709759107";
assert.equal(pay.noteReference(sample),"JK66263709759107");
assert.match(pay.paymentInstructions({...data, paymentNoteRef:pay.noteReference(sample)}),/Note to Payee:/);
assert.match(pay.paymentInstructions({...data, paymentNoteRef:pay.noteReference(sample)}),/Binance Order ID/);
assert.match(bot,/copy_text: \{text: recipient\}/);
assert.match(bot,/Copy Binance User ID:/);
assert.match(bot,/Binance Order ID received/);
assert.match(bot,/send only the Binance Order ID/);
assert.match(bot,/copy_text: \{text: note\}/);
assert.match(bot,/WORLDWIDE_KES_PER_USDT/);

console.log("PASS: international manual payments, M-Pesa, USDT, proof dedup, ledger and legacy buttons.");
