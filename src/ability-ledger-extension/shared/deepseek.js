export const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
export const DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];

export function buildDeepSeekRequest(sourceText, model = "deepseek-v4-flash") {
  const selectedModel = DEEPSEEK_MODELS.includes(model) ? model : DEEPSEEK_MODELS[0];
  const source = String(sourceText || "").trim().slice(0, 50000);
  if (!source) throw new Error("没有可供智能解析的结算内容。");
  return {
    model: selectedModel,
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },
    stream: false,
    max_tokens: 6000,
    messages: [
      {
        role: "system",
        content: `你是“知行簿”的结构化转换器。你的任务是把知识收录、学习复述或现实应用记录转换为 JSON。

只提取输入中已经存在的事实，不要补写用户没有说过的案例、评分或结论。缺失字段使用空字符串或空数组。
必须只返回一个 JSON 对象，不要使用 Markdown 代码块，不要输出解释。

输出结构必须是：
{
  "schemaVersion": 3,
  "session": {
    "date": "YYYY-MM-DD",
    "kind": "capture|recall|application|transfer",
    "topic": "",
    "recallScore": 0,
    "status": "",
    "application": "",
    "exposedIssue": "",
    "nextReview": {
      "dueDate": "",
      "prompt": ""
    },
    "sourceTitle": ""
  },
  "cards": [
    {
      "name": "",
      "oneLine": "",
      "threeSentence": "",
      "scenario": "",
      "myCase": "",
      "relatedModels": [],
      "levelSuggestion": "L0",
      "levelReason": "",
      "nextReview": {
        "dueDate": "",
        "prompt": ""
      },
      "contentBlocks": [
        {
          "type": "definition|importance|core_question|reasoning|trigger|method|example|distinction|boundary|first_recall|feedback|second_recall|progress|source_quote|application|open_question|note",
          "title": "",
          "text": "",
          "items": []
        }
      ],
      "sources": [
        {
          "type": "chat|book|article|manual",
          "title": "",
          "url": "",
          "excerpt": ""
        }
      ],
      "levelEvents": [
        {
          "type": "capture|understanding|recall|application|transfer",
          "targetLevel": "L0",
          "summary": "",
          "recallScore": null,
          "userEvidence": ""
        }
      ]
    }
  ],
  "imagePrompt": null
}

约束：
- recallScore 只能是 0、1、2、3。
- levelSuggestion 只能是 L0、L1、L2、L3、L4。
- 只有输入明确展示了迁移到新问题的证据才能使用 L4。
- 方法步骤放进 type=method 的 items。
- 适用边界放进 type=boundary。
- 个人案例放进 myCase，并可同时保留为 type=example。
- nextReview 的日期和复述问题必须分开。
- 资料、AI 解释和来源案例只能生成 type=capture、targetLevel=L0。
- understanding、recall、application、transfer 必须在 userEvidence 中保留用户亲自说过或做过的证据。
- 不能仅凭内容丰富程度提升能力等级。
- type=recall 且用户独立复述评分达到 2 才支持 L2。
- type=application 必须包含用户自己的场景和行动才支持 L3。
- type=transfer 必须包含陌生场景中的推演或跨模型迁移才支持 L4。

信息保留原则：
- 不要把长对话压缩成少数结论。压缩寒暄和重复，但保留推理与学习证据。
- oneLine 用于快速调用，threeSentence 用于结构化解释，myCase 用于真实案例；其余有长期价值的上下文写入 contentBlocks。
- 输入信息充足时，一张卡建议保留 6-12 个有实质内容的 contentBlocks；输入没有的类型直接省略，不能凑数。
- 优先保留：为什么重要、核心问题、推理链、触发场景、行动步骤、关键区分、适用边界、真实案例。
- 如果输入包含复述训练，继续保留：第一次复述、教练最关键的反馈、第二次复述、两次之间的进步证据。
- 可以保留 1-3 句代表性用户原话，但不要整段复制原始聊天。
- 每个文本块应尽量完整表达一个上下文单元，不要只输出几个失去语境的关键词。
- 只提取原文事实，不得补写不存在的经历、反馈或进步。`
      },
      {
        role: "user",
        content: `请把下面的知识收录或学习结算转换为上述 JSON：\n\n${source}`
      }
    ]
  };
}

