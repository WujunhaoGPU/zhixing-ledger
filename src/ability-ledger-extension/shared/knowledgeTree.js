export const KNOWLEDGE_TREE_FORMAT = "ability-tree/v1";
export const MUNGER_TREE_ID = "munger-mental-models-v1";

const LEVEL_ORDER = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 };
const EDGE_TYPES = new Set(["requires", "recommended"]);

export function createMungerKnowledgeTree() {
  const nodes = [
    node("latticework", "多元思维模型", "用多个基础学科模型共同解释现实，而不是依赖单一视角。", "基础", ["多元思维模型", "思维模型格栅"], 3),
    node("competence-circle", "能力圈", "区分熟悉、信心与经过真实反馈验证的能力。", "决策", ["能力圈", "能力圈=已验证经验"], 3),
    node("inversion", "反向思考", "先识别失败路径，再把它们反向改写成检查项和行动。", "决策", ["反向思考", "反向思维", "从失败路径反推行动"], 3),
    node("incentives", "激励机制", "行为和判断会被奖励、惩罚与利益结构持续塑造。", "心理", ["激励机制", "奖励和惩罚超级反应倾向"], 3),
    node("opportunity-cost", "机会成本", "评价一个选择时，同时看被放弃的最佳替代方案。", "决策", ["机会成本"], 2),
    node("compounding", "复利效应", "小的长期优势通过持续积累形成非线性差异。", "基础", ["复利", "复利效应"], 2),
    node("margin-safety", "安全边际", "承认判断可能出错，在资源、时间和承诺上保留余量。", "决策", ["安全边际"], 3),
    node("incentive-bias", "激励引发的偏见", "激励不仅改变行为，还会筛选注意力并重塑信念。", "心理", ["激励引发的偏见", "激励偏见"], 3),
    node("consistency", "承诺一致性", "人会维护既有承诺、身份和投入，即使新证据已经出现。", "心理", ["承诺一致性", "避免不一致倾向"], 2),
    node("social-proof", "社会认同", "不确定时，人会把群体行为当作判断正确性的证据。", "心理", ["社会认同", "社会认同倾向"], 2),
    node("authority", "权威影响", "权威身份会放大观点的可信感，并降低独立检查。", "心理", ["权威影响", "权威错误影响倾向"], 2),
    node("loss-aversion", "损失厌恶", "损失带来的痛苦通常比同等收益的快乐更强。", "心理", ["损失厌恶", "剥夺超级反应倾向"], 2),
    node("lollapalooza", "多种偏差共同作用", "多种心理力量同向叠加时，会产生远强于单一偏差的结果。", "心理", ["Lollapalooza", "多种心理倾向共同作用"], 3),
    node("feedback-loop", "反馈循环", "行为结果会反过来改变下一轮行为，形成强化或平衡。", "系统", ["反馈循环", "反馈系统"], 2),
    node("second-order", "二阶效应", "判断行动时继续追问结果之后还会发生什么。", "系统", ["二阶效应", "二阶思维"], 3),
    node("bottleneck", "瓶颈", "系统表现往往由最受限的关键环节决定。", "系统", ["瓶颈", "约束理论"], 2),
    node("redundancy", "冗余与可靠性", "关键系统通过备用方案和余量吸收局部失败。", "系统", ["冗余", "可靠性", "冗余与可靠性"], 2),
    node("model-comparison", "模型比较", "比较不同模型解决的问题、证据要求和适用边界。", "综合", ["模型比较", "多模型比较"], 3),
    node("decision-checklist", "决策检查表", "把模型转化为重要决策前可以执行的检查问题。", "综合", ["决策检查表", "防错清单"], 3),
    node("case-analysis", "多模型案例分析", "在一个真实案例中组合多个模型，并区分主因与辅助解释。", "综合", ["多模型案例分析", "案例分析"], 3),
    node("cross-domain-transfer", "跨领域迁移", "把已经验证的模型迁移到陌生领域，并明确何时失效。", "综合", ["跨领域迁移", "模型迁移"], 3)
  ];

  const edges = [
    edge("latticework", "competence-circle", "recommended"),
    edge("latticework", "inversion", "recommended"),
    edge("latticework", "incentives", "recommended"),
    edge("latticework", "opportunity-cost", "recommended"),
    edge("latticework", "compounding", "recommended"),
    edge("latticework", "margin-safety", "recommended"),
    edge("incentives", "incentive-bias", "requires", "L1"),
    edge("incentive-bias", "lollapalooza", "requires", "L1"),
    edge("consistency", "lollapalooza", "recommended"),
    edge("social-proof", "lollapalooza", "recommended"),
    edge("authority", "lollapalooza", "recommended"),
    edge("loss-aversion", "lollapalooza", "recommended"),
    edge("feedback-loop", "second-order", "requires", "L1"),
    edge("bottleneck", "redundancy", "recommended"),
    edge("latticework", "model-comparison", "requires", "L1"),
    edge("competence-circle", "decision-checklist", "recommended"),
    edge("inversion", "decision-checklist", "requires", "L1"),
    edge("margin-safety", "decision-checklist", "recommended"),
    edge("opportunity-cost", "decision-checklist", "recommended"),
    edge("model-comparison", "case-analysis", "requires", "L1"),
    edge("decision-checklist", "case-analysis", "requires", "L1"),
    edge("lollapalooza", "case-analysis", "recommended"),
    edge("second-order", "case-analysis", "recommended"),
    edge("case-analysis", "cross-domain-transfer", "requires", "L2")
  ];

  return normalizeKnowledgeTree({
    format: KNOWLEDGE_TREE_FORMAT,
    id: MUNGER_TREE_ID,
    title: "芒格多元思维模型",
    description: "从基础模型、心理误判、系统思维走向多模型案例分析与跨领域迁移。",
    kind: "source",
    source: {
      type: "book-system",
      title: "《穷查理宝典》与芒格思维模型",
      note: "第一版人工校准地图；章节顺序不直接等于前置关系。"
    },
    version: 1,
    nodes,
    edges,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z"
  });
}

