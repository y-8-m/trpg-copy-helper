const STORAGE_KEY = "trpg-copy-helper:settings:v1";

const state = {
  activeMainTab: "input",
  activeInputSource: "textarea",
  textareaText: "",
  loadedFile: null,
  replacementEnabled: true,
  replacementRules: [],
  isReplacementPanelOpen: false,
  isAnalysisDirty: true,
  analysis: null,
  individualExclusions: new Set(),
  drag: {
    active: false,
    startIndex: null,
    currentIndex: null,
    moved: false,
    suppressNextClick: false,
  },
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  loadSettings();
  bindEvents();
  render();
});

function bindElements() {
  elements.mainTabs = document.querySelectorAll("[data-main-tab]");
  elements.inputSourceTabs = document.querySelectorAll("[data-input-source]");
  elements.inputPanel = document.querySelector("#inputPanel");
  elements.copyPanel = document.querySelector("#copyPanel");
  elements.textareaPane = document.querySelector("#textareaPane");
  elements.filePane = document.querySelector("#filePane");
  elements.scenarioText = document.querySelector("#scenarioText");
  elements.fileInput = document.querySelector("#fileInput");
  elements.fileMeta = document.querySelector("#fileMeta");
  elements.filePreview = document.querySelector("#filePreview");
  elements.sourceCount = document.querySelector("#sourceCount");
  elements.replacementPanelToggle = document.querySelector("#replacementPanelToggle");
  elements.replacementPanel = document.querySelector("#replacementPanel");
  elements.replacementCaret = document.querySelector("#replacementCaret");
  elements.replacementSummary = document.querySelector("#replacementSummary");
  elements.replacementEnabled = document.querySelector("#replacementEnabled");
  elements.addRuleButton = document.querySelector("#addRuleButton");
  elements.rulesList = document.querySelector("#rulesList");
  elements.copyStatus = document.querySelector("#copyStatus");
  elements.copyEmpty = document.querySelector("#copyEmpty");
  elements.copyLines = document.querySelector("#copyLines");
  elements.toast = document.querySelector("#toast");
}

function bindEvents() {
  elements.mainTabs.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeMainTab = button.dataset.mainTab;
      if (state.activeMainTab === "copy") {
        ensureAnalysis();
      }
      render();
    });
  });

  elements.inputSourceTabs.forEach((button) => {
    button.addEventListener("click", () => {
      const nextSource = button.dataset.inputSource;
      if (state.activeInputSource === nextSource) {
        return;
      }
      state.activeInputSource = nextSource;
      invalidateAnalysis({ resetExclusions: true });
      render();
    });
  });

  elements.scenarioText.addEventListener("input", (event) => {
    state.textareaText = event.target.value;
    invalidateAnalysis({ resetExclusions: true });
    renderSourceMeta();
  });

  elements.fileInput.addEventListener("change", handleFileChange);

  elements.replacementPanelToggle.addEventListener("click", () => {
    state.isReplacementPanelOpen = !state.isReplacementPanelOpen;
    renderReplacementPanelState();
  });

  elements.replacementEnabled.addEventListener("change", (event) => {
    state.replacementEnabled = event.target.checked;
    saveSettings();
    invalidateAnalysis({ resetExclusions: true });
    render();
  });

  elements.addRuleButton.addEventListener("click", () => {
    state.replacementRules.push(createRule());
    saveSettings();
    invalidateAnalysis({ resetExclusions: true });
    renderRules();
    renderReplacementSummary();
  });

  elements.rulesList.addEventListener("input", handleRuleInput);
  elements.rulesList.addEventListener("change", handleRuleChange);
  elements.rulesList.addEventListener("click", handleRuleClick);

  elements.copyLines.addEventListener("mousedown", handleCopyMouseDown);
  elements.copyLines.addEventListener("mouseover", handleCopyMouseOver);
  elements.copyLines.addEventListener("mousemove", handleCopyMouseMove);
  elements.copyLines.addEventListener("click", handleCopyClick);
  document.addEventListener("mouseup", handleDocumentMouseUp);
}

function createRule() {
  return {
    id: createId(),
    source: "",
    target: "",
    enabled: true,
    exclusionInput: "",
  };
}

function createId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (typeof saved.replacementEnabled === "boolean") {
      state.replacementEnabled = saved.replacementEnabled;
    }
    if (Array.isArray(saved.replacementRules)) {
      state.replacementRules = saved.replacementRules.map(sanitizeRule);
    }
  } catch {
    state.replacementRules = [];
  }
}

