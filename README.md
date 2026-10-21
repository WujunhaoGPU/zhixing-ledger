# 知行簿 · Zhixing Ledger

把 AI 学习对话整理成可复习、可追溯的能力卡。

**[下载 v0.6.0 安装包](https://github.com/WujunhaoGPU/zhixing-ledger/releases/download/v0.6.0/ability-ledger-v0.6.0.zip)** · [Release 与校验文件](https://github.com/WujunhaoGPU/zhixing-ledger/releases/tag/v0.6.0) · [安装说明](https://github.com/WujunhaoGPU/zhixing-ledger/releases/download/v0.6.0/INSTALL-v0.6.0.md)

Local-first Chrome / Edge learning ledger: capture learning, practice recall, review with FSRS, and keep evidence of application.

知行簿是独立的 Manifest V3 浏览器扩展，配有可选的 Python 本地训练服务。它将学习材料、自己的回答、反馈和复习记录保存在浏览器本地，让下一次学习从已有记录继续。

## 能做什么

- **收录与确认**：把结构化学习结算转为每日台账和技能卡，预览后再写入。
- **主动回忆**：保留第一次回答、反馈和第二次回答，按 FSRS 安排复习。
- **成长证据**：用用户原话支持 L0–L4 等级；一般情境练习与真实应用复盘分开记录。模型建议需要人工审核，不是客观能力认证。
- **知识地图**：探索知识树、前置关系和待复习节点；可选 DeepSeek 辅助生成候选内容。
- **数据可携带**：JSON 备份与恢复、Markdown 阅读版导出、删除学习数据。
- **可选内部训练**：配对本地服务后，在插件内完成训练、草稿恢复和确认入账。

## 安装与第一次学习

普通使用请优先下载 **[v0.6.0 插件安装包](https://github.com/WujunhaoGPU/zhixing-ledger/releases/download/v0.6.0/ability-ledger-v0.6.0.zip)**，完整步骤见 [Release 安装说明](https://github.com/WujunhaoGPU/zhixing-ledger/releases/download/v0.6.0/INSTALL-v0.6.0.md)。

1. 下载 `ability-ledger-v0.6.0.zip` 并解压。
2. 在 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions` 开启开发者模式，点击“加载已解压的扩展程序”。
3. 选择解压后直接包含 `manifest.json` 的 `ability-ledger-v0.6.0` 文件夹。
4. 打开 https://chatgpt.com ，点击知行簿扩展图标，跟随新手指南。
5. 复制收录提示词给 ChatGPT，将返回的 `knowledge_ledger_update` 捕获或粘贴到知行簿，检查预览再确认。后续流程见包内 `USER-GUIDE.md` 或 [使用手册](docs/ability-ledger-quick-start.md)。

手动 ChatGPT 学习流程无需 Node.js、Python 或 DeepSeek API Key；无需构建。本版本使用开发者模式安装，尚未上架浏览器商店。

开发者也可克隆源码，按 [源码安装说明](docs/INSTALL.md) 加载 `src/ability-ledger-extension`。Release 安装包与 GitHub 自动生成的 Source code ZIP 目录不同，请按所下载文件对应的说明选择文件夹。

## 可选：在插件内训练

需要 Python 3.11+。macOS 可双击 `启动知行簿.command`，也可运行：

```sh
sh scripts/start-zhixing-service.sh
```

保持窗口打开，在设置中输入配对码，使用知行簿自己的 OAuth 登录、选择模型并测试调用。首次启动需要网络安装 Python 依赖。

**这是基于 DeepTutor 的实验性 Codex OAuth 兼容接入，不是 OpenAI 官方集成，不保证账号可用性或接口稳定性。** 手动复制/粘贴流程始终可用。限流和失败不会自动转向其他收费提供方。知行簿不读取或修改 Codex CLI / DeepTutor 的登录文件。

## 数据与隐私

学习记录默认在当前浏览器的本地存储中；本项目不提供账号系统、云同步或遥测服务。手动发给 ChatGPT 的内容由 ChatGPT 处理。启用 DeepSeek 或 Codex 训练时，相关材料与回答会发送给所选服务，受其政策约束。本地存储不是加密保险箱。

Codex 凭据由独立本地服务保存，不进入学习导出。退出 Codex 与清空学习数据是不同操作。卸载或更换扩展目录前，请先导出 JSON；不要提交个人备份、API Key、OAuth 凭据或浏览器配置目录。

## 开发与验证

Node.js 22+、npm；服务测试另需 Python 3.11+。

```sh
npm ci
npm test
npm run smoke:ledger
npm run smoke:codex
npm run package:ledger
```

浏览器回归需要支持扩展调试的 Chromium / Chrome for Testing，通过 `GROWTH_COACH_CHROME=/absolute/path/to/browser` 指定可执行文件。`smoke:codex` 请在 `npm test` 后运行，并先停止占用 17643 端口的正式本地服务；它使用临时配置和模拟上游。

[验证记录与限制](docs/VALIDATION.md) 区分自动测试、模拟上游和真实账号验收。当前为早期版本，不宣称真实学习效果、所有平台或实际套餐链路已经通过验收。

## 仓库结构

- `src/ability-ledger-extension/`：独立浏览器扩展，含本地第三方资源。
- `services/zhixing/`：本地配对、OAuth、模型目录和训练服务。
- `scripts/`：验证、浏览器回归、打包与启动脚本。
- `docs/`：安装、使用、规格和验证说明。

## 贡献与许可证

欢迎提交可复现的 Issue 和小范围 PR，见 [贡献说明](CONTRIBUTING.md)。安全问题见 [SECURITY.md](SECURITY.md)。

原创部分使用 [Apache-2.0](LICENSE)。第三方代码保留各自许可证，见 [来源清单](THIRD_PARTY_NOTICES.md)。本项目不隶属于 OpenAI、DeepTutor、DeepSeek 或上述依赖项目。
