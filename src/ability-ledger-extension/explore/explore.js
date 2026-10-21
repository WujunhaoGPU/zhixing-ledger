import cytoscape from "../vendor/cytoscape.esm.min.mjs";
import {
  DEEPSEEK_API_KEY_STORAGE_KEY,
  LEDGER_STATE_KEY,
  normalizeState
} from "../shared/ledgerModel.js";
import {
  MUNGER_TREE_ID,
  assertAcyclic,
  evaluateKnowledgeTree,
  normalizeKnowledgeTree,
  parseGeneratedKnowledgeTree,
  recommendKnowledgeNodes,
  removeKnowledgeTree,
  replaceKnowledgeTree,
  setKnowledgeTreeNodeConfirmed
} from "../shared/knowledgeTree.js";
import { buildKnowledgeNodeLearningPrompt } from "../shared/prompts.js";

const root = document.querySelector("#explore-root");
let state = normalizeState();
let deepseekApiKey = "";
let selectedNodeId = "";
let graph = null;
let generatorOpen = location.hash === "#generate";
let selectedGeneratorCardIds = new Set();
let generationBasis = "共同主题";
let generationPreview = null;
let excludedPreviewNodeIds = new Set();
let generationError = "";
let isGenerating = false;
let toast = "";

init();

async function init() {
  const stored = await chrome.storage.local.get([
    LEDGER_STATE_KEY,
    DEEPSEEK_API_KEY_STORAGE_KEY
  ]);
  state = normalizeState(stored[LEDGER_STATE_KEY]);
  deepseekApiKey = String(stored[DEEPSEEK_API_KEY_STORAGE_KEY] || "");
  selectedNodeId = state.exploration.activeNodeId || activeTree().nodes[0]?.id || "";
  chrome.storage.onChanged.addListener(handleStorageChange);
  render();
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local") return;
  if (changes[LEDGER_STATE_KEY]) {
    state = normalizeState(changes[LEDGER_STATE_KEY].newValue);
    if (!activeTree().nodes.some((item) => item.id === selectedNodeId)) {
      selectedNodeId = activeTree().nodes[0]?.id || "";
    }
    render();
  }
  if (changes[DEEPSEEK_API_KEY_STORAGE_KEY]) {
    deepseekApiKey = String(changes[DEEPSEEK_API_KEY_STORAGE_KEY].newValue || "");
  }
}

function render() {
  if (graph) {
    graph.destroy();
    graph = null;
  }
  root.innerHTML = "";
  const tree = activeTree();
  const evaluation = evaluateKnowledgeTree(tree, state.skillCards);
  const selected = evaluation.byId.get(selectedNodeId) || evaluation.nodes[0];
  if (selected && selected.id !== selectedNodeId) selectedNodeId = selected.id;
  root.append(el("div", { className: "tree-app" }, [
    renderHeader(tree),
    el("div", { className: "tree-workspace" }, [
      renderSidebar(evaluation),
      renderCanvasShell(),
      renderDetail(selected, evaluation)
    ]),
    generatorOpen ? renderGenerator() : null,
    toast ? el("div", { className: "toast", text: toast }) : null
  ]));
  requestAnimationFrame(() => initializeGraph(evaluation));
}

function renderHeader(tree) {
  const treeSelect = el("select", { className: "tree-select", "aria-label": "选择学习地图" }, state.knowledgeTrees.map((item) => el("option", {
    value: item.id,
    text: item.title,
    selected: item.id === tree.id
  })));
  treeSelect.addEventListener("change", async () => {
    const nextTree = state.knowledgeTrees.find((item) => item.id === treeSelect.value);
    selectedNodeId = nextTree?.nodes[0]?.id || "";
    await saveState({
      ...state,
      exploration: {
        activeTreeId: treeSelect.value,
        activeNodeId: "",
        learningStartedAt: ""
      }
    });
  });
  return el("header", { className: "tree-header" }, [
    el("div", { className: "brand" }, [
      el("img", { src: "../assets/brand/icon-48.png", alt: "" }),
      el("div", {}, [
        el("strong", { text: "能力圈技能树" }),
        el("span", { text: "选择下一项，而不是继续随机输入" })
      ])
    ]),
    treeSelect,
    el("div", { className: "header-actions" }, [
      button("导入", () => document.querySelector("#tree-import")?.click()),
      button("导出", () => exportCurrentTree()),
      tree.id === MUNGER_TREE_ID ? null : button("删除", () => deleteCurrentTree(), "danger"),
      button("建立地图", () => openGenerator(), "primary"),
      el("input", {
        id: "tree-import",
        type: "file",
        accept: ".json,application/json",
        hidden: true,
        onchange: importTree
      })
    ])
  ]);
}

