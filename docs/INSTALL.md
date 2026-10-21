# 安装知行簿

## 浏览器扩展（推荐先从这里开始）

支持带原生 Side Panel 的桌面 Chrome / Edge。此版本通过开发者模式安装，没有浏览器商店发布包。

1. 在仓库页面选择 Code → Download ZIP 并解压，或使用 README 中的 git clone 命令。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 开启开发者模式，选择“加载已解压的扩展程序”。
4. 选择 `src/ability-ledger-extension` 文件夹，确保其中直接包含 `manifest.json`。不要选择仓库根目录。
5. 打开 `https://chatgpt.com`，固定知行簿扩展图标并点击打开侧栏，完成新手指南。
6. 用一段非敏感材料按“收录 → 预览 → 确认 → 复习 → 结算”走一遍，详见 [使用手册](ability-ledger-quick-start.md)。

无需 npm install 或打包。手动流程需要自己可用的 ChatGPT 账号；DeepSeek 与本地训练服务均可不配置。

## 本地训练服务（可选）

安装 Python 3.11+；终端中的 `python3 --version` 应满足版本要求。

macOS：双击仓库根目录 `启动知行簿.command`。也可在仓库根目录运行：

```sh
sh scripts/start-zhixing-service.sh
```

Linux 可使用相同终端命令。Windows 可在仓库根目录用 PowerShell 手动启动：

```powershell
py -3 -m venv .cache/zhixing-venv
.cache/zhixing-venv/Scripts/python.exe -m pip install -r services/zhixing/requirements.txt
.cache/zhixing-venv/Scripts/python.exe services/zhixing/server.py
```

Windows / Linux 安装步骤尚未经过本项目原生人工验收；上述命令不代表跨平台验收通过。

首次启动会安装依赖。服务只绑定 `127.0.0.1:17643`，不要转发到公网。保持终端运行；按 Ctrl+C 停止服务。

在扩展设置中：输入启动窗口的短期配对码 → 登录 Codex → 在 OpenAI 页面本人完成授权 → 刷新连接 → 选择模型 → 测试调用。OAuth 本地回调使用 1455 / 1457 端口；回调失败时可使用界面中的手动完成登录入口。配对失败可重启服务获取新码。

服务使用独立凭据目录；macOS 默认位于 `~/Library/Application Support/ZhixingLedger/private/openai-codex`。它采用权限受限文件，并非钥匙串加密。不要共享凭据目录、回调地址或配对令牌。

此接口为实验性兼容接入；已登录、能列出模型和完成实际推理是不同状态。不能调用时保留手动 ChatGPT 流程。

## 更新、备份与卸载

- 更新前，在知行簿设置中导出 JSON。保留相同扩展目录并更新文件，然后在扩展管理页点击重新加载。
- 换目录或浏览器可能产生新的扩展 ID 和独立存储。先备份，再在新安装中导入 JSON；检查结果后再删除旧安装。
- 使用设置中的删除功能清理学习记录；需要删除 Codex 凭据时另外执行“退出 Codex”。
- 卸载扩展会失去其本地存储访问；务必提前备份。停止本地服务后可删除源码目录及其 `.cache`，独立凭据应先通过退出功能清理。

## 常见问题

- **加载失败**：确认选中的文件夹直接含 `manifest.json`，浏览器为支持 Side Panel 的桌面版本。
- **未显示侧栏**：先打开 ChatGPT 标签页，再点击扩展图标。
- **自动捕获失败**：手动复制结构化结算并粘贴；ChatGPT 页面结构可能变化。
- **服务启动失败**：检查 Python 版本、网络、依赖安装输出及 17643 端口占用。不要上传含凭据的诊断信息。
