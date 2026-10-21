import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = process.env.ABILITY_LEDGER_EXTENSION_PATH
  ? path.resolve(process.env.ABILITY_LEDGER_EXTENSION_PATH)
  : path.join(root, "src/ability-ledger-extension");
const browserCandidates = [
  process.env.GROWTH_COACH_CHROME,
  path.join(root, ".cache/browsers/chromium/mac_arm-1664362/chrome-mac/Chromium.app/Contents/MacOS/Chromium"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);
const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate));
const screenshotPath = process.env.ABILITY_LEDGER_SMOKE_SCREENSHOT || "";
const treeScreenshotPath = process.env.ABILITY_LEDGER_TREE_SMOKE_SCREENSHOT || "";
const finalTab = process.env.ABILITY_LEDGER_SMOKE_FINAL_TAB || "image";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (!payload.id) {
      (listeners.get(payload.method) || []).forEach((listener) => listener(payload.params || {}));
      return;
    }
    if (!pending.has(payload.id)) return;
    const operation = pending.get(payload.id);
    pending.delete(payload.id);
    payload.error ? operation.reject(new Error(payload.error.message)) : operation.resolve(payload.result);
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve({
      send(method, params = {}) {
        const id = nextId;
        nextId += 1;
        socket.send(JSON.stringify({ id, method, params }));
        return new Promise((operationResolve, operationReject) => pending.set(id, { resolve: operationResolve, reject: operationReject }));
      },
      on(method, listener) {
        const current = listeners.get(method) || [];
        listeners.set(method, [...current, listener]);
      },
      close() {
        socket.close();
      }
    }));
    socket.addEventListener("error", reject);
  });
}

function waitForBrowserWs(stderr) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Chrome did not expose its DevTools WebSocket.")), 30000);
    stderr.on("data", (chunk) => {
      const match = chunk.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
}

function listUrl(browserWsUrl) {
  return browserWsUrl.replace(/^ws:/, "http:").replace(/\/devtools\/browser\/.+$/, "/json/list");
}

async function waitForTarget(url, targetUrl) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const targets = await fetch(url).then((response) => response.json());
    const target = targets.find((item) => item.url === targetUrl);
    if (target?.webSocketDebuggerUrl) return target;
    await delay(150);
  }
  throw new Error("Expected ability ledger Side Panel target did not appear.");
}

async function removeTempProfile(dir) {
  let lastError;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 1, retryDelay: 100 });
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw lastError;
}

