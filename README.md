<h1 align="center">DSH Git</h1>

<p align="center">为 DeepSeek Harness 打造的原生 Git 插件</p>

<p align="center">
  分支与提交历史 · 可视化提交图 · 文件差异 · AI 提交 · Worktree 管理
</p>

<p align="center">
  <a href="https://github.com/cyrusgogogo/dsh-git/graphs/contributors"><img src="https://img.shields.io/github/contributors/cyrusgogogo/dsh-git?style=flat-square" alt="GitHub contributors"></a>
  <a href="https://github.com/cyrusgogogo/dsh-git/network/members"><img src="https://img.shields.io/github/forks/cyrusgogogo/dsh-git?style=flat-square" alt="GitHub forks"></a>
  <a href="https://github.com/cyrusgogogo/dsh-git/stargazers"><img src="https://img.shields.io/github/stars/cyrusgogogo/dsh-git?style=flat-square" alt="GitHub stars"></a>
  <a href="https://github.com/cyrusgogogo/dsh-git/issues"><img src="https://img.shields.io/github/issues/cyrusgogogo/dsh-git?style=flat-square" alt="GitHub issues"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/cyrusgogogo/dsh-git?style=flat-square" alt="License: MIT"></a>
</p>

---

在 DSH 内查看仓库、管理分支与工作树，完成暂存、提交和推送，无需离开当前工作区。紧凑的 IDE 风格底部面板随宿主明暗主题自适应，AI 生成的提交说明可在确认前自由编辑。

## 插件截图

以下截图使用演示仓库数据，点击图片可查看原图。

### 仓库总览

分支、更改、提交图和文件详情集中在同一个面板中，支持按分支、用户和日期筛选历史。

![深色主题下的 Git 仓库面板，包含分支列表、提交图和文件详情](<docs/screenshots/workspace-dark.png>)

<details>
<summary>查看浅色主题</summary>

![浅色主题下的 Git 仓库面板](<docs/screenshots/workspace-light.png>)

</details>

### 文件差异

点击提交中的文件，查看带行号和增删高亮的只读差异。

![文件差异查看器，展示代码增删与行号](<docs/screenshots/file-diff.png>)

### 提交与 AI 预览

手动提交支持全选、反选和批量暂存；AI 提交会先自动暂存全部当前改动，再生成可编辑的说明，最终由你确认提交或提交并推送。

![AI 提交预览，包含暂存文件、可编辑提交说明和提交确认按钮](<docs/screenshots/ai-commit-preview.png>)

<details>
<summary>查看手动批量提交</summary>

![手动提交弹窗，支持文件选择、批量暂存和编辑提交说明](<docs/screenshots/batch-commit.png>)

</details>

### 工作树管理

查看同一仓库的独立工作目录，创建、打开、锁定或移除工作树。“打开”仅切换插件的查看目录，不改变 DSH 会话工作区。

![Git 工作树管理列表，展示分支、工作目录、状态及操作](<docs/screenshots/worktrees.png>)

## 安装

插件以**组合包**（bundle）形式安装：包由 `package.json` 的 `dsh.bundle.patch` 声明一个配置层，安装进某个 **profile** 后，该层向组合中插入一行 `dsh-git` 插件。

- `<你的-profile>` 需替换为你实际使用的 profile 名；桌面应用所用 profile 可从 `$DSH_HOME/profiles/` 下的目录名确认。
- 命令中的 `dsh` 指已安装的 DSH CLI。

### 方式一：从源码构建后安装（推荐）

需要 Node.js **22+**、pnpm 与 Git。下述命令克隆源码、构建产物，再把 checkout 链接进 profile：

```sh
git clone https://github.com/cyrusgogogo/dsh-git.git
cd dsh-git
pnpm install --frozen-lockfile
pnpm run build

# 本目录已包含 dist/ 构建产物，链接进 profile
dsh plugin --profile <你的-profile> add .
```

也可以先打包，再安装 tarball；生成物可以拷给其他人直接安装：

