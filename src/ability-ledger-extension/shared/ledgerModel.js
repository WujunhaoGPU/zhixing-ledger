import {
  normalizeReviewLogs,
  normalizeReviewSchedule
} from "./reviewScheduler.js";
import {
  normalizeExploration,
  normalizeKnowledgeTrees
} from "./knowledgeTree.js";

export const LEDGER_STATE_KEY = "abilityLedgerStateV1";
export const LEDGER_UNDO_STATE_KEY = "abilityLedgerUndoStateV1";
export const DEEPSEEK_API_KEY_STORAGE_KEY = "abilityLedgerDeepSeekApiKeyV1";

export const SCORE_LABELS = {
  0: "0 说不出来",
  1: "1 只有关键词",
  2: "2 三句话讲清",
  3: "3 能举例应用"
};

export const LEVEL_LABELS = {
  L0: "L0 已收录",
  L1: "L1 初步理解",
  L2: "L2 可以复述",
  L3: "L3 可以应用",
  L4: "L4 可以迁移"
};

export const EVIDENCE_TYPE_LABELS = {
  capture: "知识收录",
  understanding: "理解确认",
  recall: "独立复述",
  application: "现实应用",
  transfer: "迁移推演",
  legacy: "旧版等级"
};

const BLOCK_TITLES = {
  definition: "核心理解",
  importance: "为什么重要",
  core_question: "核心问题",
  reasoning: "推理链",
  trigger: "触发场景",
  method: "行动方法",
  example: "我的案例",
  distinction: "关键区分",
  boundary: "适用边界",
  first_recall: "第一次复述",
  feedback: "教练反馈",
  second_recall: "第二次复述",
  progress: "进步证据",
  source_quote: "我的原话",
  application: "现实应用",
  open_question: "待解决问题",
  note: "补充信息"
};

export function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function createEmptyState() {
  const knowledgeTrees = normalizeKnowledgeTrees([]);
  return {
    schemaVersion: 3,
    entries: [],
    trainingSessions: [],
    skillCards: [],
    imagePrompts: [],
    knowledgeTrees,
    exploration: normalizeExploration({}, knowledgeTrees),
    settings: {
      defaultReviewDays: 1,
      imageStyle: "手写知识地图，白底，黑色墨水线条，少量蓝色和绿色标注",
      deepseekEnabled: false,
      deepseekModel: "deepseek-v4-flash",
      importMode: "auto"
    }
  };
}

export function normalizeState(value) {
  const base = createEmptyState();
  const state = value && typeof value === "object" ? value : {};
  const knowledgeTrees = normalizeKnowledgeTrees(state.knowledgeTrees);
  return {
    ...base,
    ...state,
    schemaVersion: 3,
    entries: Array.isArray(state.entries) ? state.entries.map(normalizeEntry).filter(Boolean) : [],
    skillCards: Array.isArray(state.skillCards) ? state.skillCards.map(normalizeSkillCard).filter(Boolean) : [],
    imagePrompts: Array.isArray(state.imagePrompts) ? state.imagePrompts.map(normalizeImagePrompt).filter(Boolean) : [],
    trainingSessions: Array.isArray(state.trainingSessions) ? state.trainingSessions.filter(s => s && typeof s === "object" && typeof s.id === "string").map(s => ({
      id: s.id, cardId: String(s.cardId || ""), cardName: String(s.cardName || ""), originalLevel: String(s.originalLevel || "L0"),
      model: String(s.model || ""), reasoningEffort: String(s.reasoningEffort || ""), phase: String(s.phase || "question"),
      turns: Array.isArray(s.turns) ? s.turns.filter(t => ["user", "assistant"].includes(t?.role) && typeof t.content === "string").map(t => ({ role: t.role, content: t.content })) : [],
      firstAnswer: String(s.firstAnswer || ""), secondAnswer: String(s.secondAnswer || ""), draft: String(s.draft || ""),
      question: String(s.question || ""), feedback: String(s.feedback || ""), retryQuestion: String(s.retryQuestion || ""),
      settlement: String(s.settlement || ""), rating: String(s.rating || ""), error: String(s.error || ""),
      evidenceMode: s.evidenceMode === "real-application" ? "real-application" : "practice", applicationAction: String(s.applicationAction || ""), applicationResult: String(s.applicationResult || ""),
      busy: false, committed: Boolean(s.committed), createdAt: String(s.createdAt || ""), completedAt: String(s.completedAt || "")
    })) : [],
    knowledgeTrees,
    exploration: normalizeExploration(state.exploration, knowledgeTrees),
    settings: { ...base.settings, ...(state.settings || {}) }
  };
}

