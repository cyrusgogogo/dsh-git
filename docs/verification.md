# 验收与兼容性记录

## 本次环境

- 日期：2026-10-18；本次插件版本：`0.1.2`。界面优化于 2026-10-17 完成，发布前重跑全部回归。
- 操作系统：Windows。
- Node.js：`v24.21.0`；pnpm：`11.21.0`。
- Git：`2.54.0.windows.1`。
- 浏览器：隔离的 headless Microsoft Edge，本机可执行文件版本 `155.0.4283.60`。
- 对接参考：已安装 DSH `0.2.0-rc.2` 的实际注册实现、Cordis `4.0.4`、用户提供的两份开发笔记。

## 自动验证结果

| 类别 | 结果 | 范围 |
| --- | --- | --- |
| 宿主与客户端构建 | 通过 | Node ESM；浏览器 lazy-CJS 注册脚本；React/ReactDOM 外部共享 |
| Git、解析器、模型、协议与进程生命周期 | **44/44 通过** | 包含真实隔离仓库、日期筛选、cherry-pick 冲突恢复、本地 bare remote 和真实超时 hook 清理 |
| 浏览器交互 | **18/18 通过** | 针对实际构建产物，不是另写的静态 UI；含菜单 alpha、平铺筛选、优选确认及继续/中止 |
| 总计 | **62/62 通过** | 未连接外部 Git 远程，未使用用户仓库进行破坏性测试 |

Git 集成测试只在项目内临时目录创建和清理自己拥有的仓库。由于项目本身也是 Git 仓库，“非仓库”测试用临时 bare 父仓库形成发现边界，避免错误地发现项目父级仓库。测试身份仅设在测试仓库的本地配置中，不改全局 Git 身份。

界面优化后另用无头浏览器在深/浅两套宿主令牌下抽查关键文本对比度：普通正文、次要文字、选中提交行、语义徽标、警告/进行中提示、差异配色以及主/危险操作按钮均 ≥ 4.5:1。该抽查只针对隔离测试宿主的令牌组合，不等同完整 WCAG 审计。

交互动效另在无头 Edge 中做了 10 项运行时检查：Tab 焦点可见、面板/弹层/对话框入场曲线、菜单与弹层从触发点缩放、按钮悬停渐变保留与按压缩放、`prefers-reduced-motion` 下停止位移但保留加载脉冲；全部通过。

Windows 沙箱不允许普通子进程捕获管道及浏览器调试管道；真实 Git 与浏览器测试是在针对相应命令批准的更宽权限中运行。构建使用 esbuild 公开 CLI 和继承 stdio，无需绕过沙箱的命名管道边界。

### Git / 数据回归重点

- 空工作区提示、未知工作区拒绝、初始化确认、main 空分支、保留现有文件/身份、损坏 `.git` 不覆盖。
- 首次提交、Unicode/空格文件名、真实提交/父子关系、根提交文件列表、工作区及未跟踪差异。
- 暂存重命名取消暂存时同时恢复源和目标路径，避免遗留原文件删除。
- 分支创建、切换、重命名、安全删除，未合并提交保护，过期 HEAD / 分支确认拒绝。
- plumbing 创建的选项型短分支名不能触发 `--force`、覆盖其他分支或创建意外 orphan 分支。
- 自定义 fetch 目标正确反向映射到真实远程；重叠远程命名/映射不猜测删除目标。
- 工作区路径和 worktree 成员校验；陈旧 worktree 目录被另一仓库替换后拒绝访问。
- worktree 创建、查看、锁定、脏目录移除保护；保留分支历史。
- 真实合并冲突、暂存后继续、中止；干净工作区要求下的真实变基。
- 本地 bare remote 的 fetch、上游、非强制推送、远程签出及删除。
- 合法 U+001E 元数据不会产生虚假提交；NUL 固定字段解析保留正文和换行路径。
- 卸载中的写操作不启动新请求，旧工作区响应不覆盖新工作区，确认时预期值固定。
- 精确 Connection RPC envelope、取消信号、no-store 响应及错误输入校验。
- 日期预设联动真实 Git 提交时间过滤，并可叠加分支、作者、路径条件；拒绝未定义日期预设。
- 优选要求确认、有效本地分支与干净工作区；保留来源分支及原始作者，不自动猜测合并提交主父提交。
- 真实 cherry-pick 冲突、中止恢复、解决后暂存并无编辑器继续；阻止并发的其他写操作及过期确认。
- 优选冲突后的自动快照刷新不会清除对话框内错误反馈。
- Git hook 忽略 SIGTERM 并持有输出管道时，超时仍结束进程树且释放服务。

### 浏览器回归重点

- 底部三栏面板、13 条夹具提交的真实父关系图、文件树和提交元数据。
- 分支旁加号的两个准确选项及真实 worktree 结构视图；通过相邻元素和坐标验证位置。
- 工作区选择框圆角；在深/浅主题注入带透明度的宿主菜单 token，检查分支面板、右键菜单及子菜单背景 alpha 均为 255、无模糊。
- 分支、用户、日期筛选始终平铺，支持组合和清除；1850/1100/840px 下输入与最右侧优选按钮不溢出提交图区域。
- 优选按钮按选中提交确认，取消不发送写请求；工作区脏、当前 HEAD 或合并提交时禁用。
- 优选冲突后对话框错误保持可见；提示条中止与暂存后继续均发送正确的 cherry-pick 操作类型。
- 分支搜索、确认式签出、当前/其他分支的不同上下文命令。
- 新分支表单初始焦点、Tab 焦点约束及提交参数。
- 非仓库提示、重新检测、确认式初始化及初始化后的无提交提示。
- 提交搜索、列表键盘选择和只读增删差异。
- 键盘调整面板高度；375px 视口无页面横向溢出，弹层/对话框保持在视口内。
- 主标签和侧边栏标签的方向键导航及有效 ARIA 面板关联。
- 插槽卸载后组件和注入样式被移除；浏览器无未捕获运行时错误。

