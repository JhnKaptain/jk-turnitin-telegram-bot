"use strict";

// All output pages share the original JK Turnitin US Letter template.
// Existing clean Letter pages remain 1:1. Other page sizes, or pages with
// content intruding into the report shell, are fitted proportionally into
// the safe content area; neither the source page nor its highlights stretch.
const TEMPLATE_WIDTH = 612;
const TEMPLATE_HEIGHT = 792;
const HEADER_BAND = 46;
const FOOTER_BAND = 64;
const EPSILON = 0.01;

function fitReportSourcePage(width, height, gutters = {}) {
  const sourceWidth = Number(width);
  const sourceHeight = Number(height);
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
      sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("Invalid original PDF page dimensions.");
  }

  const topIntrusion = Math.max(0, Number(gutters.top) || 0);
  const bottomIntrusion = Math.max(0, Number(gutters.bottom) || 0);
  const letterSized = Math.abs(sourceWidth - TEMPLATE_WIDTH) <= EPSILON &&
    Math.abs(sourceHeight - TEMPLATE_HEIGHT) <= EPSILON;

  // Protect backwards compatibility for ordinary US Letter documents whose
  // text is already clear of the established report header and footer.
  if (letterSized && topIntrusion === 0 && bottomIntrusion === 0) {
    return Object.freeze({
      pageWidth: TEMPLATE_WIDTH,
      pageHeight: TEMPLATE_HEIGHT,
      sourceScale: 1,
      sourceX: 0,
      sourceY: 0
    });
  }

  const availableHeight = TEMPLATE_HEIGHT - HEADER_BAND - FOOTER_BAND;
  const sourceScale = Math.min(1, TEMPLATE_WIDTH / sourceWidth, availableHeight / sourceHeight);
  const fittedWidth = sourceWidth * sourceScale;
  const fittedHeight = sourceHeight * sourceScale;

  return Object.freeze({
    pageWidth: TEMPLATE_WIDTH,
    pageHeight: TEMPLATE_HEIGHT,
    sourceScale,
    sourceX: (TEMPLATE_WIDTH - fittedWidth) / 2,
    sourceY: FOOTER_BAND + (availableHeight - fittedHeight) / 2
  });
}

module.exports = {
  fitReportSourcePage,
  TEMPLATE_WIDTH,
  TEMPLATE_HEIGHT,
  HEADER_BAND,
  FOOTER_BAND
};