function renderSidebar(evaluation) {
  const recommendations = recommendKnowledgeNodes(evaluation.tree, state.skillCards, 3);
  return el("aside", { className: "tree-sidebar" }, [
    el("h2", { className: "summary-title", text: evaluation.tree.title }),
    el("p", { className: "summary-copy", text: evaluation.tree.description }),
    el("div", { className: "progress-head" }, [
      el("strong", { text: `${evaluation.summary.progress}%` }),
      el("span", { text: `${evaluation.summary.lit}/${evaluation.summary.total} 已点亮` })
    ]),
    el("div", { className: "progress-track" }, el("i", { style: `width:${evaluation.summary.progress}%` })),
    el("div", { className: "summary-grid" }, [
      summaryStat("可学习", evaluation.summary.available),
      summaryStat("已应用", evaluation.summary.applied),
      summaryStat("锁定", evaluation.summary.locked),
      summaryStat("待复习", evaluation.summary.due)
    ]),
    el("h3", { className: "section-title", text: "现在适合学习" }),
    el("div", { className: "recommendation-list" }, recommendations.length
      ? recommendations.map((item) => el("button", {
        className: "recommendation",
        type: "button",
        onclick: () => selectNode(item.id)
      }, [
        el("strong", { text: item.title }),
        el("span", { text: item.recommendationReason })
      ]))
      : el("p", { className: "muted", text: "当前没有满足前置条件的新节点。" })),
    el("h3", { className: "section-title", text: "状态说明" }),
    el("div", { className: "legend" }, [
      legend("available", "可学习"),
      legend("locked", "锁定"),
      legend("captured", "L0 已收录"),
      legend("learning", "L1–L2"),
      legend("applied", "L3–L4")
    ])
  ]);
}

function renderCanvasShell() {
  return el("section", { className: "canvas-shell" }, [
    el("div", { id: "tree-canvas", role: "application", "aria-label": "学习技能树画布" }),
    el("div", { className: "canvas-toolbar" }, [
      iconButton("crosshair", "适应画布", () => graph?.fit(undefined, 54)),
      iconButton("rotate-ccw", "重新布局", () => runGraphLayout())
    ]),
    el("div", { className: "canvas-note", text: "从左到右展开；实线是硬前置，虚线是建议顺序。滚轮缩放，拖动画布。" })
  ]);
}

function renderDetail(node, evaluation) {
  if (!node) return el("aside", { className: "tree-detail" }, el("div", { className: "empty-detail", text: "选择一个节点查看学习条件。" }));
  const status = statusLabel(node);
  const incoming = node.incoming.map((item) => {
    const source = evaluation.byId.get(item.source);
    return `${source?.title || item.source} · ${item.type === "requires" ? `需${item.requiredLevel}` : "建议先学"}`;
  });
  const outgoing = node.outgoing.map((item) => {
    const target = evaluation.byId.get(item.target);
    return `${target?.title || item.target} · ${item.type === "requires" ? "硬前置" : "建议关联"}`;
  });
  return el("aside", { className: "tree-detail" }, [
    el("span", { className: "detail-eyebrow", text: node.branch }),
    el("h2", { className: "detail-title", text: node.title }),
    el("p", { className: "detail-copy", text: node.description || node.summary }),
    el("div", { className: "detail-meta" }, [
      el("span", { className: "status-badge", text: status }),
      node.linkedCards.length ? el("span", { className: "status-badge", text: node.level }) : null,
      node.provenance === "ai-suggested" ? el("span", { className: "source-badge", text: "AI建议 · 未校验来源" }) : null,
      node.due ? el("span", { className: "source-badge", text: "FSRS待复习" }) : null
    ]),
    node.lockReasons.length ? detailBlock("尚未满足", node.lockReasons) : null,
    incoming.length ? detailBlock("前置关系", incoming) : null,
    node.checkpoints.length ? detailBlock("最低点亮标准", node.checkpoints, true) : null,
    node.linkedCards.length ? detailBlock("关联能力卡", node.linkedCards.map((card) => `${card.name} · ${card.level}`)) : null,
    outgoing.length ? detailBlock("继续会解锁", outgoing) : null,
    el("div", { className: "detail-actions" }, [
      node.status === "candidate"
        ? button("确认纳入地图", () => confirmSuggestedNode(node), "primary")
        : button(node.linkedCards.length ? "继续深化这个节点" : "复制提示词，开始学习", () => startLearning(node, evaluation), "primary", node.status === "locked"),
      node.status === "candidate" ? el("p", { className: "muted", text: "确认只表示这个知识值得纳入地图，不会改变能力等级。" }) : null,
      node.status === "locked" ? el("p", { className: "muted", text: "先点亮上面的硬前置节点，系统不会允许手动越级。" }) : null
    ])
  ]);
}