export function normalizeEntry(value) {
  if (!value || typeof value !== "object") return null;
  const date = clean(firstValue(value, ["date"])) || todayISO();
  const theme = clean(firstValue(value, ["theme", "todayTheme", "today_theme", "topic", "category", "title"])) || "未命名主题";
  const rawNextReview = clean(firstValue(value, ["nextReview", "next_review"]));
  const prompt = clean(firstValue(value, [
    "nextReviewPrompt",
    "next_review_prompt",
    "tomorrowReview",
    "tomorrow_review"
  ]));
  return {
    id: value.id || makeId("entry"),
    date,
    theme,
    newSkillCards: normalizeNameList(firstValue(value, [
      "newSkillCards",
      "new_skill_cards",
      "newCards",
      "new_cards"
    ])),
    oldRecall: clean(firstValue(value, [
      "oldRecall",
      "oldCardRecall",
      "old_recall",
      "old_card_recall",
      "topic"
    ])),
    recallScore: clampScore(firstValue(value, [
      "recallScore",
      "recall_score",
      "recitationScore",
      "recitation_score",
      "finalScore",
      "final_score",
      "score"
    ])),
    application: cleanFlexible(firstValue(value, [
      "application",
      "applicationScenario",
      "application_scenario"
    ])),
    exposedIssue: clean(firstValue(value, [
      "exposedIssue",
      "exposed_issue",
      "exposedProblem",
      "exposed_problem",
      "issue"
    ])),
    nextReview: prompt || (looksLikeISODate(rawNextReview) ? "" : rawNextReview),
    nextReviewDate: clean(firstValue(value, [
      "nextReviewDate",
      "next_review_date",
      "dueDate",
      "due_date"
    ])) || (looksLikeISODate(rawNextReview) ? rawNextReview : ""),
    sourceTitle: clean(firstValue(value, ["sourceTitle", "source_title"])),
    kind: normalizeSessionKind(firstValue(value, ["kind", "sessionKind", "session_kind"])),
    status: clean(firstValue(value, ["status"])),
    sourceFormat: clean(firstValue(value, ["sourceFormat", "source_format"])),
    createdAt: clean(firstValue(value, ["createdAt", "created_at"])) || new Date().toISOString()
  };
}

export function normalizeSkillCard(value) {
  if (!value || typeof value !== "object") return null;
  const name = clean(firstValue(value, ["name", "title", "skillName", "skill_name", "topic"]));
  if (!name) return null;
  const contentBlocks = normalizeContentBlocks(firstValue(value, ["contentBlocks", "content_blocks"]));
  const derivedBlocks = contentBlocks.length ? contentBlocks : buildDerivedBlocks(value);
  const methods = normalizeStringList(firstValue(value, ["method", "methods", "steps"]));
  const methodExplanation = methods.length ? methods.join("；") : "";
  const rawNextReview = clean(firstValue(value, ["nextReview", "next_review"]));
  const reviewPrompt = clean(firstValue(value, ["nextReviewPrompt", "next_review_prompt"]));
  const sourceFormat = clean(firstValue(value, ["sourceFormat", "source_format"]));
  const sources = normalizeSources(firstValue(value, ["sources", "source"]));
  const nextReviewDate = clean(firstValue(value, [
    "nextReviewDate",
    "next_review_date",
    "dueDate",
    "due_date"
  ])) || (looksLikeISODate(rawNextReview) ? rawNextReview : "");
  const createdAt = clean(firstValue(value, ["createdAt", "created_at"])) || new Date().toISOString();
  const declaredLevel = normalizeLevel(firstValue(value, [
    "level",
    "currentLevel",
    "current_level",
    "levelSuggestion",
    "level_suggestion"
  ]));
  let levelEvents = normalizeLevelEvents(firstValue(value, [
    "levelEvents",
    "level_events",
    "evidenceEvents",
    "evidence_events"
  ]));
  if (!levelEvents.length) {
    if (sourceFormat === "canonical-v3") {
      if (sources.length || derivedBlocks.length) {
        levelEvents = [makeLevelEvent("capture", "L0", "已收录知识内容，等待用户输出验证。")];
      }
    } else if (declaredLevel !== "L0") {
      levelEvents = [makeLevelEvent("legacy", declaredLevel, "从旧版能力卡保留的等级。")];
    } else if (sources.length || derivedBlocks.length) {
      levelEvents = [makeLevelEvent("capture", "L0", "已收录知识内容。")];
    }
  }
  const level = deriveLevelFromEvidence(levelEvents);
  const explicitReason = clean(firstValue(value, ["levelReason", "level_reason"]));
  return {
    id: value.id || makeId("card"),
    name,
    oneLine: clean(firstValue(value, [
      "oneLine",
      "one_line",
      "oneSentence",
      "one_sentence",
      "summary"
    ])),
    threeSentence: clean(firstValue(value, [
      "threeSentence",
      "three_sentence",
      "coreUnderstanding",
      "core_understanding",
      "explanation"
    ])) || methodExplanation,
    scenario: cleanFlexible(firstValue(value, [
      "scenario",
      "usageScenario",
      "usage_scenario",
      "useScenarios",
      "use_scenarios",
      "trigger"
    ])),
    myCase: clean(firstValue(value, [
      "myCase",
      "my_case",
      "personalCase",
      "personal_case",
      "personalExample",
      "personal_example"
    ])),
    relatedModels: normalizeStringList(firstValue(value, ["relatedModels", "related_models", "tags"])),
    level,
    levelReason: declaredLevel === level && explicitReason
      ? explicitReason
      : levelReasonFromEvidence(levelEvents, level),
    nextReview: reviewPrompt || (looksLikeISODate(rawNextReview) ? "" : rawNextReview),
    nextReviewDate,
    contentBlocks: derivedBlocks,
    sources,
    levelEvents,
    reviewSchedule: normalizeReviewSchedule(
      firstValue(value, ["reviewSchedule", "review_schedule"]),
      nextReviewDate || createdAt
    ),
    reviewLogs: normalizeReviewLogs(firstValue(value, ["reviewLogs", "review_logs"])),
    sourceFormat,
    updatedAt: clean(firstValue(value, ["updatedAt", "updated_at"])) || new Date().toISOString(),
    createdAt
  };
}

