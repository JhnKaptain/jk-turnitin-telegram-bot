"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), assert = require("node:assert/strict");
const { createService, price, phone, hasProtectedPurchase } = require("./jk-client-ai-highlights.cjs");
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 8; i++) await tick(); }

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jk-paid-ai-test-"));
  const env = { AI_HIGHLIGHTS_PRICE_KES: "50" }, messages = [], documents = [];
  let prepares = 0, charges = 0, failDelivery = false, time = 1000000000;
  const jobDirectory = path.join(directory, "provider-runs", "example"); fs.mkdirSync(jobDirectory, { recursive: true });
  const bundlePath = path.join(jobDirectory, "bundle.json");
  const file = { jkSubmissionId: "trn:oid:::1:1234567890", providerBundleFile: bundlePath, apiAiDeliveredAt: 1, file_name: "Example.docx" };
  const bundle = { reportIdentity: { jkSubmissionId: file.jkSubmissionId, filename: file.file_name },
    canonicalDocument: { text: "Original sentence." }, aiDetection: { available: true, provider: "sapling", percent: 12.3,
      ranges: [{ id: "s1", start: 0, end: 18, score: 0.9, sentence: "Original sentence." }] } };
  fs.writeFileSync(bundlePath, JSON.stringify(bundle));
  const jobs = { original: { userId: 111, files: [file] } }, beforeJobs = JSON.stringify(jobs);
  const invoices = new Map();
  const deps = {
    dataDir: directory, adminId: 999, env, now: () => time, getJobs: () => jobs,
    telegram: { sendMessage: async (...args) => { messages.push(args); return { message_id: messages.length }; },
      sendDocument: async (recipient, document, options) => {
        assert.equal(options, undefined); assert.equal(recipient, 111); assert.equal(charges, 1);
        if (failDelivery) { failDelivery = false; throw new Error("Mock Telegram outage"); }
        documents.push([recipient, document]); return { document: { file_id: "saved-telegram-file" } };
      } },
    prepare: async (input, output) => { assert.equal(input, bundlePath); prepares++; fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, "%PDF-fixture"); },
    sendStk: async body => {
      charges++; const invoice = { invoice_id: "invoice-1", api_ref: body.api_ref, account: body.phone_number,
        currency: "KES", value: body.amount, state: "PENDING" }; invoices.set(body.api_ref, invoice); return { invoice };
    },
    listInvoices: async ref => ({ results: invoices.has(ref) ? [invoices.get(ref)] : [] }),
    checkPayment: async id => ({ invoice: [...invoices.values()].find(i => i.invoice_id === id) })
  };
  const answers = [], ctx = user => ({ from: { id: user }, chat: { id: user }, answerCbQuery: async text => answers.push(text) });
  let service = createService(deps);
  try {
    assert.equal(price({}), 50); assert.equal(price({ AI_HIGHLIGHTS_PRICE_KES: "0" }), null);
    assert.equal(phone("0712345678"), "254712345678"); assert.equal(phone("+254112345678"), "254112345678");
    assert.equal(service.deliveryOffer(jobs.original).replyMarkup.inline_keyboard.length, 1);
    await service.buy(ctx(222), "1234567890"); await service.buy(ctx(999), "1234567890");
    assert.equal(Object.keys(service.records).length, 0); assert.equal(charges, 0);
    await service.buy(ctx(111), "1234567890"); await settle();
    const r = Object.values(service.records)[0];
    assert.equal(r.status, "WAIT_PHONE"); assert.equal(prepares, 1); assert.equal(charges, 0);
    assert.equal(hasProtectedPurchase(directory, jobDirectory, time), true);
    env.AI_HIGHLIGHTS_PRICE_KES = "75";
    await service.handleText(ctx(111), "not a number"); assert.equal(charges, 0);
    await service.handleText(ctx(111), "0712345678");
    await service.handleText(ctx(111), "0712345678"); await settle();
    assert.equal(charges, 1); assert.equal(r.attempts[0].amount, 50); assert.equal(documents.length, 0);
    await service.buy(ctx(111), "1234567890"); await settle(); assert.equal(charges, 1);
    // A forged COMPLETE callback cannot override the authoritative PENDING invoice.
    await service.handleWebhook({ api_ref: r.attempts[0].apiRef, state: "COMPLETE", value: 50 }); await settle();
    assert.equal(documents.length, 0);
    service.stop(); service = createService(deps);
    const resumed = Object.values(service.records)[0];
    invoices.get(resumed.attempts[0].apiRef).state = "COMPLETE";
    failDelivery = true;
    await assert.rejects(() => service.verify(resumed), /Mock Telegram outage/);
    assert(resumed.paidAt); assert.equal(resumed.status, "PAID");
    assert.equal(hasProtectedPurchase(directory, jobDirectory, time), true);
    service.stop(); service = createService(deps);
    await service.tick(); await settle();
    const delivered = Object.values(service.records)[0];
    assert.equal(delivered.status, "DELIVERED"); assert.equal(documents.length, 1); assert.equal(charges, 1);
    assert.equal(hasProtectedPurchase(directory, jobDirectory, time), false);
    await service.handleWebhook({ api_ref: delivered.attempts[0].apiRef, state: "COMPLETE" }); await settle();
    assert.equal(documents.length, 1);
    fs.rmSync(path.dirname(delivered.outputPath), { recursive: true }); fs.unlinkSync(bundlePath);
    await service.buy(ctx(111), "1234567890"); await settle();
    assert.equal(documents.length, 2); assert.equal(documents[1][1], "saved-telegram-file"); assert.equal(charges, 1);
    assert.equal(JSON.stringify(jobs), beforeJobs);
    assert(messages.some(m => m[0] === 999 && m[1].includes("paid and delivered")));
    console.log("PASS: ownership, PDF-before-payment, configurable/snapshotted price, duplicate prompt prevention, authoritative payment verification, restart delivery, free redownload and retained purchase records.");
    // A separate paid result with the wrong amount must not release a PDF.
    fs.writeFileSync(bundlePath, JSON.stringify(bundle));
    const mismatchDir = path.join(directory, "mismatch");
    const badDeps = { ...deps, dataDir: mismatchDir, checkPayment: async id => {
      const i = [...invoices.values()].find(v => v.invoice_id === id); return { invoice: { ...i, state: "COMPLETE", value: 1 } };
    } };
    const bad = createService(badDeps);
    await bad.buy(ctx(111), "1234567890"); await settle();
    await bad.handleText(ctx(111), "0712345678"); await settle();
    assert.equal(Object.values(bad.records)[0].status, "REVIEW");
    assert.equal(documents.length, 2); bad.stop();
    // An uncertain STK submission must be checked, never silently resubmitted.
    const unknown = createService({ ...deps, dataDir: path.join(directory, "uncertain"),
      sendStk: async () => { throw new Error("Mock response lost"); }, listInvoices: async () => ({ results: [] }) });
    await unknown.buy(ctx(111), "1234567890"); await settle();
    await unknown.handleText(ctx(111), "0712345678"); await settle();
    const u = Object.values(unknown.records)[0]; assert.equal(u.status, "UNCERTAIN");
    const attempts = u.attempts.length;
    await unknown.buy(ctx(111), "1234567890"); await settle();
    assert.equal(u.attempts.length, attempts); unknown.stop();
    const previousCharges = charges;
    const unavailable = createService({ ...deps, dataDir: path.join(directory, "unavailable"),
      prepare: async () => { throw new Error("Mock invalid PDF"); } });
    await unavailable.buy(ctx(111), "1234567890"); await settle();
    assert.equal(Object.values(unavailable.records)[0].status, "OFFERED");
    assert.equal(charges, previousCharges); unavailable.stop();
    const expiry = createService({ ...deps, dataDir: path.join(directory, "expired-quote") });
    await expiry.buy(ctx(111), "1234567890"); await settle();
    time += 31 * 60 * 1000;
    await expiry.handleText(ctx(111), "0712345678");
    assert.equal(charges, previousCharges); assert.equal(Object.values(expiry.records)[0].status, "OFFERED"); expiry.stop();
    // Exercise the real cleanup function, including payment-file protection.
    const retentionData = path.join(directory, "retention-check"), tracked = { test: { files: [] } };
    const records = {};
    for (const name of ["pending", "paid", "delivered"]) {
      const dir = path.join(retentionData, "provider-runs", name); fs.mkdirSync(dir, { recursive: true });
      const filename = path.join(dir, "bundle.json"); fs.writeFileSync(filename, "fixture");
      const old = new Date(time - 49 * 60 * 60 * 1000); fs.utimesSync(filename, old, old); fs.utimesSync(dir, old, old);
      tracked.test.files.push({ providerBundleFile: filename, providerStatus: "COMPLETE" });
      records[name] = { bundlePath: filename, status: name.toUpperCase() };
    }
    const paymentFile = path.join(retentionData, "aiHighlightsPurchases.store.json");
    const paymentData = JSON.stringify({ version: 1, records }); fs.writeFileSync(paymentFile, paymentData);
    const result = require("./jk-file-retention.js").cleanFiles({ dataDir: retentionData, paidJobs: tracked,
      now: time, persist: () => {}, apply: true });
    assert.equal(result.deleted.length, 1); assert(result.deleted[0].endsWith("delivered"));
    assert(fs.existsSync(path.join(retentionData, "provider-runs", "pending")));
    assert(fs.existsSync(path.join(retentionData, "provider-runs", "paid")));
    assert.equal(fs.readFileSync(paymentFile, "utf8"), paymentData);
    console.log("PASS: wrong-amount rejection, uncertain-submission protection and no changes to original jobs. Mock tests only; no API requests, payments or Telegram deliveries.");
    console.log("PASS: unavailable PDF and expired quote block payment; real 48-hour cleanup protects pending/paid purchases and preserves payment records.");
  } finally { service.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
