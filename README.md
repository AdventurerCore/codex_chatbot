# Codex 飞书机器人

参考本机 ZCode 3.17.2 的飞书机器人协议与界面，独立实现的 Windows / macOS 本地 Codex 插件。源码、已构建运行文件和测试均包含在目录内。

## 安装与使用

需要 Windows 或 macOS、Node.js 22+ 和已登录的 Codex CLI，且 `node`、`codex` 已加入 `PATH`。macOS 凭据存储使用系统自带的钥匙串，无需额外安装依赖。

Windows：

```powershell
git clone git@github.com:AdventurerCore/codex_chatbot.git
cd codex_chatbot
.\安装到Codex.cmd
```

macOS：

```sh
git clone https://github.com/AdventurerCore/codex_chatbot.git
cd codex_chatbot
./安装到Codex.command
```

macOS 也可在 Finder 中双击 `安装到Codex.command`。启动器会补查 Apple Silicon 和 Intel Homebrew 的常见工具路径。若已经从本仓库的 Git 地址安装了 `local-feishu` 市场，macOS 安装器会刷新原市场并升级插件，保留原更新来源。

安装脚本会注册仓库中的本地插件市场，安装 `codex-feishu-bot@local-feishu`，并打开机器人管理页。仓库包含已构建的运行文件，使用时无需先执行 `npm install`。

也可手动安装：

```sh
codex plugin marketplace add .
codex plugin add codex-feishu-bot@local-feishu
node dist/main.cjs dashboard
```

1. 双击 `启动机器人管理.cmd`（Windows）或 `启动机器人管理.command`（macOS），打开本机管理页。
2. 选择机器人，点击 **扫码关联**，用手机飞书扫码并确认创建应用。也可在 **手动配置** 中填写自己的 App ID / App Secret。
3. 点击右上角齿轮添加允许机器人访问的项目文件夹，重复路径自动合并。首次使用需要自行配置项目。
4. 私聊新机器人，发送 `/workspace`，再发送 `/workspace 1` 选择项目。
5. 直接发送需求。Codex 使用当前本机登录账号执行，回复通过流式卡片更新。

安装后，在新 Codex 聊天中选择 **飞书机器人**，可调用管理面板和状态工具。已打开的旧聊天可能需要重新选择插件或新开聊天才能看到工具。本地浏览器管理页可立即使用。

## 功能

| 项目 | 实现 |
|---|---|
| 飞书 / Lark | 官方 SDK WebSocket 长连接，自动重连 |
| 扫码关联 | 飞书 PersonalAgent 应用注册设备流程，处理轮询、过期、拒绝、限频、Lark 域切换 |
| 回复 | Card JSON 2.0 + CardKit 文本流式更新，完成时工具摘要折叠 |
| 缺少 CardKit 权限 | 回退到可编辑 JSON 2.0 消息卡片 |
| 机器人管理 | 新建、多机器人、重命名、开关、解绑、删除、连接诊断 |
| 项目权限 | 所有已配置项目 / 指定项目，真实路径校验 |
| 群聊 | 绑定用户 @当前机器人 `/enable`，`/disable` 停用，话题分别保存会话 |
| Codex | 新会话、已有项目会话接续、模型与推理强度切换、停止任务 |
| 审批 | 命令、文件审批通过飞书按钮或指令答复；用户问题通过 `/answer` 回复 |
| 凭据 | Windows 使用 DPAPI CurrentUser；macOS 使用 AES-256-GCM，密钥保存在当前用户的系统钥匙串 |

输入支持文字与富文本。当前未实现图片、附件和语音传输；群聊只接受绑定用户，不开放给其他群成员。手机网页远程桌面镜像、微信、Telegram 不包含在此飞书插件中。

## 飞书命令

