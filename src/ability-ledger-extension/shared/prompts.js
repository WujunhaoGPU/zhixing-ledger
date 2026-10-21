import { todayISO } from "./ledgerModel.js";

export function buildRecallStartPrompt(context = {}) {
  const cards = Array.isArray(context.skillCards) ? context.skillCards.slice(0, 12) : [];
  const entries = Array.isArray(context.entries) ? context.entries.slice(0, 8) : [];
  const material = buildRecallMaterial(cards, entries);
  const targetCardName = cards.length === 1 ? cards[0].name : "";
  const stageGuidance = cards.length === 1
    ? buildStageGuidance(cards[0])
    : "如果有多张卡，先选择一张，再根据它当前的 L0-L4 阶段安排训练。";
  return `请进入「AI 能力圈每日复述教练」模式。

今天的目标不是继续灌输新知识，而是帮我把已经聊过、学过、理解过的内容，变成我能复述、能举例、能在面试或真实工作中调用的能力。

请严格按下面流程进行。

【训练原则】

1. 先让我输出，不要先给我讲解。
2. 一次只考一个知识点，不要同时问很多问题。
3. 每轮控制在 3-5 分钟内。
4. 你要像面试官 + 学习教练，不要像百科全书。
5. 重点不是“我是否看懂”，而是“我能不能说出来、用出来”。
6. 如果我说不出来，不要直接给长答案，先帮我缩小问题。
7. 每次只指出一个最关键的问题，不要一次性纠正太多。
8. 最后要帮我生成今天可写入台账的记录。

【今天可用材料】

${material}

【本次等级训练要求】

${stageGuidance}

如果上面的材料不足，你先问我：
“今天想复述哪个主题？可以是一个概念、一张技能卡，或者最近一段对话。”

【复述训练流程】

第一步：选择今日复述目标

请根据我提供的材料，帮我选择 1 个最值得复述的知识点。

选择标准：

- 最近聊过但还说不清的；
- 对面试表达有帮助的；
- 能连接我的 AI 实践经验的；
- 能从“理解”推进到“会讲”的；
- 能形成一张技能卡或升级一张旧技能卡的。

请输出：

今日复述主题：
为什么选它：
今天最低完成标准：

第二步：给我一个 30 秒复述题

请只问一个问题。

请根据当前等级出题：

- L0：让我先用一句自己的话说明“它是什么”，不要要求完整案例；
- L1：让我用 30 秒说明“是什么、为什么重要”；
- L2：让我结合一个真实场景，说明如何使用；
- L3：给我一个新的陌生场景，让我推演如何迁移；
- L4：让我比较、反驳或连接另一个模型。

然后等待我回答。

在我回答前，不要给参考答案。

第三步：对我的复述评分

我回答后，请按 0-3 分评分：

0 分：说不出来，只有零散词语；
1 分：能说关键词，但结构不清；
2 分：能用三句话讲清楚；
3 分：能举自己的例子，并能应用到现实问题。

请输出：

复述评分：
抓住的核心：
最大问题：
缺少的关键点：
如果用于面试，风险在哪里：

注意：最大问题只能选一个，不要列一堆。

第四步：给我一个更好的版本

请基于我的原话，帮我改成三个版本：

1. 一句话版本：用于快速调用。
2. 三句话版本：用于面试或日常表达。
3. 案例版本：必须结合我的真实场景，比如 AI 使用、面试准备、项目表达、学习系统或 Personal AI OS。

要求：

- 不要写得太书面；
- 不要像 AI 总结；
- 尽量保留我的表达习惯；
- 但结构要清楚。

第五步：二次复述

请再给我一个更小的复述题，让我重新说一遍。

问题格式：

“现在请你不用看上面的版本，用自己的话重新说一遍：____。”

这次只要求 15-30 秒。

第六步：生成今日结算材料

当我完成二次复述后，请帮我生成一份「今日复述结算」，并输出一个可写入插件的 knowledge_ledger_update 代码块。
代码块使用 schemaVersion 3，顶层包含 session、cards、imagePrompt。session.kind 使用 recall、application 或 transfer；不要虚构我没有说过的案例。
${targetCardName ? `cards[0].name 必须保持为“${targetCardName}”，不要因为本次比较了其他模型就另建一张同义卡。` : ""}

结算时不要把整段学习过程压缩成一句话。请去掉寒暄和重复，但保留对以后复习有价值的上下文：

- 为什么选择这个主题、它为什么重要；
- 核心问题、推理链和关键区分；
- 我的第一次复述、你给出的关键反馈、我的第二次复述；
- 两次复述之间具体进步了什么；
- 我的真实案例、行动方法、触发场景和适用边界；
- 1-3 句最能代表我理解方式的原话。

这些内容放进 cards[].contentBlocks。原文没有的模块直接省略，不要为了凑字段而编造。

同时把能够证明我当前能力的原话写入 cards[].levelEvents：

- 一句话理解：type=understanding，目标 L1；
- 独立复述且评分达到 2：type=recall，目标 L2；
- 在真实场景中给出案例和行动：type=application，目标 L3；
- 在陌生问题中完成推演：type=transfer，目标 L4。

没有 userEvidence 时只能生成 capture 证据，不能仅凭你的讲解替我升级。

为了让插件稳定解析最终结算：

- contentBlocks 使用 type、title、text、items；段落放 text，步骤或多条内容放 items；
- 优先使用 importance、core_question、reasoning、distinction、first_recall、feedback、second_recall、progress、application、trigger、boundary、source_quote、open_question 这些 type；
- session 必须包含 recallScore、status、exposedIssue 和 nextReview.prompt；
- imagePrompt 使用对象格式：{"title":"知识图标题","prompt":"可以直接交给 ChatGPT 生成图片的完整中文提示词"}；
- 最终必须保留完整 knowledge_ledger_update 代码块，即使代码块前还有简短的训练总结。

现在请先根据我提供的材料，选择今天最值得复述的一个知识点，并给我第一个 30 秒复述题。`;
}

