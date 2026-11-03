---
name: feishu-bot
description: 管理本机 Codex 飞书/Lark 机器人，扫码关联、配置项目范围、查看连接状态或排查机器人消息。
---

使用 `feishu_dashboard` 打开机器人管理界面。使用 `feishu_status` 读取连接状态，`feishu_manage` 执行用户要求的配置操作。

这个插件运行在 Windows 或 macOS 本机，使用飞书官方 WebSocket SDK 和 Codex App Server。首次关联需要用户扫描管理界面的二维码并在飞书确认；模型不能替用户完成扫码。不要要求用户把 App Secret 粘贴到聊天里，手动凭据在管理界面输入。Windows 使用 DPAPI；macOS 使用 AES-256-GCM 加密，密钥保存在当前用户的系统钥匙串中。不能把 Windows 的密文复制到 Mac 后直接使用，需要重新关联。

macOS 可以双击仓库中的 `安装到Codex.command` 安装，`启动机器人管理.command` 打开管理页，`停止机器人服务.command` 停止服务。macOS 默认数据目录为 `~/Library/Application Support/CodexFeishuBridge`；已有旧版数据时继续使用原目录。钥匙串被锁定或拒绝访问时，让用户解锁并重试，不要改成明文保存，不要重置或覆盖已有加密密钥。

在「项目访问范围」点击「选择项目…」，可读取 Codex 已有的本地项目并选择一个或多个。使用 `feishu_manage` 的 `list_projects` 读取候选列表，`save_project_scope` 用机器人 `id` 和候选条目的 `projectIds` 保存选择；候选 id 与已添加项目的内部 id 不同。读取候选列表不会自动增加访问范围，仅保存用户选择的项目。其他文件夹可在管理界面手动添加。`allowedProjects: ["*"]` 表示所有已添加的项目，不代表整个磁盘或所有候选项目。添加项目时使用用户指定或 Codex 项目列表中的真实绝对路径。

机器人默认只接受已绑定用户的消息；群聊由绑定用户 @机器人 `/enable` 启用。首次选择项目使用 `/workspace`。支持 `/new`、`/task`、`/resume`、`/model`、`/thoughtlevel`、`/stop`、`/status`、`/approve`、`/deny`、`/answer`。命令和文件审批必须由绑定用户作出，不能自动允许。

排查时先调用状态和诊断。不要输出凭据、用户令牌、runtime.json 的认证字段或明文 App Secret。删除、解绑或关闭机器人时只处理用户指定的机器人。不会自动向任意用户发送测试消息；真实飞书收发测试由用户主动给机器人发送一条消息触发。

本地后台服务在插件退出后继续运行。用户要求停止服务时运行 `node <插件根目录>/dist/main.cjs stop`。它不安装系统服务或自动启动项。

本版本的输入支持文字和富文本，不支持附件、语音或网页远程桌面镜像。不要宣称已经验证过尚未扫码的飞书端到端连接。源码和本机启动说明见 `../../README.md`。
