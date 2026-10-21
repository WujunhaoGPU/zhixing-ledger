export const CODEX_CONNECTION_KEY = "zhixingCodexConnectionV1";
export const CODEX_BASE = "http://127.0.0.1:17643";

export class CodexClient {
  constructor(storage = chrome.storage.local, fetchImpl = fetch) {
    this.storage = storage;
    this.fetch = (...args) => fetchImpl(...args);
  }
  async request(path, body, options = {}) {
    const connection = (await this.storage.get(CODEX_CONNECTION_KEY))[CODEX_CONNECTION_KEY] || {};
    let response;
    try {
      response = await this.fetch(CODEX_BASE + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", ...(globalThis.chrome?.runtime?.id ? { "X-Zhixing-Extension": `chrome-extension://${chrome.runtime.id}` } : {}), ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: options.signal || AbortSignal.timeout(15000)
      });
    } catch (error) {
      if (options.signal?.aborted) throw new Error("已停止生成，本轮尚未结算。");
      throw new Error("无法连接本地服务，请双击“启动知行簿”后重试。");
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `本地服务请求失败（${response.status}）。`);
    }
    return options.stream ? response : response.json();
  }
  async pair(code) {
    const result = await this.request("/pair", { code });
    await this.storage.set({ [CODEX_CONNECTION_KEY]: { token: result.token } });
  }
  async generate(messages, model, reasoningEffort, onDelta = () => {}, signal) {
    const id = crypto.randomUUID();
    const abort = () => { void this.request(`/tasks/${id}/cancel`, {}).catch(() => {}); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.request("/tasks", { id, messages, model, reasoning_effort: reasoningEffort || null }, { stream: true, signal: signal || AbortSignal.timeout(190000) });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = null;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "error") throw new Error(event.message);
          if (event.type === "delta") onDelta(event.text);
          if (event.type === "completed") completed = event;
        }
        if (done) break;
      }
      if (!completed?.text?.trim()) throw new Error("连接提前结束，本轮未完成，请重试。");
      return completed;
    } catch (error) {
      abort();
      if (signal?.aborted) throw new Error("已停止生成，本轮尚未结算。");
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
}