function sanitizeRule(rule) {
  return {
    id: typeof rule.id === "string" ? rule.id : createId(),
    source: typeof rule.source === "string" ? rule.source : "",
    target: typeof rule.target === "string" ? rule.target : "",
    enabled: typeof rule.enabled === "boolean" ? rule.enabled : true,
    exclusionInput:
      typeof rule.exclusionInput === "string"
        ? rule.exclusionInput
        : Array.isArray(rule.exclusions)
          ? rule.exclusions.join(", ")
          : "",
  };
}

function saveSettings() {
  const settings = {
    replacementEnabled: state.replacementEnabled,
    replacementRules: state.replacementRules.map((rule) => ({
      id: rule.id,
      source: rule.source,
      target: rule.target,
      enabled: rule.enabled,
      exclusionInput: rule.exclusionInput,
    })),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function handleFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  if (!file.name.toLowerCase().endsWith(".txt")) {
    showToast(".txtファイルを選択してください");
    elements.fileInput.value = "";
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    state.loadedFile = {
      name: file.name,
      text: String(reader.result ?? ""),
    };
    state.activeInputSource = "file";
    invalidateAnalysis({ resetExclusions: true });
    render();
  });
  reader.addEventListener("error", () => {
    showToast("ファイルを読み込めませんでした");
  });
  reader.readAsText(file, "UTF-8");
}

function handleRuleInput(event) {
  const field = event.target.dataset.ruleField;
  const id = event.target.dataset.ruleId;
  if (!field || !id) {
    return;
  }
  const rule = findRule(id);
  if (!rule) {
    return;
  }
  rule[field] = event.target.value;
  saveSettings();
  invalidateAnalysis({ resetExclusions: true });

  if (field === "source") {
    const targetInput = [...elements.rulesList.querySelectorAll('[data-rule-field="target"]')].find(
      (input) => input.dataset.ruleId === id,
    );
    if (targetInput) {
      targetInput.placeholder = getDefaultReplacement(rule.source);
    }
  }
}

function handleRuleChange(event) {
  if (event.target.dataset.ruleField !== "enabled") {
    return;
  }
  const rule = findRule(event.target.dataset.ruleId);
  if (!rule) {
    return;
  }
  rule.enabled = event.target.checked;
  saveSettings();
  invalidateAnalysis({ resetExclusions: true });
  renderReplacementSummary();
}

function handleRuleClick(event) {
  const deleteButton = event.target.closest("[data-rule-action='delete']");
  if (!deleteButton) {
    return;
  }
  const ruleId = deleteButton.dataset.ruleId;
  state.replacementRules = state.replacementRules.filter((rule) => rule.id !== ruleId);
  saveSettings();
  invalidateAnalysis({ resetExclusions: true });
  renderRules();
  renderReplacementSummary();
}

function render() {
  renderTabs();
  renderInputSource();
  renderSourceMeta();
  renderReplacementPanelState();
  renderReplacementSummary();
  renderRules();
  renderCopyPanel();
}

function renderTabs() {
  elements.mainTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mainTab === state.activeMainTab);
  });
  elements.inputPanel.classList.toggle("is-hidden", state.activeMainTab !== "input");
  elements.copyPanel.classList.toggle("is-hidden", state.activeMainTab !== "copy");
}

function renderInputSource() {
  elements.inputSourceTabs.forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.inputSource === state.activeInputSource,
    );
  });
  elements.textareaPane.classList.toggle("is-hidden", state.activeInputSource !== "textarea");
  elements.filePane.classList.toggle("is-hidden", state.activeInputSource !== "file");

  if (elements.scenarioText.value !== state.textareaText) {
    elements.scenarioText.value = state.textareaText;
  }

  if (state.loadedFile) {
    elements.fileMeta.textContent = `${state.loadedFile.name} / ${countCharacters(state.loadedFile.text)}文字`;
    elements.filePreview.textContent = state.loadedFile.text;
  } else {
    elements.fileMeta.textContent = "ファイル未選択";
    elements.filePreview.textContent = "";
  }
}

function renderSourceMeta() {
  const text = getSourceText();
  const lines = text === "" ? 0 : splitLines(text).length;
  elements.sourceCount.textContent = `${countCharacters(text)}文字 / ${lines}行`;
}

function renderReplacementPanelState() {
  elements.replacementPanel.classList.toggle("is-hidden", !state.isReplacementPanelOpen);
  elements.replacementPanelToggle.setAttribute(
    "aria-expanded",
    String(state.isReplacementPanelOpen),
  );
  elements.replacementCaret.textContent = state.isReplacementPanelOpen ? "▼" : "▶";
  elements.replacementEnabled.checked = state.replacementEnabled;
}