export function buildKnowledgeCapturePrompt(sourceHint = "") {
  const hint = sourceHint.trim()
    ? `\n\n【来源线索】\n${sourceHint.trim()}`
    : "";
  return `请把当前这段学习对话转换成一张「待学习知识卡」。

这一步只负责收录知识，不评判我已经掌握。即使对话内容非常丰富，只要没有看到我亲自复述、应用或迁移的证据，能力等级就必须保持 L0。

请压缩寒暄和重复，但尽可能保留以后复习需要的上下文：

- 核心定义和为什么重要；
- 核心问题、推理链和关键区分；
- 主要子概念、行动方法、例子与反例；
- 适用边界和容易误解的地方；
- 与已有模型的明确关系；
- 仍待我回答的问题；
- 1-3 句值得保留的来源原话。

请严格只输出一个 knowledge_ledger_update 代码块：

\`\`\`knowledge_ledger_update
{
  "schemaVersion": 3,
  "session": {
    "date": "${todayISO()}",
    "kind": "capture",
    "topic": "",
    "recallScore": 0,
    "status": "已收录，等待理解验证",
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
      "levelReason": "已收录知识内容，尚无用户输出证据。",
      "nextReview": {
        "dueDate": "",
        "prompt": "请先用一句自己的话说明这个概念是什么。"
      },
      "contentBlocks": [],
      "sources": [
        {
          "type": "chat",
          "title": "",
          "url": "",
          "excerpt": ""
        }
      ],
      "levelEvents": [
        {
          "type": "capture",
          "targetLevel": "L0",
          "summary": "已收录知识内容，等待用户输出验证。",
          "recallScore": null,
          "userEvidence": ""
        }
      ]
    }
  ],
  "imagePrompt": null
}

\`\`\`

要求：

1. 原文充分时保留 6-12 个 contentBlocks，不要只写一句总结。
2. sources.excerpt 只保留最能代表来源的内容，不要复制整段对话。
3. AI 给出的解释属于知识内容，不属于 userEvidence。
4. 不要生成 understanding、recall、application 或 transfer 证据。
5. 不要因为存在案例就把卡片设为 L3；只有用户自己的应用案例才能成为 L3 证据。
6. 不要输出代码块之外的解释。${hint}`;
}

