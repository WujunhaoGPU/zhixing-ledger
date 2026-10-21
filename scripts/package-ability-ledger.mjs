import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "src/ability-ledger-extension");
const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, "manifest.json"), "utf8"));
const releaseName = `ability-ledger-v${manifest.version}`;
const distDir = path.join(root, "dist");
const releaseDir = path.join(distDir, releaseName);
const zipPath = path.join(distDir, `${releaseName}.zip`);
const checksumPath = path.join(distDir, `${releaseName}.sha256.txt`);

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(releaseDir, { recursive: true, force: true });
fs.rmSync(zipPath, { force: true });
fs.rmSync(checksumPath, { force: true });

fs.cpSync(sourceDir, releaseDir, {
  recursive: true,
  filter: (source) => path.basename(source) !== ".DS_Store"
});

for (const name of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]) {
  const text = fs.readFileSync(path.join(root, name), "utf8");
  fs.writeFileSync(path.join(releaseDir, name), text.replaceAll("src/ability-ledger-extension/", ""));
}

fs.copyFileSync(
  path.join(root, "docs/ability-ledger-quick-start.md"),
  path.join(releaseDir, "USER-GUIDE.md")
);

fs.writeFileSync(path.join(releaseDir, "INSTALL.txt"), `知行簿 v${manifest.version}

安装方法：
1. 先解压 ${releaseName}.zip。
2. Chrome 打开 chrome://extensions；Edge 打开 edge://extensions。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择解压后包含 manifest.json 的 ${releaseName} 文件夹。
6. 打开 https://chatgpt.com，点击浏览器侧边栏中的“知行簿”。

首次打开会自动出现新手指南。
DeepSeek API Key 不是必需项。
插件内 Codex 训练：先安装 Python 3.11+，双击包内“启动知行簿.command”，
保持窗口打开，在插件设置中输入配对码、登录 Codex、选模型并测试。
首次启动会下载 Python 依赖；Codex 使用你本人的套餐，实验性接口可能变化。
更完整的流程请查看“USER-GUIDE.md”。
`, "utf8");

// Bundle the companion source and launcher, never credentials, runtime caches or test fixtures.
fs.cpSync(path.join(root, "services/zhixing"), path.join(releaseDir, "services/zhixing"), {
  recursive: true,
  filter: source => !["__pycache__", "tests", ".pytest_cache"].includes(path.basename(source))
});
fs.mkdirSync(path.join(releaseDir, "scripts"), { recursive: true });
fs.copyFileSync(path.join(root, "scripts/start-zhixing-service.sh"), path.join(releaseDir, "scripts/start-zhixing-service.sh"));
fs.copyFileSync(path.join(root, "启动知行簿.command"), path.join(releaseDir, "启动知行簿.command"));
fs.chmodSync(path.join(releaseDir, "启动知行簿.command"), 0o755);

const copiedFiles = listFiles(releaseDir);
const suspiciousFile = copiedFiles.find((file) => {
  if (!/\.(?:js|json|html|css|md|txt|py|sh|command)$/i.test(file)) return false;
  return /sk-[A-Za-z0-9_-]{20,}/.test(fs.readFileSync(file, "utf8"));
});
if (suspiciousFile) {
  throw new Error(`打包已中止：发现疑似 API Key：${path.relative(root, suspiciousFile)}`);
}

const zip = spawnSync("python3", ["-c", `
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
base = Path(sys.argv[1])
with ZipFile(sys.argv[2], "w", compression=ZIP_DEFLATED) as archive:
    for source in sorted(base.rglob("*")):
        if source.is_file():
            archive.write(source, source.relative_to(base.parent))
`, releaseDir, zipPath], { encoding: "utf8" });
if (zip.status !== 0) {
  throw new Error(zip.stderr || zip.stdout || "创建 ZIP 失败。");
}

const digest = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
fs.writeFileSync(checksumPath, `${digest}  ${path.basename(zipPath)}\n`, "utf8");

console.log(`分享包已生成：${zipPath}`);
console.log(`解压目录：${releaseDir}`);
console.log(`SHA-256：${digest}`);

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(target) : [target];
  });
}