function renderReplacementSummary() {
  elements.replacementSummary.textContent = `${state.replacementRules.length}件 ${
    state.replacementEnabled ? "ON" : "OFF"
  }`;
}

function renderRules() {
  elements.rulesList.textContent = "";
  if (state.replacementRules.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-rules";
    empty.textContent = "置換ルールは未登録です";
    elements.rulesList.append(empty);
    return;
  }

  state.replacementRules.forEach((rule) => {
    elements.rulesList.append(createRuleCard(rule));
  });
}

function createRuleCard(rule) {
  const card = document.createElement("article");
  card.className = "rule-card";

  const main = document.createElement("div");
  main.className = "rule-main";

  const sourceField = createTextField({
    label: "置換前",
    value: rule.source,
    placeholder: "例：PC",
    ruleId: rule.id,
    field: "source",
    singleLine: true,
  });

  const arrow = document.createElement("div");
  arrow.className = "rule-arrow";
  arrow.textContent = "→";

  const targetField = createTextField({
    label: "置換後",
    value: rule.target,
    placeholder: getDefaultReplacement(rule.source),
    ruleId: rule.id,
    field: "target",
    singleLine: true,
  });

  const enabledLabel = document.createElement("label");
  enabledLabel.className = "rule-enabled";
  const enabledInput = document.createElement("input");
  enabledInput.type = "checkbox";
  enabledInput.checked = rule.enabled;
  enabledInput.dataset.ruleId = rule.id;
  enabledInput.dataset.ruleField = "enabled";
  enabledLabel.append(enabledInput, "有効");

  const deleteButton = document.createElement("button");
  deleteButton.className = "danger-button";
  deleteButton.type = "button";
  deleteButton.textContent = "削除";
  deleteButton.dataset.ruleId = rule.id;
  deleteButton.dataset.ruleAction = "delete";

  main.append(sourceField, arrow, targetField, enabledLabel, deleteButton);

  const exclusionField = createTextField({
    label: "除外語",
    value: rule.exclusionInput,
    placeholder: "例：NPC, KPC",
    ruleId: rule.id,
    field: "exclusionInput",
    singleLine: false,
  });

  card.append(main, exclusionField);
  return card;
}

function createTextField({ label, value, placeholder, ruleId, field, singleLine }) {
  const wrapper = document.createElement("label");
  wrapper.className = singleLine ? "rule-field" : "exclusion-field";

  const labelText = document.createElement("span");
  labelText.textContent = label;

  const input = singleLine ? document.createElement("input") : document.createElement("textarea");
  input.className = singleLine ? "rule-input" : "exclusion-input";
  input.value = value;
  input.placeholder = placeholder;
  input.dataset.ruleId = ruleId;
  input.dataset.ruleField = field;
  if (singleLine) {
    input.type = "text";
  } else {
    input.rows = 2;
  }

  wrapper.append(labelText, input);
  return wrapper;
}

function renderCopyPanel() {
  if (state.activeMainTab !== "copy") {
    return;
  }

  ensureAnalysis();
  const text = getSourceText();
  if (text === "") {
    elements.copyStatus.textContent = "0行";
    elements.copyEmpty.classList.remove("is-hidden");
    elements.copyLines.classList.add("is-hidden");
    elements.copyLines.textContent = "";
    return;
  }

  const { lines } = state.analysis;
  elements.copyStatus.textContent = `${lines.length}行`;
  elements.copyEmpty.classList.add("is-hidden");
  elements.copyLines.classList.remove("is-hidden");
  elements.copyLines.textContent = "";

  lines.forEach((line, index) => {
    elements.copyLines.append(createLineElement(line, index));
  });
  updateDragSelectionClasses();
}

function createLineElement(line, index) {
  const row = document.createElement("div");
  row.className = "copy-line";
  row.dataset.lineIndex = String(index);

  const number = document.createElement("div");
  number.className = "line-number";
  number.textContent = String(line.lineNumber);

  const content = document.createElement("div");
  content.className = "line-content";

  const rendered = buildRenderedLine(line);
  rendered.segments.forEach((segment) => {
    if (segment.type === "text") {
      content.append(document.createTextNode(segment.text));
      return;
    }

    const chip = document.createElement("span");
    chip.className = "replacement-chip";
    chip.classList.toggle("is-excluded", segment.isExcluded);
    chip.textContent = segment.text;
    chip.title = segment.isExcluded ? "置換対象へ戻す" : "この箇所だけ置換しない";
    chip.dataset.matchId = segment.match.id;
    chip.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });
    chip.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleIndividualExclusion(segment.match.id);
    });
    content.append(chip);
  });

  row.append(number, content);
  return row;
}