export function buildKnowledgeNodeLearningPrompt(context = {}) {
  const tree = context.tree || {};
  const node = context.node || {};
  const prerequisiteCards = Array.isArray(context.prerequisiteCards) ? context.prerequisiteCards : [];
  const linkedCards = Array.isArray(context.linkedCards) ? context.linkedCards : [];
  const checkpoints = Array.isArray(node.checkpoints) ? node.checkpoints.filter(Boolean) : [];
  const cardLines = [...prerequisiteCards, ...linkedCards]
    .filter((card, index, list) => list.findIndex((item) => item.id === card.id) === index)
    .map((card) => `- ${card.name}｜${card.level || "L0"}｜${card.oneLine || "暂无一句话解释"}`);
  return `请进入「能力圈技能树学习教练」模式。

我不是来泛泛了解一个新概念，而是要沿当前知识脉络点亮一个明确节点。请把讲解、主动输出、反馈和最终结算连成一个小闭环。

【当前学习地图】

- 地图：${tree.title || "未命名学习地图"}
- 当前分支：${node.branch || "未分类"}
- 本次节点：${node.title || "未命名知识"}
- 节点说明：${node.description || node.summary || "暂无说明"}
- 节点来源：${node.provenance === "ai-suggested" ? "AI建议节点，内容和边界需要在学习中校验" : "已校准节点"}

【已有知识证据】

${cardLines.length ? cardLines.join("\n") : "- 暂无可以直接调用的相关技能卡。"}

【本次最低点亮标准】

${checkpoints.length ? checkpoints.map((item) => `- ${item}`).join("\n") : `- 能用自己的话解释${node.title || "这个知识"}是什么。`}

【训练流程】

1. 先用一个问题诊断我目前对“${node.title || "这个知识"}”知道多少，不要先给长答案。
2. 根据我的回答，只补充完成本节点最低标准真正缺少的内容。
3. 一次只处理一个核心关系；优先连接上面的已有知识，不要展开成百科全书。
4. 讲解后让我进行一次15–30秒主动复述。
5. 只指出一个最大缺口，然后给我一个更小的二次问题。
6. 二次回答后，判断本轮真实证据最多支持L0、L1还是更高等级；没有我的原话证据时只能是L0。
7. 最后输出一个可被插件解析的 knowledge_ledger_update 代码块。

【结算要求】

- schemaVersion 必须为3，顶层包含session、cards、imagePrompt。
- cards[0].name 必须保持为“${node.title || "未命名知识"}”，不要另建同义卡。
- 保留为什么学习该节点、它与已有知识的关系、核心问题、推理链、关键区分、第一次复述、关键反馈、第二次复述和进步证据。
- 用户没有说过的案例、行动和原话不得虚构。
- levelEvents只有存在userEvidence时才能使用understanding、recall、application或transfer；否则只生成capture、L0。
- 本轮只学习这一个节点，不要顺便把相邻节点也结算成新卡。

现在先问我一个诊断问题，然后等待我的回答。`;
}

