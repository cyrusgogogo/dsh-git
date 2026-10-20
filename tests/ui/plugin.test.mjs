import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, access } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

let browser, page, errors;
const chooseOption = async (label, text) => {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option').filter({ has: page.getByText(text, { exact: true }) }).click();
};
const style = `html,body,#app{margin:0;width:100%;height:100%;overflow:hidden;background:#212225;color:#dce0e6;font-family:Segoe UI,Microsoft YaHei,sans-serif}.host-frame{display:flex;height:100%;font-size:13px}.host-sidebar{width:240px;box-sizing:border-box;padding:20px;background:#28292c;border-right:1px solid #393a3d;display:flex;flex-direction:column;gap:22px;color:#aeb3bd}.host-sidebar strong{font-size:17px;color:#e1e5ed}.host-project{background:#34363d;color:#dce0e6;border-radius:5px;padding:8px}.host-sidebar small{font-size:11px;line-height:1.7;color:#9da3ad}.host-main{flex:1;min-width:0}.host-main>header{display:flex;align-items:center;justify-content:space-between;height:60px;padding:0 24px;border-bottom:1px solid #343539;color:#b7bcc5}.host-tools{display:flex;gap:8px}.host-placeholder{margin:170px auto 0;max-width:560px;padding:0 35px}.host-kicker{font-size:10px;letter-spacing:2px;color:#8da5c6}.host-placeholder h1{font-size:25px;font-weight:500;letter-spacing:1px;margin:16px 0}.host-placeholder p{color:#a0a6b1;line-height:1.9;font-size:13px}html[data-windows-titlebar] .host-frame{box-sizing:border-box;padding-top:40px}`;
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
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><style>${style}</style></head><body><div id="app"></div></body></html>`;
  await page.route('http://dsh-git.test/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://dsh-git.test/');
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
  await chooseOption('Git 工作区目录', 'empty-project');
  await expect(page.getByRole('heading', { name: '此工作区尚未使用 Git' })).toBeVisible();
  await expect(page.locator('.git-notice-error')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开分支列表' })).toBeDisabled();
  await page.getByRole('button', { name: '重新检测' }).click();
  await expect(page.getByRole('heading', { name: '此工作区尚未使用 Git' })).toBeVisible();
  await page.locator('#dsh-git-panel').screenshot({ path: '.artifacts/screenshots/not-a-repository.png' });
});
test('non-Git workspace initialization requires confirmation and ends in a usable empty repo', async () => {
  await chooseOption('Git 工作区目录', 'empty-project');
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
      root.style.setProperty('--dsw-alias-border-l2', theme === 'dark' ? '#45464b' : '#d4d4da');
      root.style.setProperty('--dsw-alias-state-business-primary', theme === 'dark' ? '#83afe9' : '#356fdb');
    }, theme);
    for (const [name, file] of [['按分支筛选', 'branch-filter'], ['按日期筛选', 'date-filter'], ['Git 工作区目录', 'workspace-select']]) {
      await page.getByRole('combobox', { name, exact: true }).click();
      const content = page.locator('.git-select-content'); await assertOpaque(content);
      await content.screenshot({ path: `.artifacts/screenshots/${file}-${theme}.png` });
      await page.keyboard.press('Escape');
    }
    await page.locator('.git-history-toolbar').screenshot({ path: `.artifacts/screenshots/filter-toolbar-${theme}.png` });
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
  await chooseOption('按日期筛选', '最近 30 天'); await expect(page.locator('.git-commit-row')).toHaveCount(11);
  await chooseOption('按分支筛选', 'feature/ui'); await user.fill('Alex');
  await expect(page.locator('.git-commit-row')).toHaveCount(1);
  const request = await page.evaluate(() => window.__gitTest.requests.filter((item) => item.op === 'history').at(-1));
  assert.equal(request.ref, 'refs/heads/feature/ui'); assert.equal(request.author, 'Alex'); assert.equal(request.dateRange, '30d');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#dsh-git-panel').screenshot({ path: '.artifacts/screenshots/inline-filters.png' });
  await page.getByRole('button', { name: '清除全部提交筛选' }).click();
  await expect(page.locator('.git-commit-row')).toHaveCount(13);
  await expect(branch).toContainText('全部'); await expect(user).toHaveValue(''); await expect(date).toContainText('不限');
});
test('shadcn selects preserve groups, explicit all-values and a missing selected branch', async () => {
  const branch = page.getByRole('combobox', { name: '按分支筛选', exact: true });
  await branch.click();
  for (const name of ['本地分支', '远程分支', '标签']) await expect(page.getByRole('group', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: '全部', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('option', { name: '全部', exact: true }).locator('.git-select-indicator svg')).toHaveCount(1);
  await page.keyboard.press('Escape'); await expect(branch).toBeFocused();
  await chooseOption('按分支筛选', 'feature/ui');
  await page.evaluate(() => { window.__gitTest.server.branches = window.__gitTest.server.branches.filter((item) => item.ref !== 'refs/heads/feature/ui'); });
  await page.getByRole('button', { name: '刷新仓库' }).click();
  await expect(branch).toContainText('feature/ui');
  await branch.click(); await expect(page.getByRole('option', { name: 'feature/ui', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await chooseOption('按分支筛选', '全部');
  await chooseOption('按日期筛选', '最近 7 天');
  await expect(page.locator('.git-commit-row')).toHaveCount(11);
  await chooseOption('按日期筛选', '不限');
  await expect(page.locator('.git-commit-row')).toHaveCount(13);
  const request = await page.evaluate(() => window.__gitTest.requests.filter((item) => item.op === 'history').at(-1));
  assert.equal(request.ref, undefined); assert.equal(request.dateRange, '');
  assert.equal(await page.evaluate(() => window.__gitTest.requests.filter((item) => item.op === 'mutate').length), 0);
});
test('shadcn selects support keyboard selection, escape focus return and shortcut isolation', async () => {
  for (const name of ['按分支筛选', '按日期筛选', 'Git 工作区目录']) {
    const trigger = page.getByLabel(name, { exact: true });
    await trigger.focus(); await page.keyboard.press('Control+Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (await trigger.getAttribute('aria-expanded') === 'true') await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('ArrowDown'); await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  }
  const date = page.getByRole('combobox', { name: '按日期筛选', exact: true });
  await date.focus(); await page.keyboard.press('Space'); await expect(page.getByRole('option', { name: '不限', exact: true })).toBeFocused();
  await page.keyboard.press('End'); await expect(page.getByRole('option', { name: '最近一年', exact: true })).toBeFocused(); await page.keyboard.press('Enter');
  await expect(date).toContainText('最近一年'); await expect(page.locator('.git-commit-row')).toHaveCount(12); await expect(date).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.getByRole('option', { name: '最近一年', exact: true })).toBeFocused();
  await page.keyboard.press('Home'); await expect(page.getByRole('option', { name: '不限', exact: true })).toBeFocused(); await page.keyboard.press('Enter');
  await expect(date).toContainText('不限'); await expect(page.locator('.git-commit-row')).toHaveCount(13);
  const workspace = page.getByRole('combobox', { name: 'Git 工作区目录', exact: true });
  await workspace.focus(); await page.keyboard.press('Space'); await expect(page.getByRole('option', { name: 'dsh-git', exact: true })).toBeFocused();
  await page.keyboard.type('empty'); await expect(page.getByRole('option', { name: 'empty-project', exact: true })).toBeFocused(); await page.keyboard.press('Enter');
  await expect(workspace).toContainText('empty-project'); await expect(page.getByRole('heading', { name: '此工作区尚未使用 Git' })).toBeVisible();
  await chooseOption('Git 工作区目录', 'dsh-git'); await expect(page.getByRole('listbox', { name: '提交列表' })).toBeVisible();
  await workspace.click(); await page.evaluate(() => window.__gitTest.unloadPlugin());
  await expect(page.locator('.git-select-content')).toHaveCount(0);
  assert.equal(await page.evaluate(() => document.body.style.pointerEvents), '');
});
test('shadcn select popovers constrain long names and show an empty workspace placeholder', async () => {
  await page.evaluate(() => {
    const server = window.__gitTest.server;
    const name = `feature/${'long-branch-name-'.repeat(20)}`;
    server.branches.push({ ...server.branches[0], name, ref: `refs/heads/${name}` });
    window.__gitTest.setWorkspaces([
      { workspaceId: 'workspace-main', title: `dsh-git-${'long-workspace-'.repeat(20)}`, path: server.root, sessionIds: ['session1'] },
      { workspaceId: 'workspace-empty', title: 'empty-project', path: 'D:\\code\\empty-project', sessionIds: [] },
    ]);
  });
  await page.getByRole('button', { name: '刷新仓库' }).click();
  for (const width of [840, 375]) {
    await page.setViewportSize({ width, height: 740 });
    for (const name of ['按分支筛选', '按日期筛选', 'Git 工作区目录']) {
      await page.getByRole('combobox', { name, exact: true }).click();
      const content = page.locator('.git-select-content');
      const box = await content.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1, `${name} must fit a ${width}px viewport`);
      assert.ok(box.y >= 0 && box.y + box.height <= 741);
      assert.equal(await content.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
      if (name === 'Git 工作区目录') await expect(content).toContainText('D:\\code\\empty-project');
      await page.keyboard.press('Escape');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
  }
  await page.evaluate(() => window.__gitTest.setWorkspaces([]));
  const workspace = page.getByRole('combobox', { name: 'Git 工作区目录', exact: true });
  await expect(workspace).toBeDisabled(); await expect(workspace).toContainText('暂无工作区');
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
test('Windows caption places one Git action immediately after Edit without changing native menus', async () => {
  const caption = page.locator('[data-windows-menu]');
  const entry = caption.getByRole('button', { name: '收起 Git 工具栏' });
  await expect(entry).toBeVisible();
  await expect(entry).not.toHaveAttribute('aria-controls', /.+/);
  await expect(caption.getByRole('menuitem')).toHaveCount(2);
  await expect(page.locator('.host-tools .git-toolbar-entry, .git-global-launcher')).toHaveCount(0);
  assert.equal(await entry.evaluate((button) => button.parentElement.previousElementSibling.getAttribute('role')), 'menubar');
  const edit = await caption.getByRole('menuitem', { name: '编辑', exact: true }).boundingBox();
  const git = await entry.boundingBox();
  assert.ok(git.x >= edit.x + edit.width && git.x - edit.x - edit.width <= 3);
  assert.ok(git.y >= 0 && git.y + git.height <= 40);
  const app = caption.getByRole('menuitem', { name: '应用', exact: true });
  await app.focus(); await page.keyboard.press('ArrowRight');
  await expect(caption.getByRole('menuitem', { name: '编辑', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight'); await expect(app).toBeFocused();
  await app.click(); assert.deepEqual(await page.evaluate(() => window.__gitTest.nativeMenuClicks), [0]);
  await app.evaluate((button) => button.blur());
  await page.screenshot({ path: '.artifacts/screenshots/titlebar-entry.png', clip: { x: 0, y: 0, width: 260, height: 40 } });
});
test('caption action supports Tab, Enter and Space and keeps editor selection on pointer activation', async () => {
  const caption = page.locator('[data-windows-menu]');
  await caption.getByRole('menuitem', { name: '编辑', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(caption.getByRole('button')).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('#dsh-git-panel')).toHaveCount(0);
  await page.keyboard.press('Space'); await expect(page.locator('#dsh-git-panel')).toBeVisible();
  await expect(caption.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  await page.evaluate(() => { const input = document.createElement('input'); input.id = 'test-editor'; input.value = 'selected text'; document.querySelector('.host-main').append(input); input.focus(); input.setSelectionRange(1, 6); });
  await caption.getByRole('button').click();
  assert.deepEqual(await page.locator('#test-editor').evaluate((input) => ({ focused: document.activeElement === input, start: input.selectionStart, end: input.selectionEnd })), { focused: true, start: 1, end: 6 });
});
test('caption action stays unique without a session or while a global panel is selected', async () => {
  await page.evaluate(() => { window.__gitTest.setSession(false); window.__gitTest.setPanel('settings'); });
  await expect(page.locator('.git-titlebar-entry')).toHaveCount(1);
  await expect(page.locator('.git-toolbar-entry, .git-global-launcher')).toHaveCount(0);
  await page.locator('.git-titlebar-entry').click(); await expect(page.locator('#dsh-git-panel')).toHaveCount(0);
  await page.locator('.git-titlebar-entry').click(); await expect(page.locator('#dsh-git-panel')).toBeVisible();
});
test('caption removal and late mounting transfer the action without losing panel state', async () => {
  await page.evaluate(() => window.__gitTest.removeWindowsMenu());
  await expect(page.locator('.host-tools .git-toolbar-entry')).toHaveCount(1);
  await expect(page.locator('#dsh-git-panel')).toBeVisible();
  await page.locator('.git-toolbar-entry').click(); await expect(page.locator('#dsh-git-panel')).toHaveCount(0);
  await page.evaluate(() => window.__gitTest.mountWindowsMenu());
  await expect(page.locator('.git-titlebar-entry')).toHaveCount(1);
  await expect(page.locator('.git-toolbar-entry')).toHaveCount(0);
  await page.locator('.git-titlebar-entry').click(); await expect(page.locator('#dsh-git-panel')).toBeVisible();
  await page.evaluate(() => window.__gitTest.mountWindowsMenu());
  await expect(page.locator('.git-titlebar-entry')).toHaveCount(1);
});
test('browser and incompatible caption layouts retain the existing fallback entry', async () => {
  await page.evaluate(() => { window.__gitTest.unload(); window.testMount({ windowsMenu: false }); });
  await expect(page.locator('.host-tools .git-toolbar-entry')).toBeVisible();
  await expect(page.locator('.git-titlebar-entry')).toHaveCount(0);
  await page.locator('.git-toolbar-entry').click(); await expect(page.locator('#dsh-git-panel')).toBeVisible();
  await page.evaluate(() => window.__gitTest.setPanel('settings'));
  await expect(page.locator('.git-global-launcher .git-toolbar-entry')).toBeVisible();
  await page.evaluate(() => { window.__gitTest.setPanel(null); window.__gitTest.mountWindowsMenu(); });
  await expect(page.locator('.git-titlebar-entry')).toHaveCount(1);
  await page.evaluate(() => { const bar = document.querySelector('[data-windows-menu]').shadowRoot.querySelector('[role=menubar]'); bar.append(bar.lastElementChild.cloneNode(true)); });
  await expect(page.locator('.host-tools .git-toolbar-entry')).toBeVisible();
  await expect(page.locator('[data-dsh-git-menu-entry]')).toHaveCount(0);
  await page.evaluate(() => document.querySelector('[data-windows-menu]').shadowRoot.querySelector('[role=menubar]').lastElementChild.remove());
  await expect(page.locator('.git-titlebar-entry')).toHaveCount(1);
  await page.evaluate(() => document.querySelector('[data-windows-menu]').shadowRoot.querySelector('[role=menubar]').remove());
  await expect(page.locator('.host-tools .git-toolbar-entry')).toBeVisible();
  await expect(page.locator('[data-dsh-git-menu-entry]')).toHaveCount(0);
  await page.evaluate(() => { window.__gitTest.setSession(false); window.__gitTest.setPanel('settings'); });
  await expect(page.locator('.git-global-launcher .git-toolbar-entry')).toBeVisible();
});
test('change actions stay above the file scroll area and remain visible with long lists', async () => {
  await page.getByRole('tab', { name: /更改/ }).click();
  const toolbar = page.locator('.git-changes-toolbar');
  await expect(toolbar.getByRole('button', { name: '提交更改…', exact: true })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'AI 提交', exact: true })).toBeVisible();
  await expect(page.locator('.git-changes-list .git-change-commit-actions')).toHaveCount(0);
  await page.locator('.git-sidebar').screenshot({ path: '.artifacts/screenshots/changes-top-actions.png' });
  await page.evaluate(() => { window.__gitTest.server.files.push(...Array.from({ length: 80 }, (_, index) => ({ path: `src/long-list-${index}.mjs`, index: '.', worktree: 'M', staged: false, unstaged: true, conflict: false }))); });
  await page.getByRole('button', { name: '刷新仓库', exact: true }).click();
  await expect(page.locator('.git-change-row')).toHaveCount(83);
  const before = await toolbar.boundingBox();
  const list = page.locator('.git-sidebar-scroll');
  assert.ok((await list.boundingBox()).y >= before.y + before.height - 1);
  await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  assert.ok(await list.evaluate((element) => element.scrollTop > 0));
  const after = await toolbar.boundingBox();
  assert.equal(after.y, before.y);
  await expect(toolbar.getByRole('button', { name: 'AI 提交', exact: true })).toBeInViewport();
  await toolbar.getByRole('button', { name: '提交更改…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '提交更改', exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => window.__gitTest.requests.filter((item) => item.op === 'mutate').length), 0);
});

test('AI preparation exposes staging progress and locks mutation and submit controls until generated', async () => {
  await page.evaluate(() => { window.__gitTest.server.stageDelay = 700; });
  await page.getByRole('tab', { name: /更改/ }).click();
  await page.locator('.git-changes-toolbar').getByRole('button', { name: 'AI 提交', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'AI 提交预览', exact: true });
  await expect(dialog.getByText('正在检查并暂存全部当前改动，随后生成提交信息…', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '提交', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '提交并推送', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('checkbox', { name: '选择全部文件', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  assert.equal(await page.evaluate(() => window.__gitTest.requests.filter((item) => item.op === 'aiCommit').length), 0);
  await expect(dialog.getByRole('textbox', { name: '提交信息', exact: true })).toHaveValue(/feat\(git\)/);
  await expect(dialog.getByRole('button', { name: '提交', exact: true })).toBeEnabled();
});

test('automatic staging failure keeps the preview editable and never calls the model or commits', async () => {
  await page.evaluate(() => { window.__gitTest.server.stageError = '暂存失败：index.lock 已存在'; });
  await page.locator('.git-statusbar').getByRole('button', { name: 'AI 提交', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('index.lock');
  await expect(dialog.getByRole('textbox', { name: '提交信息', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeEnabled();
  const requests = await page.evaluate(() => window.__gitTest.requests);
  assert.equal(requests.filter((item) => item.op === 'aiCommit').length, 0);
  assert.deepEqual(requests.filter((item) => item.op === 'mutate').map((item) => item.mutation.action), ['stage']);
});

test('top change actions keep a stable disabled state for a clean tree and reject conflicted AI staging', async () => {
  await page.getByRole('tab', { name: /更改/ }).click();
  await page.evaluate(() => { window.__gitTest.server.files = []; });
  await page.getByRole('button', { name: '刷新仓库', exact: true }).click();
  const toolbar = page.locator('.git-changes-toolbar');
  await expect(page.getByText('工作区干净', { exact: true }).first()).toBeVisible();
  await expect(toolbar.getByRole('button', { name: '提交更改…', exact: true })).toBeDisabled();
  await expect(toolbar.getByRole('button', { name: 'AI 提交', exact: true })).toBeDisabled();
  await page.evaluate(() => { window.__gitTest.server.files = [{ path: 'conflict.txt', staged: false, unstaged: true, conflict: true, index: 'U', worktree: 'U' }]; });
  await page.getByRole('button', { name: '刷新仓库', exact: true }).click();
  await expect(page.locator('.git-change-row')).toHaveCount(1);
  await expect(toolbar.getByRole('button', { name: 'AI 提交', exact: true })).toBeDisabled();
});

test('commit dialog batches selected files without implicit staging and supports select-all/invert', async () => {
  await page.locator('.git-statusbar').getByRole('button', { name: '提交', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: '选择全部文件', exact: true }).check();
  await expect(dialog.locator('.git-selection-count')).toContainText('已选 3 / 3');
  assert.equal(await page.evaluate(() => window.__gitTest.requests.filter((item) => item.op === 'mutate').length), 0);
  await dialog.getByRole('button', { name: '反选', exact: true }).click();
  await expect(dialog.locator('.git-selection-count')).toContainText('已选 0 / 3');
  await dialog.getByRole('checkbox', { name: '选择 src/client/panel.jsx', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '选择 docs/usage.md', exact: true }).check();
  await expect(dialog.getByRole('checkbox', { name: '选择全部文件', exact: true })).toHaveAttribute('aria-checked', 'mixed');
  await dialog.getByRole('button', { name: '暂存所选 (2)', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '暂存所选', exact: true })).toBeDisabled();
  const staged = await page.evaluate(() => window.__gitTest.requests.filter((item) => item.op === 'mutate'));
  assert.equal(staged.length, 1); assert.equal(staged[0].mutation.action, 'stage'); assert.deepEqual(staged[0].mutation.paths, ['src/client/panel.jsx', 'docs/usage.md']);
  await dialog.getByRole('textbox', { name: '提交信息', exact: true }).fill('feat: 批量提交');
  await dialog.screenshot({ path: '.artifacts/screenshots/batch-commit.png' });
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.git-statusbar > .git-notice')).toContainText('操作已完成');
  await expect(page.locator('.git-panel > .git-notice')).toHaveCount(0);
});
test('AI entry stages every current change, selects all files and generates an editable preview before explicit confirmation', async () => {
  await page.getByRole('tab', { name: /更改/ }).click();
  await page.locator('.git-changes-toolbar').getByRole('button', { name: 'AI 提交', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const message = dialog.getByRole('textbox', { name: '提交信息', exact: true });
  await expect(message).toHaveValue(/feat\(git\): 改进提交工作流/);
  await expect(dialog.locator('.git-selection-count')).toContainText('已选 3 / 3');
  await expect(dialog.getByRole('checkbox', { name: '选择全部文件', exact: true })).toBeChecked();
  await expect(dialog.locator('.git-stage-badge.is-staged')).toHaveCount(3);
  const before = await page.evaluate(() => ({ requests: window.__gitTest.requests, received: window.__gitTest.server.aiReceivedFiles }));
  const staged = before.requests.filter((item) => item.op === 'mutate');
  assert.deepEqual(staged.map((item) => item.mutation), [{ action: 'stage', paths: ['src/client/panel.jsx', 'docs/usage.md'] }]);
  assert.ok(before.received.every((file) => file.staged && !file.unstaged));
  assert.ok(before.requests.findIndex((item) => item.op === 'mutate') < before.requests.findIndex((item) => item.op === 'aiCommit'));
  await expect(dialog.getByRole('button', { name: '提交', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: '提交并推送', exact: true })).toBeEnabled();
  await message.fill('fix(git): 用户确认后的提交说明');
  await dialog.screenshot({ path: '.artifacts/screenshots/ai-commit-preview.png' });
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const mutation = await page.evaluate(() => window.__gitTest.requests.find((item) => item.op === 'mutate' && item.mutation.action === 'commit').mutation);
  assert.equal(mutation.action, 'commit'); assert.equal(mutation.message, 'fix(git): 用户确认后的提交说明'); assert.match(mutation.stagedTree, /^[a-f\d]{40}$/);
});
test('AI generation can be cancelled and errors preserve manual commit access', async () => {
  await page.evaluate(() => { window.__gitTest.server.aiDelay = 1000; });
  await page.locator('.git-statusbar').getByRole('button', { name: 'AI 提交', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('正在生成提交信息，不会执行提交…', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '停止生成', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: '提交信息', exact: true })).toBeEnabled();
  await page.evaluate(() => { window.__gitTest.server.aiDelay = 0; window.__gitTest.server.aiError = '模型暂时不可用'; });
  await dialog.getByRole('button', { name: 'AI 生成', exact: true }).click();
  await expect(dialog.locator('.git-inline-error')).toContainText('模型暂时不可用');
  await dialog.getByRole('textbox', { name: '提交信息', exact: true }).fill('docs: 手动提交仍可用');
  await expect(dialog.getByRole('button', { name: '提交', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  const actions = await page.evaluate(() => window.__gitTest.requests.filter((item) => item.op === 'mutate').map((item) => item.mutation.action));
  assert.deepEqual(actions, ['stage']);
  assert.equal(await page.evaluate(() => window.__gitTest.server.files.every((file) => file.staged && !file.unstaged)), true);
});
test('index changes after AI preview block submission until regeneration', async () => {
  await page.locator('.git-statusbar').getByRole('button', { name: 'AI 提交', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: '提交信息', exact: true })).toHaveValue(/feat\(git\)/);
  await dialog.getByRole('button', { name: '取消暂存 src/client/panel.jsx', exact: true }).click();
  await expect(dialog).toContainText('暂存内容已变化，请重新生成');
  await expect(dialog.getByRole('button', { name: '提交', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '重新生成', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '提交', exact: true })).toBeEnabled();
  await page.evaluate(() => { window.__gitTest.server.indexVersion++; });
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(dialog.locator('.git-inline-error')).toContainText('暂存内容已变化');
  await expect(dialog.getByRole('button', { name: '提交', exact: true })).toBeDisabled();
});
test('commit-and-push is explicit and a push failure cannot accidentally repeat a successful local commit', async () => {
  await page.evaluate(() => { window.__gitTest.server.pushError = '远程拒绝'; });
  await page.locator('.git-statusbar').getByRole('button', { name: 'AI 提交', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: '提交信息', exact: true })).toHaveValue(/feat\(git\)/);
  await dialog.getByRole('combobox', { name: '提交并推送的目标', exact: true }).selectOption('origin');
  await dialog.getByRole('button', { name: '提交并推送', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.git-statusbar .git-notice-error')).toContainText('本地提交已成功，但推送失败');
  const mutations = await page.evaluate(() => window.__gitTest.requests.filter((item) => item.op === 'mutate'));
  assert.deepEqual(mutations.map((item) => item.mutation.action), ['stage', 'commitAndPush']); assert.equal(mutations[1].mutation.remote, 'origin');
  await page.locator('#dsh-git-panel').screenshot({ path: '.artifacts/screenshots/statusbar-notice.png' });
});
test('settings sit left of collapse, persist model/prompt/shortcuts and keep shortcuts local and confirmed', async () => {
  const settings = page.getByRole('button', { name: 'Git 设置', exact: true });
  assert.equal(await settings.evaluate((button) => button.nextElementSibling.getAttribute('aria-label')), '收起 Git 面板');
  await settings.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('option', { name: '测试模型 · test-provider', exact: true })).toHaveCount(1);
  await dialog.getByRole('combobox', { name: '宿主已配置的模型', exact: true }).selectOption('1');
  await dialog.getByRole('textbox', { name: 'AI 提交信息生成规范', exact: true }).fill('请生成英文 Conventional Commit，正文解释更改原因。');
  await dialog.getByRole('textbox', { name: '提交（打开确认）', exact: true }).fill('Ctrl+Alt+C');
  await dialog.screenshot({ path: '.artifacts/screenshots/git-settings.png' });
  await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await settings.focus(); await page.keyboard.press('Control+Alt+c');
  await expect(dialog).toContainText('提交更改');
  assert.equal(await page.evaluate(() => window.__gitTest.requests.filter((item) => item.op === 'mutate').length), 0);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() => { const editor = document.createElement('textarea'); editor.id = 'host-editor'; document.querySelector('.host-main').append(editor); editor.focus(); });
  await page.keyboard.press('Control+Alt+c'); await expect(dialog).toHaveCount(0);
  await page.evaluate(() => { window.__gitTest.unload(); window.testMount(); });
  await page.getByRole('button', { name: '打开 Git 工具栏', exact: true }).click();
  await settings.click();
  await expect(dialog.getByRole('textbox', { name: '提交（打开确认）', exact: true })).toHaveValue('Ctrl+Alt+C');
  await expect(dialog.getByRole('textbox', { name: 'AI 提交信息生成规范', exact: true })).toHaveValue('请生成英文 Conventional Commit，正文解释更改原因。');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.git-statusbar').getByRole('button', { name: 'AI 提交', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: '提交信息', exact: true })).toHaveValue(/feat\(git\)/);
  const request = await page.evaluate(() => window.__gitTest.requests.find((item) => item.op === 'aiCommit'));
  assert.equal(request.provider, 'test-provider'); assert.equal(request.model, 'review-model'); assert.match(request.prompt, /英文 Conventional/);
});
test('model settings distinguish an old host from a provider configuration failure and recover after host update', async () => {
  await page.evaluate(() => { window.__gitTest.server.legacyAiModels = true; });
  await page.getByRole('button', { name: 'Git 设置', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Git 插件前后端版本不一致');
  await expect(dialog).toContainText('请完全退出并重启 DSH');
  await expect(dialog).not.toContainText('Git 请求参数不合法');
  await expect(dialog).not.toContainText('未指定提供商和模型时，生成会自动选择');
  await expect(dialog.getByRole('combobox', { name: '宿主已配置的模型', exact: true })).toBeDisabled();
  assert.equal(await page.evaluate(() => window.__gitTest.requests.filter((item) => item.op === 'aiModels').length), 1);
  await page.evaluate(() => { window.__gitTest.server.legacyAiModels = false; });
  await dialog.getByRole('button', { name: '重试模型列表', exact: true }).click();
  await expect(dialog.getByRole('option', { name: '测试模型 · test-provider', exact: true })).toHaveCount(1);
  await expect(dialog.getByRole('combobox', { name: '宿主已配置的模型', exact: true })).toBeEnabled();
  await expect(dialog).not.toContainText('Git 插件前后端版本不一致');
});

test('shortcuts ignore hidden host overlays and remain functional after unloading an open panel', async () => {
  await page.evaluate(() => { const overlay = document.createElement('div'); overlay.id = 'hidden-host-dialog'; overlay.role = 'dialog'; overlay.hidden = true; document.body.append(overlay); });
  const settings = page.getByRole('button', { name: 'Git 设置', exact: true });
  await settings.focus(); await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('dialog', { name: '提交更改', exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: '提交更改', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() => { window.__gitTest.unload(); window.testMount(); });
  await page.getByRole('button', { name: '打开 Git 工具栏', exact: true }).click();
  await expect(page.getByRole('listbox', { name: '提交列表', exact: true })).toBeVisible();
  await settings.focus(); await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('dialog', { name: '提交更改', exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => window.__gitTest.requests.filter((item) => item.op === 'mutate').length), 0);
});

test('settings expose shortcut conflicts, focus errors and fit compact light/dark windows', async () => {
  await page.getByRole('button', { name: 'Git 设置', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: '推送（打开确认）', exact: true }).fill('Ctrl+Enter');
  await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('快捷键重复');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await dialog.getByRole('button', { name: '恢复默认快捷键', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  for (const light of [false, true]) {
    await page.evaluate((light) => { if (light) { const style = document.documentElement.style; style.setProperty('--dsw-alias-bg-base', '#ffffff'); style.setProperty('--dsw-specific-menu', '#fafafc'); style.setProperty('--dsw-alias-label-primary', '#252529'); style.setProperty('--dsw-alias-label-secondary', '#56565e'); style.setProperty('--dsw-alias-border-l2', '#d4d4da'); } }, light);
    await page.setViewportSize({ width: 375, height: 740 });
    const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 375);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375);
    if (light) await dialog.screenshot({ path: '.artifacts/screenshots/settings-narrow-light.png' });
  }
});

test('slot disposal removes all plugin styles, subscriptions and mounted UI', async () => {
  await page.evaluate(() => window.__gitTest.unloadPlugin());
  await expect(page.locator('#dsh-git-panel')).toHaveCount(0); await expect(page.locator('style[data-dsh-git]')).toHaveCount(0);
  await expect(page.locator('[data-dsh-git-menu-entry]')).toHaveCount(0);
  await expect(page.locator('[data-windows-menu]').getByRole('menuitem')).toHaveCount(2);
});
