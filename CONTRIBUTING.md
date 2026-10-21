# Contributing

欢迎用中文或英文报告问题。请提供浏览器/系统版本、复现步骤、期望与实际结果，并删除个人学习记录、密钥、令牌和回调地址。

开发前阅读 README、docs/product-specs/ability-ledger-extension.md 与 docs/product-specs/zhixing-codex-training.md。较大的交互或架构改变请先开 Issue 讨论。

运行 `npm ci`、`npm test`，有界面变动时另跑 `npm run smoke:ledger`；有训练变动时另跑 `npm run smoke:codex`。浏览器测试配置见 README。请说明未运行的检查；模拟上游不能证明真实账号验收。

PR 应聚焦一个问题，说明行为变化和验证结果。保留第三方许可证、来源与修改说明，不提交个人数据或运行缓存。提交贡献即表示你有权以本项目 Apache-2.0 许可证提供该贡献，第三方文件继续遵守原许可证。