export function deriveLevelFromEvidence(events) {
  const normalized = normalizeLevelEvents(events);
  let highest = 0;
  normalized.forEach((event) => {
    const hasUserEvidence = Boolean(event.userEvidence);
    if (event.type === "legacy") {
      highest = Math.max(highest, levelNumber(event.targetLevel));
      return;
    }
    if (event.type === "understanding" && hasUserEvidence) highest = Math.max(highest, 1);
    if (event.type === "recall") {
      if (event.recallScore >= 2 && hasUserEvidence) highest = Math.max(highest, 2);
      else if (event.recallScore >= 1 && hasUserEvidence) highest = Math.max(highest, 1);
    }
    if (event.type === "application" && hasUserEvidence) highest = Math.max(highest, 3);
    if (event.type === "transfer" && hasUserEvidence) highest = Math.max(highest, 4);
  });
  return `L${highest}`;
}

export function nextLevelAction(card) {
  const actions = {
    L0: "用一句自己的话解释",
    L1: "完成一次30秒独立复述",
    L2: "用在一个真实场景并记录行动",
    L3: "迁移到陌生问题并进行推演",
    L4: "定期复盘并连接新的模型"
  };
  return actions[normalizeLevel(card?.level)] || actions.L0;
}

export function cardContentStats(card) {
  return {
    blocks: Array.isArray(card?.contentBlocks) ? card.contentBlocks.length : 0,
    sources: Array.isArray(card?.sources) ? card.sources.length : 0,
    evidence: Array.isArray(card?.levelEvents) ? card.levelEvents.length : 0
  };
}

export function normalizeImagePrompt(value) {
  if (typeof value === "string") {
    const prompt = clean(value);
    return prompt ? {
      id: makeId("image"),
      title: "无边记知识图",
      cardId: "",
      prompt,
      createdAt: new Date().toISOString()
    } : null;
  }
  if (!value || typeof value !== "object") return null;
  const prompt = clean(value.prompt || value.content);
  if (!prompt) return null;
  return {
    id: value.id || makeId("image"),
    title: clean(value.title) || "无边记知识图",
    cardId: clean(value.cardId || value.card_id),
    prompt,
    createdAt: clean(value.createdAt || value.created_at) || new Date().toISOString()
  };
}

export function analyzeLedgerUpdate(input) {
  const parsed = typeof input === "string"
    ? JSON.parse(extractJson(input, "knowledge_ledger_update"))
    : input;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("结算内容必须是一个 JSON 对象。");
  }

  const adapted = adaptPayload(parsed);
  const entries = adapted.entries.map(normalizeEntry).filter(Boolean);
  const skillCards = adapted.skillCards.map(normalizeSkillCard).filter(Boolean);
  const imagePrompts = adapted.imagePrompts.map(normalizeImagePrompt).filter(Boolean);
  const update = { entries, skillCards, imagePrompts };
  const report = buildImportReport(update, adapted);
  return {
    update,
    report,
    canonical: toCanonicalSettlement(update, report)
  };
}

export function parseLedgerUpdate(text) {
  const result = analyzeLedgerUpdate(text);
  if (!result.report.valid) {
    throw new Error(result.report.warnings[0] || "没有识别到可写入的真实台账或技能卡信息。");
  }
  return result.update;
}

export function applyLedgerUpdate(state, update) {
  const normalized = normalizeState(state);
  const entries = [...normalized.entries, ...(update.entries || [])].map(normalizeEntry).filter(Boolean);
  const skillCards = mergeSkillCards(normalized.skillCards, update.skillCards || []);
  const imagePrompts = [...(update.imagePrompts || []), ...normalized.imagePrompts]
    .map(normalizeImagePrompt)
    .filter(Boolean);
  return normalizeState({ ...normalized, entries, skillCards, imagePrompts });
}

export function toCanonicalSettlement(update, report = {}) {
  const entry = update.entries?.[0] || null;
  return {
    schemaVersion: 3,
    sourceFormat: report.sourceFormat || entry?.sourceFormat || "canonical-v3",
    session: entry ? {
      date: entry.date,
      kind: entry.kind,
      topic: entry.theme,
      recallScore: entry.recallScore,
      status: entry.status,
      application: entry.application,
      exposedIssue: entry.exposedIssue,
      nextReview: {
        dueDate: entry.nextReviewDate,
        prompt: entry.nextReview
      },
      sourceTitle: entry.sourceTitle
    } : null,
    cards: (update.skillCards || []).map((card) => ({
      name: card.name,
      oneLine: card.oneLine,
      threeSentence: card.threeSentence,
      scenario: card.scenario,
      myCase: card.myCase,
      relatedModels: card.relatedModels,
      levelSuggestion: card.level,
      levelReason: card.levelReason,
      nextReview: {
        dueDate: card.nextReviewDate,
        prompt: card.nextReview
      },
      contentBlocks: card.contentBlocks,
      sources: card.sources,
      levelEvents: card.levelEvents
    })),
    imagePrompt: update.imagePrompts?.[0] || null
  };
}