## 原生接口核对

| 接口 | 当前实现 |
| --- | --- |
| Host 服务 | `connection`、`workspaceRegistry` 注入 |
| 请求入口 | 原生 `connection.fetch.register` 精确 `/api/dsh-git`、POST buffered body |
| Client RPC | `connection.rpc.call('/api', 'dsh-git', payload, signal)` |
| 工具栏 | 追加 `conversation.session.header.utilities` list，不覆盖 single corner |
| 底部区域 | `shell.overlay` 中的固定底部覆盖层；不是伪造的 bottom-panel 插槽 |
| 客户端构建 | `window.__ModuleLoader__.load({ id, factory })`；测试检查最终产物延迟物化 |
| 安装激活 | `dsh.bundle.patch` 指向 `insert` 配置 patch，插件行用裸包名 |

路径沿用宿主 Connection 的 HTTP 认证、Host/Origin 及 Desktop bridge 准入。没有新增独立网络服务或另开一个无鉴权服务。宿主准入实现经过源码契约核对；**未把使用 stub Connection 的单元测试冒充真实登录态/CSRF 渗透测试**。

安装/分层语法另参见[官方发布文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish.md)。

## 界面截图

截图来自隔离测试宿主，仓库数据为确定性的合成夹具。真实 Git 行为由另一组集成测试覆盖。

- [Git 工作区](<../.artifacts/screenshots/git-workspace.png>)
- [分支下拉](<../.artifacts/screenshots/branch-picker.png>)
- [当前分支右键菜单](<../.artifacts/screenshots/current-branch-menu.png>)
- [其他/远程分支右键菜单](<../.artifacts/screenshots/other-branch-menu.png>)
- [工作树](<../.artifacts/screenshots/worktrees.png>)
- [非仓库状态](<../.artifacts/screenshots/not-a-repository.png>)
- [窄视口](<../.artifacts/screenshots/narrow-layout.png>)
- [平铺筛选及组合条件](<../.artifacts/screenshots/inline-filters.png>)
- [紧凑提交图布局](<../.artifacts/screenshots/compact-inline-filters.png>)
- [优选提交结果（测试夹具）](<../.artifacts/screenshots/cherry-pick-result.png>)
- [浅色实色菜单及子菜单](<../.artifacts/screenshots/light-solid-menus.png>)

## 归档检查

[归档校验脚本](<../scripts/verify-package.py>)检查 tarball 内所有导出入口、客户端清单、bundle patch、文档和许可；拒绝目录穿越、symlink 和开发缓存；比对归档中的入口字节与本地已测试产物，并计算 SHA-256。

安装包不包含依赖缓存、提取的宿主实现、测试仓库、环境变量文件或权限恢复备份。第三方声明按实际 esbuild 输入生成；一个上游 npm 包漏带独立 LICENSE 的情况已在声明中注明来源。

## 尚未进行 / 不应外推

- **本次未覆盖当前 DSH profile 中已安装的实例**，没有修改当前 GUI 配置，也没有重启应用。
- 独立 HTTP 访问现有 `http://127.0.0.1:19387` 返回 401（需要 DSH Web 认证）；没有当前页面的已认证浏览器上下文，因此未宣称新版已在该页面生效，也没有启动替代服务。
- 原生宿主安装、实际登录态/真实会话切换、Desktop IPC 和卸载事务还需安装后验收。
- 没有验证当前 DSH GUI 的 HMR watcher，因此不承诺免刷新更新。
- 未连接真实 GitHub/GitLab/SSH，未验证用户实际凭据或远程网络错误的所有形态。
- 未在 macOS/Linux 实机运行；POSIX 进程组终止与换行 worktree 路径只有实现/解析器覆盖，不能等同实机通过。
- 深色桌面布局已目视检查；界面优化后在隔离测试宿主中对深/浅两套宿主令牌分别截图检查，关键正文与次要文字实测对比度均高于 4.5:1。浅色宿主的全量色彩对比、屏幕阅读器实机和完整 WCAG 审计仍未完成。
- 底部覆盖层会遮挡聊天区域，不声称与原生布局重排完全等价。

## 安装后的建议验收

1. 确认安装进入正确 profile，组合后出现唯一 `dsh-git` 根行。
2. 按宿主报告处理 `applied` / `restart-required`，重启/刷新后验证右上角入口。
3. 在一个 Git 工作区和一个空目录之间切换；检查主会话跟随与显式目录选择。
4. 用临时工作区执行初始化、暂存、提交、创建/切换分支、创建 worktree；确认真实文件和 Git 状态。
5. 打开设置等原生覆盖层，确认备用入口、菜单层级和宿主其他控件不被替换。
6. 关闭/卸载插件，确认不再刷新、样式消失、进行中的操作按取消路径停稳。
