import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, loadSettings, saveSettings, validateSettings, matchesShortcut, shortcutFromEvent } from '../src/client/settings.mjs';

const settings = (patch = {}) => ({ ...DEFAULT_SETTINGS, ...patch, shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...patch.shortcuts } });
const emptyShortcuts = { commit: '', aiCommit: '', push: '', fetch: '' };
const bindingSettings = (shortcuts) => settings({ shortcuts: { ...emptyShortcuts, ...shortcuts } });
const event = (key, patch = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, view: { navigator: { platform: 'Win32' } }, ...patch });
function storage(initial) {
  const items = new Map(initial === undefined ? [] : [[SETTINGS_STORAGE_KEY, initial]]);
  return { items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
}

test('defaults are complete, immutable and use an editable Chinese Conventional Commits prompt', () => {
  assert.deepEqual(Object.keys(DEFAULT_SETTINGS), ['provider', 'model', 'prompt', 'shortcuts']);
  assert.equal(DEFAULT_SETTINGS.provider, ''); assert.equal(DEFAULT_SETTINGS.model, '');
  assert.match(DEFAULT_SETTINGS.prompt, /Conventional Commits/); assert.match(DEFAULT_SETTINGS.prompt, /中文/);
  assert.deepEqual(DEFAULT_SETTINGS.shortcuts, { commit: 'Ctrl+Enter', aiCommit: 'Ctrl+Shift+Enter', push: 'Ctrl+Shift+P', fetch: 'Ctrl+Shift+F' });
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS)); assert.ok(Object.isFrozen(DEFAULT_SETTINGS.shortcuts));
  assert.equal(validateSettings(DEFAULT_SETTINGS), null);
});

test('each settings load returns independently mutable data without sharing defaults', () => {
  const one = loadSettings(null), two = loadSettings(null);
  assert.deepEqual(one, DEFAULT_SETTINGS); assert.notEqual(one, two); assert.notEqual(one.shortcuts, two.shortcuts);
  one.shortcuts.commit = ''; one.prompt = 'changed';
  assert.equal(two.shortcuts.commit, 'Ctrl+Enter'); assert.equal(two.prompt, DEFAULT_SETTINGS.prompt);
});

test('validation accepts an unselected model or a complete pair, and rejects partial model selection', () => {
  assert.equal(validateSettings(settings()), null);
  assert.equal(validateSettings(settings({ provider: 'openai', model: 'example-model' })), null);
  for (const patch of [{ provider: 'openai' }, { model: 'example-model' }, { provider: '  ', model: 'x' }, { provider: 'x', model: '  ' }]) assert.match(validateSettings(settings(patch)), /同时填写/);
});

test('validation rejects malformed settings, field types, identifier controls and oversized identifiers', () => {
  for (const value of [null, undefined, [], 'value', 42]) assert.match(validateSettings(value), /格式/);
  for (const patch of [{ provider: null }, { model: 3 }]) assert.match(validateSettings(settings(patch)), /文本/);
  for (const patch of [{ provider: 'a'.repeat(257), model: 'm' }, { provider: 'p', model: 'a'.repeat(257) }, { provider: 'p\n', model: 'm' }, { provider: 'p', model: 'm\u007f' }]) assert.match(validateSettings(settings(patch)), /控制字符/);
  assert.equal(validateSettings(settings({ provider: 'p'.repeat(256), model: 'm'.repeat(256) })), null);
});

test('prompt must be nonblank text, at most 16000 characters, and may contain normal newlines', () => {
  for (const prompt of ['', '  \n\t ', null, 123]) assert.match(validateSettings(settings({ prompt })), /不能为空/);
  for (const prompt of ['x'.repeat(16001), 'test\0value']) assert.match(validateSettings(settings({ prompt })), /16000/);
  assert.equal(validateSettings(settings({ prompt: '中文规范\n\n保持换行。' })), null);
  assert.equal(validateSettings(settings({ prompt: 'x'.repeat(16000) })), null);
});

test('shortcut maps and all known shortcut values must have the expected types', () => {
  for (const shortcuts of [null, [], 'keys']) assert.match(validateSettings({ ...settings(), shortcuts }), /格式/);
  assert.match(validateSettings({ ...settings(), shortcuts: {} }), /必须是文本/);
  assert.match(validateSettings(bindingSettings({ push: 1 })), /必须是文本/);
});