export function normalizeKnowledgeTrees(value) {
  const trees = Array.isArray(value)
    ? value.map(normalizeKnowledgeTree).filter(Boolean)
    : [];
  if (!trees.some((tree) => tree.id === MUNGER_TREE_ID)) {
    trees.unshift(createMungerKnowledgeTree());
  }
  return trees;
}

export function normalizeKnowledgeTree(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean(value.id);
  const title = clean(value.title);
  if (!id || !title) return null;
  const nodes = uniqueById((Array.isArray(value.nodes) ? value.nodes : [])
    .map(normalizeTreeNode)
    .filter(Boolean));
  if (!nodes.length) return null;
  const nodeIds = new Set(nodes.map((item) => item.id));
  const edges = uniqueById((Array.isArray(value.edges) ? value.edges : [])
    .map(normalizeTreeEdge)
    .filter((item) => item && nodeIds.has(item.source) && nodeIds.has(item.target) && item.source !== item.target));
  return {
    format: KNOWLEDGE_TREE_FORMAT,
    id,
    title,
    description: clean(value.description),
    kind: ["source", "generated", "goal"].includes(value.kind) ? value.kind : "generated",
    source: normalizeTreeSource(value.source),
    version: Math.max(1, Number(value.version) || 1),
    nodes,
    edges,
    createdAt: clean(value.createdAt) || new Date().toISOString(),
    updatedAt: clean(value.updatedAt) || new Date().toISOString()
  };
}

export function normalizeExploration(value, trees = []) {
  const data = value && typeof value === "object" ? value : {};
  const treeIds = new Set(trees.map((tree) => tree.id));
  const activeTreeId = treeIds.has(data.activeTreeId)
    ? data.activeTreeId
    : trees[0]?.id || "";
  const activeTree = trees.find((tree) => tree.id === activeTreeId);
  const nodeIds = new Set(activeTree?.nodes.map((item) => item.id) || []);
  return {
    activeTreeId,
    activeNodeId: nodeIds.has(data.activeNodeId) ? data.activeNodeId : "",
    learningStartedAt: nodeIds.has(data.activeNodeId) ? clean(data.learningStartedAt) : ""
  };
}

