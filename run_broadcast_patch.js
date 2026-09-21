const fs = require('fs');
const path = require('path');

const specPath = path.resolve(process.argv[2] || 'patch_broadcast.py');
const targetPath = path.resolve(process.argv[3] || 'bot.js');

if (!fs.existsSync(specPath)) throw new Error(`Missing patch spec: ${specPath}`);
if (!fs.existsSync(targetPath)) throw new Error(`Missing target: ${targetPath}`);

const spec = fs.readFileSync(specPath, 'utf8').replace(/\r\n/g, '\n');
const raw = fs.readFileSync(targetPath);
const newline = raw.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';

let text = raw.toString('utf8').replace(/\r\n/g, '\n');
const original = text;
const vars = Object.create(null);

for (const m of spec.matchAll(/^(\w+)\s*=\s*(r)?'''([\s\S]*?)'''\s*$/gm)) {
  vars[m[1]] = m[2] ? m[3] : m[3].replace(/\\\\/g, '\\');
}

function parseArg(s) {
  s = s.trim();

  const tm = s.match(/^r?'''([\s\S]*)'''$/);
  if (tm) return tm[1];

  const qm = s.match(/^'([^']*)'$/);
  if (qm) return qm[1];

  if (/^\w+$/.test(s) && Object.prototype.hasOwnProperty.call(vars, s)) {
    return vars[s];
  }

  throw new Error(`Cannot parse patch argument: ${s.slice(0, 80)}`);
}

function splitArgs(body) {
  const out = [];
  let start = 0;
  let i = 0;
  let triple = false;

  while (i < body.length) {
    if (body.startsWith("'''", i)) {
      triple = !triple;
      i += 3;
      continue;
    }

    if (!triple && body[i] === ',') {
      out.push(body.slice(start, i));
      start = i + 1;
    }

    i++;
  }

  out.push(body.slice(start));
  return out.map(x => x.trim()).filter(Boolean);
}

const calls = [];

for (const m of spec.matchAll(/^replace_once\(\n([\s\S]*?)^\)\s*$/gm)) {
  calls.push({ index: m.index, body: m[1] });
}

for (const m of spec.matchAll(/^replace_once\(([^\n]+)\)\s*$/gm)) {
  calls.push({ index: m.index, body: m[1] });
}

calls.sort((a, b) => a.index - b.index);

if (calls.length !== 8) {
  throw new Error(`Expected 8 replace_once calls, found ${calls.length}`);
}

for (const call of calls) {
  const args = splitArgs(call.body);

  if (args.length !== 3) {
    throw new Error(`Expected 3 arguments, found ${args.length}`);
  }

  const oldText = parseArg(args[0]);
  const newText = parseArg(args[1]);
  const label = parseArg(args[2]);

  const count = text.split(oldText).length - 1;

  if (count !== 1) {
    throw new Error(
      `PATCH FAILED [${label}]: expected 1 anchor, found ${count}`
    );
  }

  text = text.replace(oldText, newText);
}

if (text === original) {
  throw new Error('PATCH FAILED: no changes made');
}

const backupPath = targetPath + '.pre-broadcast.bak';

if (fs.existsSync(backupPath)) {
  throw new Error(`PATCH FAILED: backup already exists: ${backupPath}`);
}

fs.writeFileSync(backupPath, raw);

const output = newline === '\n'
  ? text
  : text.replace(/\n/g, '\r\n');

const tmp = targetPath + '.broadcast.tmp';

fs.writeFileSync(tmp, output, 'utf8');
fs.copyFileSync(tmp, targetPath);
fs.unlinkSync(tmp);

console.log(`PATCHED: ${targetPath}`);
console.log(`BACKUP:  ${backupPath}`);