function handleCopyMouseDown(event) {
  if (event.button !== 0) {
    return;
  }
  const row = event.target.closest(".copy-line");
  if (!row) {
    return;
  }
  event.preventDefault();
  state.drag.active = true;
  state.drag.startIndex = Number(row.dataset.lineIndex);
  state.drag.currentIndex = Number(row.dataset.lineIndex);
  state.drag.moved = false;
  updateDragSelectionClasses();
}

function handleCopyMouseOver(event) {
  if (!state.drag.active) {
    return;
  }
  const row = event.target.closest(".copy-line");
  updateDragCurrentRow(row);
}

function handleCopyMouseMove(event) {
  if (!state.drag.active) {
    return;
  }
  const hoveredElement = document.elementFromPoint(event.clientX, event.clientY);
  const row = hoveredElement?.closest(".copy-line");
  updateDragCurrentRow(row);
}

function updateDragCurrentRow(row) {
  if (!row) {
    return;
  }
  if (!elements.copyLines.contains(row)) {
    return;
  }
  const index = Number(row.dataset.lineIndex);
  if (index !== state.drag.currentIndex) {
    state.drag.currentIndex = index;
    state.drag.moved = true;
    updateDragSelectionClasses();
  }
}

function handleDocumentMouseUp() {
  if (!state.drag.active) {
    return;
  }

  const shouldCopyRange =
    state.drag.moved && state.drag.startIndex !== null && state.drag.currentIndex !== null;
  const start = state.drag.startIndex;
  const end = state.drag.currentIndex;
  clearDragState();

  if (shouldCopyRange) {
    copyLineRange(start, end);
    state.drag.suppressNextClick = true;
    window.setTimeout(() => {
      state.drag.suppressNextClick = false;
    }, 0);
  }
}

function handleCopyClick(event) {
  const row = event.target.closest(".copy-line");
  if (!row) {
    return;
  }
  if (state.drag.suppressNextClick) {
    state.drag.suppressNextClick = false;
    return;
  }
  copySingleLine(Number(row.dataset.lineIndex));
}

function clearDragState() {
  state.drag.active = false;
  state.drag.startIndex = null;
  state.drag.currentIndex = null;
  state.drag.moved = false;
  updateDragSelectionClasses();
}

function updateDragSelectionClasses() {
  const rows = elements.copyLines.querySelectorAll(".copy-line");
  rows.forEach((row) => row.classList.remove("is-selected"));

  if (!state.drag.active || state.drag.startIndex === null || state.drag.currentIndex === null) {
    return;
  }

  const min = Math.min(state.drag.startIndex, state.drag.currentIndex);
  const max = Math.max(state.drag.startIndex, state.drag.currentIndex);
  rows.forEach((row) => {
    const index = Number(row.dataset.lineIndex);
    row.classList.toggle("is-selected", index >= min && index <= max);
  });
}

function ensureAnalysis() {
  const sourceText = getSourceText();
  if (!state.isAnalysisDirty && state.analysis?.sourceText === sourceText) {
    return;
  }

  state.analysis = analyzeText(sourceText);
  state.isAnalysisDirty = false;
}

function analyzeText(sourceText) {
  const lines = splitLines(sourceText).map((originalText, index) => ({
    id: `line-${index}`,
    lineNumber: index + 1,
    originalText,
  }));
  const matchesByLine = {};

  if (!state.replacementEnabled) {
    lines.forEach((line) => {
      matchesByLine[line.id] = [];
    });
    return { sourceText, lines, matchesByLine };
  }

  const activeRules = state.replacementRules
    .map((rule, index) => ({
      ...rule,
      index,
      exclusions: parseExclusionInput(rule.exclusionInput),
    }))
    .filter((rule) => rule.enabled && rule.source !== "");

  lines.forEach((line) => {
    matchesByLine[line.id] = analyzeLine(line, activeRules);
  });

  return { sourceText, lines, matchesByLine };
}

