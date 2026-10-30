"use strict";

// Paid-provider-free regression for real Word OMML formulas and PDF embedding.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { PDFDocument } = require("pdf-lib");
const { extractDocument } = require("./jk-document-extractor.js");

const pythonFixture = String.raw`
import sys
from zipfile import ZipFile, ZIP_DEFLATED

out = sys.argv[1]
content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>'''
relationships = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''
document = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
<w:body>
<w:p><w:r><w:t>Source equation integrity test</w:t></w:r></w:p>
<w:p><m:oMathPara><m:oMath><m:f><m:num><m:r><m:t>271828</m:t></m:r></m:num><m:den><m:r><m:t>314159</m:t></m:r></m:den></m:f></m:oMath></m:oMathPara></w:p>
<w:p><m:oMathPara><m:oMath><m:r><m:t>=620418</m:t></m:r></m:oMath></m:oMathPara></w:p>
<w:p><w:r><w:t>End of test</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>'''
with ZipFile(out, "w", ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", content_types)
    z.writestr("_rels/.rels", relationships)
    z.writestr("word/document.xml", document)
`;

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-math-fidelity-"));
  try {
    const docxPath = path.join(dir, "equation.docx");
    const created = spawnSync("python3", ["-c", pythonFixture, docxPath], {
      encoding: "utf8", timeout: 20000
    });
    assert.equal(created.status, 0, created.stderr || "Cannot generate OMML fixture");

    const document = await extractDocument(docxPath);
    assert.equal(document.pageCount, 1);
    const text = document.text.replace(/\s+/g, "");
    assert(text.includes("Sourceequationintegritytest"), "Normal prose was lost");
    assert(text.includes("271828"), "Word equation numerator was lost");
    assert(text.includes("314159"), "Word equation denominator was lost");
    assert(text.includes("=620418"), "Leading equals sign was corrupted in canonical source PDF");
    assert(!text.includes("¿"), "LibreOffice emitted inverted-question-mark math placeholder");
    assert(text.includes("Endoftest"), "Post-equation prose was lost");

    // The reports use pdf-lib embedPdf + drawPage. Guard this exact pathway too.
    const pdf = await PDFDocument.create();
    const [embedded] = await pdf.embedPdf(fs.readFileSync(document.pdfPath), [0]);
    const page = pdf.addPage([embedded.width, embedded.height]);
    page.drawPage(embedded, {
      x: 0, y: 0, width: embedded.width, height: embedded.height
    });
    const reportPath = path.join(dir, "embedded.pdf");
    fs.writeFileSync(reportPath, await pdf.save());
    const report = await extractDocument(reportPath);
    const reportText = report.text.replace(/\s+/g, "");
    assert(reportText.includes("271828"), "Equation numerator missing after report PDF embedding");
    assert(reportText.includes("314159"), "Equation denominator missing after report PDF embedding");
    assert(reportText.includes("=620418"), "Leading equals sign was corrupted after PDF embedding");
    assert(!reportText.includes("¿"), "Math placeholder survived in embedded report");
    assert(reportText.includes("Endoftest"), "Normal prose missing after report PDF embedding");
    console.log("PASS: Word OMML fraction, leading equals and prose survive source conversion and report PDF embedding.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
