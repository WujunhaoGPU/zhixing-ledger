import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

async function main() {
  [
    "src/ability-ledger-extension/manifest.json",
    "src/ability-ledger-extension/background.js",
    "src/ability-ledger-extension/content/content.js",
    "src/ability-ledger-extension/sidepanel/sidepanel.html",
    "src/ability-ledger-extension/sidepanel/sidepanel.js",
    "src/ability-ledger-extension/sidepanel/sidepanel.css",
    "src/ability-ledger-extension/shared/ledgerModel.js",
    "src/ability-ledger-extension/shared/deepseek.js",
    "src/ability-ledger-extension/shared/knowledgeTree.js",
    "src/ability-ledger-extension/shared/prompts.js",
    "src/ability-ledger-extension/shared/reviewScheduler.js",
    "src/ability-ledger-extension/explore/explore.html",
    "src/ability-ledger-extension/explore/explore.js",
    "src/ability-ledger-extension/explore/explore.css",
    "src/ability-ledger-extension/vendor/cytoscape.esm.min.mjs",
    "src/ability-ledger-extension/vendor/cytoscape.LICENSE",
    "src/ability-ledger-extension/vendor/ts-fsrs.mjs",
    "src/ability-ledger-extension/vendor/ts-fsrs.LICENSE",
    "scripts/package-ability-ledger.mjs",
    "docs/product-specs/ability-ledger-extension.md",
    "docs/ability-ledger-quick-start.md"
  ].forEach((relativePath) => {
    assert(fs.existsSync(path.join(root, relativePath)), `Missing file: ${relativePath}`);
  });

  const manifest = readJson("src/ability-ledger-extension/manifest.json");
  const packageJson = readJson("package.json");
  assert(manifest.manifest_version === 3, "Ability ledger must use MV3.");
  assert(manifest.name.includes("知行簿"), "Manifest must name the independent product.");
  assert(manifest.permissions.includes("storage"), "Manifest must request storage.");
  assert(manifest.permissions.includes("sidePanel"), "Manifest must request sidePanel.");
  assert(manifest.host_permissions.includes("https://chatgpt.com/*"), "Manifest must target ChatGPT.");
  assert(manifest.host_permissions.includes("https://api.deepseek.com/*"), "Manifest must allow the official DeepSeek API.");
  assert(manifest.side_panel.default_path === "sidepanel/sidepanel.html", "Side panel path must be stable.");
  assert(manifest.name === "知行簿", "Chrome Side Panel should use the short product title.");
  assert(manifest.icons?.["16"] && manifest.icons?.["128"], "Chrome must receive branded Side Panel icons.");
  assert(manifest.action?.default_icon?.["16"], "Toolbar action must use the branded icon.");
  assert(manifest.version === "0.6.0", "Codex training release must use extension version 0.6.0.");
  assert(packageJson.scripts?.["package:ledger"] === "node scripts/package-ability-ledger.mjs", "Package command must remain available.");
  assert(packageJson.dependencies?.cytoscape, "The full-page tree must use the proven Cytoscape graph engine.");
  const backgroundSource = fs.readFileSync(path.join(root, "src/ability-ledger-extension/background.js"), "utf8");
  const sidepanelSource = fs.readFileSync(path.join(root, "src/ability-ledger-extension/sidepanel/sidepanel.js"), "utf8");
  const exploreSource = fs.readFileSync(path.join(root, "src/ability-ledger-extension/explore/explore.js"), "utf8");
  assert(backgroundSource.includes("chrome.action.setIcon"), "Toolbar icon must be refreshed when the extension starts.");
  assert(backgroundSource.includes("assets/brand/icon-128.png"), "Runtime toolbar icon must use the branded asset set.");
  assert(backgroundSource.includes("ABILITY_LEDGER_DEEPSEEK_IMAGE_PROMPT"), "Background must expose adaptive image-prompt generation.");
  assert(backgroundSource.includes("ABILITY_LEDGER_DEEPSEEK_REVIEW_FEEDBACK"), "Background must expose optional AI review feedback.");
  assert(backgroundSource.includes("ABILITY_LEDGER_DEEPSEEK_KNOWLEDGE_TREE"), "Background must expose adaptive knowledge-tree generation.");
  assert(backgroundSource.includes("ABILITY_LEDGER_OPEN_EXPLORE"), "Background must open the full exploration page.");
  assert(!sidepanelSource.includes("function renderLevelSelector"), "Card levels must not be manually adjustable.");
  assert(!exploreSource.includes("renderLevelSelector"), "The exploration page must not add manual mastery controls.");
  assert(exploreSource.includes("等级仍由对话证据决定"), "AI-node confirmation must not be confused with mastery progression.");
  assert(sidepanelSource.includes("function renderOnboarding"), "A first-run onboarding guide must be available.");
  assert(sidepanelSource.includes("ONBOARDING_VERSION_STORAGE_KEY"), "Onboarding completion must use separate local UI state.");
  assert(sidepanelSource.includes("打开新手指南"), "Settings must allow the guide to be reopened.");

  const modelUrl = pathToFileURL(path.join(root, "src/ability-ledger-extension/shared/ledgerModel.js"));
  const promptsUrl = pathToFileURL(path.join(root, "src/ability-ledger-extension/shared/prompts.js"));
  const deepseekUrl = pathToFileURL(path.join(root, "src/ability-ledger-extension/shared/deepseek.js"));
  const knowledgeTreeUrl = pathToFileURL(path.join(root, "src/ability-ledger-extension/shared/knowledgeTree.js"));
  const reviewSchedulerUrl = pathToFileURL(path.join(root, "src/ability-ledger-extension/shared/reviewScheduler.js"));
  const {
    analyzeLedgerUpdate,
    applyLedgerUpdate,
    buildMarkdownExport,
    createEmptyState,
    deriveLevelFromEvidence,
    normalizeSkillCard,
    normalizeState,
    parseLedgerUpdate,
    toCanonicalSettlement
  } = await import(modelUrl);
  const {
    buildImagePrompt,
    buildKnowledgeCapturePrompt,
    buildKnowledgeNodeLearningPrompt,
    buildRecallStartPrompt,
    buildSettlementPrompt
  } = await import(promptsUrl);
  const {
    buildDeepSeekImagePromptRequest,
    buildDeepSeekKnowledgeTreeRequest,
    buildDeepSeekReviewFeedbackRequest,
    buildDeepSeekRequest,
    parseDeepSeekImagePromptResponse,
    parseDeepSeekKnowledgeTreeResponse,
    parseDeepSeekReviewFeedbackResponse,
    parseDeepSeekResponse
  } = await import(deepseekUrl);
  const {
    MUNGER_TREE_ID,
    assertAcyclic,
    createMungerKnowledgeTree,
    evaluateKnowledgeTree,
    parseGeneratedKnowledgeTree,
    recommendKnowledgeNodes,
    setKnowledgeTreeNodeConfirmed
  } = await import(knowledgeTreeUrl);
  const {
    applyReviewRating,
    buildReviewPlan,
    normalizeReviewSchedule,
    reviewScoreFromRating
  } = await import(reviewSchedulerUrl);

  const emptyState = createEmptyState();
  const mungerTree = createMungerKnowledgeTree();
  assert(emptyState.knowledgeTrees.some((tree) => tree.id === MUNGER_TREE_ID), "New state must include the standard Munger learning map.");
  assert(mungerTree.nodes.length === 21, "The calibrated Munger map must expose a useful first set of 21 nodes.");
  assert(assertAcyclic(mungerTree), "The standard Munger map must remain acyclic.");
  const treeCards = [
    {
      id: "card-incentives",
      name: "激励机制",
      level: "L1",
      oneLine: "奖励和惩罚会塑造行为与判断。",
      reviewSchedule: { due: "2026-09-01T00:00:00.000Z" }
    },
    {
      id: "card-inversion",
      name: "反向思维：从失败路径反推行动",
      level: "L3",
      oneLine: "从失败路径反推行动。",
      reviewSchedule: { due: "2026-07-01T00:00:00.000Z" }
    }
  ];
  const treeEvaluation = evaluateKnowledgeTree(mungerTree, treeCards, new Date("2026-08-21T00:00:00.000Z"));
  assert(treeEvaluation.byId.get("inversion").status === "applied", "A matching L3 card must light the corresponding tree node.");
  assert(treeEvaluation.byId.get("inversion").due, "FSRS due state must appear as an independent tree overlay.");
  assert(treeEvaluation.byId.get("incentive-bias").status === "available", "Meeting a hard prerequisite must unlock the next node.");
  assert(treeEvaluation.byId.get("lollapalooza").status === "locked", "Unmet hard prerequisites must keep downstream nodes locked.");
  const recommendations = recommendKnowledgeNodes(mungerTree, treeCards, 3);
  assert(recommendations.length === 3 && recommendations.every((node) => node.status === "available"), "Recommendations must only select currently learnable nodes.");
  const nodePrompt = buildKnowledgeNodeLearningPrompt({
    tree: mungerTree,
    node: treeEvaluation.byId.get("incentive-bias"),
    prerequisiteCards: [treeCards[0]],
    linkedCards: []
  });
  assert(nodePrompt.includes("能力圈技能树学习教练"), "A tree node must start a bounded ChatGPT learning session.");
  assert(nodePrompt.includes("先用一个问题诊断") && nodePrompt.includes("15–30秒主动复述"), "Node learning must begin with diagnosis and require active recall.");
  assert(nodePrompt.includes('cards[0].name 必须保持为“激励引发的偏见”'), "The settlement must preserve the selected node identity.");
  assert(nodePrompt.includes("schemaVersion 必须为3") && nodePrompt.includes("userEvidence"), "Node learning must close through the existing evidence-based V3 settlement.");
  const treeRequest = buildDeepSeekKnowledgeTreeRequest({
    basis: "共同主题",
    cards: treeCards
  });
  assert(treeRequest.response_format.type === "json_object", "Knowledge-tree generation must request structured JSON.");
  assert(treeRequest.messages.some((message) => message.content.includes("5–12个节点") && message.content.includes("DAG")), "DeepSeek must receive the small-tree and acyclic constraints.");
  assert(treeRequest.messages.some((message) => message.content.includes("不得虚构用户已经学过")), "DeepSeek must not invent mastery evidence.");
  const parsedTreeResponse = parseDeepSeekKnowledgeTreeResponse({
    choices: [{ message: { content: JSON.stringify({
      id: "decision-mini-tree",
      title: "决策模型小树",
      nodes: [
        { id: "inversion", title: "反向思维：从失败路径反推行动", branch: "基础" },
        { id: "margin", title: "安全边际", branch: "进阶" },
        { id: "checklist", title: "决策检查表", branch: "应用" }
      ],
      edges: [
        { source: "inversion", target: "margin", type: "recommended" },
        { source: "margin", target: "checklist", type: "requires", requiredLevel: "L1" }
      ]
    }) } }]
  });
  const generatedTree = parseGeneratedKnowledgeTree(parsedTreeResponse, [treeCards[1]]);
  assert(generatedTree.nodes.find((node) => node.id === "inversion")?.provenance === "existing-card", "Selected cards must remain real linked nodes in generated maps.");
  assert(generatedTree.nodes.find((node) => node.id === "margin")?.confirmed === false, "AI-added nodes must start as unconfirmed candidates.");
  const candidateEvaluation = evaluateKnowledgeTree(generatedTree, treeCards);
  assert(candidateEvaluation.byId.get("margin").status === "candidate", "Unconfirmed AI suggestions must not count as learned or recommended knowledge.");
  const confirmedTree = setKnowledgeTreeNodeConfirmed(generatedTree, "margin", true);
  assert(evaluateKnowledgeTree(confirmedTree, treeCards).byId.get("margin").status === "available", "User confirmation may admit an AI suggestion without changing mastery level.");
  assert(treeCards[1].level === "L3", "Tree confirmation must not mutate card mastery evidence.");

  const startPrompt = buildRecallStartPrompt({
    skillCards: [{
      name: "能力圈",
      level: "L2",
      oneLine: "能力圈是已验证经验范围。",
      threeSentence: "知道不等于会用。能力需要真实任务和反馈验证。验证后才能进入能力圈。",
      scenario: "面试准备",
      myCase: "通过模拟面试检查自己是否真的能讲清项目。",
      relatedModels: ["反馈循环"],
      contentBlocks: [
        {
          type: "feedback",
          title: "教练反馈",
          text: "已经能解释定义，但案例还没有说明采取了什么行动。",
          items: []
        },
        {
          type: "progress",
          title: "进步证据",
          text: "第二次复述补上了模拟面试和复盘反馈。",
          items: []
        }
      ],
      nextReview: "30 秒解释能力圈"
    }],
    entries: [{
      date: "2026-07-28",
      theme: "能力圈可见化",
      recallScore: 2,
      newSkillCards: ["能力圈"],
      exposedIssue: "懂了但说不出口",
      nextReview: "解释能力圈为什么不是限制自己"
    }]
  });
  assert(startPrompt.includes("AI 能力圈每日复述教练"), "Start prompt must enter recall-coach mode.");
  assert(startPrompt.includes("先让我输出"), "Start prompt must require output before explanation.");
  assert(startPrompt.includes("30 秒复述题"), "Start prompt must ask for a 30-second recall challenge.");
  assert(startPrompt.includes("二次复述"), "Start prompt must require a second recall attempt.");
  assert(startPrompt.includes("能力圈") && startPrompt.includes("懂了但说不出口"), "Start prompt must include available card and ledger material.");
  assert(startPrompt.includes("教练反馈：已经能解释定义") && startPrompt.includes("进步证据：第二次复述补上了"), "Single-card recall must reuse accumulated context blocks.");
  assert(startPrompt.includes("不要把整段学习过程压缩成一句话"), "Start prompt must require rich settlement context.");
  assert(startPrompt.includes("当前是 L2 可以复述"), "Single-card recall must adapt the exercise to the current mastery stage.");
  assert(startPrompt.includes('cards[0].name 必须保持为“能力圈”'), "Single-card review must keep the existing card identity.");
  assert(startPrompt.includes('imagePrompt 使用对象格式'), "Review settlement must request a parseable image prompt object.");
  assert(startPrompt.includes("contentBlocks 使用 type、title、text、items"), "Review settlement must keep a stable outer schema while allowing flexible coaching.");

  const capturePrompt = buildKnowledgeCapturePrompt("来源：心理误判偏差解析");
  assert(capturePrompt.includes("\"kind\": \"capture\""), "Capture prompt must create a capture session.");
  assert(capturePrompt.includes("\"schemaVersion\": 3"), "Capture prompt must use Canonical V3.");
  assert(capturePrompt.includes("能力等级就必须保持 L0"), "Capture prompt must not infer mastery from rich AI content.");
  assert(capturePrompt.includes("不能仅凭你的讲解替我升级") || capturePrompt.includes("不属于 userEvidence"), "Capture prompt must separate source knowledge from user evidence.");

  const prompt = buildSettlementPrompt("能力圈对话线索");
  assert(prompt.includes("knowledge_ledger_update"), "Settlement prompt must require the structured protocol.");
  assert(prompt.includes("recallScore"), "Settlement prompt must include recall scoring.");
  assert(prompt.includes("imagePrompt"), "Settlement prompt must request an image prompt.");
  assert(prompt.includes("压缩重复，不压缩推理和学习证据"), "Settlement prompt must preserve reasoning and learning evidence.");
  assert(prompt.includes("first_recall") && prompt.includes("second_recall") && prompt.includes("progress"), "Settlement prompt must describe the rich learning-evidence block types.");
  assert(prompt.includes("建议保留 6-12 个有实质内容的 contentBlocks"), "Settlement prompt must explicitly resist over-compression.");
  const deepseekRequest = buildDeepSeekRequest("主题：能力圈；评分：3。", "deepseek-v4-flash");
  assert(deepseekRequest.model === "deepseek-v4-flash", "DeepSeek extraction should use the current flash model by default.");
  assert(deepseekRequest.thinking.type === "disabled", "Simple extraction should disable thinking mode.");
  assert(deepseekRequest.response_format.type === "json_object", "DeepSeek extraction should request JSON Output.");
  assert(deepseekRequest.messages.some((message) => message.content.includes("schemaVersion")), "DeepSeek must receive the canonical schema.");
  assert(deepseekRequest.max_tokens >= 6000, "DeepSeek extraction must have enough output budget for rich cards.");
  assert(deepseekRequest.messages.some((message) => message.content.includes("第一次复述") && message.content.includes("进步证据")), "DeepSeek extraction must preserve recall history and progress evidence.");
  assert(deepseekRequest.messages.some((message) => message.content.includes("\"schemaVersion\": 3")), "DeepSeek extraction must emit Canonical V3.");
  assert(deepseekRequest.messages.some((message) => message.content.includes("不能仅凭内容丰富程度提升能力等级")), "DeepSeek extraction must separate card richness from mastery.");
  const deepseekParsed = parseDeepSeekResponse({
    choices: [{ message: { content: "{\"schemaVersion\":2,\"session\":{\"topic\":\"能力圈\"},\"cards\":[]}" } }]
  });
  assert(deepseekParsed.session.topic === "能力圈", "DeepSeek response parser should return structured JSON.");
  const adaptiveImageRequest = buildDeepSeekImagePromptRequest("标题：反向思维\n行动方法：失败路径 -> 反向检查项 -> 具体行动");
  assert(adaptiveImageRequest.response_format.type === "text", "Adaptive image prompt generation must request text, not JSON.");
  assert(adaptiveImageRequest.messages.some((message) => message.content.includes("流程图、因果图、对照图、边界图")), "DeepSeek must choose a diagram from the current knowledge structure.");
  assert(adaptiveImageRequest.messages.some((message) => message.content.includes("不套用固定三栏")), "DeepSeek must reject fixed ledger layouts.");
  const adaptiveImagePrompt = parseDeepSeekImagePromptResponse({
    choices: [{
      message: {
        content: "```text\n请生成一张横向 16:9 的反向思维手写知识图，使用白底、黑色墨水和少量蓝绿色标注。以失败路径到反向检查项再到具体行动为主流程，左侧列出高概率失败条件，中间展示反向转换，右侧落到面试准备行动。补充一个简短边界说明：它擅长减少明显错误，但不能单独提供最优方向。只使用输入中的知识内容，不添加新的案例或结论，不画台账、等级、评分或复述流程，保证文字清晰并留足边距。\n```"
      }
    }]
  });
  assert(adaptiveImagePrompt.startsWith("请生成一张横向 16:9"), "DeepSeek image prompt parser must strip optional code fences.");
  assert(!adaptiveImagePrompt.includes("```"), "DeepSeek image prompt parser must return plain text.");
  const reviewFeedbackRequest = buildDeepSeekReviewFeedbackRequest({
    cardName: "反向思维",
    level: "L3",
    question: "如何把失败路径转成行动？",
    answer: "先想最可能失败的地方。",
    reference: "列出失败路径，再反向改写成检查项和具体行动。"
  });
  assert(reviewFeedbackRequest.response_format.type === "json_object", "Review feedback must request a JSON object.");
  assert(reviewFeedbackRequest.messages.some((message) => message.content.includes("gap 只能有一个")), "Review feedback must focus on one correction.");
  assert(reviewFeedbackRequest.messages.some((message) => message.content.includes("先想最可能失败的地方")), "Review feedback must include the user's first answer.");
  const reviewFeedback = parseDeepSeekReviewFeedbackResponse({
    choices: [{
      message: {
        content: JSON.stringify({
          strength: "识别了失败路径",
          gap: "没有反向改写为行动",
          correction: "把每条失败路径改写成检查项。",
          retryQuestion: "请选择一条失败路径，把它改写成具体行动。"
        })
      }
    }]
  });
  assert(reviewFeedback.gap === "没有反向改写为行动", "Review feedback parser must preserve the single gap.");
  assert(reviewFeedback.retryQuestion.includes("具体行动"), "Review feedback parser must preserve the targeted retry question.");

  const migratedV2 = normalizeState({
    schemaVersion: 2,
    entries: [],
    skillCards: [{
      name: "旧版能力圈",
      oneLine: "旧版卡片",
      level: "L3"
    }]
  });
  assert(migratedV2.schemaVersion === 3, "V2 state must migrate to schema V3.");
  assert(migratedV2.skillCards[0].level === "L3", "V2 migration must preserve the existing mastery level.");
  assert(migratedV2.skillCards[0].levelEvents.some((event) => event.type === "legacy" && event.targetLevel === "L3"), "V2 migration must explain the preserved level with legacy evidence.");
  assert(migratedV2.skillCards[0].reviewSchedule?.due, "Legacy cards must receive an FSRS-compatible review schedule.");
  assert(Array.isArray(migratedV2.skillCards[0].reviewLogs), "Legacy cards must receive an empty review history.");
  const reviewBase = normalizeReviewSchedule(null, new Date("2026-07-30T09:00:00+08:00"));
  const scheduled = applyReviewRating(reviewBase, "good", new Date("2026-07-30T09:00:00+08:00"));
  assert(scheduled.schedule.reps === 1, "A completed FSRS review must increment repetitions.");
  assert(new Date(scheduled.schedule.due) > new Date("2026-07-30T09:00:00+08:00"), "A successful review must schedule a future due time.");
  assert(reviewScoreFromRating("good") === 2 && reviewScoreFromRating("again") === 0, "Review difficulty must map to the existing 0-3 recall score.");
  const dueCards = [
    normalizeSkillCard({ id: "review-1", name: "能力圈", level: "L2", nextReviewDate: "2026-07-29" }),
    normalizeSkillCard({ id: "capture-1", name: "心理误判", level: "L0", nextReviewDate: "2026-07-29" }),
    normalizeSkillCard({ id: "capture-2", name: "激励机制", level: "L0", nextReviewDate: "2026-07-29" }),
    normalizeSkillCard({ id: "review-2", name: "反向思维", level: "L3", nextReviewDate: "2026-07-29" })
  ];
  const reviewPlan = buildReviewPlan(dueCards, new Date("2026-07-30T09:00:00+08:00"), 3);
  assert(reviewPlan.queue.length === 3, "The daily review queue must remain bounded.");
  assert(reviewPlan.queue.filter((card) => card.level === "L0").length === 1, "The daily queue must include at most one new L0 card.");
  assert(reviewPlan.queue[0].level !== "L0", "Due review cards must be prioritized before new learning cards.");

  const capturedKnowledge = analyzeLedgerUpdate(`\`\`\`knowledge_ledger_update
{
  "schemaVersion": 3,
  "session": {
    "date": "2026-07-29",
    "kind": "capture",
    "topic": "心理误判偏差",
    "recallScore": 0,
    "status": "已收录，等待理解验证",
    "sourceTitle": "心理误判偏差解析"
  },
  "cards": [{
    "name": "心理误判偏差",
    "oneLine": "人在特定情境下会稳定地朝某个方向判断错误。",
    "threeSentence": "偏差不是随机粗心，而是有方向的系统误差。大脑会先产生倾向，再寻找理由。多个偏差还可能相互强化。",
    "levelSuggestion": "L4",
    "levelReason": "内容非常丰富",
    "contentBlocks": [
      {"type": "definition", "title": "核心理解", "text": "心理偏差是稳定、有方向的系统误差。"},
      {"type": "reasoning", "title": "推理链", "items": ["触发情境", "自动倾向", "合理化", "行为强化"]}
    ],
    "sources": [{
      "type": "chat",
      "title": "心理误判偏差解析",
      "url": "",
      "excerpt": "先产生倾向，再寻找理由。"
    }],
    "levelEvents": [{
      "type": "capture",
      "targetLevel": "L0",
      "summary": "已收录知识内容，等待用户输出验证。",
      "userEvidence": ""
    }]
  }],
  "imagePrompt": null
}
\`\`\``);
  assert(capturedKnowledge.report.valid, "A capture-only V3 payload must be importable.");
  assert(capturedKnowledge.update.entries[0].kind === "capture", "Capture sessions must preserve their lifecycle kind.");
  assert(capturedKnowledge.update.skillCards[0].level === "L0", "Rich AI content must remain L0 without user evidence.");
  assert(capturedKnowledge.update.skillCards[0].sources.length === 1, "Capture cards must preserve their source.");
  assert(capturedKnowledge.update.skillCards[0].levelEvents[0].type === "capture", "Capture cards must preserve capture evidence.");

  let lifecycleState = applyLedgerUpdate(createEmptyState(), capturedKnowledge.update);
  const addEvidence = (type, targetLevel, userEvidence, recallScore = null) => {
    lifecycleState = applyLedgerUpdate(lifecycleState, {
      entries: [],
      imagePrompts: [],
      skillCards: [normalizeSkillCard({
        name: "心理误判偏差",
        sourceFormat: "canonical-v3",
        levelEvents: [{
          type,
          targetLevel,
          summary: `${type} evidence`,
          recallScore,
          userEvidence,
          createdAt: new Date().toISOString()
        }]
      })]
    });
    return lifecycleState.skillCards.find((card) => card.name === "心理误判偏差");
  };
  assert(addEvidence("understanding", "L1", "它不是偶尔想错，而是稳定朝某个方向判断错误。").level === "L1", "A user-owned one-line explanation must unlock L1.");
  assert(addEvidence("recall", "L2", "我只能说出几个关键词。", 1).level === "L1", "A score-1 recall must not unlock L2.");
  assert(addEvidence("recall", "L2", "我能独立说明定义、机制和为什么重要。", 2).level === "L2", "A score-2 independent recall must unlock L2.");
  assert(addEvidence("application", "L3", "判断研究院趋势时，我会检查自己的离职倾向是否放大了负面证据。").level === "L3", "A personal scenario and action must unlock L3.");
  assert(addEvidence("transfer", "L4", "").level === "L3", "Transfer without user evidence must not unlock L4.");
  assert(addEvidence("transfer", "L4", "在采购新工具时，我会反向改变激励，推演销售和使用者会如何重新解释风险。").level === "L4", "A new-scenario inference must unlock L4.");
  assert(deriveLevelFromEvidence(lifecycleState.skillCards[0].levelEvents) === "L4", "Mastery must be derived from accumulated evidence.");
  assert(deriveLevelFromEvidence([
    ...lifecycleState.skillCards[0].levelEvents,
    {
      type: "manual_override",
      targetLevel: "L2",
      summary: "用户发现原迁移证据不充分，手动回退。",
      userEvidence: "手动确认"
    }
  ]) === "L4", "Manual override events must be ignored so only learning evidence can change mastery.");
  const manualOnlyCard = normalizeSkillCard({
    name: "手动等级测试",
    sourceFormat: "canonical-v3",
    contentBlocks: [{ type: "definition", title: "定义", text: "只有内容，没有用户输出证据。" }],
    levelEvents: [{
      type: "manual_override",
      targetLevel: "L4",
      summary: "旧版手动调整。",
      userEvidence: "手动确认"
    }]
  });
  assert(manualOnlyCard.level === "L0", "A card backed only by manual adjustment must return to L0.");
  assert(!manualOnlyCard.levelEvents.some((event) => event.type === "manual_override"), "Legacy manual adjustment evidence must be removed during normalization.");

  const parsed = parseLedgerUpdate(`before
\`\`\`knowledge_ledger_update
{
  "date": "2026-07-28",
  "theme": "能力圈可见化",
  "ledgerEntries": [
    {
      "theme": "能力圈可见化",
      "newSkillCards": ["知行簿"],
      "oldRecall": "能力圈",
      "recallScore": 3,
      "application": "面试表达",
      "exposedIssue": "说不出已有 AI 实践",
      "nextReview": "30 秒解释台账为什么有用"
    }
  ],
  "skillCards": [
    {
      "name": "知行簿",
      "oneLine": "把 AI 对话结算成可见成长记录。",
      "threeSentence": "AI 对话是原材料。台账让每日动作可见。评分让复述能力可追踪。",
      "scenario": "每日学习结算",
      "myCase": "聊完能力圈后生成技能卡",
      "relatedModels": ["能力圈", "反馈循环"],
      "level": "L3",
      "nextReview": "用一个面试例子解释"
    }
  ],
  "imagePrompt": {
    "title": "知行簿图",
    "prompt": "画出 AI 对话到技能卡的流程"
  }
}
\`\`\``);
  assert(parsed.entries[0].recallScore === 3, "Parser must preserve recall score.");
  assert(parsed.skillCards[0].level === "L3", "Parser must preserve card level.");
  const snakeCaseParsed = parseLedgerUpdate(`\`\`\`knowledge_ledger_update
{
  "date": "2026-07-29",
  "theme": "AI 能力圈学习",
  "ledgerEntries": [
    {
      "today_theme": "AI 能力圈学习",
      "new_skill_cards": ["AI 能力圈学习"],
      "recitation_score": {
        "first_round": 2,
        "second_round": 3,
        "rubric": "3分：能举自己的例子，并能应用到现实问题"
      },
      "application_scenario": "面试准备",
      "exposed_issue": "容易把看过视频误当成真实面试经验",
      "next_review_prompt": "请用30秒解释：能力圈为什么能帮助我避免把时间花在错误的面试准备方向上？"
    }
  ],
  "skillCards": [
    {
      "name": "AI 能力圈学习",
      "one_sentence": "能力圈不是我知道什么，而是我经过实践和反馈后，真的能在现实里用出来什么。",
      "core_understanding": "能力圈的关键不是了解，而是经过第一手实践、外部反馈和真实调用验证后的经验范围。",
      "use_scenarios": ["面试准备", "项目表达", "学习路线判断", "AI能力成长"],
      "personal_example": "看过很多面试技巧视频只能说明了解面试套路，只有经过模拟面试、真实面试和复盘反馈，面试技巧才算进入能力圈。",
      "related_models": ["反向思考", "机会成本", "安全边际", "复述反馈系统"],
      "current_level": "L3: 能举自己的例子，并应用到面试准备"
    }
  ]
}
\`\`\``);
  assert(snakeCaseParsed.entries[0].recallScore === 3, "Parser should use second-round recitation score from snake_case payloads.");
  assert(snakeCaseParsed.entries[0].nextReview.includes("30秒解释"), "Parser should preserve snake_case next review prompts.");
  assert(snakeCaseParsed.skillCards[0].oneLine.includes("真的能在现实里用出来"), "Parser should map one_sentence into oneLine.");
  assert(snakeCaseParsed.skillCards[0].scenario.includes("面试准备") && snakeCaseParsed.skillCards[0].scenario.includes("AI能力成长"), "Parser should map array use_scenarios into scenario text.");
  assert(snakeCaseParsed.skillCards[0].relatedModels.includes("安全边际"), "Parser should map related_models.");
  assert(snakeCaseParsed.skillCards[0].level === "L3", "Parser should extract L3 from current_level text.");
  const actualChatGptResult = analyzeLedgerUpdate(`\`\`\`knowledge_ledger_update
{
  "date": "2026-07-29",
  "category": "AI 能力圈学习",
  "topic": "反向思维",
  "score": 3,
  "status": "完成二次复述",
  "newCard": {
    "title": "反向思维：从失败路径反推行动",
    "oneSentence": "先找出最可能把事情搞砸的路径，再把这些失败条件反过来变成检查项和具体行动。",
    "trigger": "面对面试、项目或重要决策，不知道该如何开始准备时。",
    "method": [
      "先问：怎样做最容易失败？",
      "列出主要失败路径。",
      "把每条失败路径反向改写成检查项和行动。"
    ],
    "personalExample": "准备面试时，先识别不模拟面试、不熟悉项目深度、不清楚技术细节等失败路径，再安排模拟面试、深挖项目和梳理技术详情。",
    "boundary": "反向思维擅长减少明显错误，但不能单独告诉我最优方向。"
  },
  "exposedProblem": "表达时容易把高概率失败说成绝对失败，需要注意措辞的准确性。",
  "nextReview": "2026-08-01",
  "nextReviewPrompt": "不用看技能卡，用 30 秒说明反向思维是什么、如何转化为行动，以及它有什么局限。"
}
\`\`\``);
  assert(actualChatGptResult.report.valid, "The current ChatGPT settlement shape must be importable.");
  assert(actualChatGptResult.report.confidence >= 70, "The current ChatGPT settlement should have high local confidence.");
  assert(actualChatGptResult.update.entries[0].theme === "反向思维", "topic should map to the ledger theme.");
  assert(actualChatGptResult.update.entries[0].recallScore === 3, "score should map to recallScore.");
  assert(actualChatGptResult.update.entries[0].exposedIssue.includes("高概率失败"), "exposedProblem should map to exposedIssue.");
  assert(actualChatGptResult.update.entries[0].nextReviewDate === "2026-08-01", "Review dates should not be mistaken for prompts.");
  assert(actualChatGptResult.update.entries[0].nextReview.includes("30 秒说明"), "nextReviewPrompt should remain the recall question.");
  assert(actualChatGptResult.update.skillCards[0].name.includes("反向思维"), "newCard should create a real skill card.");
  assert(actualChatGptResult.update.skillCards[0].level === "L3", "A score-3 card with a personal example should suggest L3.");
  assert(actualChatGptResult.update.skillCards[0].contentBlocks.some((block) => block.type === "method"), "Flexible method content should be preserved as a block.");
  assert(actualChatGptResult.update.skillCards[0].contentBlocks.some((block) => block.type === "boundary"), "Flexible boundary content should be preserved as a block.");
  const richSettlement = analyzeLedgerUpdate(`\`\`\`knowledge_ledger_update
{
  "schemaVersion": 2,
  "session": {
    "date": "2026-07-29",
    "topic": "反向思维",
    "recallScore": 3,
    "status": "完成二次复述",
    "application": "面试准备",
    "exposedIssue": "容易把高概率失败说成绝对失败",
    "nextReview": {
      "dueDate": "2026-08-01",
      "prompt": "用30秒说明反向思维如何从失败路径转成行动"
    },
    "sourceTitle": "反向思维复述训练"
  },
  "cards": [
    {
      "name": "反向思维：从失败路径反推行动",
      "oneLine": "先找出高概率失败路径，再把这些条件反向改写成检查项和行动。",
      "threeSentence": "反向思维先问怎样最容易失败。再列出主要失败条件，并反向变成检查项。它擅长减少明显错误，但不单独提供最优方向。",
      "scenario": "面试、项目和重要决策准备",
      "myCase": "准备面试时，识别不模拟面试、不熟悉项目深度和不清楚技术细节等风险，再安排模拟面试、深挖项目和梳理技术细节。",
      "relatedModels": ["能力圈", "机会成本", "安全边际"],
      "levelSuggestion": "L3",
      "levelReason": "能够给出自己的面试案例，并把模型转成具体行动。",
      "nextReview": {
        "dueDate": "2026-08-01",
        "prompt": "不用看卡片，解释失败条件到反向行动的完整链条。"
      },
      "contentBlocks": [
        {
          "type": "importance",
          "title": "为什么重要",
          "text": "面对不确定任务时，先识别高概率失败路径，可以减少把时间投入错误准备方向的风险。",
          "items": []
        },
        {
          "type": "core_question",
          "title": "核心问题",
          "text": "怎样做最容易失败，以及怎样把这些失败条件提前变成检查项？",
          "items": []
        },
        {
          "type": "reasoning",
          "title": "推理链",
          "text": "",
          "items": ["失败条件", "反向检查项", "提前采取行动"]
        },
        {
          "type": "method",
          "title": "行动方法",
          "text": "",
          "items": ["列出高概率失败路径", "把每条路径改写为检查项", "为检查项安排具体行动"]
        },
        {
          "type": "distinction",
          "title": "关键区分",
          "text": "不是做了某件事就绝对失败，而是这些行为会明显提高失败概率。",
          "items": []
        },
        {
          "type": "boundary",
          "title": "适用边界",
          "text": "反向思维帮助减少明显错误，但不能单独告诉我最优方向。",
          "items": []
        },
        {
          "type": "first_recall",
          "title": "第一次复述",
          "text": "先想怎么把事情做砸，再避开这些路径；面试时不要不做公司研究、项目准备和技术梳理。",
          "items": []
        },
        {
          "type": "feedback",
          "title": "教练反馈",
          "text": "抓住了反向思维和边界，但案例停在列举失败行为，没有完成失败条件到具体行动的转换。",
          "items": []
        },
        {
          "type": "second_recall",
          "title": "第二次复述",
          "text": "识别不模拟面试、不熟悉项目深度等风险后，要安排模拟面试、深挖项目并梳理技术细节。",
          "items": []
        },
        {
          "type": "progress",
          "title": "进步证据",
          "text": "从只会列举错误路径，推进到了错误路径、反向检查项和具体行动的完整链条。",
          "items": []
        },
        {
          "type": "source_quote",
          "title": "我的原话",
          "text": "先找出最容易失败的地方，然后再把它转化成具体行动。",
          "items": []
        }
      ]
    }
  ],
  "imagePrompt": null
}
\`\`\``);
  assert(richSettlement.report.valid, "Rich Canonical V2 input must remain importable after the V3 upgrade.");
  assert(richSettlement.update.skillCards[0].contentBlocks.length === 11, "Rich settlement must preserve every context block.");
  assert(richSettlement.update.skillCards[0].contentBlocks.some((block) => block.type === "first_recall" && block.text.includes("公司研究")), "First recall evidence must survive normalization.");
  assert(richSettlement.update.skillCards[0].contentBlocks.some((block) => block.type === "feedback" && block.text.includes("具体行动")), "Coach feedback must survive normalization.");
  assert(richSettlement.update.skillCards[0].contentBlocks.some((block) => block.type === "progress" && block.text.includes("完整链条")), "Progress evidence must survive normalization.");
  const richCanonical = toCanonicalSettlement(richSettlement.update, richSettlement.report);
  assert(richCanonical.schemaVersion === 3, "Canonical export must upgrade settlements to V3.");
  assert(richCanonical.cards[0].contentBlocks.length === 11, "Canonical export must retain rich card context.");
  assert(Array.isArray(richCanonical.cards[0].levelEvents), "Canonical V3 export must include mastery evidence.");
  const richState = applyLedgerUpdate(createEmptyState(), richSettlement.update);
  const richMarkdown = buildMarkdownExport(richState);
  assert(richMarkdown.includes("第一次复述") && richMarkdown.includes("教练反馈") && richMarkdown.includes("进步证据"), "Markdown export must include learning-process context.");
  const richRecallPrompt = buildRecallStartPrompt({
    skillCards: [richState.skillCards[0]],
    entries: richState.entries
  });
  assert(richRecallPrompt.includes("失败条件；反向检查项；提前采取行动"), "Future recall must include the saved reasoning chain.");
  assert(richRecallPrompt.includes("从只会列举错误路径"), "Future recall must include saved progress evidence.");
  const chatGptReviewResult = analyzeLedgerUpdate({
    schemaVersion: 3,
    session: {
      date: "2026-07-30",
      kind: "transfer",
      topic: "能力圈与安全边际",
      recallScore: 3,
      status: "已完成跨领域迁移验证",
      summary: "从 AI 项目迁移到线下活动。"
    },
    cards: [{
      name: "能力圈",
      level: "L4",
      contentBlocks: [
        {
          type: "coach_feedback",
          title: "关键反馈",
          content: [
            "第一次复述把能构思直接当成能力圈证据。",
            "需要补充真实执行、反馈和稳定复现。"
          ]
        },
        {
          type: "reasoning_chain",
          title: "推理链",
          content: ["拆分任务", "检查实践证据", "为剩余误差保留余量"]
        },
        {
          type: "boundaries",
          title: "适用边界",
          content: ["安全边际不能替代基本能力。"]
        }
      ],
      levelEvents: [{
        type: "transfer",
        targetLevel: "L4",
        score: 3,
        userEvidence: "在线下活动中，我会区分已验证任务，并为餐食和座位预留余量。"
      }]
    }],
    imagePrompt: "横向16:9手写白板知识图，画出能力圈与安全边际的区别。"
  });
  const chatGptReviewCard = chatGptReviewResult.update.skillCards[0];
  assert(chatGptReviewCard.contentBlocks.find((block) => block.type === "feedback")?.items.length === 2, "ChatGPT content arrays must remain structured items.");
  assert(chatGptReviewCard.contentBlocks.some((block) => block.type === "reasoning"), "ChatGPT reasoning_chain must map to the canonical reasoning type.");
  assert(chatGptReviewCard.contentBlocks.some((block) => block.type === "boundary"), "ChatGPT plural boundary aliases must remain usable by the map builder.");
  assert(chatGptReviewResult.update.imagePrompts[0]?.prompt.includes("能力圈与安全边际"), "A string imagePrompt from ChatGPT must survive import.");
  assert(chatGptReviewCard.level === "L4", "Verified transfer evidence from ChatGPT settlement must preserve L4.");
  const emptyResult = analyzeLedgerUpdate("{}");
  assert(!emptyResult.report.valid, "Empty JSON must be rejected instead of silently creating a blank ledger entry.");
  const next = applyLedgerUpdate(createEmptyState(), parsed);
  assert(next.entries.length === 1 && next.skillCards.length === 1, "Update must append entries and cards.");
  const imagePrompt = buildImagePrompt(richState.skillCards[0]);
  assert(imagePrompt.includes("Apple 无边记") && imagePrompt.includes("知识点的解释图"), "Image prompt must target Freeform-style concept-card use.");
  assert(imagePrompt.includes("失败条件；反向检查项；提前采取行动"), "Image prompt must derive its diagram from the current concept reasoning.");
  assert(imagePrompt.includes("按内容关系自适应布局，不强制三栏"), "Image prompt must allow content-driven layouts.");
  assert(!imagePrompt.includes("当前知识点进入能力圈"), "Image prompt must not force the generic capability-circle diagram.");
  assert(!imagePrompt.includes("记录到每日台账"), "Image prompt must not force a ledger anchor.");
  assert(!imagePrompt.includes("熟练度：L3"), "Image prompt must not render mastery metadata by default.");

  console.log("Ability ledger validation passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