export function buildMarkdownExport(state) {
  const normalized = normalizeState(state);
  const lines = ["# AI 能力圈成长台账", ""];
  lines.push("## 每日台账", "");
  normalized.entries
    .slice()
    .sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`))
    .forEach((entry) => {
      lines.push(`### ${entry.date} ${entry.theme}`);
      lines.push(`- 新增技能卡：${entry.newSkillCards.join("、") || "无"}`);
      lines.push(`- 学习类型：${entry.kind}`);
      lines.push(`- 旧卡复述：${entry.oldRecall || "无"}`);
      lines.push(`- 复述评分：${SCORE_LABELS[entry.recallScore]}`);
      lines.push(`- 应用场景：${entry.application || "无"}`);
      lines.push(`- 暴露问题：${entry.exposedIssue || "无"}`);
      lines.push(`- 下次复习：${entry.nextReview || "未定"}`);
      lines.push(`- 复习日期：${entry.nextReviewDate || "未定"}`);
      lines.push("");
    });
  lines.push("## 技能卡", "");
  normalized.skillCards.forEach((card) => {
    lines.push(`### ${card.name}`);
    lines.push(`- 等级：${LEVEL_LABELS[card.level]}`);
    lines.push(`- 一句话：${card.oneLine || "未填写"}`);
    lines.push(`- 三句话：${card.threeSentence || "未填写"}`);
    lines.push(`- 使用场景：${card.scenario || "未填写"}`);
    lines.push(`- 我的案例：${card.myCase || "未填写"}`);
    lines.push(`- 关联模型：${card.relatedModels.join("、") || "无"}`);
    lines.push(`- 内容模块：${card.contentBlocks.length}`);
    lines.push(`- 来源数量：${card.sources.length}`);
    lines.push(`- 成长证据：${card.levelEvents.length}`);
    card.contentBlocks.forEach((block) => {
      const content = block.items.length ? block.items.join("；") : block.text;
      lines.push(`- ${block.title}：${content}`);
    });
    card.sources.forEach((source) => {
      lines.push(`- 来源：${source.title}${source.url ? ` ${source.url}` : ""}`);
    });
    card.levelEvents.forEach((event) => {
      lines.push(`- ${EVIDENCE_TYPE_LABELS[event.type]} → ${event.targetLevel}：${event.summary || event.userEvidence}`);
    });
    lines.push("");
  });
  lines.push("## 学习地图", "");
  normalized.knowledgeTrees.forEach((tree) => {
    lines.push(`### ${tree.title}`);
    lines.push(`- 类型：${tree.kind}`);
    lines.push(`- 节点：${tree.nodes.length}`);
    lines.push(`- 关系：${tree.edges.length}`);
    lines.push(`- 来源：${tree.source.title || "未填写"}`);
    lines.push("");
  });
  lines.push("## 知行簿训练记录", "");
  normalized.trainingSessions.forEach(session => {
    lines.push(`### ${session.cardName} · ${session.createdAt}`, `状态：${session.committed ? "已入账" : "未入账"}`, "");
    session.turns.forEach(turn => lines.push(`**${turn.role === "user" ? "我的回答" : "教练"}**`, turn.content, ""));
    if (session.draft) lines.push("未提交草稿：", session.draft, "");
  });
  return lines.join("\n");
}