export function buildSettlementPrompt(conversationHint = "") {
  const hint = conversationHint.trim()
    ? `\n\n【本次对话线索】\n${conversationHint.trim()}`
    : "";
  return `请把本次对话转换成我的「AI 能力圈成长记录」。

目标不是把聊天压缩成几个结论，而是把今天已经形成的理解、推理、反馈和进步证据完整结算成一张以后能继续复述和应用的能力卡。

请严格输出一个 knowledge_ledger_update 代码块，不要输出代码块之外的解释，也不要虚构我没有说过的经历。

【信息保留原则】

1. 压缩重复，不压缩推理和学习证据。
2. 去掉寒暄、重复追问和无关展开，但保留因果链、步骤、关键区分、适用边界、具体案例和纠错反馈。
3. 如果发生了两次复述，保留第一次复述、教练反馈、第二次复述，以及两次之间的变化。
4. 保留 1-3 句有代表性的用户原话。不要整段复制聊天，也不要把用户原话改写成 AI 腔。
5. oneLine 负责快速调用，threeSentence 负责结构化解释，myCase 负责真实案例；更丰富的上下文必须写入 contentBlocks，不能因为主字段已经有内容就丢弃。
6. 同一张卡在原文信息足够时，建议保留 6-12 个有实质内容的 contentBlocks。原文没有的类型直接省略，严禁凑数或编造。
7. 每个 contentBlock 应能独立帮助未来复习，优先保留 40-300 个中文字符；步骤型内容使用 items。

评分标准：
- 0：说不出来；
- 1：只能说关键词；
- 2：能用三句话讲清楚；
- 3：能举自己的例子并应用到现实问题。

等级标准：
- L0：已收录资料，尚无用户输出证据；
- L1：用户能用一句自己的话解释；
- L2：用户能完成独立复述；
- L3：用户能在真实场景中应用；
- L4：用户能迁移到陌生问题并进行推演。

输出格式：
\`\`\`knowledge_ledger_update
{
  "schemaVersion": 3,
  "session": {
    "date": "${todayISO()}",
    "kind": "recall",
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
          "type": "importance",
          "title": "为什么重要",
          "text": "",
          "items": []
        },
        {
          "type": "reasoning",
          "title": "推理链",
          "text": "",
          "items": []
        },
        {
          "type": "first_recall",
          "title": "第一次复述",
          "text": "",
          "items": []
        },
        {
          "type": "feedback",
          "title": "教练反馈",
          "text": "",
          "items": []
        },
        {
          "type": "second_recall",
          "title": "第二次复述",
          "text": "",
          "items": []
        },
        {
          "type": "progress",
          "title": "进步证据",
          "text": "",
          "items": []
        }
      ],
      "sources": [
        {
          "type": "chat",
          "title": "",
          "url": "",
          "excerpt": ""
        }
      ],
      "levelEvents": [
        {
          "type": "understanding|recall|application|transfer",
          "targetLevel": "L1",
          "summary": "",
          "recallScore": null,
          "userEvidence": ""
        }
      ]
    }
  ],
  "imagePrompt": null
}
\`\`\`

【contentBlocks 可用类型】

- definition：核心理解，不要只是重复 oneLine；
- importance：为什么值得学、为什么选择这个主题；
- core_question：这个模型试图回答的核心问题；
- reasoning：因果链、公式、判断路径或推理过程；
- trigger：什么时候应该想到它；
- method：可执行步骤或检查清单；
- example：用户自己的完整案例；
- distinction：容易混淆但必须区分的概念或措辞；
- boundary：适用边界、不能解决什么；
- first_recall：用户第一次复述的代表性内容；
- feedback：教练指出的核心、最大问题、缺失点或表达风险；
- second_recall：用户修正后的第二次复述；
- progress：第一次到第二次具体改善了什么；
- source_quote：1-3 句有代表性的用户原话；
- application：已经发生或明确计划的现实应用；
- open_question：仍未解决、值得后续复习的问题；
- note：其他确实有长期价值、但不属于以上类型的信息。

同类信息可以合并为一个块，避免重复；不同作用的信息不要强行合并。没有内容的块直接删除。${hint}`;
}