async function confirmSuggestedNode(node) {
  const tree = setKnowledgeTreeNodeConfirmed(activeTree(), node.id, true);
  await saveState({
    ...state,
    knowledgeTrees: replaceKnowledgeTree(state.knowledgeTrees, tree)
  });
  showToast("已纳入地图；能力等级仍由对话证据决定。");
}

function detailBlock(title, values, checkpoints = false) {
  return el("section", { className: "detail-block" }, [
    el("h3", { text: title }),
    el("div", { className: checkpoints ? "checkpoint-list" : "relation-list" }, values.map((value) => el("div", {
      className: checkpoints ? "checkpoint-row" : "relation-row",
      text: value
    })))
  ]);
}

function initializeGraph(evaluation) {
  const container = document.querySelector("#tree-canvas");
  if (!container || !evaluation.tree) return;
  const elements = [
    ...evaluation.nodes.map((node) => ({
      group: "nodes",
      data: {
        id: node.id,
        label: `${node.title}${node.linkedCards.length ? `\n${node.level}` : ""}`,
        status: node.status,
        due: node.due ? 1 : 0,
        suggested: node.provenance === "ai-suggested" ? 1 : 0
      },
      selected: node.id === selectedNodeId
    })),
    ...evaluation.tree.edges.map((item) => ({
      group: "edges",
      data: {
        id: item.id,
        source: item.source,
        target: item.target,
        type: item.type
      }
    }))
  ];
  graph = cytoscape({
    container,
    elements,
    minZoom: 0.35,
    maxZoom: 1.8,
    wheelSensitivity: 0.16,
    style: graphStyles()
  });
  graph.on("tap", "node", (event) => selectNode(event.target.id(), false));
  runGraphLayout();
}

function graphStyles() {
  return [
    {
      selector: "node",
      style: {
        width: 156,
        height: 52,
        shape: "round-rectangle",
        "background-color": "#ffffff",
        "border-width": 2,
        "border-color": "#9aa6ad",
        label: "data(label)",
        color: "#263746",
        "font-family": "Inter, PingFang SC, Microsoft YaHei, sans-serif",
        "font-size": 11,
        "font-weight": 700,
        "text-wrap": "wrap",
        "text-max-width": 136,
        "text-valign": "center",
        "text-halign": "center"
      }
    },
    { selector: 'node[status = "locked"]', style: { "background-color": "#e2e6e7", "border-color": "#b8c0c4", color: "#7b858b" } },
    { selector: 'node[status = "captured"]', style: { "background-color": "#fff3dc", "border-color": "#b67b18" } },
    { selector: 'node[status = "learning"]', style: { "background-color": "#e8f0f8", "border-color": "#3f73a8" } },
    { selector: 'node[status = "applied"]', style: { "background-color": "#e7f2ea", "border-color": "#3d7d57" } },
    { selector: 'node[status = "candidate"]', style: { "border-style": "dashed", "border-color": "#b67b18" } },
    { selector: "node[suggested = 1]", style: { "border-style": "dashed" } },
    { selector: "node[due = 1]", style: { "outline-width": 3, "outline-color": "#d49322", "outline-opacity": 0.9, "outline-offset": 3 } },
    { selector: "node:selected", style: { "border-width": 3, "border-color": "#08756f", "shadow-blur": 10, "shadow-color": "#08756f", "shadow-opacity": 0.16 } },
    {
      selector: "edge",
      style: {
        width: 1.5,
        "line-color": "#9eaaa7",
        "target-arrow-color": "#9eaaa7",
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        "arrow-scale": 0.8
      }
    },
    { selector: 'edge[type = "recommended"]', style: { "line-style": "dashed", "line-color": "#c2cac8", "target-arrow-color": "#c2cac8" } }
  ];
}