export function evaluateKnowledgeTree(treeValue, cards = [], now = new Date()) {
  const tree = normalizeKnowledgeTree(treeValue);
  if (!tree) return { tree: null, nodes: [], byId: new Map(), summary: emptySummary() };
  const incoming = groupEdges(tree.edges, "target");
  const outgoing = groupEdges(tree.edges, "source");
  const byId = new Map();

  tree.nodes.forEach((treeNode) => {
    const linkedCards = findLinkedCards(treeNode, cards);
    const level = highestLevel(linkedCards);
    byId.set(treeNode.id, {
      ...treeNode,
      linkedCards,
      level,
      levelNumber: levelNumber(level),
      due: linkedCards.some((card) => isCardDue(card, now)),
      incoming: incoming.get(treeNode.id) || [],
      outgoing: outgoing.get(treeNode.id) || [],
      status: "available",
      lockReasons: []
    });
  });

  byId.forEach((item) => {
    const hardEdges = item.incoming.filter((itemEdge) => itemEdge.type === "requires");
    const unmet = hardEdges.filter((itemEdge) => {
      const prerequisite = byId.get(itemEdge.source);
      return !prerequisite || prerequisite.levelNumber < levelNumber(itemEdge.requiredLevel);
    });
    item.lockReasons = unmet.map((itemEdge) => {
      const prerequisite = byId.get(itemEdge.source);
      return `${prerequisite?.title || itemEdge.source}需达到${itemEdge.requiredLevel}`;
    });
    if (!item.confirmed) item.status = "candidate";
    else if (item.linkedCards.length && item.level === "L0") item.status = "captured";
    else if (item.linkedCards.length && ["L1", "L2"].includes(item.level)) item.status = "learning";
    else if (item.linkedCards.length) item.status = "applied";
    else if (unmet.length) item.status = "locked";
    else item.status = "available";
  });

  const nodes = tree.nodes.map((item) => byId.get(item.id));
  const countable = nodes.filter((item) => item.confirmed);
  const summary = {
    total: countable.length,
    lit: countable.filter((item) => item.linkedCards.length).length,
    applied: countable.filter((item) => item.status === "applied").length,
    available: countable.filter((item) => item.status === "available").length,
    locked: countable.filter((item) => item.status === "locked").length,
    due: countable.filter((item) => item.due).length,
    progress: countable.length
      ? Math.round(countable.filter((item) => item.linkedCards.length).length / countable.length * 100)
      : 0
  };
  return { tree, nodes, byId, summary };
}

export function recommendKnowledgeNodes(tree, cards = [], limit = 3) {
  const evaluation = evaluateKnowledgeTree(tree, cards);
  return evaluation.nodes
    .filter((item) => item.status === "available" && item.confirmed)
    .map((item) => {
      const learnedPrerequisites = item.incoming.filter((itemEdge) => {
        const prerequisite = evaluation.byId.get(itemEdge.source);
        return prerequisite?.linkedCards.length;
      }).length;
      const unlocks = item.outgoing.filter((itemEdge) => itemEdge.type === "requires").length;
      const score = item.importance * 10 + learnedPrerequisites * 4 + unlocks * 3 - item.incoming.length;
      return {
        ...item,
        recommendationScore: score,
        recommendationReason: recommendationReason(item, learnedPrerequisites, unlocks)
      };
    })
    .sort((a, b) => b.recommendationScore - a.recommendationScore || a.title.localeCompare(b.title, "zh-CN"))
    .slice(0, Math.max(1, limit));
}

