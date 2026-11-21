"use strict";
// JK_CHAT_DELETE_V1: delete chosen chat messages (or all) from the customer
// conversation and from Bot chat. Temporary folders only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMessageLog } = require("./jk-admin-messages.cjs");
const { createBotChat } = require("./jk-admin-bot-chat.cjs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-chat-delete-"));
try {
  // 1. Conversation log: ids on every message, including old saved ones.
  fs.writeFileSync(path.join(dir, "old.json"), JSON.stringify({ "555": [{ at: 1, from: "customer", kind: "text", text: "old message" }] }));
  const old = createMessageLog(path.join(dir, "old.json"));
  assert(old.thread(555)[0].id, "older messages get an id");

  let t = 1000;
  const log = createMessageLog(path.join(dir, "m.json"), { now: () => t++ });
  log.log(111, "customer", "Where is my report?");
  log.log(111, "admin", "Here it is");
  log.log(111, "customer", "Thanks!");
  assert.equal(log.waiting(111) > 0, true, "customer waiting (last message is theirs)");
  const [m1, , m3] = log.thread(111);
  // Delete the customer's last message: no longer "waiting for a reply".
  assert.deepEqual(log.remove(111, { ids: [m3.id] }), { removed: 1 });
  assert.equal(log.waiting(111), null);
  assert.deepEqual(log.thread(111).map(m => m.text), ["Where is my report?", "Here it is"]);
  assert.deepEqual(log.remove(111, { ids: ["nope"] }), { removed: 0 });
  // Whole conversation.
  assert.deepEqual(log.remove(111, { all: true }), { removed: 2 });
  assert.deepEqual(log.thread(111), []);
  assert(!log.waitingUsers().some(w => w.userId === "111"));
  void m1;

  // 2. Bot chat: chosen entries or all; kept files removed with them.
  const filesDir = path.join(dir, "files");
  fs.mkdirSync(filesDir);
  fs.writeFileSync(path.join(filesDir, "1-x-report.pdf"), "%PDF");
  const chat = createBotChat({ file: path.join(dir, "chat.json"), adminId: 1, filesDir });
  const a = chat.add({ from: "bot", text: "🧾 M-Pesa message received" });
  const b = chat.add({ from: "bot", text: "⏳ REPORTS READY", attachments: [{ kind: "document", name: "report.pdf", local: "1-x-report.pdf" }] });
  const c = chat.add({ from: "you", text: "/mode" });
  assert.deepEqual(chat.remove({ ids: [a.id, b.id] }), { removed: 2 });
  assert.deepEqual(chat.feed().entries.map(e => e.id), [c.id]);
  assert(!fs.existsSync(path.join(filesDir, "1-x-report.pdf")), "kept file removed too");
  assert.deepEqual(chat.remove({ all: true }), { removed: 1 });
  assert.deepEqual(chat.feed().entries, []);

  // 3. Panel routes and screens.
  const panel = fs.readFileSync(path.join(__dirname, "jk-admin-panel.cjs"), "utf8");
  const client = fs.readFileSync(path.join(__dirname, "jk-admin-panel.client.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "jk-admin-panel.html"), "utf8");
  assert(panel.includes('app.post("/admin/api/users/:uid/thread/delete", guard,') && panel.includes('app.post("/admin/api/bot/delete", guard,'));
  assert(html.includes('id="dwSelAll"') && html.includes('id="dwDel"') && html.includes('id="botSelAll"') && html.includes('id="botDel"'));
  assert(client.includes('"/admin/api/users/" + drawerUser + "/thread/delete"') && client.includes('"/admin/api/bot/delete"'));
  console.log("PASS: conversation: delete chosen messages or all; deleting the customer's last message clears 'waiting for a reply'.");
  console.log("PASS: Bot chat: delete chosen messages or all, with their kept files; panel routes and Select all / Delete selected.");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