function runGraphLayout() {
  if (!graph) return;
  graph.layout({
    name: "breadthfirst",
    directed: true,
    padding: 64,
    spacingFactor: 1.15,
    circle: false,
    grid: false,
    animate: false
  }).run();
  const positions = new Map(graph.nodes().map((node) => [node.id(), { ...node.position() }]));
  const minX = Math.min(...[...positions.values()].map((position) => position.x));
  const minY = Math.min(...[...positions.values()].map((position) => position.y));
  graph.nodes().positions((node) => {
    const position = positions.get(node.id());
    return {
      x: position.y - minY,
      y: position.x - minX
    };
  });
  graph.fit(undefined, 54);
  if (graph.zoom() < 0.72) graph.zoom(0.72);
  const selected = graph.$id(selectedNodeId);
  if (selected.length) graph.center(selected);
}

function selectNode(nodeId, rerender = true) {
  selectedNodeId = nodeId;
  if (rerender) {
    render();
    return;
  }
  graph?.nodes().unselect();
  graph?.getElementById(nodeId).select();
  const evaluation = evaluateKnowledgeTree(activeTree(), state.skillCards);
  const detail = document.querySelector(".tree-detail");
  detail?.replaceWith(renderDetail(evaluation.byId.get(nodeId), evaluation));
}

async function startLearning(node, evaluation) {
  if (node.status === "locked") return;
  const prerequisiteCards = node.incoming
    .map((item) => evaluation.byId.get(item.source))
    .flatMap((item) => item?.linkedCards || []);
  const prompt = buildKnowledgeNodeLearningPrompt({
    tree: evaluation.tree,
    node,
    prerequisiteCards,
    linkedCards: node.linkedCards
  });
  await navigator.clipboard.writeText(prompt);
  await saveState({
    ...state,
    exploration: {
      activeTreeId: evaluation.tree.id,
      activeNodeId: node.id,
      learningStartedAt: new Date().toISOString()
    }
  }, false);
  showToast(`已复制“${node.title}”学习提示词。完成后回到“今日”导入结算。`);
}

function renderGenerator() {
  const cards = state.skillCards;
  const selectedCount = selectedGeneratorCardIds.size;
  const basisSelect = el("select", { className: "basis-select" }, ["共同主题", "同一来源", "共同目标"].map((basis) => el("option", {
    value: basis,
    text: basis,
    selected: generationBasis === basis
  })));
  basisSelect.addEventListener("change", () => { generationBasis = basisSelect.value; });
  return el("div", { className: "generator-layer" }, el("section", {
    className: "generator-dialog",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "generator-title"
  }, [
    el("div", { className: "generator-pane" }, [
      el("div", { className: "generator-head" }, [
        el("div", {}, [
          el("h2", { id: "generator-title", text: "围绕技能卡建立学习地图" }),
          el("p", { className: "muted", text: "选择1–5张卡。新增知识只是AI建议，保存前可以排除。" })
        ]),
        iconButton("chevron-left", "关闭", closeGenerator)
      ]),
      cards.length ? el("div", { className: "generator-card-list" }, cards.map((card) => {
        const checkbox = el("input", {
          type: "checkbox",
          checked: selectedGeneratorCardIds.has(card.id),
          disabled: !selectedGeneratorCardIds.has(card.id) && selectedCount >= 5
        });
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selectedGeneratorCardIds.add(card.id);
          else selectedGeneratorCardIds.delete(card.id);
          generationPreview = null;
          generationError = "";
          render();
        });
        return el("label", { className: "generator-card" }, [
          checkbox,
          el("div", {}, [
            el("strong", { text: card.name }),
            el("small", { text: card.oneLine || "暂无一句话解释" })
          ]),
          el("span", { className: "status-badge", text: card.level })
        ]);
      })) : el("div", { className: "preview-empty", text: "还没有真实技能卡，先在“今日”收录知识。" }),
      el("label", { className: "muted", text: "组织依据" }),
      basisSelect,
      generationError ? el("div", { className: "generator-error", text: generationError }) : null,
      el("div", { className: "generator-actions" }, [
        button("取消", closeGenerator),
        button(isGenerating ? "正在生成…" : `生成预览（已选${selectedCount}张）`, generateTreePreview, "primary", isGenerating || selectedCount < 1)
      ])
    ]),
    renderGenerationPreview()
  ]));
}

