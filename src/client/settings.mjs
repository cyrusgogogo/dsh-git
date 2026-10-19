/** Browser-independent preferences and keyboard helpers. No host or DOM imports. */
export const SETTINGS_STORAGE_KEY = 'dsh-git.settings.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  provider: '',
  model: '',
  prompt: `请根据已暂存的 Git 差异生成一条符合 Conventional Commits 规范的中文提交信息。
格式：<type>(<scope>): <中文简要描述>，scope 可选。
type 使用 feat、fix、docs、style、refactor、perf、test、build、ci、chore 或 revert；不兼容变更在 type/scope 后加 !，并在正文说明 BREAKING CHANGE。
标题简洁、准确，建议不超过 72 个字符；必要时空一行补充变更原因、关键影响与注意事项。
只描述差异中能够确认的事实，不编造测试结果、问题编号或未发生的修改。
只输出提交信息，不要解释、Markdown 代码块或引号。`,
  shortcuts: Object.freeze({ commit: 'Ctrl+Enter', aiCommit: 'Ctrl+Shift+Enter', push: 'Ctrl+Shift+P', fetch: 'Ctrl+Shift+F' }),
});

const SHORTCUT_LABELS = Object.freeze({ commit: '提交确认', aiCommit: 'AI 生成', push: '推送确认', fetch: '获取远程更新' });
const MODIFIERS = new Map([
  ['ctrl', 'ctrl'], ['control', 'ctrl'],
  ['meta', 'meta'], ['cmd', 'meta'], ['command', 'meta'], ['os', 'meta'],
  ['alt', 'alt'], ['option', 'alt'], ['shift', 'shift'], ['mod', 'mod'],
]);
const KEY_ALIASES = new Map([
  ['enter', 'Enter'], ['return', 'Enter'], ['tab', 'Tab'], ['escape', 'Escape'], ['esc', 'Escape'],
  ['space', 'Space'], ['spacebar', 'Space'], ['plus', 'Plus'],
  ['backspace', 'Backspace'], ['delete', 'Delete'], ['del', 'Delete'], ['insert', 'Insert'], ['ins', 'Insert'],
  ['home', 'Home'], ['end', 'End'], ['pageup', 'PageUp'], ['pagedown', 'PageDown'],
  ['arrowup', 'ArrowUp'], ['up', 'ArrowUp'], ['arrowdown', 'ArrowDown'], ['down', 'ArrowDown'],
  ['arrowleft', 'ArrowLeft'], ['left', 'ArrowLeft'], ['arrowright', 'ArrowRight'], ['right', 'ArrowRight'],
  ['contextmenu', 'ContextMenu'], ['printscreen', 'PrintScreen'], ['pause', 'Pause'],
]);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const freshDefaults = () => ({ ...DEFAULT_SETTINGS, shortcuts: { ...DEFAULT_SETTINGS.shortcuts } });

function normalizeKey(value) {
  if (typeof value !== 'string') return null;
  if (value === ' ') return 'Space';
  if (value === '+') return 'Plus';
  const key = value.trim();
  if (!key || MODIFIERS.has(key.toLowerCase())) return null;
  const alias = KEY_ALIASES.get(key.toLowerCase());
  if (alias) return alias;
  if (/^f(?:[1-9]|1\d|2[0-4])$/i.test(key)) return key.toUpperCase();
  // event.key is a character, not a physical key code. This also handles non-US layouts.
  if (/^[^\s\p{C}]$/u.test(key)) {
    const upper = key.toUpperCase();
    return [...upper].length === 1 ? upper : key;
  }
  return null;
}

function parseShortcut(binding) {
  if (typeof binding !== 'string' || binding.length > 120) return null;
  let source = binding.trim();
  if (!source) return null;
  // Accept Ctrl++ as an alias for Ctrl+Plus without an ambiguous empty token.
  if (source === '+') source = 'Plus';
  else if (source.endsWith('++')) source = `${source.slice(0, -1)}Plus`;
  const tokens = source.split('+').map((token) => token.trim());
  if (tokens.some((token) => !token)) return null;
  const modifiers = { ctrl: false, meta: false, alt: false, shift: false, mod: false };
  const key = normalizeKey(tokens.at(-1));
  if (!key) return null;
  for (const token of tokens.slice(0, -1)) {
    const modifier = MODIFIERS.get(token.toLowerCase());
    if (!modifier || modifiers[modifier]) return null;
    modifiers[modifier] = true;
  }
  // Mod already means Ctrl or Meta; combining them makes the binding platform-ambiguous.
  if (modifiers.mod && (modifiers.ctrl || modifiers.meta)) return null;
  return { ...modifiers, key };
}

function formatShortcut(binding) {
  return [binding.mod && 'Mod', binding.ctrl && 'Ctrl', binding.meta && 'Meta', binding.alt && 'Alt', binding.shift && 'Shift', binding.key].filter(Boolean).join('+');
}

function resolvedShortcut(binding, mac) {
  return `${Number(binding.ctrl || (binding.mod && !mac))}${Number(binding.meta || (binding.mod && mac))}${Number(binding.alt)}${Number(binding.shift)}:${binding.key}`;
}