export function buildImagePrompt(card, extra = "", style = "", sections = null) {
  const target = card || {};
  const selected = new Set(Array.isArray(sections)
    ? sections
    : ["definition", "scenario", "method", "example", "boundary", "related"]);
  const blockByType = (type) => (target.contentBlocks || []).find((block) => block.type === type);
  const blockContent = (type) => {
    const block = blockByType(type);
    if (!block) return "";
    return block.items?.length ? block.items.join("；") : block.text;
  };
  const method = blockContent("method");
  const boundary = blockContent("boundary");
  const importance = blockContent("importance");
  const coreQuestion = blockContent("core_question");
  const reasoning = blockContent("reasoning");
  const distinction = blockContent("distinction");
  const relatedModels = Array.isArray(target.relatedModels)
    ? target.relatedModels.filter(Boolean).join("、")
    : "";
  const knowledgeLines = [];
  const activeModules = [];

  const addModule = (id, label, values) => {
    if (!selected.has(id)) return;
    const available = values.filter(({ value }) => String(value || "").trim());
    if (!available.length) return;
    activeModules.push(label);
    available.forEach(({ name, value }) => {
      knowledgeLines.push(`- ${name}：${String(value).trim()}`);
    });
  };

  addModule("definition", "核心解释", [
    { name: "一句话", value: target.oneLine },
    { name: "结构化解释", value: target.threeSentence },
    { name: "为什么重要", value: importance },
    { name: "核心问题", value: coreQuestion },
    { name: "关键区分", value: distinction }
  ]);
  addModule("scenario", "使用场景", [
    { name: "使用场景", value: target.scenario }
  ]);
  addModule("method", "行动方法", [
    { name: "行动方法", value: method },
    { name: "推理链", value: reasoning }
  ]);
  addModule("example", "我的案例", [
    { name: "我的案例", value: target.myCase }
  ]);
  addModule("boundary", "适用边界", [
    { name: "适用边界", value: boundary }
  ]);
  addModule("related", "关联模型", [
    { name: "关联模型", value: relatedModels }
  ]);

  let diagramBrief = "";
  if (!activeModules.length) {
    diagramBrief = "没有选中的有效知识模块，不画解释性关系图，只保留标题和清晰留白。";
  } else if (selected.has("method") && reasoning) {
    diagramBrief = `用当前知识的推理链作为主示意图：${reasoning}。根据内容判断箭头方向和节点关系。`;
  } else if (selected.has("method") && method) {
    diagramBrief = `把行动方法转成清晰的步骤图：${method}。步骤名称必须沿用原文。`;
  } else if (selected.has("definition") && distinction) {
    diagramBrief = `围绕关键区分制作一个简洁对照图：${distinction}。`;
  } else if (selected.has("example") && target.myCase) {
    diagramBrief = "从“我的案例”中提取问题、行动和原文明确提到的结果，画成一个小型案例路径图。";
  } else if (selected.has("boundary") && boundary) {
    diagramBrief = `用边界图表现“能解决什么 / 不能解决什么”：${boundary}。`;
  } else {
    diagramBrief = "从核心解释中选择最重要的关系，画成一个概念结构图；不得加入原文没有的节点。";
  }

  const lines = [
    "请生成一张适合放进 Apple 无边记的手写知识地图图片。",
    "",
    "画面要求：",
    `- 风格：${style || "手写白板"}；白底、黑色墨水，少量蓝色和绿色标注。`,
    "- 尺寸比例：横向 16:9，留足边距，文字清晰可读。",
    "- 不要做成海报，不要做成商务 PPT，不要使用复杂背景。",
    "- 这是一个知识点的解释图，视觉结构必须服务于当前知识本身。",
    "- 先理解内容关系，再决定使用流程图、因果图、对照图、边界图、结构图或案例图。",
    "",
    "知识内容：",
    `- 标题：${target.name || "未命名知识点"}`,
    ...knowledgeLines,
    "",
    "信息组织：",
    `- 当前实际内容模块：${activeModules.join("、") || "仅标题"}。按内容关系自适应布局，不强制三栏或固定分区数量。`,
    "- 核心解释与主示意图占主要面积；案例和边界作为辅助信息；关联模型只做小型连接。",
    "- 不要为了对称、填满版面或增加装饰而补写内容。",
    "- 长句可以压缩成不改变原意的短语，但关键动作、关系和边界必须保留。",
    "",
    "当前知识专属示意图：",
    `- ${diagramBrief}`,
    "- 示意图的节点和箭头文字只能来自上面的知识内容。",
    "",
    "禁止套用：",
    "- 不要画 L0-L4、复述评分、每日台账、技能卡、学习闭环或“知识进入能力圈”等管理流程，除非它们就是当前知识主题。",
    "- 不要把关联模型扩写成新的主流程。",
    extra.trim() ? `\n补充要求：\n${extra.trim()}` : ""
  ];
  return lines.filter(Boolean).join("\n");
}

