# 知行簿 Codex 训练闭环

## 已确认范围

知行簿采用“浏览器插件 + 本地服务”，支持插件内训练，并提供基于 DeepTutor 的实验性 Codex OAuth 兼容接入。手动 ChatGPT 复制/粘贴流程保留。

## 实现边界

- 插件：参考材料收录、单卡训练、两次用户回答、关键反馈、结构化结算预览、难度确认、证据和 FSRS 入账。保留 ChatGPT 网页复制/粘贴工作流。
- 本地 Python 3.11+ 服务：只绑定 127.0.0.1:17643；OAuth 回调采用 DeepTutor 的 localhost:1455/1457；独立凭据目录，不读写 ~/.codex 或 DeepTutor 数据。
- 认证核心来自 HKUDS/DeepTutor a053fec。来源与许可证见 services/zhixing/NOTICE.md 和 LICENSE.DeepTutor。
- 本地配对码在启动窗口显示、10 分钟有效、最多 10 次尝试。配对绑定 Chrome/Edge 扩展 Origin，后续请求使用独立的本地访问令牌。它与 OAuth 凭据不同，不随学习数据导出。
- 训练调用当前用户明确选定的模型，无隐式跨提供方回退或失败重放。首次登录/实际套餐授权由用户在 OpenAI 页面操作。

## 数据与交互

训练过程保存在原有 schema V3 的可选 trainingSessions 中，包括题目、两次回答、反馈、结算、草稿、所用模型和入账状态；旧数据默认空集合。JSON 导入/导出和清空涵盖训练记录，Markdown 提供阅读版过程。连接凭据单独存储。

训练阶段：question -> feedback -> settlement -> preview -> complete。每次远端调用只发送当前卡参考及本轮对话。请求中断、输出不完整或解析失败不改变卡片等级和调度。关闭侧栏可从本地保存的阶段和草稿恢复，失败调用需主动重试。

结算先经过现有 Canonical V3 解析，再校验只能有当前主题的一张卡和一条记录。第一次/第二次复述及反馈以本地实际记录为准。成长证据的 userEvidence 必须是实际用户回答的逐字子串；应用设想/模拟案例不产生 application 证据；用户主动切换“真实应用复盘”并填写实际行动与观察结果后，才允许从其原话生成 application 证据；独立复述证据需来自第一次回答。模型判断仍需用户审核，不将其当作客观能力认证。

用户单独选择 FSRS 提取难度后确认入账；确认并发保护避免双击重复写入。当前卡片与训练记录一并保存，并保留现有一次撤销。完整训练不需要自动控制 ChatGPT 网页。

## 运行与验收

双击根目录“启动知行簿.command”，或 npm run start:codex。首次运行建立 .cache/zhixing-venv 并安装 requirements.txt。首次需要 Python 3.11+ 和网络，后续保留窗口运行。

设置 -> Codex 学习教练 -> 输入配对码 -> 登录 -> 选择模型 -> 测试模型调用。卡组点击“在知行簿内训练”，或使用“从新材料开始训练”；探索推荐节点提供“知行簿学习”。已有模型配置时普通训练入口直接进入内部训练。

学习数据仍在浏览器本地；Codex 凭据默认位于 ~/Library/Application Support/ZhixingLedger/private/openai-codex，采用 DeepTutor 的权限受限文件存储，不是操作系统钥匙串加密。设置中的退出 Codex 会清除本地 Codex 凭据和模型目录；清空学习数据不会代替服务退出操作。

自动验证：npm run test:ledger、npm run test:codex、npm run smoke:ledger、npm run smoke:codex。smoke:codex 用独立临时目录、真实扩展/本地 HTTP 与模拟上游响应，不能替代真实账号验收。

真实验收：用户实际登录、获取账号模型、完成一次实际套餐训练、确认入账并重启恢复。未完成这些步骤不得声称套餐链路已通过。
