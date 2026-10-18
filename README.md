# DSH Git

一个面向 DeepSeek Harness 的原生 Git 插件。采用紧凑的 IDE 风格，并随宿主明暗主题自适应，在当前 DSH 工作区下提供分支、提交历史、提交图、文件差异和 Git worktree 管理。

## 已实现

- **Git 初始化**：在未使用 Git 的已注册工作区中，经确认执行 `git init --initial-branch=main`；已有 `.git` 元数据（包括损坏元数据）不会被覆盖。
- **右上角 Git 入口**：向会话工具栏追加入口，不覆盖宿主原有按钮。没有活动会话时提供右上角备用入口。
- **底部面板**：支持拖动调整高度、键盘调整、最大化、收起，以及多个独立 Git 视图标签。
- **主题自适应界面**：表面、边框与文字色全部取自 DSH 宿主令牌；强调色、语义色和提交图/差异配色随宿主明暗主题调整，浅色主题下不会出现低对比的荧光色。焦点环、悬停/禁用态、按钮按压反馈、弹层触发点缩放与 `prefers-reduced-motion` 一并处理。
- **三栏仓库视图**：左侧分支/更改，中间提交历史及真实父子关系提交图，右侧变更文件树、提交正文、作者、时间与引用。
- **分支下拉**：搜索本地和远程分支；更新、提交、推送、新建分支、抓取远程；签出前明确确认。
- **不同的右键菜单**：当前分支与其他本地/远程分支分别提供适用操作，也有可通过键盘打开的“更多操作”按钮。
- **分支旁的加号**：紧邻分支选择；两个选项严格为“GIT工作区”和“工作树”。前者新增仓库视图，后者显示真实的 `git worktree list` 结果。
- **清晰的菜单与选择框**：分支下拉、右键菜单及子菜单均为不透明实色背景；工作区选择框采用圆角。
- **平铺历史筛选**：分支、用户、日期始终显示在提交图顶部，支持组合与一键清除；日期包括今天、最近 7/30/90 天与最近一年（按 Git 提交时间）。
- **优选（cherry-pick）**：位于提交图顶部最右侧，将选中的普通提交应用到当前本地分支；要求工作区干净并明确确认，支持冲突后继续或中止，不猜测合并提交的主父提交。
- **工作树**：创建、查看、打开为插件查看目录、复制路径、锁定/解锁、安全移除；保护主工作树、当前查看目录、已锁定或有改动的工作树。
- **日常 Git**：逐文件/全部暂存与取消暂存、提交已暂存内容、分支创建/重命名/安全删除、合并、变基、仅快进更新、设置上游、非强制推送、抓取远程、远程分支删除。
- **冲突处理**：保留冲突现场；在编辑器解决冲突后，可在“更改”中暂存并继续/中止合并、变基或优选。
- **友好的空状态**：非 Git 目录不是异常；另行区分 Git 未安装、目录消失、权限/执行失败。

### 实现说明

插件按紧凑的深色 IDE 布局实现，对接依据为 DSH **0.2.0-rc.2**、Cordis **4.0.4** 的公开服务与注册契约。

该宿主没有公开的原生 bottom-panel 插槽，因此底部面板通过公开 `shell.overlay` 实现为**固定、可缩放的底部覆盖层**，不会伪造不存在的宿主 API。它不会把宿主聊天区域整体重新排版，增大面板会遮住其下方内容。

插件不会自行修改 DSH 的运行中配置，也不会自行重启宿主；安装后是否需要重启由宿主提示决定。

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

1. 在 DSH 选择工作区/会话，点击右上角 **Git**。
2. 面板跟随主会话所属的注册工作区，也可以在面板右上角显式选择目录。
3. 非 Git 目录可选择 **初始化 Git 仓库**，确认后创建空的 `main`；已有 `.git` 元数据（包括损坏元数据）不会被覆盖。
4. 点击侧边栏分支筛选其历史；**双击**或右键“签出”进行切换。下拉列表点击其他分支同样需要确认。
5. 搜索提交，在提交图顶部直接按**分支、用户、日期**筛选；点击提交查看文件树，点击文件查看只读统一差异。
6. “更改”用于暂存；提交对话框只提交**已暂存**内容，不默认暂存全部文件。
7. 分支选择旁的 **＋ → 工作树** 查看/管理 worktree。“打开”仅切换**本插件**的仓库查看目录，不会偷偷修改 DSH 会话的工作区或 cwd。
8. 在干净工作区中，选中普通提交后点击最右侧的 **优选**，确认提交哈希和当前分支再执行 cherry-pick。发生冲突时先关闭错误对话框，在编辑器解决冲突并于“更改”中暂存，再通过顶部提示条继续；也可以确认中止以恢复操作前状态。

### 键盘

