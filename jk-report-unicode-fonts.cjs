"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const fallbackByFont = new WeakMap();
const FONT_HASH = "3dfc051b7bfeec603b69db536633b5b6f33d58d78541253edfad4721cdbf7949";
function needsCjk(bundle) {
  return /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\u{20000}-\u{323af}]/u.test(JSON.stringify(bundle || {}));
}
function runs(font, value) {
  const state = fallbackByFont.get(font), text = String(value);
  if (!state) return [{ font, text }];
  const result = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    let chosen = font;
    if (!state.primary.has(code) && !/[\r\n\t]/u.test(char)) {
      if (!state.fallback.has(code)) throw new Error("Report font cannot display U+" + code.toString(16).toUpperCase() + ". Original text preserved; add a suitable font.");
      chosen = state.font;
    }
    const last = result.at(-1);
    if (last?.font === chosen) last.text += char;
    else result.push({ font: chosen, text: char });
  }
  return result.length ? result : [{ font, text: "" }];
}
async function attachUnicodeFonts(doc, fonts, bundle) {
  if (!needsCjk(bundle)) return fonts;
  const filename = path.join(__dirname, "assets", "fonts", "NotoSansSC-Regular.ttf");
  if (!fs.existsSync(filename)) throw new Error("CJK report font missing: assets/fonts/NotoSansSC-Regular.ttf. Run the Unicode font installer.");
  const bytes = fs.readFileSync(filename);
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== FONT_HASH) throw new Error("CJK report font failed its integrity check.");
  // HarfBuzz makes a complete, valid small TrueType font. pdf-lib/fontkit's
  // direct CJK subsetting can store text while dropping visible glyphs.
  const subsetFont = require("subset-font");
  const characters = [...new Set(JSON.stringify(bundle))].join("");
  const subset = await subsetFont(bytes, characters, { targetFormat: "truetype" });
  const fallback = await doc.embedFont(subset, { subset: false });
  const fallbackSet = new Set(fallback.getCharacterSet());
  for (const font of new Set(Object.values(fonts).filter(f => typeof f?.getCharacterSet === "function"))) {
    const nativeWidth = font.widthOfTextAtSize.bind(font);
    fallbackByFont.set(font, { font: fallback, primary: new Set(font.getCharacterSet()), fallback: fallbackSet, nativeWidth });
    font.widthOfTextAtSize = (value, size) => runs(font, value).reduce((sum, run) => sum +
      (run.font === font ? nativeWidth(run.text, size) : run.font.widthOfTextAtSize(run.text, size)), 0);
  }
  return fonts;
}
function drawUnicodeText(page, text, options) {
  const parts = runs(options.font, text);
  if (parts.length === 1 && parts[0].font === options.font) return page.drawText(text, options);
  let x = options.x;
  for (const run of parts) {
    page.drawText(run.text, { ...options, x, font: run.font });
    x += run.font.widthOfTextAtSize(run.text, options.size);
  }
}
module.exports = { attachUnicodeFonts, drawUnicodeText, needsCjk };
