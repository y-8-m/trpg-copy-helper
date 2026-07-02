const test = require("node:test");
const assert = require("node:assert/strict");
const settingsIO = require("./replacementSettings.js");

function createIdFactory() {
  let index = 0;
  return () => `generated-${(index += 1)}`;
}

test("通常のルール設定を書き出せる", () => {
  const exported = settingsIO.buildReplacementSettingsExport({
    name: "基本変数設定",
    exportedAt: "2026-07-03T01:30:00+09:00",
    rules: [
      {
        source: "PC",
        target: "{PC}",
        enabled: true,
        exclusions: ["NPC", "KPC"],
      },
    ],
  });

  assert.equal(exported.format, settingsIO.FORMAT);
  assert.equal(exported.version, 1);
  assert.equal(exported.rules.length, 1);
  assert.deepEqual(exported.rules[0].exclusions, ["NPC", "KPC"]);
});

test("未入力の target が null になる", () => {
  const exported = settingsIO.buildReplacementSettingsExport({
    name: "",
    exportedAt: "2026-07-03T01:30:00+09:00",
    rules: [{ source: "KPC", target: "", enabled: true, exclusions: [] }],
  });

  assert.equal(exported.rules[0].target, null);
});

test("内部IDが書き出されない", () => {
  const exported = settingsIO.buildReplacementSettingsExport({
    name: "",
    exportedAt: "2026-07-03T01:30:00+09:00",
    rules: [
      {
        id: "internal-id",
        source: "PC",
        target: "{PC}",
        enabled: true,
        exclusions: [],
      },
    ],
  });

  assert.equal("id" in exported.rules[0], false);
});

test("正常なJSONを読み込める", () => {
  const result = settingsIO.parseReplacementSettingsJson(
    JSON.stringify({
      format: settingsIO.FORMAT,
      version: 1,
      name: "基本変数設定",
      exportedAt: "2026-07-03T01:30:00+09:00",
      rules: [{ source: "PC", target: "{PC}", enabled: true, exclusions: ["NPC"] }],
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.settings.rules[0].source, "PC");
});

test("不正JSONでは既存設定が変わらない", () => {
  const currentRules = [{ id: "current", source: "PC", target: "", enabled: true }];
  const result = settingsIO.parseReplacementSettingsJson("{ broken json");

  assert.equal(result.ok, false);
  assert.deepEqual(currentRules, [{ id: "current", source: "PC", target: "", enabled: true }]);
});

test("置き換えモードが動作する", () => {
  const result = settingsIO.applyImportedRules({
    currentRules: [{ id: "current", source: "OLD", target: "", enabled: true }],
    importedRules: [
      { source: "PC", target: "{PC}", enabled: true, exclusions: [] },
      { source: "KPC", target: null, enabled: false, exclusions: ["NPC"] },
    ],
    mode: settingsIO.IMPORT_MODE_REPLACE,
    createId: createIdFactory(),
  });

  assert.equal(result.rules.length, 2);
  assert.equal(result.rules[0].source, "PC");
  assert.equal(result.rules[0].id, "generated-1");
  assert.equal(result.rules[1].target, "");
});

test("追加モードで重複 source がスキップされる", () => {
  const result = settingsIO.applyImportedRules({
    currentRules: [{ id: "current", source: "PC", target: "", enabled: true }],
    importedRules: [
      { source: "PC", target: "{PC}", enabled: true, exclusions: [] },
      { source: "pc", target: "{pc}", enabled: true, exclusions: [] },
      { source: "KPC", target: null, enabled: true, exclusions: [] },
    ],
    mode: settingsIO.IMPORT_MODE_APPEND,
    createId: createIdFactory(),
  });

  assert.equal(result.addedCount, 2);
  assert.equal(result.skippedCount, 1);
  assert.deepEqual(
    result.rules.map((rule) => rule.source),
    ["PC", "pc", "KPC"],
  );
});

test("本文ハッシュ一致時のみ個別除外状態を復元する", async () => {
  const sourceText = "KPC and PC";
  const fingerprint = await settingsIO.createSourceFingerprint(sourceText);
  const settings = {
    individualState: {
      sourceFingerprint: fingerprint,
      excludedMatches: [{ ruleIndex: 0, start: 0, end: 3, original: "KPC" }],
    },
  };
  const restoreStatus = await settingsIO.evaluateIndividualStateRestore({
    settings,
    sourceText,
    mode: settingsIO.IMPORT_MODE_REPLACE,
  });
  const restored = settingsIO.restoreExcludedMatchIds({
    individualState: settings.individualState,
    analysis: {
      normalizedSourceText: sourceText,
      matchesByLine: {
        "line-0": [{ id: "match-kpc", ruleIndex: 0, globalStart: 0, globalEnd: 3 }],
      },
    },
  });

  assert.equal(restoreStatus.canRestore, true);
  assert.deepEqual([...restored.ids], ["match-kpc"]);
});

test("本文ハッシュ不一致時はルールのみ読み込む", async () => {
  const settings = {
    individualState: {
      sourceFingerprint: await settingsIO.createSourceFingerprint("KPC"),
      excludedMatches: [{ ruleIndex: 0, start: 0, end: 3, original: "KPC" }],
    },
  };
  const restoreStatus = await settingsIO.evaluateIndividualStateRestore({
    settings,
    sourceText: "PC",
    mode: settingsIO.IMPORT_MODE_REPLACE,
  });
  const applied = settingsIO.applyImportedRules({
    currentRules: [],
    importedRules: [{ source: "KPC", target: null, enabled: true, exclusions: [] }],
    mode: settingsIO.IMPORT_MODE_REPLACE,
    createId: createIdFactory(),
  });

  assert.equal(restoreStatus.canRestore, false);
  assert.equal(applied.rules.length, 1);
});

test("追加モードでは個別除外状態を復元しない", async () => {
  const sourceText = "KPC";
  const settings = {
    individualState: {
      sourceFingerprint: await settingsIO.createSourceFingerprint(sourceText),
      excludedMatches: [{ ruleIndex: 0, start: 0, end: 3, original: "KPC" }],
    },
  };
  const restoreStatus = await settingsIO.evaluateIndividualStateRestore({
    settings,
    sourceText,
    mode: settingsIO.IMPORT_MODE_APPEND,
  });

  assert.equal(restoreStatus.canRestore, false);
  assert.equal(restoreStatus.reason, "append-mode");
});

test("一括リセットで個別除外だけが解除される", () => {
  const ids = new Set(["match-1", "match-2"]);
  const rules = [{ id: "rule-1", source: "PC" }];
  const clearedCount = settingsIO.clearIndividualExclusionIds(ids);

  assert.equal(clearedCount, 2);
  assert.equal(ids.size, 0);
  assert.deepEqual(rules, [{ id: "rule-1", source: "PC" }]);
});

test("一括リセットで再解析が走らない", () => {
  const ids = new Set(["match-1"]);
  const analysis = { marker: "keep" };
  const sameAnalysis = analysis;
  settingsIO.clearIndividualExclusionIds(ids);

  assert.strictEqual(analysis, sameAnalysis);
  assert.equal(analysis.marker, "keep");
});
