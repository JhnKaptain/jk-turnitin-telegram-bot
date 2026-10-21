"use strict";

// Protect the fixed report shell while keeping embedded source pages native.
// Reserve only missing whitespace: normal top/bottom margins remain unchanged.
// No canonical text, source maps, provider scores, or range offsets are changed.
const HEADER_CLEARANCE = 46; // Branded header logo ends ~40.5pt from top.
const FOOTER_CLEARANCE = 64; // Branded footer occupies ~28-44pt from bottom.

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

      const upperEdge = pageHeight - (y + height);
      top = Math.max(top, Math.ceil(HEADER_CLEARANCE - upperEdge));
      bottom = Math.max(bottom, Math.ceil(FOOTER_CLEARANCE - y));
    }
  }

  // One consistent page geometry across the original document. Its native
  // text/images are not rescaled; highlight coordinates shift by sourceY.
  return Object.freeze({ top, bottom });
}

module.exports = { reportSourceGutters };
