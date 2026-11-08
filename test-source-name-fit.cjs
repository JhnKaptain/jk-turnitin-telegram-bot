"use strict";
// JK_SOURCE_NAME_WIDTH_FIT_V1: long JK SimilarityCheck publication titles must stop
// before the % column; short titles, domains and Quetext sources are unchanged.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const { fitSourceName, sourceDomain, sourceLinkUrl, addSourceLinkAnnotation, SOURCE_NAME_MAX_WIDTH } = require("./jk-report-renderer-max.js");

(async () => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const dir = path.join(path.dirname(require.resolve("@fontsource/noto-sans/package.json")), "files");
  const file = fs.readdirSync(dir).find(n => n.includes("latin-600-normal") && n.endsWith(".woff"));
  const font = await doc.embedFont(fs.readFileSync(path.join(dir, file)));
  const w = t => font.widthOfTextAtSize(t, 8);
  const fit = source => fitSourceName(sourceDomain(source), font, 8, SOURCE_NAME_MAX_WIDTH);

  assert.equal(36 + SOURCE_NAME_MAX_WIDTH + 12, 386, "gap to the % column");
  // Display only the hostname, yet preserve the exact source page as the link.
  const example = { url: "https://researchonline.lshtm.ac.uk/id/eprint/123/file.pdf?track=1" };
  assert.equal(sourceDomain(example), "researchonline.lshtm.ac.uk");
  assert.equal(sourceLinkUrl(example), example.url);
  assert.equal(sourceLinkUrl({ url: "researchonline.lshtm.ac.uk/id/eprint/123" }), "https://researchonline.lshtm.ac.uk/id/eprint/123");
  assert.equal(sourceLinkUrl({ title: "A publication with no source URL" }), null);
  assert.equal(sourceLinkUrl({ url: "javascript:alert(1)" }), null);
  assert.equal(sourceLinkUrl({ url: "file:///etc/passwd" }), null);
  assert.equal(sourceLinkUrl({ url: "https://evil.test\\n/redirect" }), null, "reject ambiguous backslash URL");
  assert.equal(sourceLinkUrl({ url: "https://evil.test" + String.fromCharCode(10) + "/redirect" }), null, "reject embedded newline URL");
  const linkPage = doc.addPage([612, 792]);
  assert.equal(addSourceLinkAnnotation(doc, linkPage, example, "researchonline.lshtm.ac.uk", font, 36, 100, 8), true);
  assert.equal(addSourceLinkAnnotation(doc, linkPage, { title: "No URL" }, "No URL", font, 36, 125, 8), false);
  const linkAnnots = linkPage.node.Annots();
  assert.equal(linkAnnots.size(), 1, "one clickable source link");
  assert((await doc.save()).length > 0, "PDF with link annotation saves");


  const long = [
    "Socioeconomic status and health behavior in children and adolescents: a systematic literature review of the evidence",
    "Science Brief: Prevention and Control of Respiratory and Gastrointestinal Infections in Long-Term Care Facilities",
    "W".repeat(120),
    "il".repeat(80)
  ];
  for (const title of long) {
    const out = fit({ sourceType: "database", title });
    assert(w(out) <= SOURCE_NAME_MAX_WIDTH, `fits: ${out} (${w(out)})`);
    assert(out.endsWith("..."), "marked as cut");
    assert(title.startsWith(out.slice(0, -3)), "prefix of original title");
    assert(w(out.slice(0, -3) + title[out.length - 3] + "...") > SOURCE_NAME_MAX_WIDTH || out.length > 60, "uses the room");
  }

  const short = "COVID-19 and the Nervous System from a Cuban";
  assert.equal(fit({ sourceType: "database", title: short }), short);

  // Quetext sources: no type, URL only -> domain, exactly as before.
  assert.equal(fit({ url: "https://researchonline.lshtm.ac.uk/id/eprint/123/file.pdf" }), "researchonline.lshtm.ac.uk");
  assert.equal(fit({ sourceType: "internet", url: "https://stars.library.ucf.edu/x" }), "stars.library.ucf.edu");

  console.log("PASS: long publication titles stop before the % column (measured width).");
  console.log("PASS: short titles and domains (Quetext) unchanged.");
})().catch(e => { console.error(e); process.exit(1); });