export function linkCardToTreeNode(treeValue, nodeId, cardId) {
  const tree = normalizeKnowledgeTree(treeValue);
  if (!tree || !clean(cardId)) return tree;
  return normalizeKnowledgeTree({
    ...tree,
    nodes: tree.nodes.map((item) => item.id === nodeId
      ? { ...item, linkedCardIds: unique([...item.linkedCardIds, clean(cardId)]) }
      : item),
    updatedAt: new Date().toISOString()
  });
}

export function setKnowledgeTreeNodeConfirmed(treeValue, nodeId, confirmed = true) {
  const tree = normalizeKnowledgeTree(treeValue);
  if (!tree) return tree;
  return normalizeKnowledgeTree({
    ...tree,
    nodes: tree.nodes.map((item) => item.id === nodeId
      ? { ...item, confirmed: Boolean(confirmed) }
      : item),
    updatedAt: new Date().toISOString()
  });
}

export function replaceKnowledgeTree(trees, nextTree) {
  const normalized = normalizeKnowledgeTree(nextTree);
  if (!normalized) return normalizeKnowledgeTrees(trees);
  const next = normalizeKnowledgeTrees(trees).filter((tree) => tree.id !== normalized.id);
  return [...next, normalized];
}

export function removeKnowledgeTree(trees, treeId) {
  if (treeId === MUNGER_TREE_ID) return normalizeKnowledgeTrees(trees);
  return normalizeKnowledgeTrees(trees).filter((tree) => tree.id !== treeId);
}

export function parseGeneratedKnowledgeTree(value, selectedCards = []) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("知识树结果必须是一个 JSON 对象。");
  }
  const selectedNames = selectedCards.map((card) => card.name).filter(Boolean);
  const tree = normalizeKnowledgeTree({
    ...parsed,
    format: KNOWLEDGE_TREE_FORMAT,
    id: clean(parsed.id) || `generated-${Date.now().toString(36)}`,
    kind: "generated",
    source: {
      type: "selected-cards",
      title: selectedNames.join("、") || "所选技能卡",
      note: "由 DeepSeek 根据所选卡片提出，AI建议节点仍需用户校验。"
    },
    nodes: (Array.isArray(parsed.nodes) ? parsed.nodes : []).map((item) => {
      const matchedCard = selectedCards.find((card) => namesMatch(item.title, card.name));
      return {
        ...item,
        linkedCardIds: matchedCard ? [matchedCard.id] : [],
        provenance: matchedCard ? "existing-card" : "ai-suggested",
        sourceVerified: Boolean(matchedCard),
        confirmed: Boolean(matchedCard)
      };
    })
  });
  if (!tree) throw new Error("DeepSeek 返回的知识树没有有效节点。");
  if (tree.nodes.length < 3 || tree.nodes.length > 16) {
    throw new Error("第一版小树应包含 3–16 个节点。");
  }
  assertAcyclic(tree);
  return tree;
}

export function assertAcyclic(treeValue) {
  const tree = normalizeKnowledgeTree(treeValue);
  if (!tree) throw new Error("知识树结构无效。");
  const indegree = new Map(tree.nodes.map((item) => [item.id, 0]));
  const outgoing = new Map();
  tree.edges.forEach((item) => {
    indegree.set(item.target, (indegree.get(item.target) || 0) + 1);
    outgoing.set(item.source, [...(outgoing.get(item.source) || []), item.target]);
  });
  const queue = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    visited += 1;
    (outgoing.get(id) || []).forEach((target) => {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    });
  }
  if (visited !== tree.nodes.length) throw new Error("知识树不能包含循环依赖。");
  return true;
}

function node(id, title, summary, branch, aliases = [], importance = 2) {
  return {
    id,
    title,
    summary,
    description: summary,
    branch,
    aliases,
    linkedCardIds: [],
    checkpoints: [`能用自己的话说明${title}是什么`, `能说明${title}在一个真实问题中的用途`],
    importance,
    provenance: "curated",
    sourceVerified: true,
    confirmed: true
  };
}

