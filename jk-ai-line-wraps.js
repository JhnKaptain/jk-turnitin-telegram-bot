"use strict";

function joinAiVisualLineWraps(prepared, document) {
  const source = document?.text;

  if (
    typeof source !== "string" ||
    !Array.isArray(document?.pages)
  ) return prepared;

  if (
    typeof prepared?.text !== "string" ||
    !Array.isArray(prepared.map) ||
    prepared.map.length !== prepared.text.length
  ) throw new Error("Invalid AI input map.");

  const positions = new Map();

  prepared.map.forEach((sourceIndex, inputIndex) => {
    if (Number.isInteger(sourceIndex) && sourceIndex >= 0) {
      positions.set(sourceIndex, inputIndex);
    }
  });

  const chars = prepared.text.split("");
  let joined = 0;

  for (const page of document.pages) {
    if (Number(page.rotation || 0) !== 0 || !(page.width > 0)) continue;

    const items = Array.isArray(page.items) ? page.items : [];

    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1];
      const b = items[i];

      if (
        !a || !b ||
        ![a.start, a.end, b.start, b.end].every(Number.isInteger)
      ) continue;

      if (
        source.slice(a.start, a.end) !== a.text ||
        source.slice(b.start, b.end) !== b.text
      ) continue;

      const left = a.text.trimEnd();
      const right = b.text.trimStart();

      // Conservative continuation: long line, no sentence-ending
      // punctuation, followed by a lowercase word.
      if (
        left.length < 40 ||
        !/[\p{L}\p{N},;:]$/u.test(left) ||
        !/^\p{Ll}/u.test(right)
      ) continue;

      if (
        a.direction !== "ltr" ||
        b.direction !== "ltr" ||
        !a.fontName ||
        a.fontName !== b.fontName
      ) continue;

      if (
        ![a.x, b.x, a.y, b.y, a.height, b.height, a.width]
          .every(Number.isFinite)
      ) continue;

      const height = Math.max(a.height, b.height);
      const verticalGap = a.y - b.y;

      if (
        !(height > 0) ||
        Math.abs(a.height - b.height) > 0.5 ||
        Math.abs(a.x - b.x) > height * 0.5 ||
        verticalGap < height * 1.1 ||
        verticalGap > height * 2.8 ||
        a.width < page.width * 0.55
      ) continue;

      const separator = source.slice(a.end, b.start);

      // Preserve blank lines and paragraph gaps.
      if (!/^[ \t]*\r?\n[ \t]*$/.test(separator)) continue;

      const inputStart = positions.get(a.end - 1);
      const inputEnd = positions.get(b.start);

      if (
        !Number.isInteger(inputStart) ||
        !Number.isInteger(inputEnd) ||
        inputEnd - inputStart !== b.start - (a.end - 1)
      ) continue;

      // Do not join across removed or masked material.
      let intact = true;

      for (let s = a.end - 1; s <= b.start; s++) {
        const index = inputStart + s - (a.end - 1);

        if (prepared.map[index] !== s || chars[index] !== source[s]) {
          intact = false;
          break;
        }
      }

      if (!intact) continue;

      // Same-length replacement preserves every mapping position.
      for (let s = a.end; s < b.start; s++) {
        if (source[s] === "\r" || source[s] === "\n") {
          chars[inputStart + s - (a.end - 1)] = " ";
        }
      }

      joined++;
    }
  }

  return {
    ...prepared,
    text: chars.join(""),
    aiVisualLineWrapsJoined: joined
  };
}

module.exports = { joinAiVisualLineWraps };