function renderGenerationPreview() {
  if (!generationPreview) {
    return el("div", { className: "preview-pane" }, el("div", { className: "preview-empty" }, [
      el("strong", { text: "这里先显示地图预览" }),
      el("p", { text: deepseekApiKey ? "生成后检查边界、节点和前置关系，再决定是否保存。" : "需要先在插件设置中配置DeepSeek API Key。" })
    ]));
  }
  const includedNodes = generationPreview.nodes.filter((item) => !excludedPreviewNodeIds.has(item.id));
  return el("div", { className: "preview-pane" }, [
    el("h2", { className: "summary-title", text: generationPreview.title }),
    el("p", { className: "summary-copy", text: generationPreview.description }),
    el("div", { className: "preview-node-list" }, generationPreview.nodes.map((node) => {
      const canExclude = node.provenance === "ai-suggested";
      const checkbox = el("input", {
        type: "checkbox",
        checked: !excludedPreviewNodeIds.has(node.id),
        disabled: !canExclude
      });
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) excludedPreviewNodeIds.delete(node.id);
        else excludedPreviewNodeIds.add(node.id);
        render();
      });
      return el("label", { className: "preview-node" }, [
        el("div", {}, [
          el("strong", { text: node.title }),
          el("small", { text: `${node.branch} · ${node.summary || node.description}` })
        ]),
        el("div", { className: "preview-node-controls" }, [
          checkbox,
          canExclude ? el("span", { className: "ai-badge", text: "AI建议" }) : null
        ])
      ]);
    })),
    el("p", { className: "muted", text: `将保存 ${includedNodes.length} 个节点；被排除节点相关的边会同时删除。` }),
    el("div", { className: "preview-actions" }, [
      button("重新生成", generateTreePreview, "", isGenerating),
      button("确认保存地图", saveGeneratedTree, "primary", includedNodes.length < 3)
    ])
  ]);
}

async function generateTreePreview() {
  const cards = state.skillCards.filter((card) => selectedGeneratorCardIds.has(card.id));
  if (!cards.length) return;
  if (!deepseekApiKey) {
    generationError = "请先回到插件侧栏的设置页，配置并测试DeepSeek API Key。";
    render();
    return;
  }
  isGenerating = true;
  generationError = "";
  render();
  try {
    const response = await chrome.runtime.sendMessage({
      type: "ABILITY_LEDGER_DEEPSEEK_KNOWLEDGE_TREE",
      apiKey: deepseekApiKey,
      model: state.settings.deepseekModel,
      input: { cards, basis: generationBasis }
    });
    if (!response?.ok) throw new Error(response?.error || "DeepSeek生成学习地图失败。");
    generationPreview = parseGeneratedKnowledgeTree(response.tree, cards);
    excludedPreviewNodeIds = new Set();
  } catch (error) {
    generationError = error.message || String(error);
  } finally {
    isGenerating = false;
    render();
  }
}

async function saveGeneratedTree() {
  if (!generationPreview) return;
  const nodeIds = new Set(generationPreview.nodes
    .filter((item) => !excludedPreviewNodeIds.has(item.id))
    .map((item) => item.id));
  const tree = {
    ...generationPreview,
    nodes: generationPreview.nodes.filter((item) => nodeIds.has(item.id)),
    edges: generationPreview.edges.filter((item) => nodeIds.has(item.source) && nodeIds.has(item.target)),
    updatedAt: new Date().toISOString()
  };
  assertAcyclic(tree);
  selectedNodeId = tree.nodes[0]?.id || "";
  generatorOpen = false;
  generationPreview = null;
  selectedGeneratorCardIds = new Set();
  location.hash = "";
  await saveState({
    ...state,
    knowledgeTrees: replaceKnowledgeTree(state.knowledgeTrees, tree),
    exploration: {
      activeTreeId: tree.id,
      activeNodeId: "",
      learningStartedAt: ""
    }
  });
  showToast("学习地图已保存；AI建议节点仍保留未校验标记。");
}

