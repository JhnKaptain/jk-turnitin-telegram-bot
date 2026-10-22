"use strict";

// PDF page boundaries are fixed. Office files are rendered with LibreOffice
// on the server and can paginate differently from the author's Word/WPS.
function layoutFidelityNote(filename) {
  const name = String(filename || "").trim().toLowerCase();
  if (!/\.(doc|docx|odt|rtf)$/.test(name)) return "";
  return [
    "📄 Layout tip: DOCX/Word files can change page breaks during conversion.",
    "For the same pages, images and spacing as your Word/WPS copy,",
    "export it to PDF in Word/WPS and upload that PDF instead."
  ].join("\n");
}

module.exports = { layoutFidelityNote };