function analyzeLine(line, rules) {
  const candidates = [];

  rules.forEach((rule) => {
    let start = line.originalText.indexOf(rule.source);
    while (start !== -1) {
      const end = start + rule.source.length;
      if (!isInsideExclusion(line.originalText, start, end, rule.exclusions)) {
        candidates.push({
          lineId: line.id,
          ruleId: rule.id,
          ruleIndex: rule.index,
          start,
          end,
          length: rule.source.length,
        });
      }
      start = line.originalText.indexOf(rule.source, end);
    }
  });

  candidates.sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    if (a.length !== b.length) {
      return b.length - a.length;
    }
    return a.ruleIndex - b.ruleIndex;
  });

  const selected = [];
  let cursor = 0;
  candidates.forEach((candidate) => {
    if (candidate.start < cursor) {
      return;
    }
    selected.push({
      id: `match-${line.id}-${candidate.start}-${candidate.end}-${candidate.ruleId}`,
      lineId: line.id,
      ruleId: candidate.ruleId,
      start: candidate.start,
      end: candidate.end,
      excluded: false,
    });
    cursor = candidate.end;
  });

  return selected;
}

function isInsideExclusion(text, start, end, exclusions) {
  return exclusions.some((exclusion) => {
    let exclusionStart = text.indexOf(exclusion);
    while (exclusionStart !== -1) {
      const exclusionEnd = exclusionStart + exclusion.length;
      if (start >= exclusionStart && end <= exclusionEnd) {
        return true;
      }
      exclusionStart = text.indexOf(exclusion, exclusionEnd);
    }
    return false;
  });
}

function buildRenderedLine(line) {
  const matches = state.analysis?.matchesByLine[line.id] ?? [];
  const segments = [];
  let cursor = 0;

  matches.forEach((match) => {
    if (cursor < match.start) {
      segments.push({
        type: "text",
        text: line.originalText.slice(cursor, match.start),
      });
    }

    const original = line.originalText.slice(match.start, match.end);
    const rule = findRule(match.ruleId);
    const isExcluded = state.individualExclusions.has(match.id);
    const replacement = rule ? getEffectiveReplacement(rule) : original;
    segments.push({
      type: "match",
      text: isExcluded ? original : replacement,
      match,
      isExcluded,
    });
    cursor = match.end;
  });

  if (cursor < line.originalText.length) {
    segments.push({
      type: "text",
      text: line.originalText.slice(cursor),
    });
  }

  if (segments.length === 0) {
    segments.push({ type: "text", text: "" });
  }

  return {
    segments,
    text: segments.map((segment) => segment.text).join(""),
  };
}

function toggleIndividualExclusion(matchId) {
  if (state.individualExclusions.has(matchId)) {
    state.individualExclusions.delete(matchId);
  } else {
    state.individualExclusions.add(matchId);
  }
  renderCopyPanel();
}

function copySingleLine(index) {
  const line = state.analysis?.lines[index];
  if (!line) {
    return;
  }
  const text = buildRenderedLine(line).text;
  writeClipboard(text).then((success) => {
    if (!success) {
      showToast("コピーできませんでした");
      return;
    }
    showToast(text === "" ? "空行をコピーしました" : "1行をコピーしました");
  });
}

function copyLineRange(startIndex, endIndex) {
  const min = Math.min(startIndex, endIndex);
  const max = Math.max(startIndex, endIndex);
  const lines = state.analysis?.lines.slice(min, max + 1) ?? [];
  const text = lines.map((line) => buildRenderedLine(line).text).join("\n");
  writeClipboard(text).then((success) => {
    if (!success) {
      showToast("コピーできませんでした");
      return;
    }
    showToast(`${lines.length}行をコピーしました`);
  });
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  document.body.append(textarea);
  textarea.select();
  let success = false;
  try {
    success = document.execCommand("copy");
  } catch {
    success = false;
  }
  textarea.remove();
  return success;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 1800);
}

function invalidateAnalysis({ resetExclusions }) {
  state.isAnalysisDirty = true;
  state.analysis = null;
  if (resetExclusions) {
    state.individualExclusions.clear();
  }
}

function getSourceText() {
  return state.activeInputSource === "textarea" ? state.textareaText : state.loadedFile?.text ?? "";
}

function findRule(ruleId) {
  return state.replacementRules.find((rule) => rule.id === ruleId);
}

function getDefaultReplacement(source) {
  if (source === "") {
    return "";
  }
  if (/^\{[^{}]+\}$/.test(source)) {
    return source.slice(1, -1);
  }
  return `{${source}}`;
}

function getEffectiveReplacement(rule) {
  return rule.target !== "" ? rule.target : getDefaultReplacement(rule.source);
}

function parseExclusionInput(value) {
  return value
    .split(/[,、\n]/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function splitLines(text) {
  return text.split(/\r\n|\r|\n/);
}

function countCharacters(text) {
  return Array.from(text).length;
}
