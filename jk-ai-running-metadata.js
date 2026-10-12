"use strict";

function classifyAiRunningMetadata(pages) {
  const candidates = [];
  for (const [pageIndex, page] of (pages || []).entries()) {
    const ph = Number(page.height || page.embeddedPage?.height);
    const pw = Number(page.width || page.embeddedPage?.width);
    if (!Number.isFinite(ph) || Number(page.rotation || 0) !== 0) continue;

    for (const item of page.items || page.elements || []) {
      const text = String(item.text || "").trim();
      const y = Number(item.y ?? item.style?.bottom);
      const x = Number(item.x ?? item.style?.left);
      const height = Number(
        item.height ?? item.style?.height ?? item.size ?? 11
      );

      if (!text || text.length > 200 ||
          !Number.isFinite(y) || !Number.isFinite(height) ||
          height <= 0 || height > 30) continue;

      const top = ph - y - height;
      const band = top >= -2 && top < 55
        ? "header"
        : y >= -2 && y < 55 ? "footer" : null;

      if (!band) continue;

      const signature = band + ":" + text.toLowerCase()
        .replace(/\d+/g, "#").replace(/\s+/g, " ");

      const role = String(item.role || item.type || "").toLowerCase();
      const explicit = /^(header|footer|page[-_ ]?number)$/.test(role);
      const numeric = /^\d{1,4}$/.test(text) ||
        /^[ivxlcdm]{1,8}$/i.test(text);
      const labelled = /^page\s+\d+(?:\s+of\s+\d+)?$/i.test(text);
      const nameAndNumber = Number.isFinite(pw) && x > pw * 0.60 &&
        /^[\p{L}][\p{L} .'-]{0,100}\s+\d{1,4}$/u.test(text);

      candidates.push({
        item, pageIndex, text, signature, band,
        certain: explicit || numeric || labelled || nameAndNumber
      });
    }
  }

  const occurrences = new Map();
  for (const entry of candidates) {
    if (!occurrences.has(entry.signature)) {
      occurrences.set(entry.signature, new Set());
    }
    occurrences.get(entry.signature).add(entry.pageIndex);
  }

  return candidates.filter(entry =>
    entry.certain || occurrences.get(entry.signature).size >= 2
  );
}

function excludeAiRunningMetadata(prepared, document) {
  const source = String(document?.text || "");
  const ranges = classifyAiRunningMetadata(document?.pages)
    .map(entry => ({
      start: Number(entry.item.start),
      end: Number(entry.item.end),
      kind: entry.band
    }))
    .filter(r =>
      Number.isInteger(r.start) && Number.isInteger(r.end) &&
      r.start >= 0 && r.end > r.start && r.end <= source.length
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (!ranges.length) {
    return { ...prepared, removedRunningMetadataRanges: [] };
  }

  const excluded = new Set();
  for (const r of ranges) {
    for (let i = r.start; i < r.end; i++) excluded.add(i);
  }

  let text = "";
  const map = [];
  let gap = false;

  for (let i = 0; i < prepared.text.length; i++) {
    const origin = prepared.map[i];
    if (excluded.has(origin)) {
      if (!gap && text.length) {
        text += "\n";
        map.push(Number.NaN);
      }
      gap = true;
      continue;
    }

    gap = false;
    text += prepared.text[i];
    map.push(origin);
  }

  return {
    ...prepared, text, map,
    wordCount: text.trim().split(/\s+/u).filter(Boolean).length,
    removedRunningMetadataRanges: ranges
  };
}

function countAiPositiveSentences(bundle, ai) {
  const ranges = Array.isArray(bundle?.aiDetection?.ranges)
    ? bundle.aiDetection.ranges
    : (ai?.ranges || []);

  const keys = new Set();
  for (const r of ranges) {
    if (!Number.isFinite(r.start) || !Number.isFinite(r.end) ||
        r.end <= r.start) continue;

    if (Number.isFinite(r.providerStart) &&
        Number.isFinite(r.providerEnd)) {
      keys.add("provider:" + r.providerStart + ":" + r.providerEnd);
    } else if (r.id) {
      keys.add("id:" + r.id);
    } else {
      keys.add("source:" + r.start + ":" + r.end);
    }
  }
  return keys.size;
}

module.exports = {
  classifyAiRunningMetadata,
  excludeAiRunningMetadata,
  countAiPositiveSentences
};