test('empty and whitespace-only shortcut bindings disable actions and are not duplicates', () => {
  assert.equal(validateSettings(bindingSettings(emptyShortcuts)), null);
  assert.equal(validateSettings(bindingSettings({ commit: '  ', aiCommit: '\t' })), null);
  assert.equal(matchesShortcut(event('Enter', { ctrlKey: true }), ''), false);
  assert.equal(matchesShortcut(event('Enter', { ctrlKey: true }), '  '), false);
});

test('malformed shortcut syntax is rejected with a readable error', () => {
  const invalid = ['Ctrl', 'Shift', 'Mod', 'Control+P+Q', 'Ctrl++P', 'Ctrl+Ctrl+P', 'Ctrl+Control+P', 'Ctrl+Shift+', 'Ctrl+F25', 'Ctrl+Unknown', 'Mod+Ctrl+P', 'Meta+Mod+P', 'Ctrl+ P +', 'Ctrl+Enter+Shift', 'x'.repeat(121), 'Ctrl+\0'];
  for (const binding of invalid) assert.match(validateSettings(bindingSettings({ commit: binding })), /格式不正确/, binding);
});

test('aliases, modifier order, key casing and whitespace cannot bypass duplicate checks', () => {
  const duplicates = [
    ['Ctrl+Shift+P', 'shift + control + p'],
    ['Meta+Enter', 'Cmd+Return'],
    ['Alt+ArrowUp', 'option+up'],
    ['Ctrl++', 'Ctrl+Plus'],
    ['Ctrl+Space', 'Control+Spacebar'],
    ['Ctrl+Escape', 'Control+Esc'],
  ];
  for (const [commit, push] of duplicates) assert.match(validateSettings(bindingSettings({ commit, push })), /重复/, `${commit} / ${push}`);
});

test('Mod conflicts are detected on either supported platform, including Alt and Shift variants', () => {
  for (const [commit, push] of [['Ctrl+K', 'Mod+K'], ['Meta+K', 'Mod+K'], ['Ctrl+Shift+Alt+K', 'Mod+Alt+Shift+K'], ['Mod+K', 'Command+K']]) assert.match(validateSettings(bindingSettings({ commit, push })), /重复.*Mod/, `${commit} / ${push}`);
  assert.equal(validateSettings(bindingSettings({ commit: 'Ctrl+K', push: 'Meta+K' })), null);
  assert.equal(validateSettings(bindingSettings({ commit: 'Ctrl+K', push: 'Mod+Shift+K', fetch: 'Mod+Alt+K', aiCommit: 'Ctrl+Meta+K' })), null);
});

test('load handles empty, unavailable and throwing browser storage without touching globals', () => {
  for (const value of [undefined, null, {}, storage(), { getItem() { throw new Error('blocked'); } }, { get getItem() { throw new Error('blocked property'); } }]) assert.deepEqual(loadSettings(value), DEFAULT_SETTINGS);
});

test('load rejects invalid JSON, nonobjects, malformed shortcut maps and invalid persisted fields', () => {
  for (const raw of ['{broken', 'null', '[]', '42', '"text"', '{"shortcuts":[]}', '{"shortcuts":null}', '{"prompt":null}', '{"provider":"p"}', '{"shortcuts":{"commit":"Ctrl+P","push":"Ctrl+P"}}']) assert.deepEqual(loadSettings(storage(raw)), DEFAULT_SETTINGS, raw);
});

test('load fills missing fields for schema evolution while retaining deliberately disabled shortcuts', () => {
  const result = loadSettings(storage(JSON.stringify({ prompt: '自定义规范', shortcuts: { commit: '' } })));
  assert.equal(result.prompt, '自定义规范'); assert.equal(result.shortcuts.commit, '');
  assert.equal(result.shortcuts.push, DEFAULT_SETTINGS.shortcuts.push); assert.equal(result.model, '');
  assert.deepEqual(loadSettings(storage('{}')), DEFAULT_SETTINGS);
});

test('saving writes only known preferences, canonicalizes bindings and does not mutate its input', () => {
  const target = storage();
  const value = settings({ provider: ' openai ', model: ' test-model ', prompt: ' 自定义\n规范 ', apiKey: 'must-not-persist', shortcuts: { commit: ' alt + control + return ', push: 'cmd+option+p', fetch: '', secret: 'must-not-persist' } });
  const original = structuredClone(value);
  assert.equal(saveSettings(target, value), true);
  const persisted = JSON.parse(target.items.get(SETTINGS_STORAGE_KEY));
  assert.deepEqual(Object.keys(persisted), ['provider', 'model', 'prompt', 'shortcuts']);
  assert.equal(persisted.provider, 'openai'); assert.equal(persisted.model, 'test-model'); assert.equal(persisted.prompt, value.prompt);
  assert.deepEqual(persisted.shortcuts, { commit: 'Ctrl+Alt+Enter', aiCommit: 'Ctrl+Shift+Enter', push: 'Meta+Alt+P', fetch: '' });
  assert.deepEqual(value, original);
});