function openGenerator() {
  generatorOpen = true;
  location.hash = "generate";
  render();
}

function closeGenerator() {
  generatorOpen = false;
  generationPreview = null;
  generationError = "";
  excludedPreviewNodeIds = new Set();
  location.hash = "";
  render();
}

async function exportCurrentTree() {
  const tree = activeTree();
  await chrome.runtime.sendMessage({
    type: "ABILITY_LEDGER_DOWNLOAD_TEXT",
    filename: `${tree.id}.ability-tree.json`,
    content: JSON.stringify(tree, null, 2),
    mimeType: "application/json"
  });
  showToast("当前学习地图已导出。");
}

async function importTree(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const tree = normalizeKnowledgeTree(parsed);
    if (!tree) throw new Error("文件中没有有效的 ability-tree/v1 学习地图。");
    assertAcyclic(tree);
    selectedNodeId = tree.nodes[0]?.id || "";
    await saveState({
      ...state,
      knowledgeTrees: replaceKnowledgeTree(state.knowledgeTrees, tree),
      exploration: { activeTreeId: tree.id, activeNodeId: "", learningStartedAt: "" }
    });
    showToast("学习地图已导入。");
  } catch (error) {
    showToast(`导入失败：${error.message || String(error)}`);
  } finally {
    event.target.value = "";
  }
}

async function deleteCurrentTree() {
  const tree = activeTree();
  if (tree.id === MUNGER_TREE_ID) return;
  if (!window.confirm(`确定删除学习地图“${tree.title}”吗？技能卡不会被删除。`)) return;
  const trees = removeKnowledgeTree(state.knowledgeTrees, tree.id);
  selectedNodeId = trees[0]?.nodes[0]?.id || "";
  await saveState({
    ...state,
    knowledgeTrees: trees,
    exploration: { activeTreeId: trees[0]?.id || "", activeNodeId: "", learningStartedAt: "" }
  });
  showToast("学习地图已删除，技能卡保持不变。");
}

async function saveState(nextState, rerender = true) {
  state = normalizeState(nextState);
  await chrome.storage.local.set({ [LEDGER_STATE_KEY]: state });
  if (rerender) render();
}

function activeTree() {
  return state.knowledgeTrees.find((tree) => tree.id === state.exploration.activeTreeId)
    || state.knowledgeTrees[0];
}

function statusLabel(node) {
  const labels = {
    locked: "锁定",
    available: "可学习",
    captured: "已收录",
    learning: "理解/复述中",
    applied: "已应用/迁移",
    candidate: "候选"
  };
  return labels[node.status] || "未知";
}

function summaryStat(label, value) {
  return el("div", { className: "summary-stat" }, [
    el("span", { text: label }),
    el("strong", { text: String(value) })
  ]);
}

function legend(status, label) {
  return el("div", { className: "legend-item" }, [
    el("i", { className: `legend-dot ${status}` }),
    el("span", { text: label })
  ]);
}

function iconButton(iconName, label, onclick) {
  return el("button", {
    className: "icon-button",
    type: "button",
    title: label,
    "aria-label": label,
    onclick
  }, el("img", { src: `../assets/lucide/${iconName}.svg`, alt: "" }));
}

function button(label, onclick, variant = "", disabled = false) {
  return el("button", {
    className: `button ${variant}`.trim(),
    type: "button",
    text: label,
    disabled,
    onclick
  });
}

function showToast(message) {
  toast = message;
  render();
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast = "";
    render();
  }, 2800);
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "value") node.value = value;
    else if (key === "checked") node.checked = Boolean(value);
    else if (key === "disabled") node.disabled = Boolean(value);
    else if (key === "selected") node.selected = Boolean(value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, String(value));
  });
  const list = Array.isArray(children) ? children : [children];
  list.filter(Boolean).forEach((child) => node.append(child instanceof Node ? child : document.createTextNode(String(child))));
  return node;
}
