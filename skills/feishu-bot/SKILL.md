---
name: feishu-bot
description: 管理本机 Codex 飞书/Lark 机器人，扫码关联、配置项目范围、查看连接状态或排查机器人消息。
---

使用 `feishu_dashboard` 打开机器人管理界面。使用 `feishu_status` 读取连接状态，`feishu_manage` 执行用户要求的配置操作。

这个插件运行在 Windows 本机。它使用飞书官方 WebSocket SDK 和 Codex App Server。首次关联需要用户扫描管理界面的二维码并在飞书确认；模型不能替用户完成扫码。不要要求用户把 App Secret 粘贴到聊天里，手动凭据在管理界面输入，通过 Windows DPAPI 加密保存在本机。

项目必须在管理界面添加后才能被机器人使用。`allowedProjects: ["*"]` 表示所有已配置的项目，不代表整个磁盘。添加项目时使用用户指定或 Codex 项目列表中的真实绝对路径。

机器人默认只接受已绑定用户的消息；群聊由绑定用户 @机器人 `/enable` 启用。首次选择项目使用 `/workspace`。支持 `/new`、`/task`、`/resume`、`/model`、`/thoughtlevel`、`/stop`、`/status`、`/approve`、`/deny`、`/answer`。命令和文件审批必须由绑定用户作出，不能自动允许。

排查时先调用状态和诊断。不要输出凭据、用户令牌、runtime.json 的认证字段或明文 App Secret。删除、解绑或关闭机器人时只处理用户指定的机器人。不会自动向任意用户发送测试消息；真实飞书收发测试由用户主动给机器人发送一条消息触发。

本地后台服务在插件退出后继续运行。用户要求停止服务时运行 `node <插件根目录>/dist/main.cjs stop`。它不安装系统服务或自动启动项。

本版本的输入支持文字和富文本，不支持附件、语音或网页远程桌面镜像。不要宣称已经验证过尚未扫码的飞书端到端连接。源码和本机启动说明见 `../../README.md`。