test('sanitized save and load round-trip custom settings, Mod, Space, Plus and character keys', () => {
  const target = storage();
  const value = bindingSettings({ commit: 'Mod+Spacebar', aiCommit: 'Alt++', push: 'Shift+å', fetch: 'Ctrl+ß' });
  value.provider = 'provider'; value.model = 'model'; value.prompt = '团队规范';
  assert.equal(saveSettings(target, value), true);
  const result = loadSettings(target);
  assert.deepEqual(result.shortcuts, { commit: 'Mod+Space', aiCommit: 'Alt+Plus', push: 'Shift+Å', fetch: 'Ctrl+ß' });
  assert.equal(result.prompt, '团队规范'); assert.equal(validateSettings(result), null);
  assert.equal(saveSettings(target, result), true); assert.deepEqual(loadSettings(target), result);
});

test('load ignores unknown persisted fields, including secrets, without polluting defaults', () => {
  const result = loadSettings(storage('{"apiKey":"private","__proto__":{"polluted":true},"shortcuts":{"secret":"private"}}'));
  assert.deepEqual(result, DEFAULT_SETTINGS); assert.equal(result.apiKey, undefined); assert.equal({}.polluted, undefined);
});

test('save returns false on invalid data, unavailable storage, thrown writes and thrown properties', () => {
  let writes = 0;
  const target = { setItem() { writes++; } };
  assert.equal(saveSettings(target, settings({ prompt: '' })), false); assert.equal(writes, 0);
  for (const value of [undefined, null, {}, { setItem: 'wrong' }, { setItem() { throw new Error('quota'); } }, { get setItem() { throw new Error('denied'); } }]) assert.equal(saveSettings(value, settings()), false);
  assert.equal(saveSettings(target, settings()), true); assert.equal(writes, 1);
});

test('matchesShortcut requires an exact key and exact modifiers without unexpected extras', () => {
  assert.equal(matchesShortcut(event('Enter', { ctrlKey: true }), 'Ctrl+Enter'), true);
  for (const patch of [{}, { metaKey: true }, { ctrlKey: true, shiftKey: true }, { ctrlKey: true, altKey: true }, { ctrlKey: true, metaKey: true }]) assert.equal(matchesShortcut(event('Enter', patch), 'Ctrl+Enter'), false);
  assert.equal(matchesShortcut(event('Escape', { ctrlKey: true }), 'Ctrl+Enter'), false);
  assert.equal(matchesShortcut(event('p', { ctrlKey: true, shiftKey: true }), 'Shift+Control+P'), true);
  assert.equal(matchesShortcut(event('P', { ctrlKey: true, shiftKey: true }), 'ctrl+shift+p'), true);
  assert.equal(matchesShortcut(event('K', { ctrlKey: true, metaKey: true, altKey: true, shiftKey: true }), 'Ctrl+Meta+Alt+Shift+K'), true);
});

test('matching supports named key aliases, F1–F24, punctuation, whitespace and plain keys', () => {
  const cases = [['Escape', 'Esc'], [' ', 'Space'], ['Spacebar', 'Space'], ['+', 'Plus'], ['+', '+'], ['ArrowLeft', 'Left'], ['Delete', 'Del'], ['Insert', 'Ins'], ['Enter', 'Return'], ['PageUp', 'pageup'], ['PageDown', 'pagedown'], ['Home', 'Home'], ['End', 'End'], ['Tab', 'Tab'], ['F1', 'f1'], ['F24', 'F24'], ['ContextMenu', 'ContextMenu'], ['PrintScreen', 'PrintScreen'], ['Pause', 'Pause'], ['/', '/'], ['å', 'Å'], ['ß', 'ß']];
  for (const [key, binding] of cases) assert.equal(matchesShortcut(event(key), binding), true, binding);
  assert.equal(matchesShortcut(event('+', { ctrlKey: true }), 'Ctrl++'), true);
  assert.equal(matchesShortcut(event('ArrowDown', { altKey: true }), ' option + down '), true);
  assert.equal(matchesShortcut(event('ArrowRight', { metaKey: true }), 'OS+right'), true);
});