export function buildDeepSeekImagePromptRequest(sourcePrompt, model = "deepseek-v4-flash") {
  const selectedModel = DEEPSEEK_MODELS.includes(model) ? model : DEEPSEEK_MODELS[0];
  const source = String(sourcePrompt || "").trim().slice(0, 30000);
  if (!source) throw new Error("没有可供智能编排的知识地图内容。");
  return {
    model: selectedModel,
    thinking: { type: "disabled" },
    response_format: { type: "text" },
    stream: false,
    max_tokens: 3000,
    messages: [
      {
        role: "system",
        content: `你是中文知识可视化编辑，负责把真实知识卡内容整理成一段可以直接交给 ChatGPT 图片生成的文字提示词。

你要先在内部判断当前知识最适合用流程图、因果图、对照图、边界图、结构图还是案例图表达，再输出最终提示词。不要输出你的分析过程。

硬性规则：
- 只使用输入中已有的知识事实，不得虚构概念、案例、关系或结论。
- 保留用户选择的模块；没有内容的模块直接省略，不要为了对称或填满画面补内容。
- 版式由知识关系决定，不套用固定三栏、固定底部流程或固定“进入能力圈”判断图。
- 除非当前知识本身讨论学习管理，否则不要画 L0-L4、评分、台账、技能卡、复述闭环等元信息。
- 主示意图必须解释当前知识本身，节点和箭头文字必须来自输入内容。
- 输出必须是中文纯文本提示词，不要输出 JSON，不要使用 Markdown 代码块，不要附加解释。
- 提示词要明确画面风格、比例、知识内容、信息层级、主示意图和禁止项，文字应适合横向 16:9 手写知识地图。`
      },
      {
        role: "user",
        content: `请基于下面的知识卡草稿，生成最终图片提示词：\n\n${source}`
      }
    ]
  };
}

export function buildDeepSeekReviewFeedbackRequest(input = {}, model = "deepseek-v4-flash") {
  const selectedModel = DEEPSEEK_MODELS.includes(model) ? model : DEEPSEEK_MODELS[0];
  const cardName = String(input.cardName || "").trim().slice(0, 300);
  const question = String(input.question || "").trim().slice(0, 2000);
  const answer = String(input.answer || "").trim().slice(0, 8000);
  const reference = String(input.reference || "").trim().slice(0, 12000);
  const level = String(input.level || "L0").trim();
  if (!cardName || !question || !answer) throw new Error("复习反馈缺少卡片、题目或用户回答。");
  return {
    model: selectedModel,
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },
    stream: false,
    max_tokens: 1800,
    messages: [
      {
        role: "system",
        content: `你是“知行簿”的复习反馈教练。你只能根据技能卡参考内容评价用户回答，不得补造新的知识事实。

反馈目标不是给出长篇标准答案，而是帮助用户完成一次更好的二次提取。

必须只返回一个 JSON 对象：
{
  "strength": "用户这次真正抓住的一个核心",
  "gap": "最需要修正的一个缺口",
  "correction": "用 1-3 句指出应该补上的关系或边界",
  "retryQuestion": "一个比原题更小、更聚焦的二次回答问题"
}

约束：
- 每个字段都必须是简洁中文字符串。
- gap 只能有一个，不要列问题清单。
- 不要根据表达流畅度替用户判断 L0-L4 升级。
- 不要输出分数、复习日期或鼓励性套话。
- 如果参考内容不足，要明确说缺少什么依据，不得自行补全。`
      },
      {
        role: "user",
        content: `卡片：${cardName}
当前等级：${level}
本轮问题：${question}

技能卡参考内容：
${reference || "暂无更多参考内容"}

用户第一次回答：
${answer}`
      }
    ]
  };
}

