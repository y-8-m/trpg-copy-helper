const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function app(saved = null) {
  const storage = new Map(saved === null ? [] : [['trpg-copy-helper:copy-font-size:v1', saved]]);
  const context = vm.createContext({
    LineBreaks: require('./lineBreaks.js'),
    ReplacementSettingsIO: require('./replacementSettings.js'),
    structuredClone, crypto: require('node:crypto').webcrypto,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    document: { addEventListener() {}, querySelector() { return null; } },
    window: { setTimeout() {} },
  });
  const run = code => vm.runInContext(code, context);
  run(fs.readFileSync('./script.js', 'utf8'));
  run(`
    elements.copyLines = { style: { setProperty(key, value) { this[key] = value; } } };
    elements.copyFontSize = {};
    elements.copyFontDecrease = {};
    elements.copyFontIncrease = {};
    loadCopyFontSize(); renderCopyFontSize();
  `);
  return { run, storage };
}

test('初期値16px、全7段階の増減、上下限とdisabled、保存・復元', () => {
  const { run, storage } = app();
  assert.equal(run('state.copyFontSize'), 16);
  for (const size of [18, 20, 22, 24, 24]) {
    run('changeCopyFontSize(1)');
    assert.equal(run('state.copyFontSize'), size);
    assert.equal(run('elements.copyFontSize.textContent'), `${size}px`);
    assert.equal(run('elements.copyLines.style["--copy-font-size"]'), `${size}px`);
  }
  assert.equal(run('elements.copyFontIncrease.disabled'), true);
  for (const size of [22, 20, 18, 16, 14, 12, 12]) {
    run('changeCopyFontSize(-1)');
    assert.equal(run('state.copyFontSize'), size);
  }
  assert.equal(run('elements.copyFontDecrease.disabled'), true);
  assert.equal(run('elements.copyFontIncrease.disabled'), false);
  assert.equal(app(storage.get('trpg-copy-helper:copy-font-size:v1')).run('state.copyFontSize'), 12);
});

test('不正な保存値は16pxに戻す', () => {
  for (const value of ['oops', 'null', '{}', '[]', 'true', '13', '0', '26', '"18"']) {
    assert.equal(app(value).run('state.copyFontSize'), 16, value);
  }
});

test('本文変更・入力切替・ルール変更・JSON読み込みでも設定を保持し、JSONに含めない', async () => {
  const { run } = app('22');
  run(`render = () => {}; renderSettingsTransfer = () => {}; showToast = () => {};
    state.textareaText = 'AAA'; invalidateAnalysis({resetExclusions:true});
    state.loadedFile = {text:'BBB'}; state.activeInputSource = 'file'; invalidateAnalysis({resetExclusions:true});
    state.replacementRules = []; saveSettings(); invalidateAnalysis({resetExclusions:true});
    state.pendingImport = { settings: {name:'test', rules:[]} };
  `);
  await run('applyPendingImport("replace")');
  assert.equal(run('state.copyFontSize'), 22);
  run(`var exported; downloadJson = (_, data) => { exported = data; };
    state.replacementRules = [{id:'r', source:'PC', target:'ABC', enabled:true, exclusionInput:''}];`);
  await run('handleExportSettings()');
  assert.equal(run('JSON.stringify(exported).includes("copyFontSize")'), false);
});

test('改行編集・個別除外を含むクリック／ドラッグコピーがサイズ変更前後で一致する', () => {
  const { run } = app();
  run(`renderCopyPanel = () => {}; updateDragSelectionClasses = () => {}; showToast = () => {};
    var copied = []; writeClipboard = async text => { copied.push(text); return true; };
    state.textareaText = 'PC!\\n次の行';
    state.replacementRules = [{id:'r', source:'PC', target:'ABCDE', enabled:true, exclusionInput:''}];
    ensureAnalysis();
    LineBreaks.insertBreak(state.lineBreaks, {lineId:'line-0', offset:1});
    toggleIndividualExclusion(state.analysis.matchesByLine['line-0'][0].id);
    state.displayLines = LineBreaks.buildLines(state.analysis.lines.map(line => ({id:line.id, segments:buildRenderedLine(line).segments})), state.lineBreaks);
    var originalLines = state.displayLines;
    var copyBoth = () => {
      handleCopyClick({target:{closest:()=>({dataset:{lineIndex:'0'}})}});
      state.drag = {active:true, moved:true, startIndex:0, currentIndex:2}; handleDocumentMouseUp();
      // Mouseup is followed by a click, which the drag handler suppresses.
      handleCopyClick({target:{closest:()=>({dataset:{lineIndex:'2'}})}});
    };
    copyBoth(); changeCopyFontSize(1); changeCopyFontSize(1); changeCopyFontSize(1); changeCopyFontSize(1); copyBoth();
  `);
  assert.equal(run('state.displayLines === originalLines'), true);
  assert.equal(run('copied[0]'), 'P');
  assert.equal(run('copied[1]'), 'P\nC!\n次の行');
  assert.equal(run('copied[0] === copied[2] && copied[1] === copied[3]'), true);
  assert.equal(run('state.individualExclusions.size'), 1);
});

test('CSSは本文だけサイズを変更し、行番号・折り返し・可変行高を維持', () => {
  const css = fs.readFileSync('./styles.css', 'utf8');
  const rule = selector => css.match(new RegExp(`\\.${selector} \\{([^}]+)\\}`))[1];
  assert.match(rule('line-content'), /font-size: var\(--copy-font-size\)/);
  assert.match(rule('line-number'), /font-size: 0\.8rem/);
  assert.match(rule('line-content'), /white-space: pre-wrap/);
  assert.match(rule('line-content'), /word-break: break-word/);
  assert.doesNotMatch(rule('copy-line'), /(?:^|;)\s*height:/);
  assert.equal((css.match(/font-size: var\(--copy-font-size\)/g) || []).length, 1);
});
