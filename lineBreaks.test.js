const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const breaks = require('./lineBreaks.js');
const settings = require('./replacementSettings.js');
const source = (text) => text.split('\n').map((text, index) => ({
  id: `line-${index}`, segments: [{ type: 'text', text }],
}));
const texts = (lines) => lines.map((line) => line.text);

test('offset 2 に追加、重複追加は無視し、追加改行を削除できる', () => {
  const edits = breaks.emptyState();
  const original = source('ABCDE');
  breaks.insertBreak(edits, { lineId: 'line-0', offset: 2 });
  breaks.insertBreak(edits, { lineId: 'line-0', offset: 2 });
  const lines = breaks.buildLines(original, edits);
  assert.deepEqual(texts(lines), ['AB', 'CDE']);
  breaks.removeBreak(edits, lines[0].boundaryAfter);
  assert.deepEqual(texts(breaks.buildLines(original, edits)), ['ABCDE']);
  assert.equal(original[0].segments[0].text, 'ABCDE');
});

test('既存境界の削除は空白を挿入しない', () => {
  const edits = breaks.emptyState();
  breaks.removeBreak(edits, { type: 'original', lineId: 'line-0' });
  assert.deepEqual(texts(breaks.buildLines(source('AAA\nBBB'), edits)), ['AAABBB']);
});

test('複合編集、連続結合、結合後の再分割', () => {
  const edits = { insertedBreaks: [{ lineId: 'line-0', offset: 1 }], removedLineBreaks: ['line-1'] };
  assert.deepEqual(texts(breaks.buildLines(source('AAA\nBBB\nCCC'), edits)), ['A', 'AA', 'BBBCCC']);
  edits.removedLineBreaks.push('line-0');
  breaks.insertBreak(edits, { lineId: 'line-2', offset: 1 });
  assert.deepEqual(texts(breaks.buildLines(source('AAA\nBBB\nCCC'), edits)), ['A', 'AABBBC', 'CC']);
});

test('先頭・末尾・空行と範囲外オフセット', () => {
  const edits = { insertedBreaks: [0, 2, 99].map((offset) => ({ lineId: 'line-0', offset })), removedLineBreaks: [] };
  assert.deepEqual(texts(breaks.buildLines(source('AB\n\n'), edits)), ['', 'AB', '', '', '']);
  assert.deepEqual(texts(breaks.buildLines(source(''), { insertedBreaks: [{ lineId: 'line-0', offset: 0 }], removedLineBreaks: [] })), ['', '']);
});

test('ハイライトのID・個別除外属性・元行位置を分割後も維持', () => {
  const match = { id: 'match-1' };
  const lines = breaks.buildLines([{ id: 'line-0', segments: [
    { type: 'text', text: 'A' }, { type: 'match', text: 'BCDE', match, isExcluded: true },
  ] }], { insertedBreaks: [{ lineId: 'line-0', offset: 3 }], removedLineBreaks: [] });
  assert.deepEqual(texts(lines), ['ABC', 'DE']);
  assert.equal(lines[0].segments[1].match, match);
  assert.equal(lines[1].segments[0].match, match);
  assert.equal(lines[1].segments[0].isExcluded, true);
  assert.equal(lines[1].segments[0].offset, 3);
});

function app() {
  const context = vm.createContext({
    LineBreaks: breaks, ReplacementSettingsIO: settings, structuredClone,
    document: { addEventListener() {}, querySelector() { return null; } },
    window: { setTimeout() {} },
  });
  vm.runInContext(fs.readFileSync('./script.js', 'utf8'), context);
  vm.runInContext(`
    renderCopyPanel = () => {};
    updateDragSelectionClasses = () => {};
    showToast = () => {};
    var copied = [];
    writeClipboard = async (text) => { copied.push(text); return true; };
  `, context);
  return (code) => vm.runInContext(code, context);
}