function copySettings(settings) {
  return {
    provider: settings.provider.trim(),
    model: settings.model.trim(),
    prompt: settings.prompt,
    shortcuts: Object.fromEntries(Object.keys(SHORTCUT_LABELS).map((action) => {
      const value = settings.shortcuts[action].trim();
      return [action, value ? formatShortcut(parseShortcut(value)) : ''];
    })),
  };
}

/** Returns a user-facing validation error, or null. An unselected model is valid. */
export function validateSettings(settings) {
  if (!isRecord(settings)) return '设置格式不正确。';
  if (typeof settings.provider !== 'string' || typeof settings.model !== 'string') return '模型提供商和模型 ID 必须是文本。';
  if (settings.provider.length > 256 || settings.model.length > 256 || /[\u0000-\u001f\u007f]/.test(settings.provider + settings.model)) return '模型提供商和模型 ID 不得包含控制字符，且各不超过 256 个字符。';
  if (Boolean(settings.provider.trim()) !== Boolean(settings.model.trim())) return '请同时填写模型提供商和模型 ID，或将两者都留空。';
  if (typeof settings.prompt !== 'string' || !settings.prompt.trim()) return '提交规范不能为空；可恢复默认规范。';
  if (settings.prompt.length > 16000 || settings.prompt.includes('\0')) return '提交规范不得超过 16000 个字符，且不能包含空字符。';
  if (!isRecord(settings.shortcuts)) return '快捷键设置格式不正确。';
  const parsed = [];
  for (const [action, label] of Object.entries(SHORTCUT_LABELS)) {
    const value = settings.shortcuts[action];
    if (typeof value !== 'string') return `“${label}”快捷键必须是文本，留空可禁用。`;
    if (!value.trim()) continue;
    const binding = parseShortcut(value);
    if (!binding) return `“${label}”快捷键格式不正确；例如 Ctrl+Shift+P 或 Mod+Enter。Mod 不能与 Ctrl/Meta 同时使用。`;
    for (const previous of parsed) {
      if ([false, true].some((mac) => resolvedShortcut(previous.binding, mac) === resolvedShortcut(binding, mac))) return `“${label}”与“${previous.label}”的快捷键重复（含 Mod 在 Windows/Linux 或 macOS 上的重叠）。`;
    }
    parsed.push({ label, binding });
  }
  return null;
}

/** Load only known preferences. Blocked storage, invalid JSON and invalid data safely fall back. */
export function loadSettings(storage) {
  try {
    const raw = storage?.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return freshDefaults();
    const stored = JSON.parse(raw);
    if (!isRecord(stored) || (stored.shortcuts !== undefined && !isRecord(stored.shortcuts))) return freshDefaults();
    const settings = {
      provider: stored.provider === undefined ? DEFAULT_SETTINGS.provider : stored.provider,
      model: stored.model === undefined ? DEFAULT_SETTINGS.model : stored.model,
      prompt: stored.prompt === undefined ? DEFAULT_SETTINGS.prompt : stored.prompt,
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...stored.shortcuts },
    };
    return validateSettings(settings) ? freshDefaults() : copySettings(settings);
  } catch { return freshDefaults(); }
}

/** Persist a validated, sanitized copy. False means invalid settings or unavailable storage. */
export function saveSettings(storage, settings) {
  try {
    if (validateSettings(settings) || typeof storage?.setItem !== 'function') return false;
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(copySettings(settings)));
    return true;
  } catch { return false; }
}

function ignoredEvent(event) {
  return !event || event.repeat || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229;
}

function eventOnMac(event) {
  const navigator = event.view?.navigator || globalThis.navigator;
  const platform = navigator?.userAgentData?.platform || navigator?.platform || globalThis.process?.platform || '';
  return /mac|darwin|iphone|ipad|ipod/i.test(platform);
}

/** Strict modifier matching. Mod maps to Meta on Apple platforms, Ctrl elsewhere. */
export function matchesShortcut(event, binding) {
  if (ignoredEvent(event)) return false;
  const parsed = parseShortcut(binding);
  if (!parsed || normalizeKey(event.key) !== parsed.key) return false;
  return Boolean(event.ctrlKey) === Boolean(parsed.ctrl || (parsed.mod && !eventOnMac(event)))
    && Boolean(event.metaKey) === Boolean(parsed.meta || (parsed.mod && eventOnMac(event)))
    && Boolean(event.altKey) === parsed.alt
    && Boolean(event.shiftKey) === parsed.shift;
}

/** Record physical modifiers as Ctrl/Meta (not Mod). Modifier-only / IME events return null. */
export function shortcutFromEvent(event) {
  if (ignoredEvent(event)) return null;
  const key = normalizeKey(event.key);
  if (!key) return null;
  return formatShortcut({ ctrl: Boolean(event.ctrlKey), meta: Boolean(event.metaKey), alt: Boolean(event.altKey), shift: Boolean(event.shiftKey), mod: false, key });
}