function buildRecallMaterial(cards, entries) {
  const lines = [];
  if (cards.length) {
    lines.push("【已有技能卡】");
    if (cards.length === 1) {
      const card = cards[0];
      lines.push(`名称：${card.name || "未命名"}`);
      lines.push(`等级：${card.level || "L0"}`);
      lines.push(`一句话：${card.oneLine || "未填写"}`);
      lines.push(`三句话：${card.threeSentence || "未填写"}`);
      lines.push(`使用场景：${card.scenario || "未填写"}`);
      lines.push(`我的案例：${card.myCase || "未填写"}`);
      lines.push(`关联模型：${Array.isArray(card.relatedModels) && card.relatedModels.length ? card.relatedModels.join("、") : "未填写"}`);
      if (Array.isArray(card.contentBlocks) && card.contentBlocks.length) {
        lines.push("已积累的上下文：");
        card.contentBlocks.forEach((block) => {
          const content = Array.isArray(block.items) && block.items.length
            ? block.items.join("；")
            : block.text;
          if (content) lines.push(`- ${block.title || block.type || "补充信息"}：${content}`);
        });
      }
      lines.push(`下次复习：${card.nextReview || "未定"}`);
    } else {
      cards.forEach((card) => {
        const blockTitles = Array.isArray(card.contentBlocks)
          ? card.contentBlocks.map((block) => block.title || block.type).filter(Boolean)
          : [];
        lines.push(`- ${card.name || "未命名"}｜等级：${card.level || "L0"}｜一句话：${card.oneLine || "未填写"}｜场景：${card.scenario || "未填写"}｜已积累：${blockTitles.join("、") || "暂无扩展上下文"}｜下次复习：${card.nextReview || "未定"}`);
      });
    }
  }
  if (entries.length) {
    lines.push("");
    lines.push("【最近台账】");
    entries.forEach((entry) => {
      lines.push(`- ${entry.date || todayISO()}｜${entry.theme || "未命名主题"}｜评分：${entry.recallScore ?? 0}｜新增卡：${Array.isArray(entry.newSkillCards) ? entry.newSkillCards.join("、") : "无"}｜暴露问题：${entry.exposedIssue || "未填写"}｜下次复习：${entry.nextReview || "未定"}`);
    });
  }
  if (!lines.length) {
    return "- 暂无历史技能卡或台账。请先让我选择一个主题开始 30 秒复述。";
  }
  return lines.join("\n");
}

function buildStageGuidance(card) {
  const level = card?.level || "L0";
  const guidance = {
    L0: "当前是 L0 已收录。目标是让我先形成一句自己的理解；不要先要求完整复述或举例。",
    L1: "当前是 L1 初步理解。目标是让我脱离原文完成一次 30 秒复述，讲清是什么和为什么重要。",
    L2: "当前是 L2 可以复述。目标是让我用在一个真实场景中，给出自己的案例、行动和预期结果。",
    L3: "当前是 L3 可以应用。目标是给我一个新的陌生场景，让我推演如何迁移，并说明边界。",
    L4: "当前是 L4 可以迁移。目标是通过反例、模型比较或跨领域连接检验理解是否稳定。"
  };
  return guidance[level] || guidance.L0;
}
