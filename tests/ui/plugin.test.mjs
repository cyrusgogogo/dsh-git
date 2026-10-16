import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, access } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

let browser, page, errors;
const style = `html,body,#app{margin:0;width:100%;height:100%;overflow:hidden;background:#212225;color:#dce0e6;font-family:Segoe UI,Microsoft YaHei,sans-serif}.host-frame{display:flex;height:100%;font-size:13px}.host-sidebar{width:240px;box-sizing:border-box;padding:20px;background:#28292c;border-right:1px solid #393a3d;display:flex;flex-direction:column;gap:22px;color:#aeb3bd}.host-sidebar strong{font-size:17px;color:#e1e5ed}.host-project{background:#34363d;color:#dce0e6;border-radius:5px;padding:8px}.host-sidebar small{font-size:11px;line-height:1.7;color:#9da3ad}.host-main{flex:1;min-width:0}.host-main>header{display:flex;align-items:center;justify-content:space-between;height:60px;padding:0 24px;border-bottom:1px solid #343539;color:#b7bcc5}.host-tools{display:flex;gap:8px}.host-placeholder{margin:170px auto 0;max-width:560px;padding:0 35px}.host-kicker{font-size:10px;letter-spacing:2px;color:#8da5c6}.host-placeholder h1{font-size:25px;font-weight:500;letter-spacing:1px;margin:16px 0}.host-placeholder p{color:#a0a6b1;line-height:1.9;font-size:13px}`;
before(async () => {
  let executablePath = process.env.DSH_GIT_BROWSER || chromium.executablePath();
  try { await access(executablePath); } catch { executablePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'; await access(executablePath); }
  browser = await chromium.launch({ executablePath, headless: true });
  await mkdir('.artifacts/screenshots', { recursive: true });
});
after(async () => { await browser?.close(); });
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1850, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce', locale: 'zh-CN' });
  errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><style>${style}</style></head><body><div id="app"></div></body></html>`);
  await page.addScriptTag({ content: await readFile('.artifacts/ui-harness.js', 'utf8') });
  await page.addScriptTag({ content: await readFile('dist/client.js', 'utf8') });
  await page.evaluate(() => window.testMount());
  await page.getByRole('button', { name: '打开 Git 工具栏' }).click();
  await expect(page.getByRole('listbox', { name: '提交列表' })).toBeVisible();
  await expect(page.locator('.git-file-tree .git-tree-file')).toHaveCount(4);
});
afterEach(async () => {
  if (page) { await page.evaluate(() => { if (window.__gitTest && !window.__gitTest.unloaded) { window.__gitTest.unloaded = true; window.__gitTest.unload(); } }); await page.close(); }
  assert.deepEqual(errors, [], 'Browser must not emit runtime errors');
});

test('bottom panel shows a real-parent graph, file tree and metadata with no initial error', async () => {
  await expect(page.locator('.git-commit-row')).toHaveCount(13);
  await expect(page.locator('.git-inspector')).toContainText('新增底部 Git 工作区');
  await expect(page.locator('.git-notice-error')).toHaveCount(0);
  const panel = await page.locator('#dsh-git-panel').boundingBox(); assert.equal(Math.round(panel.y + panel.height), 900);
  await page.locator('#dsh-git-panel').screenshot({ path: '.artifacts/screenshots/git-workspace.png' });
});
test('the plus next to the branch selector opens exactly Git workspace and worktrees', async () => {
  await expect(page.locator('.git-branch-trigger + .git-add-tab')).toHaveCount(1);
  const branch = await page.locator('.git-branch-trigger').boundingBox();
  const plus = await page.getByRole('button', { name: '新增 Git 标签页' }).boundingBox();
  assert.ok(plus.x >= branch.x + branch.width && plus.x - branch.x - branch.width < 12);
  await page.getByRole('button', { name: '新增 Git 标签页' }).click();
  await expect(page.getByRole('menuitem')).toHaveCount(2);
  await expect(page.getByRole('menuitem', { name: 'GIT工作区', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: '工作树', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Git 工作树列表' })).toBeVisible();
  await expect(page.locator('.git-worktree-row')).toHaveCount(2);
  await page.locator('#dsh-git-panel').screenshot({ path: '.artifacts/screenshots/worktrees.png' });
});
test('branch picker searches and switches through an explicit confirmation', async () => {
  await page.getByRole('button', { name: '打开分支列表' }).click();
  const search = page.getByRole('textbox', { name: '搜索分支和操作' }); await expect(search).toBeFocused();
  await page.locator('.git-branch-popover').screenshot({ path: '.artifacts/screenshots/branch-picker.png' });
  await search.fill('feature/ui');
  await page.locator('.git-branch-popover .git-branch-row').click();
  await expect(page.getByRole('dialog')).toContainText('签出 feature/ui');
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.git-branch-trigger')).toContainText('feature/ui');
  const last = await page.evaluate(() => window.__gitTest.requests.find((request) => request.op === 'mutate'));
  assert.equal(last.mutation.action, 'checkout'); assert.equal(last.mutation.ref, 'refs/heads/feature/ui');
});
test('current and other branch context menus expose distinct commands', async () => {
  await page.locator('.git-sidebar .git-branch-row').filter({ has: page.getByText('main', { exact: true }) }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: "从 'main' 新建分支…", exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '重命名…', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '签出', exact: true })).toHaveCount(0);
  await page.locator('[data-radix-menu-content]').screenshot({ path: '.artifacts/screenshots/current-branch-menu.png' });
  await page.keyboard.press('Escape');
  await page.locator('.git-sidebar .git-branch-row').filter({ has: page.getByText('origin/feature-ui', { exact: true }) }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '签出', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: "将 'origin/feature-ui' 合并到 'main' 中", exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: "使用变基拉入 'main'", exact: true })).toBeVisible();
  await page.locator('[data-radix-menu-content]').screenshot({ path: '.artifacts/screenshots/other-branch-menu.png' });
});
test('new-branch dialog traps focus and submits typed parameters', async () => {
  await page.getByRole('button', { name: '打开分支列表' }).click();
  await page.getByRole('button', { name: '新建分支…', exact: true }).click();
  const field = page.getByRole('textbox', { name: '分支名称', exact: true }); await expect(field).toBeFocused();
  await field.fill('feature/new-panel');
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement))); }
  await page.getByRole('button', { name: '新建分支', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.git-branch-trigger')).toContainText('feature/new-panel');
});
test('non-Git workspace shows a helpful hint instead of an error and supports retry', async () => {
  await page.getByRole('combobox', { name: 'Git 工作区目录' }).selectOption('workspace-empty');
  await expect(page.getByRole('heading', { name: '此工作区尚未使用 Git' })).toBeVisible();
  await expect(page.locator('.git-notice-error')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开分支列表' })).toBeDisabled();
  await page.getByRole('button', { name: '重新检测' }).click();
  await expect(page.getByRole('heading', { name: '此工作区尚未使用 Git' })).toBeVisible();
  await page.locator('#dsh-git-panel').screenshot({ path: '.artifacts/screenshots/not-a-repository.png' });
});
test('non-Git workspace initialization requires confirmation and ends in a usable empty repo', async () => {
  await page.getByRole('combobox', { name: 'Git 工作区目录' }).selectOption('workspace-empty');
  await page.getByRole('button', { name: '初始化 Git 仓库', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('不会自动提交文件');
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '还没有提交', exact: true })).toBeVisible();
  const request = await page.evaluate(() => window.__gitTest.requests.find((item) => item.op === 'initialize'));
  assert.deepEqual(request, { op: 'initialize', workspaceId: 'workspace-empty', confirmed: true });
});
test('commit search, keyboard selection and diff preview remain interactive', async () => {
  await page.getByRole('textbox', { name: '搜索提交' }).fill('worktree');
  await expect(page.locator('.git-commit-row')).toHaveCount(2);
  const list = page.getByRole('listbox', { name: '提交列表' }); await list.focus(); await page.keyboard.press('End');
  await expect(page.locator('.git-commit-row[aria-selected=true]')).toContainText('锁定与移除保护');
  await page.locator('.git-file-tree .git-tree-file').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.git-diff-add')).toHaveCount(5);
  await expect(page.locator('.git-diff-remove')).toHaveCount(1);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('resize has a keyboard alternative and narrow screens keep controls inside the viewport', async () => {
  const handle = page.getByRole('separator', { name: '调整 Git 面板高度' });
  await handle.focus(); await page.keyboard.press('ArrowUp'); await expect(handle).toHaveAttribute('aria-valuenow', '404');
  await page.setViewportSize({ width: 375, height: 740 });
  const plus = await page.getByRole('button', { name: '新增 Git 标签页' }).boundingBox(); assert.ok(plus.x >= 0 && plus.x + plus.width <= 375);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375);
  await page.getByRole('button', { name: '打开分支列表' }).click(); await expect(page.getByRole('textbox', { name: '搜索分支和操作' })).toBeVisible();
  const picker = await page.locator('.git-branch-popover').boundingBox(); assert.ok(picker.x >= 0 && picker.x + picker.width <= 375);
  await page.screenshot({ path: '.artifacts/screenshots/narrow-layout.png' });
  await page.getByRole('button', { name: '新建分支…', exact: true }).click();
  const dialog = await page.getByRole('dialog').boundingBox(); assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= 375);
});
test('Git and sidebar tabs support arrow-key navigation and valid panel associations', async () => {
  await page.getByRole('tab', { name: '分支', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /更改/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: '暂存全部更改', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新增 Git 标签页' }).click(); await page.getByRole('menuitem', { name: '工作树', exact: true }).click();
  await page.getByRole('tab', { name: '工作树', exact: true }).focus(); await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('listbox', { name: '提交列表' })).toBeVisible();
  assert.equal(await page.locator('[role="tab"]').evaluateAll((tabs) => tabs.filter((tab) => !document.getElementById(tab.getAttribute('aria-controls'))).length), 0);
});
test('workspace selector is rounded and translucent host tokens cannot make branch menus transparent', async () => {
  const radius = await page.locator('.git-workspace-selector').evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
  assert.ok(parseFloat(radius) >= 6);
  const assertOpaque = async (locator) => {
    const result = await locator.evaluate((element) => {
      const style = getComputedStyle(element), canvas = document.createElement('canvas');
      canvas.width = 1; canvas.height = 1;
      const context = canvas.getContext('2d'); context.fillStyle = style.backgroundColor; context.fillRect(0, 0, 1, 1);
      return { alpha: context.getImageData(0, 0, 1, 1).data[3], opacity: style.opacity, backdrop: style.backdropFilter };
    });
    assert.deepEqual(result, { alpha: 255, opacity: '1', backdrop: 'none' });
  };
  for (const theme of ['dark', 'light']) {
    await page.evaluate((theme) => {
      const root = document.documentElement;
      root.style.setProperty('--dsw-specific-menu', theme === 'dark' ? 'rgba(51,52,56,.25)' : 'rgba(250,250,252,.25)');
      root.style.setProperty('--dsw-alias-bg-base', theme === 'dark' ? '#292a2d' : '#ffffff');
      root.style.setProperty('--dsw-specific-sidebar-fill', theme === 'dark' ? '#2c2d30' : '#f5f5f7');
      root.style.setProperty('--dsw-alias-label-primary', theme === 'dark' ? '#dce0e6' : '#252529');
      root.style.setProperty('--dsw-alias-label-secondary', theme === 'dark' ? '#aeb3bd' : '#56565e');
    }, theme);
    await page.getByRole('button', { name: '打开分支列表' }).click();
    await assertOpaque(page.locator('.git-branch-popover'));
    await page.keyboard.press('Escape');
    await page.locator('.git-sidebar .git-branch-row').filter({ has: page.getByText('main', { exact: true }) }).click({ button: 'right' });
    await assertOpaque(page.locator('.git-menu'));
    await page.getByRole('menuitem', { name: "跟踪的分支 'origin/main'", exact: true }).hover();
    await expect(page.locator('.git-menu')).toHaveCount(2);
    await assertOpaque(page.locator('.git-menu').last());
    if (theme === 'light') await page.screenshot({ path: '.artifacts/screenshots/light-solid-menus.png' });
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  }
});
test('branch, user and date filters are flat, composable and resettable', async () => {
  const filters = page.getByRole('group', { name: '提交筛选' });
  const branch = page.getByRole('combobox', { name: '按分支筛选' });
  const user = page.getByRole('textbox', { name: '按用户筛选' });
  const date = page.getByRole('combobox', { name: '按日期筛选' });
  await expect(filters).toBeVisible(); await expect(branch).toBeVisible(); await expect(user).toBeVisible(); await expect(date).toBeVisible();
  await expect(page.getByRole('button', { name: '筛选提交', exact: true })).toHaveCount(0);
  await expect(page.locator('.git-filter-popover')).toHaveCount(0);
  await date.selectOption('30d'); await expect(page.locator('.git-commit-row')).toHaveCount(11);
  await branch.selectOption('refs/heads/feature/ui'); await user.fill('Alex');
  await expect(page.locator('.git-commit-row')).toHaveCount(1);
  const request = await page.evaluate(() => window.__gitTest.requests.filter((item) => item.op === 'history').at(-1));
  assert.equal(request.ref, 'refs/heads/feature/ui'); assert.equal(request.author, 'Alex'); assert.equal(request.dateRange, '30d');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#dsh-git-panel').screenshot({ path: '.artifacts/screenshots/inline-filters.png' });
  await page.getByRole('button', { name: '清除全部提交筛选' }).click();
  await expect(page.locator('.git-commit-row')).toHaveCount(13);
  await expect(branch).toHaveValue(''); await expect(user).toHaveValue(''); await expect(date).toHaveValue('');
});
test('history filters and far-right cherry-pick button stay inside wide and compact history panes', async () => {
  for (const width of [1850, 1100, 840]) {
    await page.setViewportSize({ width, height: 900 });
    const pane = await page.locator('.git-history').boundingBox();
    for (const control of await page.locator('.git-history-toolbar :is(input, select, button)').all()) {
      const box = await control.boundingBox();
      assert.ok(box.x >= pane.x && box.x + box.width <= pane.x + pane.width + 1, `Control must fit in a ${width}px layout`);
    }
    const pick = await page.getByRole('button', { name: '优选', exact: true }).boundingBox();
    assert.ok(Math.abs(pane.x + pane.width - (pick.x + pick.width) - 9) <= 1);
    const boxes = await Promise.all(['按分支筛选', '按用户筛选', '按日期筛选'].map((name) => page.getByLabel(name, { exact: true }).boundingBox()));
    assert.ok(boxes.every((box) => Math.abs(box.y - boxes[0].y) <= 1), 'All three filters stay on the same row');
  }
  await page.locator('#dsh-git-panel').screenshot({ path: '.artifacts/screenshots/compact-inline-filters.png' });
});
test('cherry-pick acts on the selected commit only after explicit confirmation', async () => {
  await page.evaluate(() => { window.__gitTest.server.files = []; });
  await page.getByRole('button', { name: '刷新仓库' }).click();
  await page.locator('.git-commit-row').filter({ hasText: '新增提交详情与文件差异' }).click();
  const pick = page.getByRole('button', { name: '优选', exact: true });
  await expect(pick).toBeEnabled();
  const selected = await page.locator('.git-commit-row[aria-selected=true]').getAttribute('id');
  await pick.click(); await expect(page.getByRole('dialog')).toContainText('优选提交（cherry-pick）');
  await expect(page.getByRole('dialog')).toContainText('main');
  assert.equal(await page.evaluate(() => window.__gitTest.requests.filter((item) => item.op === 'mutate').length), 0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__gitTest.requests.filter((item) => item.op === 'mutate').length), 0);
  await pick.click(); await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('.git-commit-row')).toHaveCount(14);
  const request = await page.evaluate(() => window.__gitTest.requests.find((item) => item.op === 'mutate'));
  assert.equal(request.mutation.action, 'cherryPick'); assert.ok(selected.endsWith(request.mutation.hash)); assert.equal(request.confirmed, true); assert.equal(request.expected.branch, 'main');
  await page.locator('#dsh-git-panel').screenshot({ path: '.artifacts/screenshots/cherry-pick-result.png' });
});
test('cherry-pick is disabled for local changes, current HEAD and merge commits', async () => {
  const pick = page.getByRole('button', { name: '优选', exact: true });
  await page.locator('.git-commit-row').filter({ hasText: '新增提交详情与文件差异' }).click();
  await expect(pick).toBeDisabled(); await expect(pick).toHaveAttribute('title', /未提交的改动/);
  await page.evaluate(() => { const server = window.__gitTest.server; server.files = []; server.commits[3].parents.push(server.commits[5].hash); });
  await page.getByRole('button', { name: '刷新仓库' }).click();
  await page.locator('.git-commit-row').first().click(); await expect(pick).toBeDisabled(); await expect(pick).toHaveAttribute('title', /HEAD/);
  await page.locator('.git-commit-row').filter({ hasText: '接入 DSH 原生工具栏插槽' }).click();
  await expect(pick).toBeDisabled(); await expect(pick).toHaveAttribute('title', /合并提交/);
});
test('interrupted cherry-pick exposes conflict status and the correct abort request', async () => {
  await page.evaluate(() => { window.__gitTest.server.files = []; window.__gitTest.server.cherryPickConflicts = true; });
  await page.getByRole('button', { name: '刷新仓库' }).click();
  await page.locator('.git-commit-row').filter({ hasText: '新增提交详情与文件差异' }).click();
  await page.getByRole('button', { name: '优选', exact: true }).click();
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.locator('.git-inline-error')).toContainText('冲突');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  const banner = page.locator('.git-operation-banner');
  await expect(banner).toContainText('优选（拣选提交）'); await expect(banner.getByRole('button', { name: '继续', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '优选', exact: true })).toBeDisabled();
  await banner.getByRole('button', { name: '中止', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('中止优选');
  await page.getByRole('button', { name: '确认执行', exact: true }).click(); await expect(banner).toHaveCount(0);
  const request = await page.evaluate(() => window.__gitTest.requests.filter((item) => item.op === 'mutate').at(-1));
  assert.deepEqual(request.mutation, { action: 'abortOperation', operation: 'cherry-pick' });
});
test('a resolved and staged cherry-pick uses the continue action in the conflict banner', async () => {
  await page.evaluate(() => { window.__gitTest.server.files = []; window.__gitTest.server.cherryPickConflicts = true; });
  await page.getByRole('button', { name: '刷新仓库' }).click();
  await page.locator('.git-commit-row').filter({ hasText: '新增提交详情与文件差异' }).click();
  await page.getByRole('button', { name: '优选', exact: true }).click();
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.locator('.git-inline-error')).toContainText('冲突');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('tab', { name: /更改/ }).click();
  await page.getByRole('button', { name: '暂存 src/client/panel.jsx', exact: true }).click();
  const banner = page.locator('.git-operation-banner');
  await expect(banner.getByRole('button', { name: '继续', exact: true })).toBeEnabled();
  await banner.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('继续优选');
  await page.getByRole('button', { name: '确认执行', exact: true }).click(); await expect(banner).toHaveCount(0);
  const request = await page.evaluate(() => window.__gitTest.requests.filter((item) => item.op === 'mutate').at(-1));
  assert.deepEqual(request.mutation, { action: 'continueOperation', operation: 'cherry-pick' });
});
test('slot disposal removes all plugin styles, subscriptions and mounted UI', async () => {
  await page.evaluate(() => { window.__gitTest.unloaded = true; window.__gitTest.unload(); });
  await expect(page.locator('#dsh-git-panel')).toHaveCount(0); await expect(page.locator('style[data-dsh-git]')).toHaveCount(0);
});