export function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function adaptPayload(parsed) {
  const sourceFormat = detectSourceFormat(parsed);
  if (sourceFormat === "canonical-v3") return adaptCanonicalV3(parsed);
  if (sourceFormat === "canonical-v2") return adaptCanonicalV2(parsed);

  const date = clean(parsed.date) || todayISO();
  const theme = clean(firstValue(parsed, ["theme", "todayTheme", "today_theme", "topic", "category", "title"])) || "AI 能力圈学习";
  const rawCards = arrayValue(firstValue(parsed, [
    "skillCards",
    "skill_cards",
    "cards",
    "newCards",
    "new_cards",
    "newCard",
    "new_card",
    "skillCard",
    "skill_card"
  ]));
  const cardNames = rawCards
    .map((card) => clean(firstValue(card || {}, ["name", "title", "topic"])))
    .filter(Boolean);
  const rawEntries = arrayValue(firstValue(parsed, [
    "ledgerEntries",
    "ledger_entries",
    "entries",
    "dailyLedger",
    "daily_ledger",
    "ledgerEntry",
    "ledger_entry"
  ]));
  const entries = (rawEntries.length ? rawEntries : [parsed]).map((entry) => ({
    ...entry,
    date: entry?.date || date,
    theme: clean(firstValue(entry || {}, ["theme", "todayTheme", "today_theme", "topic", "category", "title"])) || theme,
    newSkillCards: normalizeNameList(firstValue(entry || {}, ["newSkillCards", "new_skill_cards"])).length
      ? normalizeNameList(firstValue(entry || {}, ["newSkillCards", "new_skill_cards"]))
      : cardNames,
    oldRecall: firstValue(entry || {}, ["oldRecall", "old_recall", "topic"]) || parsed.topic || "",
    recallScore: firstValue(entry || {}, [
      "recallScore",
      "recall_score",
      "recitationScore",
      "recitation_score",
      "score"
    ]) || firstValue(parsed, ["recallScore", "recall_score", "recitationScore", "recitation_score", "score"]),
    application: firstValue(entry || {}, ["application", "applicationScenario", "application_scenario"])
      || firstValue(rawCards[0] || {}, ["scenario", "trigger"]),
    exposedIssue: firstValue(entry || {}, [
      "exposedIssue",
      "exposed_issue",
      "exposedProblem",
      "exposed_problem"
    ]) || firstValue(parsed, ["exposedIssue", "exposed_issue", "exposedProblem", "exposed_problem"]),
    nextReview: firstValue(entry || {}, ["nextReviewPrompt", "next_review_prompt"])
      || firstValue(parsed, ["nextReviewPrompt", "next_review_prompt"])
      || firstValue(entry || {}, ["nextReview", "next_review"])
      || firstValue(parsed, ["nextReview", "next_review"]),
    nextReviewDate: firstValue(entry || {}, ["nextReviewDate", "next_review_date"])
      || firstValue(parsed, ["nextReviewDate", "next_review_date"])
      || (looksLikeISODate(parsed.nextReview) ? parsed.nextReview : ""),
    status: firstValue(entry || {}, ["status"]) || parsed.status || "",
    kind: firstValue(entry || {}, ["kind", "sessionKind", "session_kind"])
      || firstValue(parsed, ["kind", "sessionKind", "session_kind"])
      || "recall",
    sourceFormat
  }));
  const score = clampScore(firstValue(parsed, ["recallScore", "recall_score", "recitationScore", "recitation_score", "score"]));
  const skillCards = rawCards.map((card) => ({
    ...card,
    level: firstValue(card || {}, ["level", "currentLevel", "current_level", "levelSuggestion", "level_suggestion"])
      || deriveLevel(score, card),
    nextReview: firstValue(card || {}, ["nextReviewPrompt", "next_review_prompt"])
      || firstValue(parsed, ["nextReviewPrompt", "next_review_prompt"]),
    nextReviewDate: firstValue(card || {}, ["nextReviewDate", "next_review_date"])
      || (looksLikeISODate(parsed.nextReview) ? parsed.nextReview : ""),
    sourceFormat
  }));
  const rawImage = firstValue(parsed, ["imagePrompt", "image_prompt"]);
  return {
    sourceFormat,
    entries,
    skillCards,
    imagePrompts: rawImage ? arrayValue(rawImage) : [],
    recognizedFields: countRecognizedFields(parsed, rawCards)
  };
}

function adaptCanonicalV2(parsed) {
  const session = parsed.session && typeof parsed.session === "object" ? parsed.session : {};
  const review = session.nextReview && typeof session.nextReview === "object" ? session.nextReview : {};
  const cards = arrayValue(parsed.cards).map((card) => {
    const cardReview = card.nextReview && typeof card.nextReview === "object" ? card.nextReview : {};
    return {
      ...card,
      level: card.levelSuggestion || card.level,
      nextReview: cardReview.prompt || card.nextReviewPrompt || "",
      nextReviewDate: cardReview.dueDate || card.nextReviewDate || "",
      sourceFormat: "canonical-v2"
    };
  });
  const entries = Object.keys(session).length ? [{
    date: session.date,
    theme: session.topic || session.theme,
    newSkillCards: cards.map((card) => card.name).filter(Boolean),
    oldRecall: session.topic || "",
    recallScore: session.recallScore,
    application: session.application,
    exposedIssue: session.exposedIssue,
    nextReview: review.prompt,
    nextReviewDate: review.dueDate,
    sourceTitle: session.sourceTitle,
    status: session.status || session.summary,
    kind: session.kind || "recall",
    sourceFormat: "canonical-v2"
  }] : [];
  return {
    sourceFormat: "canonical-v2",
    entries,
    skillCards: cards,
    imagePrompts: parsed.imagePrompt ? [parsed.imagePrompt] : [],
    recognizedFields: 9
  };
}

function adaptCanonicalV3(parsed) {
  const session = parsed.session && typeof parsed.session === "object" ? parsed.session : {};
  const review = session.nextReview && typeof session.nextReview === "object" ? session.nextReview : {};
  const topLevelEvents = arrayValue(firstValue(parsed, ["evidenceEvents", "evidence_events"]));
  const cards = arrayValue(parsed.cards).map((card) => {
    const cardReview = card.nextReview && typeof card.nextReview === "object" ? card.nextReview : {};
    const cardEvents = arrayValue(firstValue(card, ["levelEvents", "level_events", "evidenceEvents", "evidence_events"]));
    return {
      ...card,
      level: card.levelSuggestion || card.level || "L0",
      levelEvents: cardEvents.length ? cardEvents : topLevelEvents,
      nextReview: cardReview.prompt || card.nextReviewPrompt || "",
      nextReviewDate: cardReview.dueDate || card.nextReviewDate || "",
      sourceFormat: "canonical-v3"
    };
  });
  const entries = Object.keys(session).length ? [{
    date: session.date,
    kind: session.kind || "recall",
    theme: session.topic || session.theme,
    newSkillCards: cards.map((card) => card.name).filter(Boolean),
    oldRecall: session.topic || "",
    recallScore: session.recallScore,
    application: session.application,
    exposedIssue: session.exposedIssue,
    nextReview: review.prompt,
    nextReviewDate: review.dueDate,
    sourceTitle: session.sourceTitle,
    status: session.status || session.summary,
    sourceFormat: "canonical-v3"
  }] : [];
  return {
    sourceFormat: "canonical-v3",
    entries,
    skillCards: cards,
    imagePrompts: parsed.imagePrompt ? [parsed.imagePrompt] : [],
    recognizedFields: 12
  };
}

