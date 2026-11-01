"use strict";
// Website (Turnitin card) AI highlights: a priced button per document, no
// Telegram-style status texts in the customer's chat. Mocks only: no payments.
const fs = require("fs"), path = require("path"), os = require("os"), assert = require("node:assert/strict");
const { createService } = require("./jk-client-ai-highlights.cjs");
const { isWebUserId, WEB_UID_BASE } = require("./jk-web-orders.cjs");
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-web-hl-"));
  const uid = WEB_UID_BASE + 77;
  const mk = (id, name) => {
    const jobDir = path.join(dir, "provider-runs", id); fs.mkdirSync(jobDir, { recursive: true });
    const bundlePath = path.join(jobDir, "bundle.json");
    const file = { jkSubmissionId: "trn:oid:::1:" + id, providerBundleFile: bundlePath, apiAiDeliveredAt: 1, file_name: name };
    fs.writeFileSync(bundlePath, JSON.stringify({ reportIdentity: { jkSubmissionId: file.jkSubmissionId, filename: name },
      canonicalDocument: { text: "Original sentence." }, aiDetection: { available: true, provider: "sapling", percent: 12,
        ranges: [{ id: "s1", start: 0, end: 18, score: 0.9, sentence: "Original sentence." }] } }));
    return file;
  };
  const job = { userId: uid, files: [mk("1234567890", "Essay.docx"), mk("2234567890", "Broken.docx")] };
  const messages = [], documents = [], invoices = new Map();
  let charges = 0;
  const service = createService({
    dataDir: dir, adminId: 999, env: { AI_HIGHLIGHTS_PRICE_KES: "50" }, getJobs: () => ({ j: job }), isWebUser: isWebUserId,
    telegram: {
      sendMessage: async (...a) => { messages.push(a); return { message_id: messages.length }; },
      sendDocument: async (to, doc) => { documents.push({ to, name: doc.filename || doc }); return { document: { file_id: "F" } }; },
    },
    prepare: async (input, output) => {
      if (input.includes("2234567890")) throw new Error("no highlightable sentences");
      fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, "%PDF-fixture");
    },
    sendStk: async body => { charges++; const invoice = { invoice_id: "inv" + charges, api_ref: body.api_ref, account: body.phone_number,
      currency: "KES", value: body.amount, state: "PENDING" }; invoices.set(body.api_ref, invoice); return { invoice }; },
    listInvoices: async ref => ({ results: invoices.has(ref) ? [invoices.get(ref)] : [] }),
    checkPayment: async id => ({ invoice: [...invoices.values()].find(i => i.invoice_id === id) }),
  });
  try {
    assert.equal(service.deliveryOffer(job).text, "", "no Telegram offer text in the website chat");
    assert.deepEqual(service.webOffers(job).map(o => [o.name, o.price, o.state]),
      [["Essay.docx", 50, "AVAILABLE"], ["Broken.docx", 50, "AVAILABLE"]], "button with price per document");

    await assert.rejects(service.webBuy(uid, "1234567890", "123"), e => e.status === 400);
    assert.equal(await service.webBuy(uid, "1234567890", "0712345678"), "CHECKING");
    await settle();
    assert.equal(charges, 1, "one M-Pesa prompt after the PDF is ready");
    assert.equal(service.webOffers(job)[0].state, "WAITING_PAYMENT");
    assert.equal(await service.webBuy(uid, "1234567890", "0712345678"), "WAITING_PAYMENT");
    await settle();
    assert.equal(charges, 1, "tapping again does not charge twice");

    // Not available for this document: no payment requested.
    await service.webBuy(uid, "2234567890", "0712345678"); await settle();
    assert.equal(charges, 1);
    assert.equal(service.webOffers(job)[1].state, "UNAVAILABLE");

    // Paid -> the PDF is delivered to the order (captured as a report).
    const r = Object.values(service.records).find(x => x.id === "1234567890");
    invoices.get(r.attempts[0].apiRef).state = "COMPLETE";
    await service.verify(r); await settle();
    assert.equal(documents.length, 1);
    assert.equal(documents[0].to, uid);
    assert.equal(service.webOffers(job)[0].state, "DELIVERED");
    assert.equal(await service.webBuy(uid, "1234567890", "0712345678"), "DELIVERED");
    assert.equal(charges, 1);
    assert.equal(messages.filter(m => m[0] === uid).length, 0, "no status texts spam the website chat");
    assert(messages.some(m => m[0] === 999 && /AI HIGHLIGHTS paid and delivered/.test(m[1])), "admin still gets the receipt");
    console.log("PASS: website AI highlights: priced button per document, one M-Pesa prompt, unavailable = no charge, PDF delivered, no chat spam");
  } finally {
    service.stop(); fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