```text
/help                   使用说明
/workspace              列出允许访问的项目
/workspace 1            选择项目
/new                    开始新的对话上下文
/task                   当前项目的最近会话
/resume 完整会话ID        接续项目内会话
/model                  列出模型
/model 模型ID            切换模型
/thoughtlevel high      设置推理强度
/stop                   停止当前任务
/status                 当前会话状态
/enable                 绑定当前群聊（需 @机器人）
/disable                停用当前群聊
/approve 编号           允许一次操作
/deny 编号              拒绝操作
/answer 编号 回答        回答 Codex 问题
```

多问题回答格式：`/answer 编号 {"问题ID":"回答","第二个ID":"回答"}`。手动配置且没有 Open ID 时，在管理页生成一次性绑定码，再私聊机器人发送 `/bind 绑定码`。

## 手动创建飞书应用

在飞书开放平台创建自建应用，启用机器人，使用长连接接收事件与回调。订阅 `im.message.receive_v1`、`card.action.trigger`。根据平台要求发布应用版本。

需要消息接收、机器人发送、卡片更新权限，例如 `im:message.p2p_msg:readonly`、`im:message.group_at_msg:readonly`、`im:message:send_as_bot`、`cardkit:card:write`。具体可选权限以开放平台该应用显示为准；扫码注册的 PersonalAgent 通常预置基础权限。

使用独立飞书应用。飞书的多连接采用分发模式，同一应用同时连接 ZCode 和本插件会分流消息，不能保证两边都收到。

## 运行与数据

后台服务仅监听 `127.0.0.1:23947`，不会开启公网端口或配置开机启动。关闭网页不会关闭机器人服务。双击 `停止机器人服务.cmd`（Windows）或 `停止机器人服务.command`（macOS）停止。

Windows 状态位于 `%LOCALAPPDATA%\CodexFeishuBridge`，macOS 默认位于 `~/Library/Application Support/CodexFeishuBridge`。若 Mac 已有旧版 `~/.local/share/CodexFeishuBridge/state.json`，且新目录没有状态文件，则继续使用旧目录；`CODEX_FEISHU_DATA_DIR` 可指定数据目录。`state.json` 保存机器人、项目、会话和加密后的凭据；`runtime.json` 保存本机管理服务的访问令牌；`service.log` 保存简要日志。不要分享这些运行文件。

macOS 的加密密钥保存在钥匙串的 `com.adventurercore.codex-feishu-bot` 服务中，凭据文件使用随机 nonce 和认证标签保护。密钥通过进程标准输入交给系统工具，不出现在命令行参数中。钥匙串锁定或拒绝访问时会报错，不会改成明文保存或覆盖已有密钥。若 macOS 提示访问钥匙串，请允许访问；若登录钥匙串被锁定，请先在系统中解锁。Windows 与 macOS 的密文不能互换，换机器或系统后应重新扫码关联。

消息去重持久化，SDK 收到事件后立即确认，再异步处理，避免长任务导致飞书重复投递。审批与机器人、聊天和绑定用户一致才可通过；审批 10 分钟后过期。停止、解绑和项目范围修改会中断当前任务。

Codex 默认使用 `workspace-write` 与 `on-request` 审批。使用本机官方 App Server 的标准输入输出协议，没有改写 ZCode 或 Codex 程序文件。已有会话通过存储的会话 ID 接续；请避免同时在桌面端和飞书对同一会话发起任务。

模型与推理强度按当前 CLI 账号的 `model/list` 目录解析。全局配置中的模型可用时会保留；若全局模型不受该账号支持，则使用目录推荐的默认模型，并为新建和接续会话显式设置。有效的全局推理强度会保留，不支持时使用该模型的默认值。`/model`、`/thoughtlevel` 的手动选择优先；不可用的手动模型会明确报错，不会悄悄替换。`/status` 显示实际使用的模型与推理强度。此过程不修改全局 Codex 配置。

## 开发与验证

```powershell
npm ci
npm test
npm run build
node dist/main.cjs diagnose
```