- 标签页：左右方向键、Home、End；当前标签为主要 Tab 停靠点。
- 提交列表：上下方向键、Home、End。
- 分支菜单、下拉、对话框：Radix 管理焦点与键盘行为；Esc 关闭，执行中的操作对话框不会被 Esc 意外关闭。
- 面板上边缘：聚焦后使用上下方向键调整高度，Home/End 调整到预设/最大高度；双击切换最大化。

## 安全与限制

- **执行者是 DSH 宿主机器上的 Git**，不是模型工具沙箱中的 Git。现有 Git hooks、SSH、凭据助手和用户配置可能执行代码/访问网络。仅对可信工作区使用写操作。
- 不使用 shell，不允许客户端提供任意命令、可执行文件或 cwd；工作区路径只从宿主注册表解析。
- 选择的 linked worktree 必须与原工作区的规范化 Git common directory 一致；不允许陈旧登记把操作导向另一个仓库。
- 同一仓库的修改串行执行，并在锁内重新发现仓库，检查对话框打开时的 HEAD/分支预期值。
- 对解析出的真实短分支名再次校验；显式终止选项解析，防止异常引用名变为 `--force` 等选项。
- 远程操作依据 `remote.<name>.fetch` refspec 反向定位来源。**映射歧义会拒绝操作，不会猜测远程名并删除错误仓库的分支。**
- 不提供强制推送、`reset --hard`、`branch -D`、强制覆盖 checkout 或强制移除工作树。
- 远程删除需额外输入完整分支显示名；会真实影响远程和协作者，请谨慎操作。
- 取消/超时会终止拥有的 Git 进程树；已经完成的提交、推送等副作用**不会因此自动回滚**。
- 工作区外普通文件读取、Git 元数据路径、越界路径不接受；未跟踪文件读取校验真实路径并限量。
- 命令输出有上限；大差异会截断并明确提示。二进制差异不提供图像对比，未提供文件编辑器、stash、revert、合并提交的 cherry-pick 或复杂交互式 rebase。
- 工作树创建要求目标在当前仓库外、父目录已存在，且目标为空/不存在；不负责创建任意祖先目录。
- 视图打开且页面可见时每 10 秒刷新本地状态；**不会自动 fetch/push**。用户手动“获取”才执行网络抓取并清理过期远程跟踪引用。
- 当前仅识别 merge/rebase/cherry-pick 进行中的状态；不尝试代管其他外部工具的复杂 Git 流程。

这不是防御恶意本机进程的文件系统沙箱；外部编辑器/Git 命令仍可能并发修改仓库。插件的串行化与预期检查只覆盖其自身请求和可检测状态变化。

## 配置

[组合包 patch](<cordis.patch.yml>)使用稳定根行 ID。覆盖配置时应保留完整 `config`，宿主的 patch 不是对象深合并。

| 配置 | 默认值 | 范围 | 含义 |
| --- | ---: | ---: | --- |
| `maxCommits` | 300 | 20–1000 | 每次加载的提交数量，支持继续加载 |
| `commandTimeoutMs` | 30000 | 1000–120000 | 本地 Git 命令超时 |
| `networkTimeoutMs` | 120000 | 1000–600000 | 网络 Git 命令超时 |

## 项目导航

- [宿主入口](<src/index.mjs>)：Standard Schema 配置、原生 Connection Fetch 路由、错误封装、生命周期。
- [Git 服务](<src/host/git-service.mjs>)：工作区授权、仓库发现、数据读取与安全修改。
- [Git runner](<src/host/git-runner.mjs>)：无 shell 子进程、取消、超时与输出限额。
- [解析器](<src/host/parsers.mjs>)：NUL 格式 status、refs、log、worktree 与文件列表。
- [客户端入口](<src/client/index.jsx>) / [状态模型](<src/client/model.mjs>)：公开插槽接入、请求取消和界面状态。
- [面板](<src/client/panel.jsx>) / [分支](<src/client/branches.jsx>) / [样式](<src/client/styles.css>)：界面实现。
- [协议](<src/shared/protocol.mjs>)：允许的请求类型与边界校验。
- [构建脚本](<scripts/build.mjs>)：宿主 ESM 与 DSH lazy-CJS 浏览器产物。
- [真实 Git 回归测试](<tests/git-service.test.mjs>) / [模型与协议测试](<tests/model-and-protocol.test.mjs>) / [浏览器测试](<tests/ui/plugin.test.mjs>)。
- [验收与兼容性记录](<docs/verification.md>)。
- [开发笔记](<docs/research/dsh-plugin-development-notes.md>)与[参考笔记](<docs/research/dsh-plugin-reference-notes.md>)。

## 许可

MIT，见 [LICENSE](<LICENSE>)。第三方构建依赖的许可与版权声明见 [THIRD_PARTY_NOTICES.md](<THIRD_PARTY_NOTICES.md>)。
