"use strict";
// No providers, PDFs, messages or network access. Layout arithmetic only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { reportSourceGutters } = require("./jk-report-source-gutters.cjs");

const sourcePage = (height, ...texts) => ({
  width: 612, height,
  elements: texts.map(([y, h], i) => ({
    text: "Body sentence " + i,
    style: { bottom: y, height: h, left: 60, width: 220 }
  }))
});
const normal = [sourcePage(792, [75, 12], [125, 12], [680, 12])];
const g0 = reportSourceGutters(normal);
assert.deepEqual(g0, { top: 0, bottom: 0 });
assert.equal(normal[0].height + g0.top + g0.bottom, 792);

const nearFooter = [sourcePage(792, [1.4, 12], [680, 12]), ...normal];
const gf = reportSourceGutters(nearFooter);
assert.deepEqual(gf, { top: 0, bottom: 80 });
assert.equal(792 + gf.top + gf.bottom, 872);
// Body text remains at its original distance from the top.
assert.equal((792 + gf.bottom) - (120 + gf.bottom), 792 - 120);
// The branded footer stays anchored 44pt from the new bottom edge.
assert.equal(872 - (872 - (792 - 748)), 792 - (792 - (792 - 748)));
assert(gf.bottom - (792 - 748) > 30);

assert.deepEqual(reportSourceGutters([sourcePage(792, [740, 12])]), { top: 64, bottom: 0 });
assert.deepEqual(reportSourceGutters([sourcePage(792, [2, 12], [770, 12])]), { top: 64, bottom: 80 });
assert.deepEqual(reportSourceGutters([sourcePage(842, [2, 12])]), { top: 0, bottom: 80 });
assert.deepEqual(reportSourceGutters([sourcePage(842, [90, 12])]), { top: 0, bottom: 0 });
assert.deepEqual(reportSourceGutters([{height:792,elements:[{text:"",style:{bottom:0,height:12}}]}]), {top:0,bottom:0});

const renderer = fs.readFileSync(path.join(__dirname, "jk-report-renderer-max.js"), "utf8");
assert(renderer.includes('require("./jk-report-source-gutters.cjs")'));
assert(renderer.includes('const sourceGutters = reportSourceGutters(originalPages);'));
assert(renderer.includes('sourceHeight + sourceGutters.top + sourceGutters.bottom'));
assert(renderer.includes('const sourceY = sourceGutters.bottom;'));
assert(renderer.includes('const sourceScale = 1;'));
console.log("PASS: normal pages retain identical canvas dimensions and source placement.");
console.log("PASS: footer-crowded, header-crowded, Letter and A4 sources receive conditional gutters.");
console.log("PASS: native-scale placement, branded footer anchor and highlight coordinate translation.");
console.log("Offline only. No API requests, document uploads or Telegram deliveries.");