async function main() {
  assert(browserPath, "Browser not found");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "zhixing-smoke-"));
  const codeFile = path.join(temp, "pair-code");
  const fixture = spawn(path.join(root, ".cache/zhixing-venv/bin/python"), [path.join(root, "services/zhixing/tests/browser_fixture.py"), codeFile], { stdio: ["ignore", "pipe", "pipe"] });
  let fixtureError = "";
  fixture.stderr.on("data", x => fixtureError += x);
  let chrome, client, browserClient;
  try {
    for (let i=0;i<50;i++) {
      if (fs.existsSync(codeFile) && await fetch("http://127.0.0.1:17643/health").then(r=>r.ok).catch(()=>false)) break;
      await delay(100);
    }
    assert(fs.existsSync(codeFile), "Fixture failed: "+fixtureError);
    const pairCode = fs.readFileSync(codeFile,"utf8");
    chrome = spawn(browserPath, ["--headless=new","--disable-gpu","--enable-extensions","--enable-unsafe-extension-debugging","--no-first-run","--remote-debugging-port=0","--user-data-dir="+path.join(temp,"profile"),"about:blank"], {stdio:["ignore","ignore","pipe"]});
    const ws = await waitForBrowserWs(chrome.stderr);
    browserClient = await connect(ws);
    const loaded = await browserClient.send("Extensions.loadUnpacked", {path:extensionPath});
    const panelUrl = `chrome-extension://${loaded.id}/sidepanel/sidepanel.html`;
    await browserClient.send("Target.createTarget", {url:panelUrl});
    const target = await waitForTarget(listUrl(ws),panelUrl);
    client = await connect(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable"); await client.send("Page.enable");
    const errors=[]; client.on("Runtime.exceptionThrown",e=>errors.push(e.exceptionDetails?.text));
    const run = async expression => {
      const result=await client.send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const helpers = `const waitFor=async(p)=>{for(let i=0;i<100;i++){if(await p())return;await new Promise(r=>setTimeout(r,80));}throw new Error("UI timeout: "+document.body.innerText)};const button=t=>[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===t);const input=(q,value)=>{const n=document.querySelector(q);if(!n)throw new Error("Missing "+q);n.value=value;n.dispatchEvent(new Event("input",{bubbles:true}));};`;
    await delay(500);
    await run(`(async()=>{ const {createEmptyState,normalizeSkillCard}=await import("../shared/ledgerModel.js"); const state=createEmptyState();state.skillCards=[normalizeSkillCard({id:"test-card",name:"反向思维",oneLine:"从失败反推行动",levelEvents:[{type:"capture",targetLevel:"L0"}]})];await chrome.storage.local.set({abilityLedgerStateV1:state,abilityLedgerOnboardingVersionV1:2});location.reload();})()`);
    await delay(500);
    await client.send("Emulation.setDeviceMetricsOverride",{width:410,height:900,deviceScaleFactor:1,mobile:false});
    await run(`(async()=>{${helpers} await waitFor(()=>document.querySelector(".screen-settings-button")); document.querySelector(".screen-settings-button").click();input("#codex-pair-code",${JSON.stringify(pairCode)});button("配对本地服务").click();await waitFor(()=>document.querySelector("#codex-model option[value='fixture-coach']"));const model=document.querySelector("#codex-model");model.value="fixture-coach";model.dispatchEvent(new Event("change",{bubbles:true}));await waitFor(()=>document.querySelector("#codex-model")?.value==="fixture-coach");button("测试模型调用").click();await waitFor(()=>document.body.innerText.includes("最近完成调用"));})()`);
    fs.mkdirSync(path.join(root,"docs/reviews/screenshots"),{recursive:true});
    const screenshot = async name => {
      const shot=await client.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
      fs.writeFileSync(path.join(root,"docs/reviews/screenshots/"+name),Buffer.from(shot.data,"base64"));
    };
    await screenshot("zhixing-codex-settings.png");
    await run(`(async()=>{${helpers} [...document.querySelectorAll(".bottom-tab")].find(b=>b.textContent.includes("卡组")).click();button("在知行簿内训练").click();await waitFor(()=>document.body.innerText.includes("最低标准："));input("#codex-answer","我先找面试可能失败的原因，再反推准备行动。");button("提交第一次回答").click();await waitFor(()=>document.body.innerText.includes("第二次回答"));input("#codex-answer","我会把失败原因变成检查项，比如模拟面试并记录回答中的缺口。");await new Promise(r=>setTimeout(r,500));})()`);
    await screenshot("zhixing-codex-training.png");
    // Reload proves draft/session durability rather than retaining JS variables.
    await client.send("Page.reload"); await delay(500);
    await run(`(async()=>{${helpers} await waitFor(()=>button("在知行簿内训练"));button("在知行簿内训练").click();await waitFor(()=>document.querySelector("#codex-answer")?.value.includes("模拟面试"));button("提交二次回答并结算").click();await waitFor(()=>button("确认写入并安排复习"));const before=(await chrome.storage.local.get("abilityLedgerStateV1")).abilityLedgerStateV1;if(before.entries.length!==0)throw new Error("Wrote before confirmation");button("确认写入并安排复习").click();await new Promise(r=>setTimeout(r,100));const noRating=(await chrome.storage.local.get("abilityLedgerStateV1")).abilityLedgerStateV1;if(noRating.entries.length!==0)throw new Error("Missing rating accepted");[...document.querySelectorAll(".rating-option")].find(b=>b.textContent.includes("正常")).click();})()`);
    await screenshot("zhixing-codex-preview.png");
    await run(`(async()=>{${helpers} const confirm=button("确认写入并安排复习");confirm.click();confirm.click();await waitFor(()=>document.body.innerText.includes("本轮已入账"));const saved=(await chrome.storage.local.get("abilityLedgerStateV1")).abilityLedgerStateV1;if(saved.entries.length!==1||saved.skillCards[0].reviewLogs.length!==1)throw new Error("Duplicate or missing settlement");if(saved.skillCards[0].level!=="L2")throw new Error("Evidence level mismatch");if(!saved.trainingSessions[0].committed)throw new Error("Training not marked committed");const {normalizeState,buildMarkdownExport}=await import("../shared/ledgerModel.js");const restored=normalizeState(JSON.parse(JSON.stringify(saved)));if(restored.trainingSessions[0].turns.length!==5)throw new Error("Training export lost turns");if(!buildMarkdownExport(restored).includes("模拟面试"))throw new Error("Markdown lost answers");const all=JSON.stringify(await chrome.storage.local.get(null));if(all.includes("fixture-access-secret")||all.includes("fixture-refresh-secret"))throw new Error("OAuth credential leaked into extension");})()`);
    await screenshot("zhixing-codex-complete.png");
    await run(`(async()=>{${helpers} document.querySelector(".back-button").click();document.querySelector(".codex-new-material summary").click();input("#codex-material-title","机会成本");input("#codex-material","选择一个方案时，要考虑放弃的最佳替代选项。");button("收录为 L0 并开始训练").click();await waitFor(()=>button("改为真实应用复盘"));button("改为真实应用复盘").click();await waitFor(()=>document.querySelector("#codex-applicationAction"));input("#codex-answer","我在选项目任务时比较了放弃其他任务的价值。");button("提交第一次回答").click();if(!document.body.innerText.includes("真实应用复盘需要填写"))throw new Error("Application accepted without action/result");input("#codex-applicationAction","我先完成用户反馈最多的修复，推迟了一个新功能。");input("#codex-applicationResult","两位试用者确认原问题解决，新功能仍未开始。");button("提交第一次回答").click();await waitFor(()=>document.body.innerText.includes("第二次回答"));input("#codex-answer","我会比较被放弃的最佳方案，而不是把所有没做的事情都相加。");button("提交二次回答并结算").click();await waitFor(()=>button("确认写入并安排复习"));[...document.querySelectorAll(".rating-option")].find(b=>b.textContent.includes("正常")).click();button("确认写入并安排复习").click();await waitFor(()=>document.body.innerText.includes("本轮已入账"));const saved=(await chrome.storage.local.get("abilityLedgerStateV1")).abilityLedgerStateV1;const card=saved.skillCards.find(c=>c.name==="机会成本");if(card.level!=="L3"||saved.entries.length!==2)throw new Error("Real application loop did not settle independently");})()`);
    for (const width of [320,600]) {
      await client.send("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:false});
      assert(await run(`document.documentElement.scrollWidth <= window.innerWidth`),`Overflow at ${width}`);
    }
    assert(errors.length===0,errors.join("\n"));
    console.log("Codex browser E2E passed: real extension → paired local HTTP service → mocked Codex SSE → two answers → reload recovery → evidence preview → idempotent FSRS write → export → new-material real-application report.");
  } finally {
    client?.close();browserClient?.close();chrome?.kill("SIGTERM");fixture.kill("SIGTERM");
    await delay(700);fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