test('repeated, composing, legacy IME and missing events never match or record', () => {
  for (const value of [null, undefined, event('Enter', { ctrlKey: true, repeat: true }), event('Enter', { ctrlKey: true, isComposing: true }), event('Enter', { ctrlKey: true, nativeEvent: { isComposing: true } }), event('Enter', { ctrlKey: true, keyCode: 229 })]) {
    assert.equal(matchesShortcut(value, 'Ctrl+Enter'), false); assert.equal(shortcutFromEvent(value), null);
  }
});

test('invalid bindings, modifier-only keys and unknown event keys never match', () => {
  for (const binding of [null, undefined, 1, {}, 'Ctrl+Unknown', 'Mod+Ctrl+Enter']) assert.equal(matchesShortcut(event('Enter', { ctrlKey: true }), binding), false);
  for (const key of [undefined, null, '', '\n', 'Ctrl', 'Control', 'Meta', 'Alt', 'Shift', 'OS', 'Dead', 'Process', 'Unidentified']) {
    assert.equal(matchesShortcut(event(key), 'Enter'), false); assert.equal(shortcutFromEvent(event(key)), null);
  }
});

test('Mod maps to Ctrl on Windows and Linux and Meta on Apple platforms', () => {
  for (const platform of ['Win32', 'Windows', 'Linux x86_64', 'linux', '']) {
    const view = { navigator: { platform } };
    assert.equal(matchesShortcut(event('k', { ctrlKey: true, view }), 'Mod+K'), true, platform);
    assert.equal(matchesShortcut(event('k', { metaKey: true, view }), 'Mod+K'), false, platform);
  }
  for (const platform of ['MacIntel', 'macOS', 'darwin', 'iPhone', 'iPad', 'iPod']) {
    const view = { navigator: { platform } };
    assert.equal(matchesShortcut(event('k', { metaKey: true, view }), 'Mod+K'), true, platform);
    assert.equal(matchesShortcut(event('k', { ctrlKey: true, view }), 'Mod+K'), false, platform);
  }
  assert.equal(matchesShortcut(event('k', { metaKey: true, view: { navigator: { userAgentData: { platform: 'macOS' }, platform: 'Win32' } } }), 'Mod+K'), true);
  assert.equal(matchesShortcut(event('k', { ctrlKey: true, view: undefined }), 'Mod+K'), process.platform !== 'darwin');
});

test('Mod safely defaults to Ctrl in a browser without platform or Node globals', () => {
  const originalProcess = globalThis.process;
  try {
    globalThis.process = undefined;
    const view = { navigator: {} };
    assert.equal(matchesShortcut(event('k', { ctrlKey: true, view }), 'Mod+K'), true);
    assert.equal(matchesShortcut(event('k', { metaKey: true, view }), 'Mod+K'), false);
  } finally { globalThis.process = originalProcess; }
});

test('explicit Ctrl and Meta bindings do not change meaning on macOS', () => {
  const view = { navigator: { platform: 'MacIntel' } };
  assert.equal(matchesShortcut(event('Enter', { ctrlKey: true, view }), 'Ctrl+Enter'), true);
  assert.equal(matchesShortcut(event('Enter', { metaKey: true, view }), 'Ctrl+Enter'), false);
  assert.equal(matchesShortcut(event('Enter', { metaKey: true, view }), 'Command+Return'), true);
  assert.equal(matchesShortcut(event('Enter', { ctrlKey: true, metaKey: true, view }), 'Mod+Enter'), false);
});

test('recording produces a stable modifier order, preserves physical Ctrl/Meta and round-trips matching', () => {
  const cases = [
    [event('Enter', { ctrlKey: true }), 'Ctrl+Enter'],
    [event('p', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+P'],
    [event('k', { metaKey: true, altKey: true }), 'Meta+Alt+K'],
    [event('k', { ctrlKey: true, metaKey: true, altKey: true, shiftKey: true }), 'Ctrl+Meta+Alt+Shift+K'],
    [event(' ', { altKey: true }), 'Alt+Space'],
    [event('+', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Plus'],
    [event('F12'), 'F12'], [event('Tab', { shiftKey: true }), 'Shift+Tab'],
    [event('ß', { ctrlKey: true }), 'Ctrl+ß'],
  ];
  for (const [value, binding] of cases) { assert.equal(shortcutFromEvent(value), binding); assert.equal(matchesShortcut(value, binding), true); assert.equal(validateSettings(bindingSettings({ commit: binding })), null); }
});
