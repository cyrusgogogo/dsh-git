import React, { useId, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Keyboard, RefreshCw, Settings2, ShieldCheck, X } from 'lucide-react';
import { IconButton, Spinner } from './ui.jsx';
import { DEFAULT_SETTINGS, shortcutFromEvent, validateSettings } from './settings.mjs';

const SHORTCUTS = [
  ['commit', '提交（打开确认）'],
  ['aiCommit', 'AI 提交（自动暂存并生成）'],
  ['push', '推送（打开确认）'],
  ['fetch', '获取 fetch（打开确认）'],
];
const copySettings = (value = DEFAULT_SETTINGS) => ({ ...DEFAULT_SETTINGS, ...value, shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...value.shortcuts } });

/** The model owns initial discovery; this view only retries at the user's request. */
export function SettingsDialog({ state, actions }) {
  if (state.dialog?.type !== 'settings') return null;
  return <SettingsForm state={state} actions={actions} />;
}

function SettingsForm({ state, actions }) {
  const id = useId();
  const [draft, setDraft] = useState(() => copySettings(state.settings));
  const [manual, setManual] = useState(false);
  const [recording, setRecording] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const errorRef = useRef(null), inputRefs = useRef({});
  const update = (patch) => { setDraft((current) => ({ ...current, ...patch })); setSaveError(''); };
  const setShortcut = (action, value) => {
    setDraft((current) => ({ ...current, shortcuts: { ...current.shortcuts, [action]: value } }));
    setSaveError('');
  };
  const models = (state.aiModels || []).filter((item, index, items) => item && typeof item.provider === 'string' && item.provider && typeof item.model === 'string' && item.model && items.findIndex((other) => other?.provider === item.provider && other?.model === item.model) === index);
  const selectedIndex = models.findIndex((item) => item.provider === draft.provider && item.model === draft.model);
  const showManual = manual || (selectedIndex < 0 && Boolean(draft.provider || draft.model));
  const validation = validateSettings(draft);
  const error = validation || saveError;
  const modelsError = state.aiModelsError?.message || state.aiModelsError;
  const incompatibleHost = state.aiModelsErrorCode === 'HOST_UPGRADE_REQUIRED';
  const chooseModel = (value) => {
    setManual(value === '__manual__');
    if (value === '__manual__') return;
    const model = models[Number(value)];
    update(value === '' || !model ? { provider: '', model: '' } : { provider: model.provider, model: model.model });
  };
  const close = () => { if (!saving) actions.closeDialog(); };
  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (validation) { errorRef.current?.focus(); return; }
    setRecording(null); setSaving(true); setSaveError('');
    try {
      const saved = await actions.saveSettings(copySettings(draft));
      if (saved) actions.closeDialog();
      else setSaveError('未能保存设置。请检查浏览器是否允许本地存储后重试；输入内容已保留。');
    } catch (cause) {
      setSaveError(cause?.message || '保存设置失败，请重试；输入内容已保留。');
    } finally { setSaving(false); }
  };
  const record = (event, action) => {
    if (recording !== action) return;
    event.stopPropagation();
    if (event.key === 'Tab') { setRecording(null); return; }
    event.preventDefault();
    if (event.key === 'Escape') { setRecording(null); return; }
    if (event.repeat || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
    if (['Backspace', 'Delete'].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      setShortcut(action, ''); setRecording(null); return;
    }
    const binding = shortcutFromEvent(event);
    if (binding) { setShortcut(action, binding); setRecording(null); }
  };
  return <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dsh-git git-modal-overlay" />
      <Dialog.Content className="dsh-git git-dialog git-settings-dialog" onPointerDownOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => { if (saving || recording) { event.preventDefault(); setRecording(null); } }}>
        <div className="git-dialog-heading"><Settings2 size={16} aria-hidden="true" /><Dialog.Title>Git 设置</Dialog.Title><IconButton icon={X} label="关闭设置" onClick={close} disabled={saving} /></div>
        <Dialog.Description className="git-dialog-description">选择 AI 提交模型、编辑提交规范与快捷键。设置仅保存在当前浏览器，不会修改仓库配置或同步到其他设备。</Dialog.Description>
        <form onSubmit={submit} noValidate>
          <fieldset className="git-form-fields" disabled={saving} aria-describedby={error ? `${id}-error` : undefined}>
            <section className="git-settings-section" aria-labelledby={`${id}-model-title`}>
              <div className="git-settings-section-heading"><h3 id={`${id}-model-title`}>AI 提交模型</h3><button type="button" className="git-button git-button-small" onClick={() => actions.loadAiModels()} disabled={state.aiModelsLoading}>{state.aiModelsLoading ? <Spinner /> : <RefreshCw size={12} aria-hidden="true" />}{state.aiModelsLoading ? '读取中…' : modelsError ? '重试模型列表' : '刷新模型列表'}</button></div>
              <label className="git-form-field" htmlFor={`${id}-model`}><span>宿主已配置的模型</span><select id={`${id}-model`} disabled={incompatibleHost} value={showManual ? '__manual__' : selectedIndex >= 0 ? String(selectedIndex) : ''} onChange={(event) => chooseModel(event.target.value)} aria-describedby={`${id}-model-status ${id}-privacy`}>
                <option value="">使用宿主首个可用模型</option>
                {models.map((item, index) => <option value={String(index)} key={`${item.provider}\0${item.model}`}>{item.label || item.model} · {item.provider}</option>)}
                <option value="__manual__">手动填写提供商与模型 ID…</option>
              </select></label>
              <div id={`${id}-model-status`} className="git-settings-help" role="status">
                {state.aiModelsLoading ? '正在读取 DSH 宿主模型目录…' : incompatibleHost ? <span>{String(modelsError)} 重启后再点击“重试模型列表”；手动填写模型 ID 无法解决版本不一致。</span> : modelsError ? <span>读取模型列表失败：{String(modelsError)} 请重试；手动填写的模型也必须已在宿主模型目录中登记。</span> : !models.length ? '尚未发现可用模型。请先在 DSH 宿主配置模型后刷新；手动填写不能绕过宿主模型目录。' : `已发现 ${models.length} 个模型。手动填写仅用于明确指定宿主目录中已登记的 provider/model。`}
              </div>
              {!incompatibleHost && <p className="git-settings-help">未指定提供商和模型时，生成会自动选择宿主目录中的首个可用模型{models.length ? `（当前为 ${models[0].provider} / ${models[0].model}）` : ''}；实际路由以生成时的宿主目录为准。宿主不接受未登记的任意模型 ID。</p>}
              {showManual && !incompatibleHost && <div className="git-settings-grid">
                <label className="git-form-field" htmlFor={`${id}-provider`}><span>提供商 ID（provider）</span><input id={`${id}-provider`} value={draft.provider} onChange={(event) => update({ provider: event.target.value })} placeholder="例如 openai" maxLength={256} autoComplete="off" spellCheck={false} /></label>
                <label className="git-form-field" htmlFor={`${id}-model-id`}><span>模型 ID（model）</span><input id={`${id}-model-id`} value={draft.model} onChange={(event) => update({ model: event.target.value })} placeholder="与宿主配置中的模型 ID 一致" maxLength={256} autoComplete="off" spellCheck={false} /></label>
              </div>}
              <p id={`${id}-privacy`} className="git-settings-note"><ShieldCheck size={14} aria-hidden="true" /><span>API 密钥由 DSH 宿主已有配置管理，此处不读取或保存密钥。生成时会将当前仓库的已暂存差异与下方提交规范发送给所选模型；请先确认其中没有敏感信息。</span></p>
            </section>
            <section className="git-settings-section" aria-labelledby={`${id}-prompt-title`}>
              <div className="git-settings-section-heading"><h3 id={`${id}-prompt-title`}>默认提交规范</h3><button type="button" className="git-button git-button-small" onClick={() => update({ prompt: DEFAULT_SETTINGS.prompt })} disabled={draft.prompt === DEFAULT_SETTINGS.prompt}>恢复默认规范</button></div>
              <label className="git-form-field" htmlFor={`${id}-prompt`}><span className="git-sr-only">AI 提交信息生成规范</span><textarea id={`${id}-prompt`} aria-label="AI 提交信息生成规范" value={draft.prompt} onChange={(event) => update({ prompt: event.target.value })} rows={7} maxLength={16000} aria-describedby={`${id}-prompt-hint`} spellCheck={false} /><small id={`${id}-prompt-hint`}>默认使用 Conventional Commits 中文规范；可按团队习惯修改，仅影响 AI 生成。</small></label>
            </section>
            <section className="git-settings-section" aria-labelledby={`${id}-shortcuts-title`}>
              <div className="git-settings-section-heading"><h3 id={`${id}-shortcuts-title`}>快捷键</h3><button type="button" className="git-button git-button-small" onClick={() => { update({ shortcuts: { ...DEFAULT_SETTINGS.shortcuts } }); setRecording(null); }}>恢复默认快捷键</button></div>
              <p id={`${id}-shortcuts-hint`} className="git-settings-help">仅在 Git 面板获得焦点时生效，不拦截输入框或其他弹窗。留空即禁用。支持 Ctrl / Meta / Alt / Shift + 按键；Mod 在 macOS 对应 ⌘，其他平台对应 Ctrl。提交、推送和获取快捷键只打开确认弹窗，不会直接执行。AI 提交快捷键会自动暂存全部当前改动并生成预览，仍需确认后才提交。</p>
              <div className="git-settings-grid">
                {SHORTCUTS.map(([action, label]) => <div className="git-settings-shortcut" key={action}>
                  <label className="git-form-field" htmlFor={`${id}-${action}`}><span>{label}</span><input id={`${id}-${action}`} ref={(element) => { inputRefs.current[action] = element; }} value={draft.shortcuts[action]} onChange={(event) => setShortcut(action, event.target.value)} onKeyDown={(event) => record(event, action)} onBlur={() => { if (recording === action) setRecording(null); }} readOnly={recording === action} placeholder={recording === action ? '请按下组合键…' : '已禁用'} aria-describedby={`${id}-shortcuts-hint${recording === action ? ` ${id}-recording` : ''}`} autoComplete="off" spellCheck={false} maxLength={120} /></label>
                  <button type="button" className="git-button git-button-small" aria-label={`录制${label}快捷键`} aria-pressed={recording === action} onClick={() => { setRecording((current) => current === action ? null : action); inputRefs.current[action]?.focus(); }}><Keyboard size={13} aria-hidden="true" />录制</button>
                </div>)}
              </div>
              <p id={`${id}-recording`} className="git-settings-help" role="status">{recording ? '正在录制：按组合键替换，Backspace / Delete 清空，Esc 取消，Tab 退出。' : '可直接编辑或点击录制。部分组合键可能被浏览器或系统占用。'}</p>
            </section>
            {error && <p id={`${id}-error`} className="git-inline-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
          </fieldset>
          <div className="git-dialog-footer"><button type="button" className="git-button" onClick={close} disabled={saving}>取消</button><button type="submit" className="git-button git-button-primary" disabled={saving}>{saving ? <Spinner /> : <Check size={14} aria-hidden="true" />}{saving ? '保存中…' : '保存设置'}</button></div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