```sh
pnpm pack
dsh plugin --profile <你的-profile> add ./dsh-git-0.1.2.tgz
```

### 方式二：直接从 GitHub 安装

```sh
dsh plugin --profile <你的-profile> add github:cyrusgogogo/dsh-git
```

git 安装拉到的是**源码而非构建产物**，因此 pnpm 会运行本包的 `prepare` 脚本（`node scripts/build.mjs`）在安装时构建发布入口。pnpm ≥10 默认拒绝执行依赖的构建脚本，第一次 `add` 可能因此失败并打印修法：把 pnpm 给出的确切包键写进该 profile 的 `pnpm-workspace.yaml`，然后重新执行 `add`。

```yaml
allowBuilds:
  dsh-git: true
```

这等于**允许该包的代码在安装时于你的机器上执行**（不在 agent 沙箱内），请只对可信来源授权；需要可复现的安装时锁定 commit，例如 `github:cyrusgogogo/dsh-git#<sha>`。

### 安装后核对

```sh
# 组合后的配置中应出现 id/name 为 dsh-git 的根行
dsh --profile <你的-profile> --dump-config
```

保存成功不代表当前进程已激活。若宿主报告 `restart-required`，请重启 DSH 并刷新 Web 页面。

卸载：

```sh
dsh plugin --profile <你的-profile> remove dsh-git
```

安装/分层依据：[官方插件发布与安装说明](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish.md)。插件只追加自己的配置行，不修改其他插件的完整配置对象。

### 从源码开发

要求 Node.js **22+**、pnpm、Git **2.31+**。

```powershell
pnpm install --frozen-lockfile
pnpm run build
pnpm run test
pnpm run test:ui
pnpm run dev
```

浏览器测试优先使用 Playwright 对应的 Chromium，Windows 缺少时尝试本机 Edge。可通过 `DSH_GIT_BROWSER` 指定测试浏览器可执行文件；没有可用浏览器时，按需手工执行 `pnpm exec playwright install chromium`。测试不需要访问真实 DSH 页面、不需要模型密钥、不连接外部 Git 远程。

在 Windows DSH agent 沙箱中，捕获子进程输出和浏览器进程管道可能返回 `spawn EPERM`。这属于运行测试的沙箱边界，不是插件声称能够绕过的权限；需由操作者为相应测试命令授权。

`pnpm run dev` 只监听并重建本项目产物，不会自动把插件注入已安装的 profile；宿主端的客户端 HMR 取决于它实际加载的位置和对应的重建通知。

当前只在 Windows 上完成实机验证；macOS/Linux 的实现路径存在，但未做实机验收。

## 使用

1. 在 DSH 选择工作区/会话，点击顶部“编辑”后面的 **Git**（普通浏览器或不兼容宿主位于会话右上角）。
2. 面板跟随主会话所属的注册工作区，也可以在面板右上角显式选择目录。
3. 非 Git 目录可选择 **初始化 Git 仓库**，确认后创建空的 `main`；已有 `.git` 元数据（包括损坏元数据）不会被覆盖。
4. 点击侧边栏分支筛选其历史；**双击**或右键“签出”进行切换。下拉列表点击其他分支同样需要确认。
5. 搜索提交，在提交图顶部直接按**分支、用户、日期**筛选；点击提交查看文件树，点击文件查看只读统一差异。
6. “更改”区域顶部的 **提交更改…** 打开手动提交弹窗，支持全选、反选和批量暂存/取消暂存。勾选本身不会写入 Git；“暂存所选”会暂存所选文件的全部当前更改（包括原来只部分暂存的文件）。普通提交只包含**已暂存**内容，不默认暂存全部文件。
7. 点击 **AI 提交**（或 AI 快捷键）会先读取最新状态，自动暂存全部当前未暂存改动、全选文件，再生成可编辑说明。包括当前未跟踪的新文件、删除和部分暂存文件的剩余改动，不包含 Git 忽略文件。每次 RPC 最多暂存 1000 个文件，更多文件自动分批；暂存失败或期间出现新改动时停止，不会发送不完整范围给模型或自动提交。生成后检查并修改文本，明确点击 **提交** 或 **提交并推送**。取消/停止/模型失败不会回滚已完成的暂存；可手写说明或重试生成。预览里的“AI 生成 / 重新生成”只基于当前暂存内容，不重复暂存。API 密钥由已有 DSH 模型配置管理。
8. 右上角 **设置** 可选择 AI 模型、修改 Conventional Commits 默认规范并录制快捷键。未指定模型时使用宿主模型目录中的首个可用模型，实际模型会显示在生成结果旁；手动填写的 provider/model 也必须已登记。设置不写入仓库，不同步到其他浏览器。
9. 分支选择旁的 **＋ → 工作树** 查看/管理 worktree。“打开”仅切换**本插件**的仓库查看目录，不会偷偷修改 DSH 会话的工作区或 cwd。
10. 在干净工作区中，选中普通提交后点击最右侧的 **优选**，确认提交哈希和当前分支再执行 cherry-pick。发生冲突时先关闭错误对话框，在编辑器解决冲突并于“更改”中暂存，再通过顶部进行中提示条继续；也可以确认中止以恢复操作前状态。