function edge(source, target, type = "recommended", requiredLevel = "L1") {
  return { id: `${source}-${target}`, source, target, type, requiredLevel };
}

function normalizeTreeNode(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean(value.id);
  const title = clean(value.title || value.name);
  if (!id || !title) return null;
  return {
    id,
    title,
    summary: clean(value.summary),
    description: clean(value.description || value.content || value.summary),
    branch: clean(value.branch) || "其他",
    aliases: normalizeStrings(value.aliases),
    linkedCardIds: normalizeStrings(value.linkedCardIds || value.linked_card_ids),
    checkpoints: normalizeStrings(value.checkpoints).slice(0, 5),
    importance: Math.min(3, Math.max(1, Number(value.importance) || 2)),
    provenance: ["curated", "existing-card", "ai-suggested"].includes(value.provenance)
      ? value.provenance
      : "ai-suggested",
    sourceVerified: value.sourceVerified === true,
    confirmed: value.confirmed !== false
  };
}

function normalizeTreeEdge(value) {
  if (!value || typeof value !== "object") return null;
  const source = clean(value.source);
  const target = clean(value.target);
  if (!source || !target) return null;
  const type = EDGE_TYPES.has(value.type) ? value.type : "recommended";
  return {
    id: clean(value.id) || `${source}-${target}`,
    source,
    target,
    type,
    requiredLevel: normalizeLevel(value.requiredLevel || value.required_level || "L1")
  };
}

function normalizeTreeSource(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    type: clean(source.type) || "manual",
    title: clean(source.title),
    note: clean(source.note)
  };
}

function findLinkedCards(treeNode, cards) {
  const explicit = new Set(treeNode.linkedCardIds);
  const names = [treeNode.title, ...treeNode.aliases];
  return (Array.isArray(cards) ? cards : []).filter((card) => (
    explicit.has(card.id) || names.some((name) => namesMatch(name, card.name))
  ));
}

function namesMatch(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function normalizeName(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[：:———()（）\[\]【】,，。.!！?？\s]/g, "")
    .replace(/从失败路径反推行动|已验证经验|模型$/g, "");
}

function highestLevel(cards) {
  return (Array.isArray(cards) ? cards : []).reduce((highest, card) => (
    levelNumber(card.level) > levelNumber(highest) ? normalizeLevel(card.level) : highest
  ), "L0");
}

function isCardDue(card, now) {
  if (!card?.reviewSchedule?.due) return false;
  const due = new Date(card.reviewSchedule.due);
  return !Number.isNaN(due.getTime()) && due.getTime() <= now.getTime();
}

function recommendationReason(item, learnedPrerequisites, unlocks) {
  if (learnedPrerequisites && unlocks) return `前置知识已准备，可继续解锁 ${unlocks} 个后续节点。`;
  if (learnedPrerequisites) return `与已点亮知识直接相邻，适合沿当前脉络继续。`;
  if (unlocks) return `这是${item.branch}分支的基础节点，可解锁 ${unlocks} 个后续节点。`;
  return `这是${item.branch}分支中尚未点亮的重要节点。`;
}

function groupEdges(edges, key) {
  const grouped = new Map();
  edges.forEach((item) => grouped.set(item[key], [...(grouped.get(item[key]) || []), item]));
  return grouped;
}

function normalizeLevel(value) {
  const match = clean(value).toUpperCase().match(/L[0-4]/);
  return match ? match[0] : "L0";
}

function levelNumber(value) {
  return LEVEL_ORDER[normalizeLevel(value)] || 0;
}

function normalizeStrings(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return unique(list.map(clean).filter(Boolean));
}

function unique(values) {
  return [...new Set(values)];
}

function uniqueById(values) {
  const byId = new Map();
  values.forEach((item) => byId.set(item.id, item));
  return [...byId.values()];
}

function clean(value) {
  return String(value ?? "").trim();
}

function emptySummary() {
  return { total: 0, lit: 0, applied: 0, available: 0, locked: 0, due: 0, progress: 0 };
}