`scripts/build.cjs` 生成单文件 MCP / 后台服务与自包含 HTML 面板。更改源码后重新构建，同步更新 `package.json`、`package-lock.json`、`plugin.json` 和 `.codex-plugin/plugin.json` 的版本，再运行当前系统对应的安装脚本重新安装。更新前先停止旧版机器人服务；重新安装后打开管理页。不要直接修改 Codex 插件缓存。

本地开发时，若 `local-feishu` 已注册为 Git 市场，而要安装尚未推送的本地修改，请先 `codex plugin marketplace remove local-feishu`，再 `codex plugin marketplace add .`，之后重新安装插件。普通 Git 安装更新可直接 `codex plugin marketplace upgrade local-feishu`、`codex plugin add codex-feishu-bot@local-feishu`。

在 macOS 上测试真实钥匙串读写：

```sh
CODEX_FEISHU_TEST_KEYCHAIN=1 npm test
```

该测试使用独立的临时钥匙串条目，并在结束后删除；普通 `npm test` 不访问真实钥匙串。macOS 适配测试覆盖加密与重启后解密、密文篡改、钥匙串拒绝访问、密钥缺失、并发首次保存、旧数据路径、Homebrew 路径及浏览器启动参数。Windows 原生 DPAPI 测试只在 Windows 上执行。

Windows 原版已验证：17 项自动化测试、Windows DPAPI、真实 Codex 登录检查、MCP 工具发现及状态调用、管理页面、真实飞书扫码关联与 WebSocket 长连接。2026-11-03 的真实收发测试中，用户发送“只回复：飞书连接成功，不修改任何文件”，Codex 约 7 秒完成，飞书 JSON 2.0 卡片显示“飞书连接成功”；该轮没有工具调用或文件修改。

macOS 0.1.3 本机验证（2026-11-03）：39 项测试中 38 项通过，Windows 原生 DPAPI 测试跳过。真实系统钥匙串读写、密文保存与跨进程解密、后台重启、中文与空格项目路径、精简 PATH 下的 Codex 登录、MCP 四个工具及管理页资源均通过检查。真实手机飞书扫码关联与 WebSocket 长连接已建立，升级后保留凭据和项目配置。使用当前 CLI 账号可用模型的真实 Codex 生成测试返回了“macOS 飞书连接成功”，没有执行文件或命令操作。

macOS 的真实飞书往返测试也已通过：用户重发“只回复：macOS 飞书连接成功，不修改任何文件”后，飞书触发的 Codex 会话状态为 `completed`，回复包含“macOS 飞书连接成功”，用户确认在飞书收到该回复。该轮没有文件或命令操作，后台没有卡片发送或流式更新错误；已安装的 0.1.3 后台保持连接，当前项目配置保留。

群聊、真实文件修改审批和长时间断网重连尚未做端到端现场验证，相关权限与协议行为已有自动化测试覆盖。

## 仓库结构

```text
.agents/plugins/marketplace.json  本地插件市场
.codex-plugin/plugin.json        Codex 插件清单
.mcp.json                        Codex MCP 配置
plugin.json / mcp.json           通用插件格式清单
src/                            后台服务、飞书适配、Codex 桥接和管理界面
dist/                           已构建运行文件
skills/                         插件技能
scripts/                        构建脚本
test/                           自动化测试
```

仓库只包含程序与文档。飞书应用凭据、绑定用户、项目路径、会话、日志和管理访问令牌均保存在本机运行目录，不随仓库分发。

## 许可证

本项目沿用仓库的 [Apache License 2.0](LICENSE)。构建文件包含的第三方依赖遵循各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 参考

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [OpenAI 插件包与本地市场](https://developers.openai.com/plugins/build/plugins)
- [飞书长连接接收事件](https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-)
- [飞书卡片流式更新](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/cardkit-v1/card-element/content)

这是本地独立实现，不是 ZCode 或飞书的官方发行版。交付包不包含提取的 ZCode 代码或运行凭据。