### 模型列表提示“Git 请求参数不合法”

此错误发生在插件请求协议校验阶段，并不表示模型名称或 API 密钥错误。若页面已显示 AI 设置，但运行中的宿主仍使用旧插件协议，新客户端的 `aiModels` 请求就会被旧宿主拒绝。单独刷新页面或运行 `pnpm run build` 不保证重载已运行的宿主模块。

1. 先保存当前输入，在方便时**完全退出并重启 DSH**（包括托盘驻留），再打开 Git 设置刷新模型列表；不要只刷新 Web 页面。
2. 确认当前 profile 安装/链接的是新构建。仓库中旧的 [0.1.2 发布包](<dsh-git-0.1.2.tgz>)尚未包含 AI 功能，不能把它当成本轮源码构建。
3. 若完全重启后仍失败，只需提供 `/api/dsh-git` 响应的 `result.error.code` 与 `result.error.details.issues`，不要提供 Cookie、Authorization、模型密钥或完整配置。

插件仅在新操作被宿主判定为未知操作时提示版本不一致；真实字段错误和未配置模型服务仍按原类别显示，不会自动安装、重启、放宽校验或改走其他模型接口。

### 键盘

以下操作快捷键可在 Git 设置中修改、录制或留空禁用：

| 操作 | 默认快捷键 | 行为 |
| --- | --- | --- |
| 提交 | `Ctrl+Enter` | 打开提交预览，不直接提交 |
| AI 提交 | `Ctrl+Shift+Enter` | 自动暂存全部当前改动、全选并生成预览；仍需确认提交 |
| 推送 | `Ctrl+Shift+P` | 打开推送确认 |
| 获取 | `Ctrl+Shift+F` | 打开获取远程更新确认 |

仅在 **Git 面板获得焦点** 时生效，不拦截宿主编辑器、输入框、其他弹窗或菜单。支持 `Ctrl` / `Meta` / `Alt` / `Shift` 与 `Mod`（macOS 对应 ⌘，其他平台对应 Ctrl）；检测快捷键冲突，忽略输入法组合事件与长按重复。部分组合键可能被浏览器/操作系统占用。

- 标签页：左右方向键、Home、End；当前标签为主要 Tab 停靠点。
- 提交列表：上下方向键、Home、End。
- 分支菜单、下拉、对话框：Radix 管理焦点与键盘行为；Esc 关闭，执行中的操作对话框不会被 Esc 意外关闭。
- 面板上边缘：聚焦后使用上下方向键调整高度，Home/End 调整到预设/最大高度；双击切换最大化。

## 许可

MIT，见 [LICENSE](<LICENSE>)。第三方构建依赖的许可与版权声明见 [THIRD_PARTY_NOTICES.md](<THIRD_PARTY_NOTICES.md>)。