export function buildDeepSeekKnowledgeTreeRequest(input = {}, model = "deepseek-v4-flash") {
  const selectedModel = DEEPSEEK_MODELS.includes(model) ? model : DEEPSEEK_MODELS[0];
  const cards = Array.isArray(input.cards) ? input.cards.slice(0, 5) : [];
  const basis = String(input.basis || "共同主题").trim().slice(0, 100);
  if (!cards.length) throw new Error("请至少选择一张技能卡生成学习地图。");
  const material = cards.map((card) => ({
    id: String(card.id || "").trim(),
    name: String(card.name || "").trim(),
    level: String(card.level || "L0").trim(),
    oneLine: String(card.oneLine || "").trim().slice(0, 800),
    threeSentence: String(card.threeSentence || "").trim().slice(0, 1800),
    scenario: String(card.scenario || "").trim().slice(0, 800),
    relatedModels: Array.isArray(card.relatedModels) ? card.relatedModels.slice(0, 12) : [],
    sources: Array.isArray(card.sources)
      ? card.sources.slice(0, 4).map((source) => ({ title: source.title, type: source.type }))
      : []
  }));
  return {
    model: selectedModel,
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },
    stream: false,
    max_tokens: 4200,
    messages: [
      {
        role: "system",
        content: `你是“知行簿”的学习地图编辑。你需要围绕用户选中的真实技能卡，提出一张小而清晰的学习地图，而不是生成百科全书。

必须只返回一个 JSON 对象，不要使用 Markdown 代码块：
{
  "format": "ability-tree/v1",
  "id": "英文或拼音短id",
  "title": "地图名称",
  "description": "一句话说明地图边界和学习目标",
  "kind": "generated",
  "version": 1,
  "nodes": [{
    "id": "唯一短id",
    "title": "简短知识名称",
    "summary": "一句话",
    "description": "这个节点是什么以及掌握意味着什么",
    "branch": "分支名",
    "aliases": [],
    "checkpoints": ["可验证标准"],
    "importance": 1,
    "confirmed": true
  }],
  "edges": [{
    "source": "前置节点id",
    "target": "后续节点id",
    "type": "requires|recommended",
    "requiredLevel": "L1|L2"
  }]
}

规则：
- 生成5–12个节点；用户选中的每张卡都必须对应一个节点，名称尽量保持一致。
- 先确定共同主题和明确边界；不能因为语义相近就强行组成一条线。
- edges必须构成DAG，不能循环；箭头从前置指向后续。
- requires只用于真正阻塞后续理解的硬前置，默认达到L1即可；需要稳定复述时才要求L2。
- recommended表示建议顺序，不锁定节点。
- checkpoints必须是可以通过复述、比较、案例或行动验证的标准，不能只写“了解”。
- 除所选卡片外的节点都是AI建议，只能提出常见且与地图边界直接相关的候选知识。
- 不得虚构用户已经学过、应用过或掌握这些新增节点。
- 不得生成积分、徽章、每日台账、FSRS或图片提示词节点。`
      },
      {
        role: "user",
        content: `组织依据：${basis}\n\n所选技能卡：\n${JSON.stringify(material, null, 2)}`
      }
    ]
  };
}

export function parseDeepSeekResponse(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (!String(content || "").trim()) {
    throw new Error("DeepSeek 返回了空内容。");
  }
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("结果不是 JSON 对象");
    }
    return parsed;
  } catch (error) {
    throw new Error(`DeepSeek 返回的 JSON 无法解析：${error.message}`);
  }
}

export function parseDeepSeekImagePromptResponse(response) {
  const content = String(response?.choices?.[0]?.message?.content || "").trim();
  if (!content) throw new Error("DeepSeek 返回了空的图片提示词。");
  const prompt = content
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (prompt.startsWith("{") || prompt.startsWith("[")) {
    throw new Error("DeepSeek 错误地返回了 JSON，而不是文字提示词。");
  }
  if (prompt.length < 120) {
    throw new Error("DeepSeek 返回的图片提示词过短，无法可靠表达知识内容。");
  }
  return prompt;
}

export function parseDeepSeekReviewFeedbackResponse(response) {
  const parsed = parseDeepSeekResponse(response);
  const feedback = {
    strength: String(parsed.strength || "").trim(),
    gap: String(parsed.gap || "").trim(),
    correction: String(parsed.correction || "").trim(),
    retryQuestion: String(parsed.retryQuestion || parsed.retry_question || "").trim()
  };
  if (!feedback.gap || !feedback.retryQuestion) {
    throw new Error("DeepSeek 复习反馈缺少核心缺口或二次问题。");
  }
  return feedback;
}

export function parseDeepSeekKnowledgeTreeResponse(response) {
  const parsed = parseDeepSeekResponse(response);
  if (!Array.isArray(parsed.nodes) || !parsed.nodes.length) {
    throw new Error("DeepSeek 返回的学习地图没有节点。");
  }
  if (!Array.isArray(parsed.edges)) parsed.edges = [];
  return parsed;
}

export function safeDeepSeekError(status, payload) {
  const detail = String(payload?.error?.message || payload?.message || "").trim();
  const labels = {
    400: "请求格式不正确",
    401: "API Key 无效",
    402: "DeepSeek 账户余额不足",
    422: "请求参数不支持",
    429: "请求过于频繁",
    500: "DeepSeek 服务暂时异常",
    503: "DeepSeek 服务繁忙"
  };
  const label = labels[status] || `DeepSeek 请求失败（${status}）`;
  return detail ? `${label}：${detail.slice(0, 180)}` : label;
}