test('クリック・ドラッグのイベントが仮想行をコピーする', () => {
  const run = app();
  run(`state.displayLines = LineBreaks.buildLines([
    { id: 'line-0', segments: [{ text: 'AAA' }] },
    { id: 'line-1', segments: [{ text: 'BBB' }] },
    { id: 'line-2', segments: [{ text: 'CCC' }] }
  ], { insertedBreaks: [], removedLineBreaks: ['line-0'] });
  handleCopyClick({ target: { closest: () => ({ dataset: { lineIndex: '0' } }) } });
  state.drag = { active: true, moved: true, startIndex: 1, currentIndex: 0 };
  handleDocumentMouseUp();`);
  assert.equal(run('copied[0]'), 'AAABBB');
  assert.equal(run('copied[1]'), 'AAABBB\nCCC');
});

test('本文変更でリセット、ルール変更と同一本文への入力切替では保持', () => {
  const run = app();
  run(`state.textareaText = 'AAA'; invalidateAnalysis({resetExclusions: true});
    LineBreaks.insertBreak(state.lineBreaks, {lineId: 'line-0', offset: 1});
    invalidateAnalysis({resetExclusions: true});`);
  assert.equal(run('state.lineBreaks.insertedBreaks.length'), 1);
  run(`state.loadedFile = {text: 'AAA'}; state.activeInputSource = 'file'; invalidateAnalysis({resetExclusions: true});`);
  assert.equal(run('state.lineBreaks.insertedBreaks.length'), 1);
  run(`state.loadedFile = {text: 'BBB'}; invalidateAnalysis({resetExclusions: true});`);
  assert.equal(run('state.lineBreaks.insertedBreaks.length'), 0);
});

test('置換→改行編集→個別除外でも元の解析とmatch IDを維持', () => {
  const run = app();
  run(`state.textareaText = 'PC!';
    state.replacementRules = [{id:'r',source:'PC',target:'ABCDE',enabled:true,exclusionInput:''}];
    invalidateAnalysis({resetExclusions:true}); ensureAnalysis();
    var originalAnalysis = state.analysis;
    var matchId = state.analysis.matchesByLine['line-0'][0].id;
    state.lineBreaks.insertedBreaks.push({lineId:'line-0',offset:1});
    var build = () => LineBreaks.buildLines(state.analysis.lines.map(line => ({id:line.id,segments:buildRenderedLine(line).segments})), state.lineBreaks);
  `);
  assert.equal(run('build().map(line=>line.text).join("\\n")'), 'A\nBCDE!');
  run('toggleIndividualExclusion(matchId)');
  assert.equal(run('build().map(line=>line.text).join("\\n")'), 'P\nC!');
  assert.equal(run('state.analysis === originalAnalysis'), true);
  assert.equal(run('state.textareaText'), 'PC!');
});

test('旧v1 JSON互換・新項目の往復・不正な改行状態を拒否', () => {
  const base = { format: settings.FORMAT, version: 1, rules: [], individualState: {
    sourceFingerprint: 'fingerprint', excludedMatches: [],
  } };
  assert.equal(settings.validateReplacementSettings(base).ok, true);
  Object.assign(base.individualState, { insertedBreaks: [{lineId:'line-0',offset:2}], removedLineBreaks:['line-1'] });
  const restored = settings.parseReplacementSettingsJson(JSON.stringify(base));
  assert.deepEqual(restored.settings.individualState.insertedBreaks, base.individualState.insertedBreaks);
  assert.deepEqual(restored.settings.individualState.removedLineBreaks, ['line-1']);
  base.individualState.insertedBreaks[0].offset = -1;
  assert.equal(settings.validateReplacementSettings(base).ok, false);
});

test('本文固有状態を復元し、旧JSONでは改行編集を空に戻す', () => {
  const run = app();
  run("state.textareaText = 'AAA\\nBBB';");
  run(`invalidateAnalysis({resetExclusions:true});
    state.pendingIndividualStateRestore = {excludedMatches:[], insertedBreaks:[{lineId:'line-0',offset:1}],removedLineBreaks:['line-0']};
    ensureAnalysis();`);
  assert.equal(run('state.lineBreaks.insertedBreaks[0].offset'), 1);
  assert.equal(run('state.lineBreaks.removedLineBreaks[0]'), 'line-0');
  run(`state.pendingIndividualStateRestore = {excludedMatches:[]}; applyPendingIndividualStateRestore();`);
  assert.equal(run('state.lineBreaks.insertedBreaks.length'), 0);
  assert.equal(run('state.lineBreaks.removedLineBreaks.length'), 0);
});
