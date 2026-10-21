"use strict";

// Use native-scale embedded PDF pages. Additional space is allocated only
// when source text actually occupies the branded header/footer zone.
// This does not alter canonical text, source maps, provider scores or ranges.
const HEADER_BAND = 49;
const FOOTER_BAND = 61;
const HEADER_SPACE = 64;
const FOOTER_SPACE = 80;

function reportSourceGutters(pages) {
  let top = 0;
  let bottom = 0;

  for (const page of Array.isArray(pages) ? pages : []) {
    const pageHeight = Number(page?.height || page?.embeddedPage?.height);
    if (!Number.isFinite(pageHeight) || pageHeight <= 0) continue;

    for (const item of Array.isArray(page?.elements) ? page.elements : []) {
      if (!String(item?.text || "").trim()) continue;
      const y = Number(item?.style?.bottom);
      const height = Number(item?.style?.height || item?.size);
      if (!Number.isFinite(y) || !Number.isFinite(height) || height <= 0) continue;

      if (pageHeight - (y + height) < HEADER_BAND) top = HEADER_SPACE;
      if (y < FOOTER_BAND) bottom = FOOTER_SPACE;
      if (top && bottom) return Object.freeze({ top, bottom });
    }
  }

  // Consistent geometry across a document; its pages do not unpredictably
  // alternate between different sizes.
  return Object.freeze({ top, bottom });
}

module.exports = { reportSourceGutters };
