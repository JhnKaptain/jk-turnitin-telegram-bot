"use strict";

// Independent, per-document SIMILARITY controls. AI filtering is deliberately
// unaffected: Sapling always retains quotes and excludes verified references.
const LEGACY_FILTERED = "FILTERED";
const LEGACY_UNFILTERED = "UNFILTERED";

function normalizeSimilarityFilters(value, legacyMode = LEGACY_FILTERED) {
  const mode = String(legacyMode || LEGACY_FILTERED).trim().toUpperCase();
  const legacyFiltered = mode !== LEGACY_UNFILTERED;
  const legacyQuotes = legacyFiltered &&
    String(process.env.JK_SIMILARITY_FILTER_QUOTES || "").trim() === "1";
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { excludeBibliography: legacyFiltered, excludeQuotes: legacyQuotes };
  }
  return {
    excludeBibliography:
      typeof value.excludeBibliography === "boolean"
        ? value.excludeBibliography : legacyFiltered,
    excludeQuotes:
      typeof value.excludeQuotes === "boolean"
        ? value.excludeQuotes : legacyQuotes
  };
}

function similarityFiltersMode(value, legacyMode) {
  const f = normalizeSimilarityFilters(value, legacyMode);
  return f.excludeBibliography || f.excludeQuotes
    ? LEGACY_FILTERED : LEGACY_UNFILTERED;
}

function toggleSimilarityFilter(value, which, legacyMode) {
  const f = normalizeSimilarityFilters(value, legacyMode);
  if (which === "bibliography") return { ...f, excludeBibliography: !f.excludeBibliography };
  if (which === "quotes") return { ...f, excludeQuotes: !f.excludeQuotes };
  throw new TypeError("Unsupported similarity filter toggle");
}

function similarityFiltersSummary(value, legacyMode) {
  const f = normalizeSimilarityFilters(value, legacyMode);
  if (f.excludeBibliography && f.excludeQuotes) return "Bibliography + quotes";
  if (f.excludeBibliography) return "Bibliography";
  if (f.excludeQuotes) return "Quotes";
  return "None";
}

function similarityFilterButtons(value, legacyMode) {
  const f = normalizeSimilarityFilters(value, legacyMode);
  return {
    bibliography: (f.excludeBibliography ? "☑" : "☐") + " Exclude bibliography",
    quotes: (f.excludeQuotes ? "☑" : "☐") + " Exclude quotes"
  };
}

module.exports = {
  normalizeSimilarityFilters,
  similarityFiltersMode,
  toggleSimilarityFilter,
  similarityFiltersSummary,
  similarityFilterButtons
};
