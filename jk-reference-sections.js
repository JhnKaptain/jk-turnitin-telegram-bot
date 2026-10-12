"use strict";

function findReferenceSections(source, fallbackStart = -1) {
  const headings = [];
  const re = /(^|\n)[ \t]*(reference list|references?|bibliography|works cited|table of cases|table of legislation)[ \t]*:?[ \t]*(?=\r?\n|$)/gim;
  let match;

  while ((match = re.exec(source))) {
    const start = match.index + match[1].length;
    if (start >= source.length * 0.30) headings.push(start);
  }

  // Retain the existing flattened-heading fallback.
  if (!headings.length &&
      Number.isInteger(fallbackStart) && fallbackStart >= 0) {
    headings.push(fallbackStart);
  }

  const ranges = [];
  const terminator = /(^|\n)[ \t]*(?:(?:appendix|appendices|glossary|acknowledgements?|acknowledgments?|exhibits)(?:[ \t]+[^\r\n]+)?|(?:tables?|figures?|charts?)(?:[ \t]+\d+[^\r\n]*)?)[ \t]*:?[ \t]*(?=\r?\n|$)/gim;

  let excludedUntil = -1;

  for (const start of headings) {
    if (start < excludedUntil) continue;

    terminator.lastIndex = start;
    const endMatch = terminator.exec(source);
    const end = endMatch
      ? endMatch.index + endMatch[1].length
      : source.length;

    if (end > start) {
      ranges.push({ start, end });
      excludedUntil = end;
    }
  }

  return ranges;
}

function prepareWithoutReferences(rawText, builder, fallbackStart = -1) {
  const source = String(rawText || "");
  const ranges = findReferenceSections(source, fallbackStart);
  if (!ranges.length) return builder(source);

  let text = "";
  const map = [];
  let cursor = 0;

  for (const range of ranges) {
    for (let i = cursor; i < range.start; i++) {
      text += source[i];
      map.push(i);
    }

    if (text.length) {
      text += "\n";
      map.push(Number.NaN);
    }

    cursor = range.end;
  }

  for (let i = cursor; i < source.length; i++) {
    text += source[i];
    map.push(i);
  }

  const prepared = builder(text);

  const composed = prepared.map.map(index =>
    Number.isInteger(index) && index >= 0
      ? map[index]
      : Number.NaN
  );

  const quoteRanges = (prepared.removedQuoteRanges || [])
    .map(range => ({
      ...range,
      start: map[range.start],
      end: map[range.end - 1] + 1
    }))
    .filter(range =>
      Number.isFinite(range.start) && Number.isFinite(range.end)
    );

  return {
    ...prepared,
    map: composed,
    removedQuoteRanges: quoteRanges,
    originalLength: source.length,
    bibliographyStart: ranges[0].start,
    removedReferenceRanges: ranges
  };
}

module.exports = {
  findReferenceSections,
  prepareWithoutReferences
};
