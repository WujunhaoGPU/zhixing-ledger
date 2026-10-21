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
  assert(browserPath, "Chrome or Chromium was not found.");
  assert(fs.existsSync(path.join(extensionPath, "manifest.json")), `Ability ledger extension was not found: ${extensionPath}`);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ability-ledger-smoke-"));
  const chrome = spawn(browserPath, [
    "--disable-gpu",
    "--enable-extensions",
    "--enable-unsafe-extension-debugging",
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profileDir,
    "https://chatgpt.com/"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let panelClient;
  let treeClient;
  try {
    const browserWsUrl = await waitForBrowserWs(chrome.stderr);
    const browserClient = await connect(browserWsUrl);
    const loaded = await browserClient.send("Extensions.loadUnpacked", { path: extensionPath });
    assert(loaded.id, "Extensions.loadUnpacked did not return an extension id.");
    const panelUrl = "chrome-extension://" + loaded.id + "/sidepanel/sidepanel.html";
    await browserClient.send("Target.createTarget", { url: panelUrl });
    browserClient.close();

    const target = await waitForTarget(listUrl(browserWsUrl), panelUrl);
    panelClient = await connect(target.webSocketDebuggerUrl);
    const consoleErrors = [];
    panelClient.on("Runtime.exceptionThrown", (params) => {
      consoleErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "Uncaught runtime exception");
    });
    panelClient.on("Log.entryAdded", (params) => {
      if (params.entry?.level === "error") consoleErrors.push(params.entry.text || "Console error");
    });
    await panelClient.send("Runtime.enable");
    await panelClient.send("Log.enable");
    await panelClient.send("Page.enable");
    await panelClient.send("Emulation.setDeviceMetricsOverride", {
      width: 410,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });

    const result = await panelClient.send("Runtime.evaluate", {
      expression: String.raw`(async () => {
        const root = document.querySelector("#ability-ledger-root");
        const text = () => root ? root.innerText : "";
        const button = (label) => [...root.querySelectorAll("button")].find((item) => item.textContent.includes(label));
        const bottomButton = (label) => [...root.querySelectorAll(".bottom-tab")].find((item) => item.textContent.includes(label));
        const waitFor = async (predicate) => {
          for (let attempt = 0; attempt < 30; attempt += 1) {
            if (predicate()) return true;
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
          return false;
        };
        const out = {
          onboardingAutoOpen: false,
          onboardingFlowComplete: false,
          onboardingReopen: false,
          loaded: false,
          startPromptVisible: false,
          weekAgendaVisible: false,
          previewVisible: false,
          richContextPreview: false,
          imported: false,
          deleted: false,
          undoRestored: false,
          cardVisible: false,
          lifecycleVisible: false,
          reviewQueueVisible: false,
          externalReviewVisible: false,
          reviewLoopComplete: false,
          detailViewsVisible: false,
          manualLevelControlRemoved: false,
          exploreVisible: false,
          nodeLearningStarted: false,
          imagePrompt: false,
          duplicateHeaderRemoved: false,
          error: "",
          text: ""
        };
        try {
        out.onboardingAutoOpen = await waitFor(() => (
          Boolean(root.querySelector(".onboarding-layer"))
          && text().includes("把 AI 对话变成可复习的能力")
          && text().includes("今日")
          && text().includes("卡组")
          && text().includes("探索")
          && text().includes("制图")
        ));
        button("下一步").click();
        await waitFor(() => text().includes("先把一次学习收进来"));
        button("下一步").click();
        await waitFor(() => text().includes("在知行簿或 ChatGPT 里复习"));
        button("下一步").click();
        await waitFor(() => text().includes("把知识带出去，也把数据留下来"));
        button("开始使用").click();
        out.onboardingFlowComplete = await waitFor(() => !root.querySelector(".onboarding-layer"));
        out.loaded = await waitFor(() => text().includes("今日复习") && text().includes("今天没有到期任务"));
        out.weekAgendaVisible = Boolean(root.querySelector(".week-agenda"))
          && Boolean(root.querySelector(".agenda-scroll"))
          && root.querySelectorAll(".week-day").length === 7
          && root.querySelectorAll(".week-dot").length === 7
          && text().includes("任务")
          && !text().includes("上下滑动查看本周复习");
        out.duplicateHeaderRemoved = !root.querySelector(".chrome-header");
        root.querySelector(".screen-settings-button").click();
        await waitFor(() => text().includes("打开新手指南"));
        button("打开新手指南").click();
        out.onboardingReopen = await waitFor(() => (
          Boolean(root.querySelector(".onboarding-layer"))
          && text().includes("把 AI 对话变成可复习的能力")
        ));
        button("跳过").click();
        await waitFor(() => !root.querySelector(".onboarding-layer"));
        bottomButton("今日").click();
        await waitFor(() => text().includes("今日学习") && Boolean(root.querySelector(".settlement-panel")));
        const today = new Date().toISOString().slice(0, 10);
        const payload = [
          "\`\`\`knowledge_ledger_update",
          "{",
          '  "date": "' + today + '",',
          '  "category": "AI 能力圈学习",',
          '  "topic": "反向思维",',
          '  "score": 3,',
          '  "status": "完成二次复述",',
          '  "newCard": {',
          '    "title": "反向思维：从失败路径反推行动",',
          '    "oneSentence": "先找出最可能把事情搞砸的路径，再把这些失败条件反过来变成检查项和具体行动。",',
          '    "trigger": "面对面试、项目或重要决策，不知道该如何开始准备时。",',
          '    "method": ["先问怎样做最容易失败", "列出失败路径", "反向改写成行动"],',
          '    "personalExample": "准备面试时，把不模拟面试反向改成提前预演。",',
          '    "boundary": "擅长减少明显错误，但不能单独给出最优方向。",',
          '    "firstRecall": "第一次只列出了不准备项目、不模拟面试等失败行为。",',
          '    "feedback": "已经会分析失败路径，但还没有把每条路径转成具体行动。",',
          '    "secondRecall": "第二次补上了模拟面试、深挖项目和梳理技术细节。",',
          '    "progress": "从列举错误推进到了失败路径到反向行动的完整链条。"',
          "  },",
          '  "exposedProblem": "容易把高概率失败说成绝对失败。",',
          '  "nextReview": "' + today + '",',
          '  "nextReviewPrompt": "用 30 秒说明反向思维如何转化为行动。"',
          "}",
          "\`\`\`"
        ].join("\n");
        const reviewPayload = JSON.stringify({
          schemaVersion: 3,
          session: {
            date: today,
            kind: "transfer",
            topic: "反向思维与安全边际的协同使用",
            recallScore: 3,
            status: "已完成跨模型迁移验证",
            exposedIssue: "第一次回答只描述了失败路径，没有说明安全边际如何吸收判断误差。",
            nextReview: {
              dueDate: "",
              prompt: "换到产品发布场景，比较反向思维和安全边际分别解决什么问题。"
            }
          },
          cards: [{
            name: "反向思维：从失败路径反推行动",
            oneLine: "先识别高概率失败路径，再把它们反向改写成行动，并为剩余误差保留安全边际。",
            level: "L4",
            contentBlocks: [
              {
                type: "first_recall",
                title: "第一次复述",
                content: ["先列出不模拟面试、不熟悉项目等失败路径。"]
              },
              {
                type: "coach_feedback",
                title: "关键反馈",
                content: ["最大缺口是没有说明识别失败路径之后如何给预测误差留出余量。"]
              },
              {
                type: "second_recall",
                title: "第二次复述",
                content: ["先反向识别失败路径并安排模拟面试，再为时间和故障预留缓冲。"]
              },
              {
                type: "progress",
                title: "两次复述之间的进步",
                content: ["从只会列举失败路径，推进到失败路径、具体行动和风险余量的完整链条。"]
              },
              {
                type: "boundaries",
                title: "适用边界",
                content: ["反向思维减少明显错误，安全边际吸收剩余误差，但两者都不能单独判断目标是否值得做。"]
              }
            ],
            levelEvents: [{
              type: "transfer",
              targetLevel: "L4",
              score: 3,
              userEvidence: "我会先识别失败路径并安排对应动作，再为时间和故障预留缓冲。"
            }]
          }],
          imagePrompt: "请生成一张横向16:9手写白板知识图，画出失败路径、反向行动和安全边际之间的关系。"
        }, null, 2);
        bottomButton("今日").click();
        await waitFor(() => text().includes("智能结算"));
        out.startPromptVisible = text().includes("高级方式：手动追加")
          && text().includes("收录当前学习")
          && text().includes("开始能力训练");
        const input = root.querySelector("textarea");
        input.value = payload;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        button("生成结算预览").click();
        out.previewVisible = await waitFor(() => text().includes("写入前预览") && text().includes("反向思维") && text().includes("字段完整度"));
        out.richContextPreview = text().includes("已保留 8 个上下文模块") && text().includes("查看代表性上下文");
        button("确认写入").click();
        out.imported = await waitFor(() => text().includes("已写入 1 条台账和 1 张技能卡") && text().includes("容易把高概率失败"));
        root.querySelector(".entry-delete").click();
        out.deleted = await waitFor(() => text().includes("记录已删除") && !text().includes("容易把高概率失败"));
        button("撤销上一步").click();
        out.undoRestored = await waitFor(() => text().includes("已撤销上一步数据变更") && text().includes("容易把高概率失败"));
        bottomButton("卡组").click();
        out.cardVisible = await waitFor(() => text().includes("从失败路径反推行动") && text().includes("全部知识卡"));
        out.lifecycleVisible = text().includes("模块") && text().includes("来源") && text().includes("下一步：");
        out.reviewQueueVisible = text().includes("今天先完成这些")
          && text().includes("尚未建立稳定的复习记录")
          && text().includes("本轮：迁移挑战");
        root.querySelector(".review-plan-row .button").click();
        out.externalReviewVisible = await waitFor(() => (
          text().includes("让 ChatGPT 完成灵活追问")
          && text().includes("复制完整训练提示词")
          && text().includes("捕获 ChatGPT 最新结算")
        ));
        const settlementInput = root.querySelector(".chatgpt-settlement-input");
        settlementInput.value = reviewPayload;
        settlementInput.dispatchEvent(new Event("input", { bubbles: true }));
        button("解析结算内容").click();
        await waitFor(() => (
          text().includes("确认本轮结算")
          && text().includes("关键反馈")
          && text().includes("无边记图片提示词")
          && text().includes("从只会列举失败路径")
        ));
        [...root.querySelectorAll(".external-rating-section .rating-option")]
          .find((item) => item.textContent.includes("正常")).click();
        button("确认写入并安排复习").click();
        out.reviewLoopComplete = await waitFor(() => (
          text().includes("本轮已入账")
          && text().includes("FSRS 下次日期")
          && text().includes("提取难度：正常")
          && text().includes("接着生成无边记图片")
        ));
        button("查看这张卡").click();
        out.detailViewsVisible = await waitFor(() => (
          text().includes("知识内容")
          && text().includes("成长证据")
          && text().includes("来源")
          && text().includes("内容模块")
        ));
        out.manualLevelControlRemoved = !root.querySelector(".level-selector")
          && text().includes("等级由对话证据自动进化");
        [...root.querySelectorAll(".detail-tab")].find((item) => item.textContent.includes("成长证据")).click();
        out.detailViewsVisible = out.detailViewsVisible && await waitFor(() => text().includes("复习记录") && text().includes("迁移推演"));
        root.querySelector(".back-button").click();
        await waitFor(() => text().includes("今日复习"));
        bottomButton("探索").click();
        out.exploreVisible = await waitFor(() => (
          text().includes("探索学习")
          && text().includes("芒格多元思维模型")
          && text().includes("现在适合学习")
          && text().includes("打开完整技能树")
          && text().includes("从技能卡建立学习地图")
        ));
        const learnButton = [...root.querySelectorAll(".explore-recommendation button")]
          .find((item) => item.textContent.trim() === "学习");
        learnButton.click();
        out.nodeLearningStarted = await waitFor(() => (
          text().includes("正在学习")
          && text().includes("完成ChatGPT学习后")
          && text().includes("重新复制")
        ));
        bottomButton("制图").click();
        await waitFor(() => text().includes("生成并交给 ChatGPT"));
        button("生成并复制图片提示词").click();
        out.imagePrompt = await waitFor(() => [...root.querySelectorAll("textarea")].some((item) => (
          item.value.includes("Apple 无边记")
          && item.value.includes("知识点的解释图")
          && item.value.includes("按内容关系自适应布局，不强制三栏")
          && item.value.includes("把行动方法转成清晰的步骤图")
          && !item.value.includes("当前知识点进入能力圈")
          && !item.value.includes("记录到每日台账")
          && !item.value.includes("熟练度：L3")
        )));
        const requestedFinalTab = ${JSON.stringify(finalTab)};
        if (requestedFinalTab === "onboarding") {
          root.querySelector(".screen-settings-button").click();
          await waitFor(() => text().includes("打开新手指南"));
          button("打开新手指南").click();
          await waitFor(() => Boolean(root.querySelector(".onboarding-layer")));
        } else if (["detail", "review", "review-preview"].includes(requestedFinalTab)) {
          bottomButton("卡组").click();
          await waitFor(() => Boolean(root.querySelector(".deck-row")));
          root.querySelector(".deck-row").click();
          await waitFor(() => text().includes("知识内容") && text().includes("成长证据"));
          if (["review", "review-preview"].includes(requestedFinalTab)) {
            root.querySelector(".vertical-actions .button.primary").click();
            await waitFor(() => text().includes("复制完整训练提示词") && Boolean(root.querySelector(".chatgpt-settlement-input")));
          }
          if (requestedFinalTab === "review-preview") {
            const previewInput = root.querySelector(".chatgpt-settlement-input");
            previewInput.value = reviewPayload;
            previewInput.dispatchEvent(new Event("input", { bubbles: true }));
            button("解析结算内容").click();
            await waitFor(() => text().includes("确认本轮结算") && text().includes("本轮进步"));
            root.querySelector(".chatgpt-review-preview").scrollIntoView({ block: "start" });
          }
        } else if (requestedFinalTab !== "image") {
          const finalLabels = {
            today: "今日",
            cards: "卡组",
            explore: "探索"
          };
          if (requestedFinalTab === "settings") root.querySelector(".screen-settings-button").click();
          else bottomButton(finalLabels[requestedFinalTab] || "今日").click();
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        await new Promise((resolve) => setTimeout(resolve, 2800));
        } catch (error) {
          out.error = error.message;
        }
        out.text = text();
        return out;
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const value = result.result.value;
    if (screenshotPath) {
      const screenshot = await panelClient.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false
      });
      fs.writeFileSync(path.resolve(screenshotPath), Buffer.from(screenshot.data, "base64"));
    }
    const treeUrl = "chrome-extension://" + loaded.id + "/explore/explore.html";
    const treeBrowserClient = await connect(browserWsUrl);
    await treeBrowserClient.send("Target.createTarget", { url: treeUrl });
    treeBrowserClient.close();
    const treeTarget = await waitForTarget(listUrl(browserWsUrl), treeUrl);
    treeClient = await connect(treeTarget.webSocketDebuggerUrl);
    treeClient.on("Runtime.exceptionThrown", (params) => {
      consoleErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "Uncaught tree-page exception");
    });
    treeClient.on("Log.entryAdded", (params) => {
      if (params.entry?.level === "error") consoleErrors.push(params.entry.text || "Tree-page console error");
    });
    await treeClient.send("Runtime.enable");
    await treeClient.send("Log.enable");
    await treeClient.send("Page.enable");
    await treeClient.send("Emulation.setDeviceMetricsOverride", {
      width: 1360,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    const treeResult = await treeClient.send("Runtime.evaluate", {
      expression: String.raw`(async () => {
        const waitFor = async (predicate) => {
          for (let attempt = 0; attempt < 50; attempt += 1) {
            if (predicate()) return true;
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
          return false;
        };
        const text = () => document.body.innerText;
        const visible = await waitFor(() => (
          text().includes("能力圈技能树")
          && text().includes("芒格多元思维模型")
          && text().includes("选择下一项，而不是继续随机输入")
          && document.querySelectorAll("#tree-canvas canvas").length > 0
        ));
        await new Promise((resolve) => setTimeout(resolve, 900));
        const canvases = [...document.querySelectorAll("#tree-canvas canvas")];
        let nonblankPixels = 0;
        for (const canvas of canvases) {
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context || !canvas.width || !canvas.height) continue;
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          const step = Math.max(4, Math.floor(pixels.length / 12000 / 4) * 4);
          for (let index = 3; index < pixels.length; index += step) {
            if (pixels[index] > 0) nonblankPixels += 1;
          }
        }
        const recommendation = document.querySelector(".recommendation");
        recommendation?.click();
        await new Promise((resolve) => setTimeout(resolve, 200));
        const detailInteractive = Boolean(document.querySelector(".tree-detail .detail-title"))
          && text().includes("最低点亮标准")
          && text().includes("复制提示词");
        [...document.querySelectorAll("button")].find((item) => item.textContent.includes("建立地图"))?.click();
        const generatorVisible = await waitFor(() => (
          text().includes("围绕技能卡建立学习地图")
          && text().includes("选择1–5张卡")
          && text().includes("需要先在插件设置中配置DeepSeek API Key")
        ));
        document.querySelector('.generator-head button[title="关闭"]')?.click();
        await waitFor(() => !document.querySelector(".generator-layer"));
        return {
          visible,
          canvasCount: canvases.length,
          nonblankPixels,
          detailInteractive,
          generatorVisible,
          text: text()
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const treeValue = treeResult.result.value;
    if (treeScreenshotPath) {
      const screenshot = await treeClient.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false
      });
      fs.writeFileSync(path.resolve(treeScreenshotPath), Buffer.from(screenshot.data, "base64"));
    }
    assert(!value.error, `Smoke script errored: ${value.error}. Text: ${value.text}`);
    assert(value.onboardingAutoOpen, `First-run onboarding did not open. Text: ${value.text}`);
    assert(value.onboardingFlowComplete, `Onboarding could not be completed. Text: ${value.text}`);
    assert(value.onboardingReopen, `Settings could not reopen onboarding. Text: ${value.text}`);
    assert(value.loaded, `Panel did not load. Text: ${value.text}`);
    assert(value.startPromptVisible, `Start recall prompt entry is missing. Text: ${value.text}`);
    assert(value.weekAgendaVisible, `Week agenda is missing. Text: ${value.text}`);
    assert(value.duplicateHeaderRemoved, `Duplicate in-app product header was not removed. Text: ${value.text}`);
    assert(value.previewVisible, `Import preview did not render. Text: ${value.text}`);
    assert(value.richContextPreview, `Rich context count is missing from import preview. Text: ${value.text}`);
    assert(value.imported, `Ledger import did not complete. Text: ${value.text}`);
    assert(value.deleted, `Timeline entry delete did not persist. Text: ${value.text}`);
    assert(value.undoRestored, `Timeline entry undo did not restore data. Text: ${value.text}`);
    assert(value.cardVisible, `Skill card did not render. Text: ${value.text}`);
    assert(value.lifecycleVisible, `Card lifecycle summary did not render. Text: ${value.text}`);
    assert(value.reviewQueueVisible, `Review queue did not explain what to review. Text: ${value.text}`);
    assert(value.externalReviewVisible, `ChatGPT-led review entry did not render. Text: ${value.text}`);
    assert(value.reviewLoopComplete, `Review loop did not complete and schedule the next review. Text: ${value.text}`);
    assert(value.detailViewsVisible, `Card content/evidence/source detail views did not render. Text: ${value.text}`);
    assert(value.manualLevelControlRemoved, `Manual mastery controls still render in card detail. Text: ${value.text}`);
    assert(value.exploreVisible, `Exploration summary did not render. Text: ${value.text}`);
    assert(value.nodeLearningStarted, `A recommended node could not start the ChatGPT learning loop. Text: ${value.text}`);
    assert(value.imagePrompt, `Image prompt did not render. Text: ${value.text}`);
    assert(treeValue.visible, `Full learning map did not render. Text: ${treeValue.text}`);
    assert(treeValue.canvasCount > 0 && treeValue.nonblankPixels > 20, "Cytoscape rendered a blank learning-map canvas.");
    assert(treeValue.detailInteractive, `Tree node details are not interactive. Text: ${treeValue.text}`);
    assert(treeValue.generatorVisible, `Generated mini-tree entry did not open. Text: ${treeValue.text}`);
    assert(consoleErrors.length === 0, `Console errors:\n${consoleErrors.join("\n")}`);
    console.log("Ability ledger smoke passed.");
  } finally {
    if (panelClient) panelClient.close();
    if (treeClient) treeClient.close();
    if (!chrome.killed) chrome.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => chrome.once("exit", resolve)),
      delay(5000)
    ]);
    await removeTempProfile(profileDir);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
