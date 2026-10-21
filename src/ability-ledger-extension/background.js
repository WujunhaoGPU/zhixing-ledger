import {
  DEEPSEEK_API_URL,
  buildDeepSeekImagePromptRequest,
  buildDeepSeekKnowledgeTreeRequest,
  buildDeepSeekReviewFeedbackRequest,
  buildDeepSeekRequest,
  parseDeepSeekImagePromptResponse,
  parseDeepSeekKnowledgeTreeResponse,
  parseDeepSeekReviewFeedbackResponse,
  parseDeepSeekResponse,
  safeDeepSeekError
} from "./shared/deepseek.js";

const SIDE_PANEL_PATH = "sidepanel/sidepanel.html";
const DEEPSEEK_TIMEOUT_MS = 45000;
const ACTION_ICON_PATHS = {
  16: "assets/brand/icon-16.png",
  32: "assets/brand/icon-32.png",
  48: "assets/brand/icon-48.png",
  128: "assets/brand/icon-128.png"
};

function isChatGPT(tab) {
  return Boolean(tab?.id && tab.url?.startsWith("https://chatgpt.com/"));
}

async function configureSidePanel(tab) {
  if (!chrome.sidePanel || !tab?.id) return;
  await chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: SIDE_PANEL_PATH,
    enabled: isChatGPT(tab)
  });
}

async function configureActiveSidePanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) await configureSidePanel(tab);
}

async function enablePanel() {
  if (!chrome.sidePanel) return;
  await chrome.sidePanel.setOptions({ path: SIDE_PANEL_PATH, enabled: false });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await configureActiveSidePanel();
}

async function configureActionIcon() {
  await chrome.action.setIcon({ path: ACTION_ICON_PATHS });
  await chrome.action.setTitle({ title: "知行簿" });
}

async function initializeExtension() {
  await configureActionIcon();
  await enablePanel();
}

chrome.runtime.onInstalled.addListener(() => {
  initializeExtension().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  initializeExtension().catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    configureSidePanel({ ...tab, id: tabId }).catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then(configureSidePanel).catch(() => {});
});

initializeExtension().catch(() => {});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return false;
  if (message.type === "ABILITY_LEDGER_DOWNLOAD_TEXT") {
    downloadText(message).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });
    return true;
  }
  if (message.type === "ABILITY_LEDGER_DEEPSEEK_EXTRACT") {
    extractWithDeepSeek(message).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });
    return true;
  }
  if (message.type === "ABILITY_LEDGER_DEEPSEEK_TEST") {
    testDeepSeek(message).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });
    return true;
  }
  if (message.type === "ABILITY_LEDGER_DEEPSEEK_IMAGE_PROMPT") {
    generateImagePromptWithDeepSeek(message).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });
    return true;
  }
  if (message.type === "ABILITY_LEDGER_DEEPSEEK_REVIEW_FEEDBACK") {
    generateReviewFeedbackWithDeepSeek(message).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });
    return true;
  }
  if (message.type === "ABILITY_LEDGER_DEEPSEEK_KNOWLEDGE_TREE") {
    generateKnowledgeTreeWithDeepSeek(message).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });
    return true;
  }
  if (message.type === "ABILITY_LEDGER_OPEN_EXPLORE") {
    openExplorePage(message).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });
    return true;
  }
  return false;
});

async function openExplorePage(message) {
  const suffix = message.mode === "generate" ? "#generate" : "";
  const tab = await chrome.tabs.create({
    url: chrome.runtime.getURL(`explore/explore.html${suffix}`)
  });
  return { ok: true, tabId: tab.id };
}

async function downloadText(message) {
  const mimeType = message.mimeType || "text/markdown";
  const url = `data:${mimeType};charset=utf-8,${encodeURIComponent(message.content || "")}`;
  const downloadId = await chrome.downloads.download({
    url,
    filename: message.filename,
    saveAs: false,
    conflictAction: "overwrite"
  });
  return { ok: true, downloadId };
}

async function extractWithDeepSeek(message) {
  const apiKey = String(message.apiKey || "").trim();
  if (!apiKey) throw new Error("请先在设置中填写 DeepSeek API Key。");
  const request = buildDeepSeekRequest(message.sourceText, message.model);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await postDeepSeek(apiKey, request);
      const data = parseDeepSeekResponse(response);
      return {
        ok: true,
        data,
        usage: response.usage || null,
        retried: attempt > 0
      };
    } catch (error) {
      lastError = error;
      if (attempt === 0 && /空内容|无法解析|服务暂时异常|服务繁忙/.test(error.message)) continue;
      break;
    }
  }
  throw lastError || new Error("DeepSeek 智能解析失败。");
}

async function testDeepSeek(message) {
  const apiKey = String(message.apiKey || "").trim();
  if (!apiKey) throw new Error("请先填写 DeepSeek API Key。");
  const request = buildDeepSeekRequest("主题：连接测试。评分：2。形成技能卡：API 连接测试。", message.model);
  const response = await postDeepSeek(apiKey, request);
  parseDeepSeekResponse(response);
  return { ok: true, model: request.model };
}

async function generateImagePromptWithDeepSeek(message) {
  const apiKey = String(message.apiKey || "").trim();
  if (!apiKey) throw new Error("请先在设置中填写 DeepSeek API Key。");
  const request = buildDeepSeekImagePromptRequest(message.sourcePrompt, message.model);
  const response = await postDeepSeek(apiKey, request);
  return {
    ok: true,
    prompt: parseDeepSeekImagePromptResponse(response),
    usage: response.usage || null
  };
}

async function generateReviewFeedbackWithDeepSeek(message) {
  const apiKey = String(message.apiKey || "").trim();
  if (!apiKey) throw new Error("请先在设置中填写 DeepSeek API Key。");
  const request = buildDeepSeekReviewFeedbackRequest(message.input, message.model);
  const response = await postDeepSeek(apiKey, request);
  return {
    ok: true,
    feedback: parseDeepSeekReviewFeedbackResponse(response),
    usage: response.usage || null
  };
}

async function generateKnowledgeTreeWithDeepSeek(message) {
  const apiKey = String(message.apiKey || "").trim();
  if (!apiKey) throw new Error("请先在设置中填写 DeepSeek API Key。");
  const request = buildDeepSeekKnowledgeTreeRequest(message.input, message.model);
  const response = await postDeepSeek(apiKey, request);
  return {
    ok: true,
    tree: parseDeepSeekKnowledgeTreeResponse(response),
    usage: response.usage || null
  };
}

async function postDeepSeek(apiKey, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(safeDeepSeekError(response.status, payload));
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("DeepSeek 请求超时，请稍后重试。");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