function detectSourceFormat(parsed) {
  if (Number(parsed.schemaVersion) === 3 && (parsed.session || parsed.cards)) return "canonical-v3";
  if (Number(parsed.schemaVersion) === 2 && (parsed.session || parsed.cards)) return "canonical-v2";
  if (parsed.newCard || parsed.new_card) return "compact-card-v1";
  if (parsed.skill_cards || parsed.ledger_entries || parsed.daily_ledger) return "snake-case-v1";
  if (parsed.skillCards || parsed.ledgerEntries) return "ledger-v1";
  return "unknown-json";
}

function buildImportReport(update, adapted) {
  const entry = update.entries[0];
  const card = update.skillCards[0];
  let confidence = 0;
  if (entry?.theme && !["未命名主题", "AI 能力圈学习"].includes(entry.theme)) confidence += 15;
  if (adapted.recognizedFields > 0 || (entry && entry.recallScore > 0)) confidence += 10;
  if (card?.name) confidence += 15;
  if (card?.oneLine) confidence += 15;
  if (card?.myCase) confidence += 10;
  if (card?.scenario) confidence += 10;
  if (card?.contentBlocks?.length || card?.threeSentence) confidence += 10;
  if (card?.sources?.length) confidence += 5;
  if (card?.levelEvents?.length) confidence += 5;
  if (entry?.exposedIssue) confidence += 8;
  if (entry?.nextReview || card?.nextReview) confidence += 7;

  const hasMeaningfulEntry = Boolean(entry && (
    (entry.theme && !["未命名主题", "AI 能力圈学习"].includes(entry.theme))
    || entry.application
    || entry.exposedIssue
    || entry.nextReview
    || entry.newSkillCards.length
  ));
  const hasMeaningfulCard = Boolean(card && (card.oneLine || card.myCase || card.scenario || card.contentBlocks.length));
  const valid = hasMeaningfulEntry || hasMeaningfulCard;
  const warnings = [];
  if (!valid) warnings.push("没有识别到可写入的主题、评分依据、技能卡或复习内容，已阻止空数据导入。");
  if (!update.skillCards.length) warnings.push("没有识别到技能卡，将不会更新卡组。");
  if (entry?.kind !== "capture" && !entry?.exposedIssue) warnings.push("没有识别到本次暴露的问题。");
  if (entry?.kind !== "capture" && !(entry?.nextReview || card?.nextReview)) warnings.push("没有识别到下一次复述题。");
  return {
    valid,
    confidence: Math.min(100, confidence),
    sourceFormat: adapted.sourceFormat,
    counts: {
      entries: update.entries.length,
      skillCards: update.skillCards.length,
      imagePrompts: update.imagePrompts.length,
      sources: update.skillCards.reduce((sum, item) => sum + item.sources.length, 0),
      evidence: update.skillCards.reduce((sum, item) => sum + item.levelEvents.length, 0)
    },
    warnings
  };
}

function mergeSkillCards(existing, incoming) {
  const byName = new Map();
  existing.map(normalizeSkillCard).filter(Boolean).forEach((card) => {
    byName.set(card.name, card);
  });
  incoming.map(normalizeSkillCard).filter(Boolean).forEach((card) => {
    const prior = byName.get(card.name);
    byName.set(card.name, prior ? normalizeSkillCard({
      ...prior,
      ...card,
      id: prior.id,
      oneLine: card.oneLine || prior.oneLine,
      threeSentence: card.threeSentence || prior.threeSentence,
      scenario: card.scenario || prior.scenario,
      myCase: card.myCase || prior.myCase,
      levelReason: card.levelReason || prior.levelReason,
      nextReview: card.nextReview || prior.nextReview,
      nextReviewDate: card.nextReviewDate || prior.nextReviewDate,
      createdAt: prior.createdAt,
      relatedModels: unique([...prior.relatedModels, ...card.relatedModels]),
      contentBlocks: mergeContentBlocks(prior.contentBlocks, card.contentBlocks),
      sources: mergeSources(prior.sources, card.sources),
      levelEvents: mergeLevelEvents(prior.levelEvents, card.levelEvents),
      reviewSchedule: prior.reviewSchedule,
      reviewLogs: prior.reviewLogs,
      sourceFormat: "canonical-v3",
      updatedAt: new Date().toISOString()
    }) : card);
  });
  return [...byName.values()];
}

function extractJson(text, fenceName) {
  const value = String(text || "").trim();
  const namedFence = new RegExp("```" + fenceName + "\\s*([\\s\\S]*?)```", "i");
  const namedMatch = value.match(namedFence);
  if (namedMatch) return namedMatch[1].trim();
  const jsonFence = value.match(/```json\s*([\s\S]*?)```/i);
  if (jsonFence) return jsonFence[1].trim();
  const genericFence = value.match(/```\s*([\s\S]*?)```/);
  if (genericFence && genericFence[1].trim().startsWith("{")) return genericFence[1].trim();
  if (value.startsWith("{")) return value;
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start >= 0 && end > start) return value.slice(start, end + 1);
  throw new Error(`没有找到 ${fenceName} 或 JSON 结构化区块。`);
}

