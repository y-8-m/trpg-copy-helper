(function (global) {
  const FORMAT = "trpg-copy-helper.replacement-settings";
  const VERSION = 1;
  const IMPORT_MODE_REPLACE = "replace";
  const IMPORT_MODE_APPEND = "append";

  /**
   * @typedef {Object} ExportedReplacementRule
   * @property {string} source
   * @property {string | null} target
   * @property {boolean} enabled
   * @property {string[]} exclusions
   */

  /**
   * @typedef {Object} ExportedExcludedMatch
   * @property {number} ruleIndex
   * @property {number} start
   * @property {number} end
   * @property {string} original
   */

  /**
   * @typedef {Object} ExportedIndividualState
   * @property {string} sourceFingerprint
   * @property {string | undefined} [sourceName]
   * @property {ExportedExcludedMatch[]} excludedMatches
   */

  /**
   * @typedef {Object} ExportedReplacementSettings
   * @property {string} format
   * @property {number} version
   * @property {string} name
   * @property {string} exportedAt
   * @property {ExportedReplacementRule[]} rules
   * @property {ExportedIndividualState | undefined} [individualState]
   */

  function normalizeNewlines(text) {
    return String(text).replace(/\r\n?/g, "\n");
  }

  async function createSourceFingerprint(text) {
    const normalizedText = normalizeNewlines(text);
    const data = new TextEncoder().encode(normalizedText);
    const cryptoApi = global.crypto;
    if (!cryptoApi?.subtle) {
      throw new Error("crypto.subtle is not available");
    }
    const hashBuffer = await cryptoApi.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function buildReplacementSettingsExport({ name, exportedAt, rules, individualState }) {
    const settings = {
      format: FORMAT,
      version: VERSION,
      name: typeof name === "string" ? name : "",
      exportedAt,
      rules: rules.map((rule) => ({
        source: rule.source,
        target: rule.target === "" ? null : rule.target,
        enabled: rule.enabled,
        exclusions: [...rule.exclusions],
      })),
    };

    if (individualState) {
      settings.individualState = individualState;
    }

    return settings;
  }

  function parseReplacementSettingsJson(jsonText) {
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return { ok: false, error: "invalid-json" };
    }
    return validateReplacementSettings(parsed);
  }

  function validateReplacementSettings(value) {
    if (!isRecord(value)) {
      return { ok: false, error: "not-object" };
    }
    if (value.format !== FORMAT) {
      return { ok: false, error: "unsupported-format" };
    }
    if (value.version !== VERSION) {
      return { ok: false, error: "unsupported-version" };
    }
    if (!Array.isArray(value.rules)) {
      return { ok: false, error: "invalid-rules" };
    }

    const rules = [];
    for (const rule of value.rules) {
      const validatedRule = validateRule(rule);
      if (!validatedRule.ok) {
        return { ok: false, error: "invalid-rule" };
      }
      rules.push(validatedRule.rule);
    }

    const settings = {
      format: FORMAT,
      version: VERSION,
      name: typeof value.name === "string" ? value.name : "",
      exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "",
      rules,
    };

    if (hasOwn(value, "individualState")) {
      const validatedState = validateIndividualState(value.individualState);
      if (!validatedState.ok) {
        return { ok: false, error: "invalid-individual-state" };
      }
      settings.individualState = validatedState.individualState;
    }

    return { ok: true, settings };
  }

  function validateRule(value) {
    if (!isRecord(value)) {
      return { ok: false };
    }
    if (typeof value.source !== "string" || value.source === "") {
      return { ok: false };
    }
    if (typeof value.target !== "string" && value.target !== null) {
      return { ok: false };
    }
    if (typeof value.enabled !== "boolean") {
      return { ok: false };
    }
    if (!Array.isArray(value.exclusions)) {
      return { ok: false };
    }
    if (!value.exclusions.every((item) => typeof item === "string")) {
      return { ok: false };
    }

    return {
      ok: true,
      rule: {
        source: value.source,
        target: value.target,
        enabled: value.enabled,
        exclusions: [...value.exclusions],
      },
    };
  }

  function validateIndividualState(value) {
    if (!isRecord(value)) {
      return { ok: false };
    }
    if (typeof value.sourceFingerprint !== "string" || value.sourceFingerprint === "") {
      return { ok: false };
    }
    if (
      hasOwn(value, "sourceName") &&
      value.sourceName !== undefined &&
      typeof value.sourceName !== "string"
    ) {
      return { ok: false };
    }
    if (!Array.isArray(value.excludedMatches)) {
      return { ok: false };
    }

    const excludedMatches = [];
    for (const match of value.excludedMatches) {
      if (!isRecord(match)) {
        return { ok: false };
      }
      if (!Number.isInteger(match.ruleIndex) || match.ruleIndex < 0) {
        return { ok: false };
      }
      if (!Number.isInteger(match.start) || match.start < 0) {
        return { ok: false };
      }
      if (!Number.isInteger(match.end) || match.end < match.start) {
        return { ok: false };
      }
      if (typeof match.original !== "string") {
        return { ok: false };
      }
      excludedMatches.push({
        ruleIndex: match.ruleIndex,
        start: match.start,
        end: match.end,
        original: match.original,
      });
    }

    return {
      ok: true,
      individualState: {
        sourceFingerprint: value.sourceFingerprint,
        sourceName: typeof value.sourceName === "string" ? value.sourceName : undefined,
        excludedMatches,
      },
    };
  }

  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function createInternalRuleFromExported(rule, createId) {
    return {
      id: createId(),
      source: rule.source,
      target: rule.target === null ? "" : rule.target,
      enabled: rule.enabled,
      exclusionInput: rule.exclusions.join(", "),
    };
  }

  function applyImportedRules({ currentRules, importedRules, mode, createId }) {
    const nextRules = importedRules.map((rule) => createInternalRuleFromExported(rule, createId));
    if (mode === IMPORT_MODE_REPLACE) {
      return {
        rules: nextRules,
        addedCount: nextRules.length,
        skippedCount: 0,
      };
    }

    const knownSources = new Set(currentRules.map((rule) => rule.source));
    const additions = [];
    let skippedCount = 0;
    nextRules.forEach((rule) => {
      if (knownSources.has(rule.source)) {
        skippedCount += 1;
        return;
      }
      knownSources.add(rule.source);
      additions.push(rule);
    });

    return {
      rules: [...currentRules, ...additions],
      addedCount: additions.length,
      skippedCount,
    };
  }

  async function evaluateIndividualStateRestore({ settings, sourceText, mode }) {
    if (!settings.individualState) {
      return {
        hasIndividualState: false,
        matchesSource: false,
        canRestore: false,
      };
    }
    if (mode !== IMPORT_MODE_REPLACE) {
      return {
        hasIndividualState: true,
        matchesSource: false,
        canRestore: false,
        reason: "append-mode",
      };
    }
    if (sourceText === "") {
      return {
        hasIndividualState: true,
        matchesSource: false,
        canRestore: false,
        reason: "empty-source",
      };
    }

    let currentFingerprint;
    try {
      currentFingerprint = await createSourceFingerprint(sourceText);
    } catch {
      return {
        hasIndividualState: true,
        matchesSource: false,
        canRestore: false,
        reason: "fingerprint-error",
      };
    }
    const matchesSource = currentFingerprint === settings.individualState.sourceFingerprint;
    return {
      hasIndividualState: true,
      matchesSource,
      canRestore: matchesSource,
      currentFingerprint,
    };
  }

  function restoreExcludedMatchIds({ individualState, analysis }) {
    const ids = new Set();
    if (!individualState || !analysis) {
      return { ids, restoredCount: 0, requestedCount: 0 };
    }

    const matchesByKey = new Map();
    Object.values(analysis.matchesByLine ?? {}).forEach((matches) => {
      matches.forEach((match) => {
        const original = analysis.normalizedSourceText.slice(match.globalStart, match.globalEnd);
        matchesByKey.set(createMatchKey(match.ruleIndex, match.globalStart, match.globalEnd, original), match);
      });
    });

    individualState.excludedMatches.forEach((excludedMatch) => {
      const originalAtPosition = analysis.normalizedSourceText.slice(
        excludedMatch.start,
        excludedMatch.end,
      );
      if (originalAtPosition !== excludedMatch.original) {
        return;
      }
      const match = matchesByKey.get(
        createMatchKey(
          excludedMatch.ruleIndex,
          excludedMatch.start,
          excludedMatch.end,
          excludedMatch.original,
        ),
      );
      if (match) {
        ids.add(match.id);
      }
    });

    return {
      ids,
      restoredCount: ids.size,
      requestedCount: individualState.excludedMatches.length,
    };
  }

  function createMatchKey(ruleIndex, start, end, original) {
    return `${ruleIndex}:${start}:${end}:${original}`;
  }

  function clearIndividualExclusionIds(exclusionIds) {
    const count = exclusionIds.size;
    exclusionIds.clear();
    return count;
  }

  function formatExportedAt(date = new Date()) {
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absoluteMinutes = Math.abs(offsetMinutes);
    const offsetHours = Math.floor(absoluteMinutes / 60);
    const offsetRemainder = absoluteMinutes % 60;
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(offsetHours)}:${pad(
      offsetRemainder,
    )}`;
  }

  function formatTimestampForFilename(date = new Date()) {
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
      date.getHours(),
    )}${pad(date.getMinutes())}`;
  }

  function createExportFileName(name, date = new Date()) {
    const safeName = sanitizeFileNamePart(name);
    const baseName = safeName === "" ? "replacement-settings" : safeName;
    return `${baseName}-${formatTimestampForFilename(date)}.json`;
  }

  function sanitizeFileNamePart(value) {
    return String(value ?? "")
      .trim()
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  const api = {
    FORMAT,
    VERSION,
    IMPORT_MODE_REPLACE,
    IMPORT_MODE_APPEND,
    normalizeNewlines,
    createSourceFingerprint,
    buildReplacementSettingsExport,
    parseReplacementSettingsJson,
    validateReplacementSettings,
    createInternalRuleFromExported,
    applyImportedRules,
    evaluateIndividualStateRestore,
    restoreExcludedMatchIds,
    clearIndividualExclusionIds,
    formatExportedAt,
    formatTimestampForFilename,
    createExportFileName,
    sanitizeFileNamePart,
  };

  global.ReplacementSettingsIO = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
