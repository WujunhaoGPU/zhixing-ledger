(() => {
  if (window.__abilityLedgerAdapterLoaded) return;
  window.__abilityLedgerAdapterLoaded = true;

  function latestAssistantText() {
    const selectors = [
      "[data-message-author-role='assistant']",
      "[data-testid*='conversation-turn'] [data-message-author-role='assistant']",
      "article"
    ];
    const nodes = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
    const uniqueNodes = [...new Set(nodes)].filter((node) => {
      const text = (node.innerText || node.textContent || "").trim();
      return text.length > 40;
    });
    const latest = uniqueNodes.at(-1);
    if (!latest) throw new Error("没有找到最新的 ChatGPT 助手回复，请手动复制粘贴。");
    return (latest.innerText || latest.textContent || "").trim();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "ABILITY_LEDGER_PAGE_ACTION") return false;
    try {
      if (message.action === "capture-latest") {
        sendResponse({ ok: true, text: latestAssistantText() });
        return true;
      }
      throw new Error("不支持的页面操作。");
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error) });
      return true;
    }
  });
})();