function normalizeLevel(level) {
  const value = clean(level).toUpperCase();
  const match = value.match(/\bL[0-4]\b/);
  if (match) return match[0];
  return Object.hasOwn(LEVEL_LABELS, value) ? value : "L0";
}

function normalizeSessionKind(value) {
  const kind = clean(value).toLowerCase();
  return ["capture", "recall", "application", "transfer"].includes(kind) ? kind : "recall";
}

function normalizeSources(value) {
  return arrayValue(value).map((source) => {
    if (typeof source === "string") {
      return {
        id: makeId("source"),
        type: "manual",
        title: clean(source),
        url: "",
        excerpt: "",
        capturedAt: new Date().toISOString()
      };
    }
    if (!source || typeof source !== "object") return null;
    const title = clean(firstValue(source, ["title", "name", "sourceTitle", "source_title"]));
    const url = clean(firstValue(source, ["url", "href", "sourceUrl", "source_url"]));
    const excerpt = clean(firstValue(source, ["excerpt", "text", "content", "summary"]));
    if (!title && !url && !excerpt) return null;
    return {
      id: clean(source.id) || makeId("source"),
      type: normalizeSourceType(firstValue(source, ["type", "sourceType", "source_type"])),
      title: title || url || "未命名来源",
      url,
      excerpt,
      capturedAt: clean(firstValue(source, ["capturedAt", "captured_at", "createdAt", "created_at"])) || new Date().toISOString()
    };
  }).filter(Boolean);
}

function normalizeSourceType(value) {
  const type = clean(value).toLowerCase();
  return ["chat", "book", "article", "manual"].includes(type) ? type : "manual";
}

function normalizeLevelEvents(value) {
  return arrayValue(value).map((event) => {
    if (!event || typeof event !== "object") return null;
    const rawType = clean(firstValue(event, ["type", "evidenceType", "evidence_type"])).toLowerCase();
    if (rawType === "manual_override") return null;
    const type = normalizeEvidenceType(rawType);
    const targetLevel = normalizeLevel(firstValue(event, ["targetLevel", "target_level", "level"]));
    const summary = clean(firstValue(event, ["summary", "reason", "description"]));
    const userEvidence = cleanFlexible(firstValue(event, [
      "userEvidence",
      "user_evidence",
      "evidence",
      "userAnswer",
      "user_answer"
    ]));
    if (!summary && !userEvidence && type !== "capture" && type !== "legacy") return null;
    return {
      id: clean(event.id) || makeId("evidence"),
      type,
      targetLevel,
      summary,
      recallScore: clampOptionalScore(firstValue(event, ["recallScore", "recall_score", "score"])),
      userEvidence,
      sourceId: clean(firstValue(event, ["sourceId", "source_id"])),
      verified: event.verified !== false,
      createdAt: clean(firstValue(event, ["createdAt", "created_at", "date"])) || new Date().toISOString()
    };
  }).filter(Boolean);
}

function normalizeEvidenceType(value) {
  const type = clean(value).toLowerCase();
  return Object.hasOwn(EVIDENCE_TYPE_LABELS, type) ? type : "capture";
}

function makeLevelEvent(type, targetLevel, summary, userEvidence = "", recallScore = null) {
  return {
    id: makeId("evidence"),
    type,
    targetLevel: normalizeLevel(targetLevel),
    summary: clean(summary),
    recallScore,
    userEvidence: clean(userEvidence),
    sourceId: "",
    verified: true,
    createdAt: new Date().toISOString()
  };
}

function levelReasonFromEvidence(events, level) {
  return events
    .slice()
    .reverse()
    .find((event) => event.targetLevel === level && (event.summary || event.userEvidence))?.summary || "";
}

function levelNumber(level) {
  return Number(normalizeLevel(level).slice(1));
}

function deriveLevel(score, card) {
  const example = clean(firstValue(card || {}, ["myCase", "personalExample", "personal_example"]));
  if (score >= 3 && example) return "L3";
  if (score >= 2) return "L2";
  if (score >= 1) return "L1";
  return "L0";
}

function clampOptionalScore(value) {
  if (value === "" || value === null || value === undefined) return null;
  return clampScore(value);
}

function clampScore(value) {
  if (value && typeof value === "object") {
    const secondRound = Number(value.second_round ?? value.secondRound);
    if (Number.isFinite(secondRound)) return Math.min(3, Math.max(0, Math.round(secondRound)));
    const firstRound = Number(value.first_round ?? value.firstRound);
    if (Number.isFinite(firstRound)) return Math.min(3, Math.max(0, Math.round(firstRound)));
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(3, Math.max(0, Math.round(number)));
}

function normalizeContentBlocks(value) {
  if (!Array.isArray(value)) return [];
  return value.map((block, index) => {
    if (typeof block === "string") {
      return { id: `block-${index}`, type: "note", title: BLOCK_TITLES.note, text: clean(block), items: [] };
    }
    if (!block || typeof block !== "object") return null;
    const type = normalizeBlockType(block.type);
    const content = block.content;
    const text = clean(block.text || (Array.isArray(content) ? "" : content));
    const items = normalizeStringList(block.items || block.values || (Array.isArray(content) ? content : []));
    if (!text && !items.length) return null;
    return {
      id: clean(block.id) || `block-${index}`,
      type,
      title: clean(block.title) || BLOCK_TITLES[type] || BLOCK_TITLES.note,
      text,
      items
    };
  }).filter(Boolean);
}

function normalizeBlockType(value) {
  const type = clean(value).toLowerCase();
  const aliases = {
    training_context: "importance",
    reasoning_chain: "reasoning",
    key_distinctions: "distinction",
    coach_feedback: "feedback",
    triggers: "trigger",
    boundaries: "boundary",
    user_quotes: "source_quote",
    next_review: "open_question"
  };
  return aliases[type] || type || "note";
}

function buildDerivedBlocks(value) {
  const blocks = [];
  const richFields = [
    ["definition", ["definition", "coreUnderstanding", "core_understanding"]],
    ["importance", ["importance", "whyImportant", "why_important"]],
    ["core_question", ["coreQuestion", "core_question"]],
    ["reasoning", ["reasoning", "reasoningChain", "reasoning_chain", "logic"]],
    ["distinction", ["distinction", "keyDistinction", "key_distinction"]],
    ["first_recall", ["firstRecall", "first_recall"]],
    ["feedback", ["feedback", "coachFeedback", "coach_feedback"]],
    ["second_recall", ["secondRecall", "second_recall"]],
    ["progress", ["progress", "progressEvidence", "progress_evidence"]],
    ["source_quote", ["sourceQuote", "source_quote", "userQuote", "user_quote"]],
    ["application", ["application"]],
    ["open_question", ["openQuestion", "open_question"]]
  ];
  richFields.forEach(([type, keys]) => {
    const content = cleanFlexible(firstValue(value, keys));
    if (content) blocks.push(makeBlock(type, content));
  });
  const trigger = clean(firstValue(value, ["trigger"]));
  const methods = normalizeStringList(firstValue(value, ["method", "methods", "steps"]));
  const example = clean(firstValue(value, ["personalExample", "personal_example", "myCase", "my_case"]));
  const boundary = clean(firstValue(value, ["boundary", "limitations", "limitation"]));
  if (trigger) blocks.push(makeBlock("trigger", trigger));
  if (methods.length) blocks.push(makeBlock("method", "", methods));
  if (example) blocks.push(makeBlock("example", example));
  if (boundary) blocks.push(makeBlock("boundary", boundary));
  return blocks;
}

function makeBlock(type, text = "", items = []) {
  return {
    id: makeId("block"),
    type,
    title: BLOCK_TITLES[type] || BLOCK_TITLES.note,
    text,
    items
  };
}

function mergeContentBlocks(existing, incoming) {
  const values = [...(existing || []), ...(incoming || [])];
  const byContent = new Map();
  values.forEach((block) => {
    const key = `${block.type}:${block.text}:${block.items.join("|")}`;
    byContent.set(key, block);
  });
  return [...byContent.values()];
}

function mergeSources(existing, incoming) {
  const values = [...(existing || []), ...(incoming || [])];
  const byIdentity = new Map();
  values.forEach((source) => {
    const key = source.url || `${source.type}:${source.title}:${source.excerpt}`;
    byIdentity.set(key, source);
  });
  return [...byIdentity.values()];
}

function mergeLevelEvents(existing, incoming) {
  const values = [...(existing || []), ...(incoming || [])];
  const byIdentity = new Map();
  values.forEach((event) => {
    const key = event.id || `${event.type}:${event.targetLevel}:${event.userEvidence}:${event.createdAt}`;
    byIdentity.set(key, event);
  });
  return [...byIdentity.values()];
}

function countRecognizedFields(parsed, cards) {
  const keys = [
    "topic",
    "theme",
    "score",
    "recallScore",
    "recall_score",
    "exposedProblem",
    "exposedIssue",
    "nextReviewPrompt",
    "next_review_prompt"
  ];
  let count = keys.filter((key) => parsed[key] !== undefined && parsed[key] !== "").length;
  if (cards.length) count += 2;
  return count;
}

function normalizeNameList(value) {
  if (Array.isArray(value)) {
    return unique(value.map((item) => {
      if (item && typeof item === "object") return clean(firstValue(item, ["name", "title"]));
      return clean(item);
    }).filter(Boolean));
  }
  if (value && typeof value === "object") {
    const name = clean(firstValue(value, ["name", "title"]));
    return name ? [name] : [];
  }
  const text = clean(value);
  return text ? [text] : [];
}

function normalizeStringList(value) {
  if (Array.isArray(value)) return unique(value.map(clean).filter(Boolean));
  const text = clean(value);
  return text ? [text] : [];
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value && typeof value === "object" ? [value] : [];
}

function unique(values) {
  return [...new Set(values)];
}

function firstValue(source, keys) {
  if (!source || typeof source !== "object") return "";
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
  }
  return "";
}

function cleanFlexible(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean).join("、");
  return clean(value);
}

function looksLikeISODate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(clean(value));
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
