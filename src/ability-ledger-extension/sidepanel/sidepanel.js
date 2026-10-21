import { CodexClient, CODEX_CONNECTION_KEY } from "../shared/codexClient.js";
import { createTraining, trainingMessages, validateTrainingSettlement } from "../shared/codexTraining.js";
import {
  DEEPSEEK_API_KEY_STORAGE_KEY,
  LEDGER_UNDO_STATE_KEY,
  LEDGER_STATE_KEY,
  SCORE_LABELS,
  EVIDENCE_TYPE_LABELS,
  analyzeLedgerUpdate,
  applyLedgerUpdate,
  buildMarkdownExport,
  cardContentStats,
  createEmptyState,
  nextLevelAction,
  normalizeEntry,
  normalizeSkillCard,
  normalizeState,
  todayISO
} from "../shared/ledgerModel.js";
import {
  buildImagePrompt,
  buildKnowledgeNodeLearningPrompt,
  buildKnowledgeCapturePrompt,
  buildRecallStartPrompt,
  buildSettlementPrompt
} from "../shared/prompts.js";
import {
  REVIEW_RATINGS,
  applyReviewRating,
  buildReviewPlan,
  cardsDueForDate,
  nextDueSummary,
  reviewReason,
  reviewScoreFromRating,
  reviewsCompletedForDate
} from "../shared/reviewScheduler.js";
import {
  evaluateKnowledgeTree,
  linkCardToTreeNode,
  recommendKnowledgeNodes,
  replaceKnowledgeTree
} from "../shared/knowledgeTree.js";

const root = document.querySelector("#ability-ledger-root");
const tabs = ["today", "cards", "explore", "image"];
const ONBOARDING_VERSION_STORAGE_KEY = "abilityLedgerOnboardingVersionV1";
const CURRENT_ONBOARDING_VERSION = 2;
const ONBOARDING_STEPS = [
  {
    icon: "book-open-check",
    eyebrow: "知行簿",
    title: "把 AI 对话变成可复习的能力",
    description: "知行簿保存学习材料、安排复习和记录成长证据；连接 Codex 后可直接在插件内完成训练，也可继续使用 ChatGPT 网页。",
    items: [
      ["今日", "收录学习结算"],
      ["卡组", "完成到期复习"],
      ["探索", "沿技能树选择下一项"],
      ["制图", "生成无边记提示词"]
    ]
  },
  {
    icon: "sun",
    eyebrow: "01 今日",
    title: "先把一次学习收进来",
    description: "学完一段对话、一章书或一篇文章后，用收录提示词让 ChatGPT 生成结构化结算。",
    items: [
      ["复制收录提示词", "交给当前 ChatGPT 对话"],
      ["捕获或粘贴结算", "先查看插件解析的预览"],
      ["确认写入", "生成台账和内容丰富的 L0 卡"]
    ]
  },
  {
    icon: "layers",
    eyebrow: "02 卡组",
    title: "在知行簿或 ChatGPT 里复习",
    description: "设置中连接 Codex 后，可在知行簿一次一题地回答、接收反馈和完成二次复述；确认结算后再入账。",
    items: [
      ["打开今日到期卡", "查看入选原因和本轮目标"],
      ["连接 Codex 直接训练", "也可复制提示词到 ChatGPT"],
      ["导入最终结算", "只有你的原话证据会推动 L0-L4"]
    ]
  },
  {
    icon: "list-tree",
    eyebrow: "03 探索与制图",
    title: "找到下一项，再把知识带出去",
    description: "探索显示已点亮、可学习和锁定节点；制图负责生成适合交给 ChatGPT 的无边记图片提示词。",
    items: [
      ["探索", "查看推荐节点并打开完整技能树"],
      ["学习", "从节点复制提示词到 ChatGPT"],
      ["制图", "选择卡片、内容模块和图片风格"],
    ]
  }
];
const fallbackCard = normalizeSkillCard({
  id: "fallback-card",
  name: "能力圈",
  oneLine: "能力圈不是知道什么，而是经过验证后能在现实里用出来什么。",
  threeSentence: "能力圈提醒我区分听过、理解和会用。重要决策要尽量在已验证经验内做。圈外内容要通过小任务、复述和反馈逐步扩张。",
  scenario: "面试准备、项目表达、学习路线判断",
  myCase: "如果只看面试技巧视频，却没有模拟面试和真实反馈，面试表达还没有进入能力圈。",
  relatedModels: ["反向思考", "机会成本", "安全边际"],
  level: "L3",
  nextReview: "30 秒解释：能力圈为什么不是限制自己？"
});

const codexClient = new CodexClient();
let codexStatus = null;
let codexMessage = "";
let codexBusy = false;
let codexPollTimer = null;
let codexSession = null;
let codexController = null;
let codexDraftTimer = null;
let codexStream = "";
let state = createEmptyState();
let activeTab = "cards";
let cardView = "deck";
let cardDetailTab = "content";
let selectedCardId = "";
let selectedAgendaDate = todayISO();
let levelFilter = "all";
let draftText = "";
let importPreview = null;
let importReport = null;
let importError = "";
let isAnalyzing = false;
let canUndoImport = false;
let deepseekApiKey = "";
let apiKeyDraft = "";
let deepseekStatus = "未连接";
let imageOutput = "";
let mapStyle = "手写白板";
let mapSections = new Set(["definition", "scenario", "method", "example", "boundary", "related"]);
let isGeneratingMapPrompt = false;
let mapPromptStatus = "";
let reviewSession = null;
let reviewTimer = null;
let isReviewFeedbackLoading = false;
let toast = "";
let undoActionKind = "";
let showOnboarding = false;
let onboardingStep = 0;

init();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[LEDGER_STATE_KEY]) return;
  state = normalizeState(changes[LEDGER_STATE_KEY].newValue);
  render();
});

async function init() {
  const stored = await chrome.storage.local.get([
    LEDGER_STATE_KEY,
    LEDGER_UNDO_STATE_KEY,
    DEEPSEEK_API_KEY_STORAGE_KEY,
    ONBOARDING_VERSION_STORAGE_KEY
  ]);
  const storedState = stored[LEDGER_STATE_KEY];
  state = normalizeState(storedState);
  const hasManualLevelEvents = storedState?.skillCards?.some((card) => (
    card?.levelEvents?.some((event) => event?.type === "manual_override")
  ));
  if (storedState?.schemaVersion !== 3 || hasManualLevelEvents) {
    await chrome.storage.local.set({ [LEDGER_STATE_KEY]: state });
  }
  deepseekApiKey = String(stored[DEEPSEEK_API_KEY_STORAGE_KEY] || "");
  apiKeyDraft = deepseekApiKey;
  canUndoImport = Boolean(stored[LEDGER_UNDO_STATE_KEY]);
  undoActionKind = canUndoImport ? "change" : "";
  showOnboarding = Number(stored[ONBOARDING_VERSION_STORAGE_KEY] || 0) < CURRENT_ONBOARDING_VERSION;
  selectedCardId = featuredCard().id;
  render();
}

async function saveState(nextState) {
  state = normalizeState(nextState);
  if (!allCards().some((card) => card.id === selectedCardId)) {
    selectedCardId = featuredCard().id;
  }
  await chrome.storage.local.set({ [LEDGER_STATE_KEY]: state });
  render();
}

function render() {
  document.body.classList.toggle("onboarding-open", showOnboarding);
  root.innerHTML = "";
  root.append(el("div", { className: "app deck-app" }, [
    activeTab === "today" ? renderToday() : null,
    activeTab === "cards" ? renderCards() : null,
    activeTab === "explore" ? renderExplore() : null,
    activeTab === "image" ? renderImage() : null,
    activeTab === "settings" ? renderSettings() : null,
    renderBottomTabs(),
    showOnboarding ? renderOnboarding() : null,
    toast ? el("div", { className: "toast", text: toast }) : null
  ]));
}

function renderOnboarding() {
  const step = ONBOARDING_STEPS[onboardingStep];
  const isLast = onboardingStep === ONBOARDING_STEPS.length - 1;
  return el("div", { className: "onboarding-layer" }, [
    el("section", {
      className: "onboarding-dialog",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "onboarding-title"
    }, [
      el("header", { className: "onboarding-topbar" }, [
        el("span", { text: `${onboardingStep + 1} / ${ONBOARDING_STEPS.length}` }),
        el("button", {
          className: "onboarding-skip",
          type: "button",
          text: "跳过",
          onclick: completeOnboarding
        })
      ]),
      el("div", { className: "onboarding-content" }, [
        el("div", { className: "onboarding-icon" }, icon(step.icon)),
        el("p", { className: "onboarding-eyebrow", text: step.eyebrow }),
        el("h2", { id: "onboarding-title", text: step.title }),
        el("p", { className: "onboarding-description", text: step.description }),
        el("div", { className: "onboarding-list" }, step.items.map(([title, description], index) => el("div", { className: "onboarding-list-row" }, [
          el("span", { className: "onboarding-list-index", text: String(index + 1) }),
          el("div", {}, [
            el("strong", { text: title }),
            el("small", { text: description })
          ])
        ])))
      ]),
      el("footer", { className: "onboarding-footer" }, [
        el("button", {
          className: "onboarding-back",
          type: "button",
          title: "上一步",
          "aria-label": "上一步",
          disabled: onboardingStep === 0,
          onclick: () => {
            onboardingStep = Math.max(0, onboardingStep - 1);
            render();
          }
        }, icon("chevron-left")),
        el("div", { className: "onboarding-dots", role: "tablist", "aria-label": "新手指南进度" }, ONBOARDING_STEPS.map((_, index) => el("button", {
          type: "button",
          className: "onboarding-dot",
          "aria-selected": String(index === onboardingStep),
          "aria-label": `第 ${index + 1} 步`,
          onclick: () => {
            onboardingStep = index;
            render();
          }
        }))),
        el("button", {
          className: "onboarding-next",
          type: "button",
          onclick: isLast ? completeOnboarding : () => {
            onboardingStep += 1;
            render();
          }
        }, [
          el("span", { text: isLast ? "开始使用" : "下一步" }),
          isLast ? null : icon("chevron-right")
        ])
      ])
    ])
  ]);
}

async function completeOnboarding() {
  await chrome.storage.local.set({
    [ONBOARDING_VERSION_STORAGE_KEY]: CURRENT_ONBOARDING_VERSION
  });
  showOnboarding = false;
  onboardingStep = 0;
  render();
}

function openOnboarding() {
  onboardingStep = 0;
  showOnboarding = true;
  render();
}

function renderBottomTabs() {
  const labels = {
    today: ["sun", "今日"],
    cards: ["layers", "卡组"],
    explore: ["list-tree", "探索"],
    image: ["map", "制图"]
  };
  return el("nav", { className: "bottom-tabs tabs" }, tabs.map((tab) => el("button", {
    className: "bottom-tab tab",
    type: "button",
    "aria-selected": String(activeTab === tab),
    onclick: () => {
      clearReviewTimer();
      activeTab = tab;
      if (tab === "cards") cardView = "deck";
      render();
    }
  }, [
    el("span", { className: "tab-icon" }, icon(labels[tab][0])),
    el("span", { text: labels[tab][1] })
  ])));
}

function renderToday() {
  const todayEntries = state.entries.filter((entry) => entry.date === todayISO()).slice().reverse();
  const lastRecallEntry = todayEntries.find((entry) => entry.kind !== "capture");
  const todayCardNames = [...new Set(todayEntries.flatMap((entry) => entry.newSkillCards))];
  const smartEnabled = state.settings.deepseekEnabled && Boolean(deepseekApiKey);
  const textarea = el("textarea", {
    className: "textarea ledger-import",
    placeholder: "粘贴知识收录、复述结算、JSON，或直接捕获 ChatGPT 最新回复",
    value: draftText,
    oninput: (event) => { draftText = event.target.value; }
  });
  return el("main", { className: "screen" }, [
    renderScreenHead("今日学习", "先收录知识，再用理解、复述、应用和迁移证据推动升级。"),
    el("section", { className: "today-overview" }, [
      stat("今日活动", String(todayEntries.length)),
      stat("最新评分", lastRecallEntry ? `${lastRecallEntry.recallScore}/3` : "—"),
      stat("涉及卡片", String(todayCardNames.length))
    ]),
    el("section", { className: "panel learning-actions-panel" }, [
      el("div", { className: "panel-title", text: "从哪一步开始" }),
      el("p", { className: "copy", text: "正在读书或和 AI 探索时先收录；已经有卡片时再按当前等级训练。" }),
      el("div", { className: "learning-action-grid" }, [
        button("收录当前学习", async () => {
          await copyText(buildKnowledgeCapturePrompt());
          showToast("已复制知识收录提示词。发送给 ChatGPT 后，再捕获结构化回复。");
        }, "primary"),
        button("开始能力训练", async () => {
          await copyText(buildRecallStartPrompt({ skillCards: state.skillCards, entries: state.entries }));
          showToast("已复制分级训练提示词。");
        })
      ])
    ]),
    el("section", { className: "panel settlement-panel" }, [
      el("div", { className: "panel-head" }, [
        el("div", {}, [
          el("div", { className: "eyebrow", text: "智能结算" }),
          el("div", { className: "panel-title", text: "导入知识收录或训练结算" }),
          el("p", {
            className: "copy",
            text: smartEnabled
              ? "先在本地识别；字段不完整时再使用 DeepSeek 转换。"
              : "默认在本地识别；可在设置中启用 DeepSeek 处理陌生格式。"
          })
        ]),
        el("span", {
          className: `status-pill ${smartEnabled ? "ready" : ""}`,
          text: smartEnabled ? "智能模式" : "本地模式"
        })
      ]),
      button(isAnalyzing ? "正在分析…" : "捕获并生成预览", async () => {
        if (isAnalyzing) return;
        await captureAndAnalyze();
      }, "primary wide"),
      el("div", { className: "section-divider", text: "或粘贴结构化内容" }),
      textarea,
      el("div", { className: "actions" }, [
        button(isAnalyzing ? "解析中…" : "生成结算预览", () => analyzeDraft(), "primary"),
        smartEnabled
          ? button("使用 DeepSeek 重解析", () => analyzeDraft({ forceDeepseek: true }))
          : null
      ]),
      importError ? el("div", { className: "inline-alert error", text: importError }) : null
    ]),
    importPreview ? renderImportPreview() : null,
    canUndoImport ? el("section", { className: "undo-strip" }, [
      el("span", { text: undoActionKind === "delete" ? "刚删除的记录可以一起恢复" : "上一步数据变更可以撤销" }),
      button("撤销上一步", undoLastChange)
    ]) : null,
    el("section", { className: "panel" }, [
      el("div", { className: "panel-head" }, [
        el("div", { className: "panel-title", text: "今日记录" }),
        el("span", { className: "count-badge", text: String(todayEntries.length) })
      ]),
      todayEntries.length ? el("div", { className: "timeline" }, todayEntries.map(renderTimelineEntry)) : empty("今天还没有学习记录。可以先收录一段对话，也可以开始复述训练。")
    ]),
    el("details", { className: "advanced-panel" }, [
      el("summary", { text: "高级方式：手动追加" }),
      renderQuickAdd()
    ])
  ]);
}

function renderQuickAdd() {
  const date = input(todayISO(), "日期");
  const theme = input("", "今日主题，例如：能力圈可见化");
  const card = input("", "新增技能卡，例如：能力圈");
  const application = textareaSmall("", "现实应用，例如：面试准备时用评分暴露表达短板");
  const nextReview = input("", "明日复习题，例如：30 秒解释能力圈为什么等于已验证经验");
  const score = selectScore(2);
  return el("section", { className: "manual-form" }, [
    el("div", { className: "form-grid" }, [
      el("div", { className: "row" }, [date, score]),
      theme,
      card,
      application,
      nextReview
    ]),
    button("手动追加一行", async () => {
      const entry = normalizeEntry({
        date: date.value,
        kind: "recall",
        theme: theme.value,
        newSkillCards: card.value ? [card.value] : [],
        recallScore: score.value,
        application: application.value,
        nextReview: nextReview.value
      });
      const skillCard = card.value ? normalizeSkillCard({
        name: card.value,
        scenario: application.value,
        levelEvents: [{
          type: entry.recallScore >= 3 && application.value ? "application" : "recall",
          targetLevel: entry.recallScore >= 3 && application.value ? "L3" : entry.recallScore >= 2 ? "L2" : "L1",
          summary: "来自手动追加的学习证据。",
          recallScore: entry.recallScore,
          userEvidence: application.value || theme.value,
          createdAt: new Date().toISOString()
        }],
        nextReview: nextReview.value
      }) : null;
      await saveState(applyLedgerUpdate(state, {
        entries: [entry],
        skillCards: skillCard ? [skillCard] : []
      }));
      showToast("已手动追加。");
    }, "primary")
  ]);
}

function renderCards() {
  if (cardView === "codex-training") return renderCodexTraining();
  if (cardView === "chatgpt-review") return renderChatGPTReviewScreen();
  if (cardView === "chatgpt-review-complete") return renderChatGPTReviewCompleteScreen();
  if (cardView === "detail") return renderCardDetail();
  return renderDeckHome();
}

function renderDeckHome() {
  const cards = filteredCards();
  const plan = buildReviewPlan(allRealCards());
  const completedToday = reviewsCompletedForDate(allRealCards(), new Date());
  return el("main", { className: "screen" }, [
    renderScreenHead("今日复习", "系统安排到期知识，L0-L4 决定这一轮具体练什么。"),
    el("section", { className: "review-overview" }, [
      stat("到期复习", String(plan.dueReview.length)),
      stat("待学习", String(plan.dueLearning.length)),
      stat("今日完成", String(completedToday))
    ]),
    el("section", { className: "codex-entry" }, [
      button("在知行簿内训练", () => allRealCards().length ? startCodexTraining(selectedCard()) : showToast("请先在今日收录一张知识卡。"), "primary"),
      el("p", { className: "copy", text: "直接出题、回答、反馈与结算；首次使用在设置连接 Codex。" })
    ]),
    renderNewTrainingMaterial(),
    renderTrainingHistory(),
    renderTodayReviewQueue(plan),
    renderWeekAgenda(),
    el("div", { className: "section-heading" }, [
      el("div", {}, [
        el("div", { className: "panel-title", text: "全部知识卡" }),
        el("p", { className: "copy", text: "这里用于查找和管理，不代表今天都要复习。" })
      ]),
      el("span", { className: "count-badge", text: String(cards.length) })
    ]),
    renderLevelFilters(),
    cards.length
      ? el("section", { className: "card-list" }, cards.map(renderCardRow))
      : el("section", { className: "empty-state" }, [
        el("div", { className: "empty-title", text: "还没有真实技能卡" }),
        el("p", { className: "copy", text: "上方卡片是界面演示，不参与统计。完成一次今日结算后，真实卡片会出现在这里。" }),
        button("去今日结算", () => { activeTab = "today"; render(); }, "primary")
      ])
  ]);
}

function renderTodayReviewQueue(plan) {
  if (!plan.queue.length) {
    return el("section", { className: "empty-state review-empty" }, [
      el("div", { className: "empty-title", text: "今天没有到期任务" }),
      el("p", { className: "copy", text: "不需要为了连续打卡提前刷卡。下一张知识到期后会自动出现在这里。" })
    ]);
  }
  return el("section", { className: "review-plan" }, [
    el("div", { className: "section-heading" }, [
      el("div", {}, [
        el("div", { className: "panel-title", text: "今天先完成这些" }),
        el("p", { className: "copy", text: `系统从 ${plan.totalDue} 张到期卡中选出最多 3 张。` })
      ]),
      el("span", { className: "count-badge", text: String(plan.queue.length) })
    ]),
    ...plan.queue.map((card, index) => renderReviewPlanRow(card, index))
  ]);
}

function renderReviewPlanRow(card, index) {
  const stage = stageTrainingConfig(card);
  return el("article", { className: "review-plan-row" }, [
    el("div", { className: "review-order", text: String(index + 1) }),
    el("div", { className: "review-plan-main" }, [
      el("div", { className: "review-plan-title-row" }, [
        el("strong", { text: card.name }),
        levelChip(card.level)
      ]),
      el("p", { className: "review-reason", text: reviewReason(card) }),
      el("p", { className: "review-task", text: `本轮：${stage.title} · 约 3 分钟` })
    ]),
    button("开始", () => startReviewSession(card), "compact")
  ]);
}

function renderWeekAgenda() {
  const days = buildWeekDays();
  if (!days.some((day) => day.iso === selectedAgendaDate)) selectedAgendaDate = todayISO();
  return el("section", { className: "week-agenda" }, [
    el("div", { className: "week-strip" }, days.map((day) => el("button", {
      className: "week-day",
      type: "button",
      "aria-current": day.iso === selectedAgendaDate ? "date" : "false",
      onclick: () => {
        selectedAgendaDate = day.iso;
        render();
      }
    }, [
      el("span", { text: day.weekday }),
      el("strong", { text: day.day }),
      el("i", { className: `week-dot ${dayDotClass(day.iso)}` })
    ]))),
    el("div", { className: "agenda-scroll", tabindex: "0" }, orderedAgendaDays(days).map(renderAgendaDay))
  ]);
}

function renderAgendaDay(day) {
  const completed = reviewsCompletedForDate(allRealCards(), day.iso);
  const due = dueCardsForDate(day.iso);
  const target = due[0]?.level ? stageTrainingConfig(due[0]).shortTitle : completed ? "完成" : "无";
  return el("button", {
    className: "agenda-day",
    type: "button",
    "aria-current": day.iso === selectedAgendaDate ? "date" : "false",
    onclick: () => {
      if (due[0]) {
        startReviewSession(due[0]);
      }
    }
  }, [
    el("div", { className: "agenda-date" }, [
      el("strong", { text: formatMonthDay(day.iso) }),
      el("span", { text: day.label })
    ]),
    stat("待复习", String(due.length)),
    stat("完成", String(completed)),
    stat("任务", target),
    el("span", { className: "chevron", text: "›" })
  ]);
}

function renderFeaturedCard(card) {
  const isDemo = card.id === fallbackCard.id;
  return el("section", { className: "hero-card" }, [
    el("div", { className: "hero-icon" }, icon("circle-dot")),
    el("div", { className: "hero-card-body" }, [
      el("div", { className: "hero-title-row" }, [
        el("h2", { className: "hero-title", text: card.name }),
        isDemo ? el("span", { className: "demo-chip", text: "演示" }) : levelChip(card.level)
      ]),
      el("p", { className: "hero-copy", text: card.oneLine || card.scenario || "选择一张卡，开始 30 秒复述训练。" })
    ]),
    el("div", { className: "hero-actions" }, [
      isDemo
        ? button("去今日生成卡片", () => { activeTab = "today"; render(); }, "primary")
        : button(card.level === "L0" ? "确认理解" : card.level === "L1" ? "开始复述" : card.level === "L2" ? "记录应用" : card.level === "L3" ? "迁移挑战" : "巩固复盘", () => startReviewSession(card), "primary"),
      isDemo
        ? button("复制开始提示词", async () => {
          await copyText(buildRecallStartPrompt({ skillCards: [], entries: state.entries }));
          showToast("已复制开始复述提示词。");
        })
        : button("生成图", async () => {
          selectedCardId = card.id;
          imageOutput = "";
          mapPromptStatus = "";
          activeTab = "image";
          render();
          await generateAndCopyMapPrompt(card);
        })
    ])
  ]);
}

function renderLevelFilters() {
  const filters = ["all", "L0", "L1", "L2", "L3", "L4"];
  const labels = { all: "全部", L0: "L0", L1: "L1", L2: "L2", L3: "L3", L4: "L4" };
  return el("div", { className: "segmented" }, filters.map((filter) => el("button", {
    className: "segment",
    type: "button",
    "aria-selected": String(levelFilter === filter),
    text: labels[filter],
    onclick: () => {
      levelFilter = filter;
      render();
    }
  })));
}

function renderCardRow(card) {
  const stats = cardContentStats(card);
  return el("article", {
    className: "deck-row",
    onclick: () => {
      selectedCardId = card.id;
      cardView = "detail";
      cardDetailTab = "content";
      render();
    }
  }, [
    el("span", { className: "row-icon" }, icon(cardIcon(card))),
    el("div", { className: "row-main" }, [
      el("div", { className: "row-title", text: card.name }),
      el("div", { className: "row-sub", text: `${stats.blocks} 模块 · ${stats.sources} 来源 · 下一步：${nextLevelAction(card)}` })
    ]),
    levelChip(card.level),
    el("span", { className: "chevron" }, icon("chevron-right"))
  ]);
}

function renderChatGPTReviewScreen() {
  const card = selectedCard();
  const stage = stageTrainingConfig(card);
  const session = ensureChatGPTReviewSession(card);
  const outputInput = el("textarea", {
    className: "textarea chatgpt-settlement-input",
    placeholder: "完成两轮复述后，粘贴 ChatGPT 最后的 knowledge_ledger_update 代码块或整段结算回复",
    value: session.rawOutput,
    oninput: (event) => {
      session.rawOutput = event.target.value;
      session.analysis = null;
      session.report = null;
      session.error = "";
      session.phase = "awaiting-output";
    }
  });
  return el("main", { className: "screen" }, [
    renderSubHead(`ChatGPT ${stage.title}`, returnToDeck),
    button("改在知行簿内训练", () => startCodexTraining(card), "primary"),
    renderChatGPTReviewProgress(session.analysis ? "preview" : "prepare"),
    el("section", { className: "review-context-strip" }, [
      el("span", { className: "row-icon" }, icon(cardIcon(card))),
      el("div", { className: "review-context-main" }, [
        el("div", { className: "review-context-title-row" }, [
          el("strong", { text: card.name }),
          levelChip(card.level)
        ]),
        el("p", { className: "copy", text: `${reviewReason(card)} · 本轮目标：${stage.title}` })
      ])
    ]),
    el("section", { className: "chatgpt-review-intro" }, [
      el("div", { className: "chatgpt-review-icon" }, icon("book-open-check")),
      el("div", {}, [
        el("div", { className: "panel-title", text: "让 ChatGPT 完成灵活追问" }),
        el("p", { className: "copy", text: "插件提供完整技能卡与训练边界；ChatGPT 负责出题、反馈和二次复述，最后返回结构化结算。" })
      ])
    ]),
    el("section", { className: "external-review-step" }, [
      renderStepLabel("1", "把本轮训练交给 ChatGPT"),
      el("p", { className: "copy", text: "提示词只包含当前技能卡、相关台账和当前等级要求，不会自动发送。" }),
      button("复制完整训练提示词", async () => {
        await copyText(session.prompt);
        session.phase = "awaiting-output";
        render();
        showToast("训练提示词已复制，请粘贴到当前 ChatGPT 对话。");
      }, "primary wide"),
      el("details", { className: "review-reference" }, [
        el("summary", { text: "查看训练提示词" }),
        el("textarea", {
          className: "textarea prompt-preview",
          value: session.prompt,
          readonly: true
        })
      ])
    ]),
    el("section", { className: "external-review-step" }, [
      renderStepLabel("2", "导入 ChatGPT 的最终结算"),
      el("p", { className: "copy", text: "训练结束后，让 ChatGPT 输出 knowledge_ledger_update。可以直接捕获当前页面的最新回复，也可以手动粘贴。" }),
      button(session.isAnalyzing ? "正在捕获…" : "捕获 ChatGPT 最新结算", () => captureChatGPTReviewSettlement(card), "primary wide"),
      el("div", { className: "section-divider", text: "或手动粘贴" }),
      outputInput,
      button(session.isAnalyzing ? "解析中…" : "解析结算内容", () => analyzeChatGPTReviewSettlement(card), "wide"),
      session.error ? el("div", { className: "inline-alert error", text: session.error }) : null
    ]),
    session.analysis ? renderChatGPTSettlementPreview(card, session) : null
  ]);
}

function renderChatGPTSettlementPreview(originalCard, session) {
  const entry = session.analysis.entries[0];
  const importedCard = matchingImportedCard(originalCard, session.analysis);
  const imagePrompt = session.analysis.imagePrompts[0];
  const focusBlocks = [
    ["first_recall", "第一次复述"],
    ["feedback", "关键反馈"],
    ["second_recall", "第二次复述"],
    ["progress", "本轮进步"]
  ].map(([type, label]) => ({
    type,
    label,
    content: reviewBlockContent(importedCard, type)
  })).filter((item) => item.content);
  return el("section", { className: "chatgpt-review-preview" }, [
    renderStepLabel("3", "确认本轮结算"),
    el("div", { className: "external-result-overview" }, [
      el("div", { className: "external-score" }, [
        el("strong", { text: String(entry?.recallScore ?? 0) }),
        el("span", { text: "/3" })
      ]),
      el("div", { className: "external-result-main" }, [
        el("div", { className: "panel-title", text: entry?.theme || importedCard?.name || originalCard.name }),
        el("p", { className: "copy", text: entry?.status || "已识别 ChatGPT 复述结算" }),
        el("div", { className: "tag-row" }, [
          chip(entryKindLabel(entry?.kind)),
          chip(`${originalCard.level} → ${importedCard?.level || originalCard.level}`),
          chip(`${importedCard?.contentBlocks.length || 0} 个内容模块`)
        ])
      ])
    ]),
    focusBlocks.length ? el("div", { className: "settlement-focus-list" }, focusBlocks.map((item) => el("article", {
      className: `settlement-focus ${item.type}`
    }, [
      el("strong", { text: item.label }),
      el("p", { text: item.content })
    ]))) : null,
    importedCard?.contentBlocks.length ? el("details", { className: "review-reference settlement-all-blocks" }, [
      el("summary", { text: `查看全部 ${importedCard.contentBlocks.length} 个结算模块` }),
      el("div", { className: "preview-context-list" }, importedCard.contentBlocks.map((block) => el("div", { className: "preview-context-row" }, [
        el("strong", { text: block.title }),
        el("span", { text: blockContent(block) })
      ])))
    ]) : null,
    imagePrompt ? el("div", { className: "settlement-image-prompt" }, [
      el("div", { className: "panel-title", text: "无边记图片提示词" }),
      el("p", { className: "copy", text: imagePrompt.prompt }),
      button("复制图片提示词", async () => {
        await copyText(imagePrompt.prompt);
        showToast("图片提示词已复制，可以交给 ChatGPT 生成图片。");
      }, "compact")
    ]) : el("div", { className: "inline-alert", text: "本次结算没有图片提示词，确认写入后仍可在地图页根据技能卡重新生成。" }),
    el("section", { className: "rating-section external-rating-section" }, [
      el("div", { className: "panel-title", text: "确认这次提取难度" }),
      el("p", { className: "copy", text: "教练的 0–3 分记录能力证据；这里的难度只决定 FSRS 下次复习时间。" }),
      el("div", { className: "rating-grid" }, Object.entries(REVIEW_RATINGS).map(([key, rating]) => el("button", {
        className: "rating-option",
        type: "button",
        "aria-selected": String(session.rating === key),
        onclick: () => {
          session.rating = key;
          if (session.codexTrainingId && codexSession) { codexSession.rating = key; void persistTraining(codexSession); }
          render();
        }
      }, [
        el("strong", { text: rating.label }),
        el("small", { text: rating.description })
      ])))
    ]),
    session.report?.warnings.length ? el("details", { className: "warning-details" }, [
      el("summary", { text: `${session.report.warnings.length} 条需要确认` }),
      el("ul", {}, session.report.warnings.map((warning) => el("li", { text: warning })))
    ]) : null,
    el("div", { className: "actions vertical-actions" }, [
      button("确认写入并安排复习", () => confirmChatGPTReviewSettlement(originalCard), "primary"),
      session.codexTrainingId ? button("重新生成结算", async () => {
        codexSession.phase = "settlement";
        codexSession.turns = codexSession.turns.slice(0, -1);
        reviewSession = null;
        await runCodexTraining();
      }) : button("清除预览，重新解析", () => {
        session.analysis = null;
        session.report = null;
        session.error = "";
        session.phase = "awaiting-output";
        render();
      })
    ])
  ]);
}

function renderChatGPTReviewCompleteScreen() {
  const card = selectedCard();
  const result = reviewSession?.result;
  if (!result) {
    return el("main", { className: "screen" }, [
      renderSubHead("复习结算", returnToDeck),
      el("section", { className: "inline-alert error", text: "没有找到已确认的复习结算，请返回卡组重新开始。" })
    ]);
  }
  return el("main", { className: "screen" }, [
    renderSubHead("本轮已入账", returnToDeck),
    renderChatGPTReviewProgress("complete"),
    el("section", { className: "review-result-panel" }, [
      el("div", { className: "result-icon" }, icon("book-open-check")),
      el("div", { className: "eyebrow", text: card.name }),
      el("h2", { className: "result-title", text: `${result.score}/3 · ${nextDueSummary(result.schedule)}` }),
      el("span", { className: "status-pill ready", text: `提取难度：${result.ratingLabel}` }),
      el("p", { className: "copy", text: `FSRS 下次日期：${formatMonthDay(toISODate(new Date(result.schedule.due)))}` })
    ]),
    el("section", { className: "result-summary" }, [
      feedbackRow("能力等级", result.levelChanged
        ? `${result.previousLevel} → ${result.currentLevel}`
        : `${result.currentLevel}，本轮继续巩固`),
      feedbackRow("关键反馈", result.feedback || "本轮未提供明确反馈"),
      feedbackRow("本轮进步", result.progress || "已完成训练与结构化结算"),
      feedbackRow("下次复习", result.nextQuestion || "由当前等级重新生成题目")
    ]),
    result.imagePrompt ? el("section", { className: "settlement-image-prompt complete-image-prompt" }, [
      el("div", { className: "panel-title", text: "接着生成无边记图片" }),
      el("p", { className: "copy", text: result.imagePrompt }),
      el("div", { className: "actions vertical-actions" }, [
        button("复制并交给 ChatGPT 生成图片", async () => {
          await copyText(result.imagePrompt);
          showToast("图片提示词已复制。");
        }, "primary"),
        button("到地图页继续调整", () => {
          imageOutput = result.imagePrompt;
          activeTab = "image";
          cardView = "deck";
          reviewSession = null;
          render();
        })
      ])
    ]) : null,
    el("div", { className: "actions vertical-actions" }, [
      button("查看这张卡", () => {
        reviewSession = null;
        cardView = "detail";
        cardDetailTab = "evidence";
        render();
      }, "primary"),
      button("返回今日复习", returnToDeck)
    ])
  ]);
}

function renderChatGPTReviewProgress(active) {
  const steps = [
    ["prepare", "发送训练"],
    ["preview", "解析结算"],
    ["complete", "确认入账"]
  ];
  const activeIndex = Math.max(0, steps.findIndex(([key]) => key === active));
  return el("div", { className: "external-review-progress" }, steps.map(([key, label], index) => el("div", {
    className: "external-review-progress-step",
    "data-state": index < activeIndex ? "done" : key === active ? "active" : "pending"
  }, [
    el("span", { text: String(index + 1) }),
    el("strong", { text: label })
  ])));
}

function renderRecallScreen() {
  const card = selectedCard();
  ensureReviewSession(card);
  const stage = stageTrainingConfig(card);
  const answerInput = textareaSmall(reviewSession.firstAnswer, "先不用看卡片，写下或粘贴你的第一次回答");
  answerInput.addEventListener("input", () => {
    reviewSession.firstAnswer = answerInput.value;
  });
  return el("main", { className: "screen" }, [
    renderSubHead(stage.title, returnToDeck),
    renderReviewProgress("question"),
    el("section", { className: "review-context-strip" }, [
      el("span", { className: "row-icon" }, icon(cardIcon(card))),
      el("div", { className: "review-context-main" }, [
        el("div", { className: "review-context-title-row" }, [
          el("strong", { text: card.name }),
          levelChip(card.level)
        ]),
        el("p", { className: "copy", text: reviewReason(card) })
      ])
    ]),
    el("section", { className: "review-question-panel" }, [
      el("div", { className: "review-timer-row" }, [
        el("div", {}, [
          el("div", { className: "eyebrow", text: stage.eyebrow }),
          el("div", { className: "timer-time", text: formatReviewTimer(reviewSession.timerRemaining) })
        ]),
        button(reviewSession.timerRunning ? "计时中" : "开始 30 秒", startReviewTimer, "compact")
      ]),
      el("h2", { className: "recall-question", text: reviewSession.question }),
      el("div", { className: "requirement-row" }, stage.requirements.map(chip)),
      answerInput,
      el("div", { className: "actions vertical-actions" }, [
        button("完成第一次回答", () => requestReviewFeedback(card), "primary"),
        button("复制题目到 ChatGPT", async () => {
          await copyText(buildRecallPromptForCard(card));
          showToast("已复制本轮题目。");
        })
      ]),
      el("details", { className: "review-reference" }, [
        el("summary", { text: "回答困难时查看知识卡" }),
        el("p", { className: "copy", text: buildReviewReference(card) })
      ])
    ])
  ]);
}

function renderFeedbackScreen() {
  const card = selectedCard();
  ensureReviewSession(card);
  const feedback = reviewSession.feedback || buildLocalReviewFeedback(card);
  const continueButton = button("进行二次回答", () => {
    if (!reviewSession.rating) return;
    clearReviewTimer();
    cardView = "retry";
    reviewSession.phase = "retry";
    render();
  }, "primary");
  continueButton.disabled = !reviewSession.rating;
  return el("main", { className: "screen" }, [
    renderSubHead("核对与反馈", () => {
      cardView = "recall";
      reviewSession.phase = "question";
      render();
    }),
    renderReviewProgress("feedback"),
    el("section", { className: "answer-review" }, [
      el("div", { className: "eyebrow", text: "你的第一次回答" }),
      el("p", { className: "evidence-quote", text: reviewSession.firstAnswer })
    ]),
    el("section", { className: "feedback-focus" }, [
      el("div", { className: "feedback-source-row" }, [
        el("div", { className: "panel-title", text: "只修正一个关键缺口" }),
        el("span", {
          className: `status-pill ${reviewSession.feedbackSource === "DeepSeek" ? "ready" : ""}`,
          text: isReviewFeedbackLoading ? "分析中" : reviewSession.feedbackSource || "本地核对"
        })
      ]),
      feedback.strength ? feedbackBlock("已经抓住", feedback.strength, "strength") : null,
      feedbackBlock("最大缺口", feedback.gap, "gap"),
      feedbackBlock("需要补上", feedback.correction, "correction"),
      reviewSession.feedbackError
        ? el("p", { className: "privacy-note", text: reviewSession.feedbackError })
        : null
    ]),
    el("section", { className: "rating-section" }, [
      el("div", { className: "panel-title", text: "这次提取有多困难？" }),
      el("p", { className: "copy", text: "这个评价只决定下次复习时间，不直接决定 L0-L4。" }),
      el("div", { className: "rating-grid" }, Object.entries(REVIEW_RATINGS).map(([key, rating]) => el("button", {
        className: "rating-option",
        type: "button",
        "aria-selected": String(reviewSession.rating === key),
        onclick: () => {
          reviewSession.rating = key;
          render();
        }
      }, [
        el("strong", { text: rating.label }),
        el("small", { text: rating.description })
      ])))
    ]),
    el("details", { className: "review-reference" }, [
      el("summary", { text: "查看技能卡参考内容" }),
      el("p", { className: "copy", text: buildReviewReference(card) })
    ]),
    continueButton
  ]);
}

function renderReviewRetryScreen() {
  const card = selectedCard();
  ensureReviewSession(card);
  const feedback = reviewSession.feedback || buildLocalReviewFeedback(card);
  const secondInput = textareaSmall(reviewSession.secondAnswer, "不用照抄参考内容，用自己的话重新回答");
  secondInput.addEventListener("input", () => {
    reviewSession.secondAnswer = secondInput.value;
  });
  return el("main", { className: "screen" }, [
    renderSubHead("二次回答", () => {
      cardView = "feedback";
      reviewSession.phase = "feedback";
      render();
    }),
    renderReviewProgress("retry"),
    el("section", { className: "retry-panel" }, [
      el("div", { className: "eyebrow", text: "只针对刚才的缺口" }),
      el("h2", { className: "recall-question", text: feedback.retryQuestion }),
      el("p", { className: "review-correction", text: feedback.correction }),
      secondInput
    ]),
    button("完成并安排下次复习", () => completeReview(card), "primary wide")
  ]);
}

function renderReviewCompleteScreen() {
  const card = selectedCard();
  const result = reviewSession?.result;
  if (!result) {
    returnToDeck();
    return el("main", { className: "screen" });
  }
  const nextPlan = buildReviewPlan(allRealCards()).queue.filter((item) => item.id !== card.id);
  return el("main", { className: "screen" }, [
    renderSubHead("本轮完成", returnToDeck),
    renderReviewProgress("complete"),
    el("section", { className: "review-result-panel" }, [
      el("div", { className: "result-icon" }, icon("book-open-check")),
      el("div", { className: "eyebrow", text: card.name }),
      el("h2", { className: "result-title", text: `${result.ratingLabel} · ${nextDueSummary(result.schedule)}` }),
      el("p", { className: "copy", text: `下次日期：${formatMonthDay(toISODate(new Date(result.schedule.due)))}` })
    ]),
    el("section", { className: "result-summary" }, [
      result.levelChanged
        ? feedbackRow("能力证据", `${result.previousLevel} → ${result.currentLevel}`)
        : feedbackRow("能力等级", `${result.currentLevel}，本轮未升级`),
      feedbackRow("本轮修正", result.gap || "已完成两次提取"),
      feedbackRow("下次题型", result.nextQuestion)
    ]),
    el("div", { className: "actions vertical-actions" }, [
      nextPlan.length
        ? button("继续下一张", () => startReviewSession(nextPlan[0]), "primary")
        : button("返回今日复习", returnToDeck, "primary"),
      button("查看这张卡", () => {
        clearReviewTimer();
        reviewSession = null;
        cardView = "detail";
        cardDetailTab = "evidence";
        render();
      })
    ])
  ]);
}

function renderReviewProgress(active) {
  const order = ["question", "feedback", "retry", "complete"];
  const activeIndex = order.indexOf(active);
  const labels = {
    question: "第一次回答",
    feedback: "核对反馈",
    retry: "二次回答",
    complete: "安排复习"
  };
  return el("div", { className: "review-progress" }, order.map((step, index) => el("div", {
    className: "review-progress-step",
    "data-state": index < activeIndex ? "done" : index === activeIndex ? "active" : "pending"
  }, [
    el("span", { text: String(index + 1) }),
    el("small", { text: labels[step] })
  ])));
}

function feedbackBlock(label, text, variant) {
  return el("div", { className: `feedback-block ${variant}` }, [
    el("strong", { text: label }),
    el("p", { text: text || "等待本轮反馈。" })
  ]);
}

function renderCardDetail() {
  const card = selectedCard();
  const stats = cardContentStats(card);
  const detailTabs = [
    ["content", "知识内容"],
    ["evidence", "成长证据"],
    ["sources", "来源"]
  ];
  return el("main", { className: "screen" }, [
    renderSubHead(card.name, () => { cardView = "deck"; render(); }),
    el("section", { className: "card-level-summary" }, [
      levelChip(card.level),
      el("div", {}, [
        el("strong", { text: "等级由对话证据自动进化" }),
        el("p", { className: "copy", text: nextLevelAction(card) })
      ])
    ]),
    el("section", { className: "card-metrics" }, [
      stat("内容模块", String(stats.blocks)),
      stat("来源", String(stats.sources)),
      stat("成长证据", String(stats.evidence))
    ]),
    el("div", { className: "detail-tabs" }, detailTabs.map(([value, label]) => el("button", {
      className: "detail-tab",
      type: "button",
      "aria-selected": String(cardDetailTab === value),
      text: label,
      onclick: () => {
        cardDetailTab = value;
        render();
      }
    }))),
    cardDetailTab === "content" ? renderCardContent(card) : null,
    cardDetailTab === "evidence" ? renderCardEvidence(card) : null,
    cardDetailTab === "sources" ? renderCardSources(card) : null,
    el("div", { className: "actions vertical-actions" }, [
      button(nextLevelAction(card), () => startReviewSession(card), "primary"),
      button("导出 Markdown", async () => {
        await downloadText("ability-ledger.md", buildMarkdownExport(state), "text/markdown");
        showToast("已保存 Markdown 导出。");
      })
    ])
  ]);
}

function renderCardContent(card) {
  return el("section", { className: "detail-sections" }, [
    detailBlock("一句话", card.oneLine || "未填写", "pencil"),
    detailBlock("三句话", card.threeSentence || "未填写", "list-tree"),
    detailBlock("我的案例", card.myCase || "未填写", "pencil"),
    detailBlock("关联模型", card.relatedModels.join("、") || "未填写", "list-tree"),
    ...card.contentBlocks
      .filter((block) => !["example", "definition"].includes(block.type))
      .map((block) => detailBlock(
        block.title,
        block.items.length ? block.items.join("；") : block.text,
        "list-tree"
      ))
  ]);
}

function renderCardEvidence(card) {
  const history = historyForCard(card);
  return el("section", { className: "evidence-list" }, [
    card.reviewLogs.length ? el("section", { className: "panel review-log-panel" }, [
      el("div", { className: "panel-title", text: "复习记录" }),
      el("div", { className: "review-log-list" }, card.reviewLogs.slice().reverse().map((log) => el("article", { className: "review-log-row" }, [
        el("div", { className: "review-log-head" }, [
          el("strong", { text: `${log.stageLevel || card.level} · ${REVIEW_RATINGS[log.rating]?.label || "已复习"}` }),
          el("span", { className: "meta", text: formatEvidenceDate(log.reviewedAt) })
        ]),
        log.feedback ? el("p", { className: "copy", text: `本轮缺口：${log.feedback}` }) : null,
        log.secondAnswer ? el("p", { className: "evidence-quote", text: log.secondAnswer }) : null,
        el("span", { className: "meta", text: `下次：${formatMonthDay(toISODate(new Date(log.dueAfter)))}` })
      ])))
    ]) : null,
    ...(card.levelEvents.length
      ? card.levelEvents.slice().reverse().map((event) => el("article", { className: "evidence-item" }, [
        el("div", { className: "evidence-item-head" }, [
          el("strong", { text: EVIDENCE_TYPE_LABELS[event.type] || event.type }),
          levelChip(event.targetLevel)
        ]),
        el("p", { className: "copy", text: event.summary || "已记录成长证据。" }),
        event.userEvidence ? el("p", { className: "evidence-quote", text: event.userEvidence }) : null,
        el("span", { className: "meta", text: formatEvidenceDate(event.createdAt) })
      ]))
      : [empty("还没有成长证据。先完成当前等级对应的训练。")]),
    history.length ? el("section", { className: "panel" }, [
      el("div", { className: "panel-title", text: "关联台账" }),
      el("div", { className: "history-list" }, history.map((entry) => el("div", { className: "history-row" }, [
        el("span", { text: entry.date }),
        el("strong", { text: entry.kind === "capture" ? "已收录" : `评分 ${entry.recallScore}` }),
        el("span", { text: entry.application || entry.status || "已记录" })
      ])))
    ]) : null
  ]);
}

function renderCardSources(card) {
  return el("section", { className: "source-list" }, card.sources.length
    ? card.sources.map((source) => el("article", { className: "source-item" }, [
      el("div", { className: "source-item-head" }, [
        el("strong", { text: source.title }),
        el("span", { className: "source-type", text: source.type })
      ]),
      source.excerpt ? el("p", { className: "copy", text: source.excerpt }) : null,
      source.url ? el("a", { className: "source-link", href: source.url, target: "_blank", text: source.url }) : null,
      el("span", { className: "meta", text: formatEvidenceDate(source.capturedAt) })
    ]))
    : [empty("还没有保存来源。下次使用“收录当前学习”时会自动加入来源。")]);
}

function renderExplore() {
  const tree = activeKnowledgeTree();
  const evaluation = evaluateKnowledgeTree(tree, allRealCards());
  const recommendations = recommendKnowledgeNodes(tree, allRealCards(), 3);
  const activeNode = evaluation.byId.get(state.exploration.activeNodeId);
  const treeSelect = el("select", { className: "select explore-tree-select" }, state.knowledgeTrees.map((item) => el("option", {
    value: item.id,
    text: item.title,
    selected: item.id === tree.id
  })));
  treeSelect.addEventListener("change", async () => {
    await saveState({
      ...state,
      exploration: {
        activeTreeId: treeSelect.value,
        activeNodeId: "",
        learningStartedAt: ""
      }
    });
  });
  return el("main", { className: "screen explore-screen" }, [
    renderScreenHead("探索学习", "技能树决定接下来学什么；FSRS仍然只负责旧知识何时复习。"),
    el("section", { className: "panel explore-tree-summary" }, [
      el("div", { className: "explore-tree-picker" }, [
        el("span", { className: "eyebrow", text: "当前学习地图" }),
        treeSelect
      ]),
      el("div", { className: "explore-progress-row" }, [
        el("div", {}, [
          el("strong", { text: `${evaluation.summary.progress}%` }),
          el("span", { text: `已点亮 ${evaluation.summary.lit}/${evaluation.summary.total}` })
        ]),
        el("div", { className: "explore-progress-track" }, el("i", {
          style: `width:${evaluation.summary.progress}%`
        }))
      ]),
      el("div", { className: "explore-mini-stats" }, [
        stat("可学习", String(evaluation.summary.available)),
        stat("已应用", String(evaluation.summary.applied)),
        stat("待复习", String(evaluation.summary.due))
      ]),
      button("打开完整技能树", () => openExplorePage(), "primary")
    ]),
    activeNode ? el("section", { className: "active-learning-strip" }, [
      el("div", {}, [
        el("span", { className: "eyebrow", text: "正在学习" }),
        el("strong", { text: activeNode.title }),
        el("p", { className: "copy", text: "完成ChatGPT学习后，到“今日”导入结算，节点会根据证据自动点亮。" })
      ]),
      button("重新复制", () => startNodeLearning(tree, activeNode), "compact")
    ]) : null,
    el("section", { className: "explore-recommendations" }, [
      el("div", { className: "section-heading" }, [
        el("div", {}, [
          el("div", { className: "panel-title", text: "现在适合学习" }),
          el("p", { className: "copy", text: "只推荐已经满足硬前置的未点亮节点。" })
        ]),
        el("span", { className: "count-badge", text: String(recommendations.length) })
      ]),
      ...(recommendations.length
        ? recommendations.map((item, index) => renderExploreRecommendation(tree, item, index))
        : [el("div", { className: "empty-state" }, [
          el("div", { className: "empty-title", text: "当前没有可推荐的新节点" }),
          el("p", { className: "copy", text: "可以先完成被锁定节点的前置学习，或从已有卡片生成一张新的小树。" })
        ])])
    ]),
    el("section", { className: "panel explore-create-panel" }, [
      el("div", { className: "panel-title", text: "零散知识也可以形成路线" }),
      el("p", { className: "copy", text: "选择1–5张技能卡，让DeepSeek提出共同主题、附近缺口和前置关系；保存前必须预览确认。" }),
      button("从技能卡建立学习地图", () => openExplorePage("generate"))
    ])
  ]);
}

function renderExploreRecommendation(tree, item, index) {
  return el("article", { className: "explore-recommendation" }, [
    el("span", { className: "explore-rank", text: String(index + 1) }),
    el("div", { className: "explore-recommendation-main" }, [
      el("div", { className: "explore-node-title" }, [
        el("strong", { text: item.title }),
        el("span", { className: "branch-chip", text: item.branch })
      ]),
      el("p", { className: "copy", text: item.summary || item.description }),
      el("p", { className: "recommendation-reason", text: item.recommendationReason })
    ]),
    el("div", { className: "actions" }, [
      button("知行簿学习", () => startNodeCodexTraining(tree, item), "compact"),
      button("学习", () => startNodeLearning(tree, item), "compact")
    ])
  ]);
}

async function startNodeLearning(tree, node) {
  const evaluation = evaluateKnowledgeTree(tree, allRealCards());
  const evaluatedNode = evaluation.byId.get(node.id);
  if (!evaluatedNode || evaluatedNode.status === "locked") {
    showToast(`前置知识尚未满足：${evaluatedNode?.lockReasons.join("；") || "暂不可学习"}`);
    return;
  }
  const prerequisiteCards = evaluatedNode.incoming
    .map((item) => evaluation.byId.get(item.source))
    .flatMap((item) => item?.linkedCards || []);
  const prompt = buildKnowledgeNodeLearningPrompt({
    tree,
    node: evaluatedNode,
    prerequisiteCards,
    linkedCards: evaluatedNode.linkedCards
  });
  await copyText(prompt);
  await saveState({
    ...state,
    exploration: {
      activeTreeId: tree.id,
      activeNodeId: node.id,
      learningStartedAt: new Date().toISOString()
    }
  });
  showToast(`已复制“${node.title}”学习提示词。`);
}

async function openExplorePage(mode = "view") {
  const response = await chrome.runtime.sendMessage({
    type: "ABILITY_LEDGER_OPEN_EXPLORE",
    mode
  });
  if (!response?.ok) showToast(response?.error || "无法打开完整技能树。");
}

function activeKnowledgeTree() {
  return state.knowledgeTrees.find((tree) => tree.id === state.exploration.activeTreeId)
    || state.knowledgeTrees[0];
}

function renderImage() {
  const cards = allRealCards();
  if (!cards.length) {
    return el("main", { className: "screen" }, [
      renderScreenHead("知识地图", "把真实技能卡转成适合 Apple 无边记的图片提示词。"),
      el("section", { className: "empty-state map-empty" }, [
        el("div", { className: "empty-title", text: "还没有可生成地图的技能卡" }),
        el("p", { className: "copy", text: "演示卡不会进入地图。先完成一次今日结算，确认生成真实技能卡。" }),
        button("去今日结算", () => { activeTab = "today"; render(); }, "primary")
      ])
    ]);
  }
  if (!cards.some((card) => card.id === selectedCardId)) selectedCardId = cards[0].id;
  const smartMapEnabled = state.settings.deepseekEnabled && Boolean(deepseekApiKey);
  const cardSelect = el("select", { className: "select" }, cards.map((card) => el("option", {
    value: card.id,
    text: `${card.name} ${card.level}`,
    selected: card.id === selectedCardId
  })));
  cardSelect.addEventListener("change", () => {
    selectedCardId = cardSelect.value;
    imageOutput = "";
    mapPromptStatus = "";
    render();
  });
  const card = selectedCard();
  const output = el("textarea", {
    className: "textarea output",
    value: imageOutput,
    placeholder: "生成后的无边记图片提示词会出现在这里。"
  });
  output.addEventListener("input", () => { imageOutput = output.value; });
  const generateButton = button(
    isGeneratingMapPrompt
      ? "正在分析知识结构…"
      : smartMapEnabled
        ? "DeepSeek 自适应生成并复制"
        : "生成并复制图片提示词",
    () => generateAndCopyMapPrompt(card),
    "primary"
  );
  generateButton.disabled = isGeneratingMapPrompt;
  return el("main", { className: "screen" }, [
    renderScreenHead("知识地图", "选择一张卡和需要表达的内容，再交给 ChatGPT 生成图片。"),
    el("section", { className: "selected-card-panel" }, [
      el("div", { className: "row-icon large" }, icon("circle-dot")),
      el("div", {}, [
        el("div", { className: "row-title", text: card.name }),
        el("div", { className: "row-sub", text: "已选卡片" })
      ]),
      levelChip(card.level)
    ]),
    el("section", { className: "map-step" }, [
      renderStepLabel("1", "选择知识卡"),
      cardSelect,
      el("div", { className: "source-note", text: `将使用“${card.name}”中由你勾选且确实存在的知识内容。` })
    ]),
    el("section", { className: "map-step" }, [
      renderStepLabel("2", "选择地图内容"),
      el("div", { className: "module-grid" }, [
        mapModuleToggle("definition", "核心解释", Boolean(card.oneLine || card.threeSentence)),
        mapModuleToggle("scenario", "使用场景", Boolean(card.scenario)),
        mapModuleToggle("method", "行动方法", hasCardBlock(card, "method")),
        mapModuleToggle("example", "我的案例", Boolean(card.myCase)),
        mapModuleToggle("boundary", "适用边界", hasCardBlock(card, "boundary")),
        mapModuleToggle("related", "关联模型", Boolean(card.relatedModels.length))
      ]),
      el("div", { className: "style-options" }, ["手写白板", "课堂板书", "知识卡片"].map((style) => el("button", {
        className: "style-option",
        type: "button",
        "aria-selected": String(mapStyle === style),
        text: style,
        onclick: () => {
          mapStyle = style;
          imageOutput = "";
          mapPromptStatus = "";
          render();
        }
      })))
    ]),
    el("section", { className: "map-step prompt-output" }, [
      renderStepLabel("3", "生成并交给 ChatGPT"),
      output,
      el("div", {
        className: "source-note",
        text: mapPromptStatus || (smartMapEnabled
          ? "DeepSeek 会判断当前知识更适合流程图、因果图、对照图、边界图还是案例图。"
          : "当前使用本地内容驱动模板；在设置中启用 DeepSeek 后可自适应选择图形结构。")
      }),
      el("div", { className: "actions vertical-actions" }, [
        generateButton,
        button("保存记录", async () => {
          const prompt = imageOutput || buildMapPrompt(card);
          await saveState({
            ...state,
            imagePrompts: [{
              id: `image-${Date.now()}`,
              cardId: card.id,
              title: `${card.name}知识地图`,
              prompt,
              createdAt: new Date().toISOString()
            }, ...state.imagePrompts]
          });
          imageOutput = prompt;
          showToast("已保存图片提示词记录。");
        })
      ])
    ])
  ]);
}

function renderSettings() {
  const enabledToggle = el("input", {
    type: "checkbox",
    checked: state.settings.deepseekEnabled,
    onchange: async (event) => {
      if (event.target.checked && !apiKeyDraft.trim()) {
        event.target.checked = false;
        deepseekStatus = "请先填写并保存 API Key";
        render();
        return;
      }
      await saveState({
        ...state,
        settings: { ...state.settings, deepseekEnabled: event.target.checked }
      });
    }
  });
  const keyInput = el("input", {
    className: "input",
    type: "password",
    autocomplete: "off",
    placeholder: "sk-… 仅存储在本机扩展中",
    value: apiKeyDraft,
    oninput: (event) => { apiKeyDraft = event.target.value; }
  });
  const modelSelect = el("select", { className: "select" }, [
    el("option", {
      value: "deepseek-v4-flash",
      text: "DeepSeek V4 Flash（推荐）",
      selected: state.settings.deepseekModel === "deepseek-v4-flash"
    }),
    el("option", {
      value: "deepseek-v4-pro",
      text: "DeepSeek V4 Pro",
      selected: state.settings.deepseekModel === "deepseek-v4-pro"
    })
  ]);
  const backupInput = el("input", {
    className: "file-input",
    type: "file",
    accept: "application/json,.json",
    onchange: importBackup
  });
  return el("main", { className: "screen" }, [
    renderScreenHead("设置", "管理训练模型、智能解析和本地数据。"),
    renderCodexSettings(),
    el("section", { className: "settings-section" }, [
      el("div", { className: "settings-title-row" }, [
        el("div", {}, [
          el("div", { className: "panel-title", text: "AI 智能解析" }),
          el("p", { className: "copy", text: "用于陌生结算转换和知识地图自适应编排；卡组可选择 Codex 插件内训练，或原有 ChatGPT 网页流程。" })
        ]),
        el("label", { className: "switch" }, [
          enabledToggle,
          el("span", { className: "switch-track" })
        ])
      ]),
      el("label", { className: "field-label", text: "API Key" }),
      keyInput,
      el("label", { className: "field-label", text: "模型" }),
      modelSelect,
      el("div", { className: "connection-row" }, [
        el("span", { className: `connection-status ${deepseekStatus === "连接成功" ? "success" : ""}`, text: deepseekStatus }),
        el("div", { className: "actions" }, [
          button("保存", () => saveDeepSeekSettings(modelSelect.value), "primary"),
          button("测试连接", () => testDeepSeekConnection(modelSelect.value))
        ])
      ]),
      el("p", { className: "privacy-note", text: "只有你主动要求智能转换的结算文本，或生成地图时选中的知识内容会发送给 DeepSeek；Codex 训练内容不会经 DeepSeek 转发，API Key 也不会进入导出文件。" })
    ]),
    el("section", { className: "settings-section" }, [
      el("div", { className: "panel-title", text: "固定提示词" }),
      el("details", { className: "prompt-setting" }, [
        el("summary", { text: "收录当前学习" }),
        el("p", { className: "copy", text: "把书籍、文章或 AI 对话保存成内容丰富但等级保守的 L0 卡。" }),
        button("复制知识收录提示词", async () => {
          await copyText(buildKnowledgeCapturePrompt());
          showToast("已复制知识收录提示词。");
        }, "primary")
      ]),
      el("details", { className: "prompt-setting" }, [
        el("summary", { text: "开始今日复述" }),
        el("p", { className: "copy", text: "从已有技能卡中选择一个主题，先考后讲，完成两轮复述。" }),
        button("复制开始复述提示词", async () => {
          await copyText(buildRecallStartPrompt({ skillCards: state.skillCards, entries: state.entries }));
          showToast("已复制开始复述提示词。");
        }, "primary")
      ]),
      el("details", { className: "prompt-setting" }, [
        el("summary", { text: "第六步结算" }),
        el("p", { className: "copy", text: "把本次训练整理成台账、技能卡和下一次复述题。" }),
        button("复制第六步提示词", async () => {
          await copyText(buildSettlementPrompt());
          showToast("已复制第六步结算提示词。");
        })
      ])
    ]),
    el("section", { className: "settings-section" }, [
      el("div", { className: "panel-title", text: "使用帮助" }),
      el("p", { className: "copy", text: "重新查看收录、复习、生成知识图和备份数据的完整循环。" }),
      button("打开新手指南", openOnboarding, "primary")
    ]),
    el("section", { className: "settings-section" }, [
      el("div", { className: "panel-title", text: "数据与备份" }),
      el("div", { className: "data-summary" }, [
        stat("台账", String(state.entries.length)),
        stat("技能卡", String(state.skillCards.length)),
        stat("地图记录", String(state.imagePrompts.length))
      ]),
      el("div", { className: "actions vertical-actions" }, [
        button("导出 Markdown", async () => {
          await downloadText("ability-ledger.md", buildMarkdownExport(state), "text/markdown");
          showToast("已保存 Markdown 导出。");
        }, "primary"),
        button("导出 JSON", async () => {
          await downloadText("ability-ledger.json", JSON.stringify(state, null, 2), "application/json");
          showToast("已保存 JSON 导出。");
        }),
        el("label", { className: "button file-button" }, [
          el("span", { text: "导入 JSON 备份" }),
          backupInput
        ]),
        button("清空全部本地数据", clearAllData, "warn")
      ])
    ])
  ]);
}

function renderImportPreview() {
  const entry = importPreview.entries[0];
  const cards = importPreview.skillCards;
  const sourceLabel = importReport.sourceFormat.startsWith("deepseek")
    ? "DeepSeek 智能转换"
    : "本地格式识别";
  return el("section", { className: "preview-panel" }, [
    el("div", { className: "preview-head" }, [
      el("div", {}, [
        el("div", { className: "eyebrow", text: "写入前预览" }),
        el("div", { className: "panel-title", text: entry?.theme || cards[0]?.name || "待确认结算" })
      ]),
      el("span", { className: "source-badge", text: sourceLabel })
    ]),
    el("div", { className: "confidence-row" }, [
      el("span", { text: "字段完整度" }),
      el("div", { className: "confidence-track" }, [
        el("i", { style: `width:${importReport.confidence}%` })
      ]),
      el("strong", { text: `${importReport.confidence}%` })
    ]),
    entry ? el("article", { className: "preview-session" }, [
      el("div", { className: "preview-score" }, [
        entry.kind === "capture"
          ? el("strong", { className: "capture-mark", text: "收" })
          : el("strong", { text: String(entry.recallScore) }),
        el("span", { text: entry.kind === "capture" ? "录" : "/3" })
      ]),
      el("div", { className: "preview-main" }, [
        el("div", { className: "row-title", text: entry.theme }),
        entry.exposedIssue ? el("p", { className: "copy", text: `暴露问题：${entry.exposedIssue}` }) : null,
        entry.nextReview ? el("p", { className: "copy", text: `下次复述：${entry.nextReview}` }) : null,
        entry.nextReviewDate ? el("span", { className: "date-chip", text: entry.nextReviewDate }) : null
      ])
    ]) : null,
    cards.length ? el("div", { className: "preview-cards" }, cards.map((card) => el("article", { className: "preview-card" }, [
      el("div", { className: "preview-card-head" }, [
        el("strong", { text: card.name }),
        levelChip(card.level)
      ]),
      card.oneLine ? el("p", { className: "copy", text: card.oneLine }) : null,
      card.myCase ? el("p", { className: "evidence-line", text: `案例：${card.myCase}` }) : null,
      card.contentBlocks.length ? el("div", { className: "context-count", text: `已保留 ${card.contentBlocks.length} 个上下文模块` }) : null,
      el("div", { className: "preview-metrics" }, [
        chip(`${card.sources.length} 个来源`),
        chip(`${card.levelEvents.length} 条成长证据`)
      ]),
      card.contentBlocks.length ? el("details", { className: "preview-context" }, [
        el("summary", { text: "查看代表性上下文" }),
        el("div", { className: "preview-context-list" }, card.contentBlocks.slice(0, 4).map((block) => el("div", { className: "preview-context-row" }, [
          el("strong", { text: block.title }),
          el("span", { text: block.items.length ? block.items.join("；") : block.text })
        ]))),
        card.contentBlocks.length > 4
          ? el("div", { className: "meta", text: `另有 ${card.contentBlocks.length - 4} 个模块会一并保存。` })
          : null
      ]) : null,
      card.contentBlocks.length ? el("div", { className: "tag-row" }, card.contentBlocks.map((block) => chip(block.title))) : null
    ]))) : el("div", { className: "inline-alert", text: "本次没有识别到技能卡，只会写入每日台账。" }),
    importReport.warnings.length ? el("details", { className: "warning-details" }, [
      el("summary", { text: `${importReport.warnings.length} 条需要注意` }),
      el("ul", {}, importReport.warnings.map((warning) => el("li", { text: warning })))
    ]) : null,
    el("div", { className: "actions" }, [
      button(`确认写入 ${importReport.counts.entries} 条台账`, confirmImport, "primary"),
      button("取消", () => {
        importPreview = null;
        importReport = null;
        importError = "";
        render();
      })
    ])
  ]);
}

function renderTimelineEntry(entry) {
  const score = selectScore(entry.recallScore);
  score.addEventListener("change", async () => {
    await saveState({
      ...state,
      entries: state.entries.map((item) => item.id === entry.id
        ? { ...item, recallScore: Number(score.value) }
        : item)
    });
    showToast("评分已更新。");
  });
  return el("article", { className: "timeline-entry" }, [
    el("div", { className: "timeline-marker" }),
    el("div", { className: "timeline-content" }, [
      el("div", { className: "entry-head" }, [
        el("div", {}, [
          el("div", { className: "entry-title", text: entry.theme }),
          el("div", { className: "meta", text: `${entry.date}${entry.status ? ` · ${entry.status}` : ""}` })
        ]),
        el("div", { className: "entry-controls" }, [
          entry.kind === "capture" ? el("span", { className: "capture-badge", text: "知识收录" }) : score,
          button("删除", () => deleteTimelineEntry(entry.id), "warn compact entry-delete")
        ])
      ]),
      entry.newSkillCards.length ? el("div", { className: "tag-row" }, entry.newSkillCards.map((item) => chip(item))) : null,
      entry.application ? el("p", { className: "copy", text: `应用：${entry.application}` }) : null,
      entry.exposedIssue ? el("p", { className: "copy", text: `问题：${entry.exposedIssue}` }) : null,
      entry.nextReview ? el("p", { className: "next-review-line", text: `下次：${entry.nextReview}` }) : null
    ])
  ]);
}

function renderStepLabel(number, title) {
  return el("div", { className: "step-label" }, [
    el("span", { text: number }),
    el("strong", { text: title })
  ]);
}

function mapModuleToggle(id, label, available) {
  const selected = mapSections.has(id);
  return el("button", {
    className: "module-toggle",
    type: "button",
    disabled: !available,
    "aria-pressed": String(selected),
    onclick: () => {
      if (!available) return;
      if (selected) mapSections.delete(id);
      else mapSections.add(id);
      imageOutput = "";
      mapPromptStatus = "";
      render();
    }
  }, [
    el("span", { className: "module-check", text: selected ? "✓" : "" }),
    el("strong", { text: label }),
    el("small", { text: available ? (selected ? "已加入" : "未加入") : "暂无内容" })
  ]);
}

function hasCardBlock(card, type) {
  return card.contentBlocks.some((block) => block.type === type);
}

function buildMapPrompt(card) {
  const sectionLabels = {
    definition: "核心解释",
    scenario: "使用场景",
    method: "行动方法",
    example: "我的案例",
    boundary: "适用边界",
    related: "关联模型"
  };
  const available = {
    definition: Boolean(card.oneLine || card.threeSentence),
    scenario: Boolean(card.scenario),
    method: hasCardBlock(card, "method"),
    example: Boolean(card.myCase),
    boundary: hasCardBlock(card, "boundary"),
    related: Boolean(card.relatedModels.length)
  };
  const selectedIds = [...mapSections].filter((id) => available[id]);
  const selected = selectedIds.map((id) => sectionLabels[id]).filter(Boolean);
  const extra = [
    `本次只重点呈现这些模块：${selected.join("、") || "仅保留标题，不展开其他模块"}。`,
    "没有被选择的模块不要扩写，不要为了填满画面虚构内容。",
    "主示意图必须围绕当前知识本身，不要套用台账、等级或通用学习流程。"
  ].join("\n");
  return buildImagePrompt(card, extra, mapStyle, selectedIds);
}

async function generateAndCopyMapPrompt(card) {
  if (isGeneratingMapPrompt) return;
  const localPrompt = buildMapPrompt(card);
  const useDeepSeek = state.settings.deepseekEnabled && Boolean(deepseekApiKey);
  isGeneratingMapPrompt = true;
  mapPromptStatus = useDeepSeek
    ? "正在让 DeepSeek 判断最合适的知识结构…"
    : "正在使用本地内容驱动模板…";
  render();

  let prompt = localPrompt;
  let generatedBy = "本地规则";
  try {
    if (useDeepSeek) {
      const response = await chrome.runtime.sendMessage({
        type: "ABILITY_LEDGER_DEEPSEEK_IMAGE_PROMPT",
        apiKey: deepseekApiKey,
        model: state.settings.deepseekModel,
        sourcePrompt: localPrompt
      });
      if (!response?.ok) throw new Error(response?.error || "DeepSeek 图片提示词生成失败。");
      prompt = response.prompt;
      generatedBy = "DeepSeek";
      mapPromptStatus = "已由 DeepSeek 根据当前知识结构自适应生成。";
    } else {
      mapPromptStatus = "已使用本地内容驱动模板生成；未加入固定台账流程。";
    }
  } catch (error) {
    mapPromptStatus = `DeepSeek 未完成：${error.message || String(error)}。已自动使用本地模板。`;
  } finally {
    imageOutput = prompt;
    isGeneratingMapPrompt = false;
    render();
  }

  await copyText(prompt);
  showToast(`已用${generatedBy}生成并复制图片提示词。`);
}

function renderEntry(entry) {
  const score = selectScore(entry.recallScore);
  score.addEventListener("change", async () => {
    await saveState({
      ...state,
      entries: state.entries.map((item) => item.id === entry.id ? { ...item, recallScore: Number(score.value) } : item)
    });
    showToast("评分已更新。");
  });
  return el("article", { className: "entry" }, [
    el("div", { className: "entry-head" }, [
      el("div", {}, [
        el("div", { className: "entry-title", text: entry.theme }),
        el("div", { className: "meta", text: entry.date })
      ]),
      score
    ]),
    entry.newSkillCards.length ? el("div", { className: "tag-row" }, entry.newSkillCards.map((item) => el("span", { className: "tag", text: item }))) : null,
    entry.application ? el("p", { className: "copy", text: `应用场景：${entry.application}` }) : null,
    entry.exposedIssue ? el("p", { className: "copy", text: `暴露问题：${entry.exposedIssue}` }) : null,
    entry.nextReview ? el("p", { className: "copy", text: `下次复习：${entry.nextReview}` }) : null
  ]);
}

function renderScreenHead(title, subtitle) {
  return el("section", { className: "screen-head" }, [
    el("div", { className: "screen-head-row" }, [
      el("h1", { text: title }),
      activeTab === "settings" ? null : el("button", {
        className: "icon-button screen-settings-button",
        type: "button",
        title: "设置",
        "aria-label": "设置",
        onclick: () => {
          clearReviewTimer();
          activeTab = "settings";
          render();
          void chrome.storage.local.get(CODEX_CONNECTION_KEY).then(stored => { if (stored[CODEX_CONNECTION_KEY]?.token) void codexAction(); });
        }
      }, icon("settings"))
    ]),
    el("p", { text: subtitle })
  ]);
}

function renderSubHead(title, onBack) {
  return el("section", { className: "sub-head" }, [
    el("button", { className: "back-button", type: "button", title: "返回", "aria-label": "返回", onclick: onBack }, icon("chevron-left")),
    el("h1", { text: title }),
    el("button", { className: "icon-button", type: "button", title: "更多", "aria-label": "更多" }, icon("ellipsis"))
  ]);
}

function detailBlock(title, value, iconName) {
  return el("article", { className: "detail-block" }, [
    el("div", {}, [
      el("div", { className: "detail-title", text: title }),
      el("p", { className: "copy", text: value })
    ]),
    el("span", { className: "detail-icon" }, icon(iconName))
  ]);
}

function feedbackRow(label, value) {
  return el("div", { className: "feedback-row" }, [
    el("span", { text: label }),
    el("strong", { text: value })
  ]);
}

function allRealCards() {
  return state.skillCards;
}

function allCards() {
  return state.skillCards;
}

function filteredCards() {
  return allRealCards().filter((card) => levelFilter === "all" || card.level === levelFilter);
}

function selectedCard() {
  return allRealCards().find((card) => card.id === selectedCardId) || featuredCard();
}

function featuredCard() {
  const cards = allRealCards();
  return buildReviewPlan(cards).queue[0] || cards[0] || fallbackCard;
}

function historyForCard(card) {
  return state.entries
    .filter((entry) => entry.newSkillCards.includes(card.name) || entry.oldRecall === card.name || entry.theme.includes(card.name))
    .slice()
    .sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`))
    .slice(0, 4);
}

function entriesForDate(date) {
  return state.entries.filter((entry) => entry.date === date);
}

function dueCardsForDate(date) {
  return cardsDueForDate(allRealCards(), date).slice(0, 4);
}

function buildWeekDays() {
  const today = parseISODate(todayISO());
  const start = startOfWeek(today);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const iso = toISODate(date);
    return {
      iso,
      weekday: ["日", "一", "二", "三", "四", "五", "六"][date.getDay()],
      day: String(date.getDate()).padStart(2, "0"),
      label: iso === todayISO() ? "今日" : iso < todayISO() ? "已过" : relativeDayLabel(daysBetween(todayISO(), iso))
    };
  });
}

function orderedAgendaDays(days) {
  const selectedIndex = Math.max(0, days.findIndex((day) => day.iso === selectedAgendaDate));
  return [...days.slice(selectedIndex), ...days.slice(0, selectedIndex)];
}

function dayDotClass(iso) {
  const due = dueCardsForDate(iso).length;
  const completed = reviewsCompletedForDate(allRealCards(), iso);
  if (iso === todayISO()) return "today";
  if (completed) return "done";
  if (due) return "due";
  return "muted";
}

function startOfWeek(date) {
  const start = new Date(date);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  return start;
}

function relativeDayLabel(offset) {
  if (offset === 1) return "明天";
  if (offset === 2) return "后天";
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][parseISODate(addDays(todayISO(), offset)).getDay()];
}

function addDays(iso, offset) {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + offset);
  return toISODate(date);
}

function daysBetween(fromIso, toIso) {
  const from = parseISODate(fromIso);
  const to = parseISODate(toIso);
  return Math.round((to - from) / 86400000);
}

function parseISODate(iso) {
  const [year, month, day] = String(iso).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonthDay(iso) {
  const [, month, day] = iso.split("-");
  return `${month}/${day}`;
}

function buildRecallPromptForCard(card) {
  return buildRecallStartPrompt({
    skillCards: [card],
    entries: historyForCard(card)
  });
}

function ensureChatGPTReviewSession(card) {
  if (reviewSession?.cardId === card.id && reviewSession.prompt) return reviewSession;
  reviewSession = {
    cardId: card.id,
    phase: "prepare",
    prompt: buildRecallPromptForCard(card),
    rawOutput: "",
    analysis: null,
    report: null,
    error: "",
    isAnalyzing: false,
    result: null
  };
  return reviewSession;
}

async function captureChatGPTReviewSettlement(card) {
  const session = ensureChatGPTReviewSession(card);
  session.isAnalyzing = true;
  session.error = "";
  render();
  try {
    session.rawOutput = await captureLatestAssistant();
    await analyzeChatGPTReviewSettlement(card, { keepLoading: true });
  } catch (error) {
    session.error = error.message || String(error);
  } finally {
    session.isAnalyzing = false;
    render();
  }
}

async function analyzeChatGPTReviewSettlement(card, options = {}) {
  const session = ensureChatGPTReviewSession(card);
  if (!session.rawOutput.trim()) {
    session.error = "请先捕获或粘贴 ChatGPT 的最终复述结算。";
    render();
    return;
  }
  if (!options.keepLoading) {
    session.isAnalyzing = true;
    session.error = "";
    render();
  }
  try {
    const result = analyzeLedgerUpdate(session.rawOutput);
    if (!result.report.valid) {
      throw new Error(result.report.warnings[0] || "没有识别到有效的复述结算。");
    }
    if (!result.update.entries.length || !result.update.skillCards.length) {
      throw new Error("结算必须同时包含 session 和至少一张技能卡。");
    }
    session.analysis = result.update;
    session.report = result.report;
    session.rating = session.rating || reviewRatingFromScore(result.update.entries[0]?.recallScore);
    session.phase = "preview";
    session.error = "";
  } catch (error) {
    session.analysis = null;
    session.report = null;
    session.error = error.message || String(error);
  } finally {
    if (!options.keepLoading) {
      session.isAnalyzing = false;
      render();
    }
  }
}

async function confirmChatGPTReviewSettlement(originalCard) {
  const session = ensureChatGPTReviewSession(originalCard);
  if (session.committing || session.result) return;
  session.committing = true;
  try { await commitChatGPTReviewSettlement(originalCard); }
  catch (error) {
    session.result = null; session.phase = "preview"; session.error = error.message;
    cardView = session.codexTrainingId ? "codex-training" : "chatgpt-review";
    showToast(`写入失败：${error.message}`);
  } finally { session.committing = false; render(); }
}

async function commitChatGPTReviewSettlement(originalCard) {
  const session = ensureChatGPTReviewSession(originalCard);
  if (session.codexTrainingId && !allRealCards().some(c => c.id === originalCard.id)) throw new Error("知识卡已删除，未写入。");
  if (!session.analysis || !session.report?.valid || session.result) return;
  if (session.codexTrainingId && !session.rating) { session.error = "请先确认提取难度。"; showToast(session.error); return; }
  const entry = session.analysis.entries[0];
  const importedCard = matchingImportedCard(originalCard, session.analysis);
  if (!importedCard) {
    session.error = "没有找到与当前训练对应的技能卡。";
    render();
    return;
  }
  const reviewedAt = new Date();
  const score = Number(entry?.recallScore || 0);
  const ratingKey = session.rating || reviewRatingFromScore(score);
  const scheduleResult = applyReviewRating(originalCard.reviewSchedule, ratingKey, reviewedAt);
  const normalizedUpdate = {
    ...session.analysis,
    entries: session.analysis.entries.map((item, index) => index === 0 ? normalizeEntry({
      ...item,
      newSkillCards: [originalCard.name],
      oldRecall: originalCard.name
    }) : item),
    skillCards: session.analysis.skillCards.map((card) => card.id === importedCard.id
      ? normalizeSkillCard({
        ...card,
        id: originalCard.id,
        name: originalCard.name
      })
      : card),
    imagePrompts: session.analysis.imagePrompts.map((prompt) => ({
      ...prompt,
      cardId: originalCard.id,
      title: prompt.title === "无边记知识图" ? `${originalCard.name}知识图` : prompt.title
    }))
  };
  let nextState = reconcileActiveTreeLearning(applyLedgerUpdate(state, normalizedUpdate));
  const mergedCard = nextState.skillCards.find((card) => card.id === originalCard.id || card.name === originalCard.name);
  if (!mergedCard) {
    session.error = "技能卡合并失败，尚未写入任何数据。";
    render();
    return;
  }
  const feedback = reviewBlockContent(importedCard, "feedback");
  const firstAnswer = reviewBlockContent(importedCard, "first_recall");
  const secondAnswer = reviewBlockContent(importedCard, "second_recall");
  const progress = reviewBlockContent(importedCard, "progress");
  const nextQuestion = importedCard.nextReview
    || reviewBlockContent(importedCard, "open_question")
    || mergedCard.nextReview
    || stageTrainingConfig(mergedCard).question;
  const reviewLog = {
    id: `review-${Date.now()}`,
    ...scheduleResult.fsrsLog,
    stageLevel: originalCard.level,
    question: originalCard.nextReview || stageTrainingConfig(originalCard).question,
    firstAnswer,
    feedback,
    secondAnswer
  };
  const updatedCard = normalizeSkillCard({
    ...mergedCard,
    reviewSchedule: scheduleResult.schedule,
    reviewLogs: [...originalCard.reviewLogs, reviewLog],
    nextReview: nextQuestion,
    nextReviewDate: toISODate(new Date(scheduleResult.schedule.due)),
    updatedAt: reviewedAt.toISOString()
  });
  nextState = {
    ...nextState,
    skillCards: nextState.skillCards.map((card) => card.id === updatedCard.id ? updatedCard : card)
  };

  await chrome.storage.local.set({ [LEDGER_UNDO_STATE_KEY]: state });
  canUndoImport = true;
  undoActionKind = "import";
  session.phase = "complete";
  session.result = {
    score,
    ratingLabel: REVIEW_RATINGS[ratingKey].label,
    schedule: scheduleResult.schedule,
    previousLevel: originalCard.level,
    currentLevel: updatedCard.level,
    levelChanged: originalCard.level !== updatedCard.level,
    feedback,
    progress,
    nextQuestion,
    imagePrompt: normalizedUpdate.imagePrompts[0]?.prompt || ""
  };
  cardView = "chatgpt-review-complete";
  if (session.codexTrainingId) {
    nextState.trainingSessions = (nextState.trainingSessions || []).map(s => s.id === session.codexTrainingId
      ? { ...s, committed: true, phase: "complete", completedAt: reviewedAt.toISOString() } : s);
  }
  await saveState(nextState);
  if (session.codexTrainingId && codexSession?.id === session.codexTrainingId) codexSession.committed = true;
}

function matchingImportedCard(originalCard, update) {
  return update?.skillCards?.find((card) => card.name === originalCard.name)
    || update?.skillCards?.[0]
    || null;
}

function reviewBlockContent(card, type) {
  const block = card?.contentBlocks?.find((item) => item.type === type);
  return blockContent(block);
}

function blockContent(block) {
  if (!block) return "";
  return block.items?.length ? block.items.join("；") : block.text || "";
}

function reviewRatingFromScore(score) {
  return ["again", "hard", "good", "easy"][Math.min(3, Math.max(0, Number(score) || 0))];
}

function entryKindLabel(kind) {
  return {
    capture: "知识收录",
    recall: "独立复述",
    application: "现实应用",
    transfer: "迁移推演"
  }[kind] || "复述结算";
}

function startReviewSession(card) {
  if (state.settings.codexModel) { void startCodexTraining(card); return; }
  clearReviewTimer();
  selectedCardId = card.id;
  reviewSession = {
    cardId: card.id,
    phase: "prepare",
    prompt: buildRecallPromptForCard(card),
    rawOutput: "",
    analysis: null,
    report: null,
    error: "",
    isAnalyzing: false,
    result: null
  };
  cardView = "chatgpt-review";
  render();
}

function ensureReviewSession(card) {
  if (reviewSession?.cardId === card.id) return;
  const stage = stageTrainingConfig(card);
  reviewSession = {
    cardId: card.id,
    phase: "question",
    question: card.nextReview || stage.question,
    firstAnswer: "",
    secondAnswer: "",
    rating: "",
    feedback: null,
    feedbackSource: "",
    feedbackError: "",
    timerRemaining: 30,
    timerRunning: false,
    result: null
  };
}

function returnToDeck() {
  clearReviewTimer();
  reviewSession = null;
  cardView = "deck";
  render();
}

function startReviewTimer() {
  if (!reviewSession || reviewSession.timerRunning) return;
  reviewSession.timerRemaining = 30;
  reviewSession.timerRunning = true;
  const timerNode = root.querySelector(".timer-time");
  const timerButton = [...root.querySelectorAll("button")]
    .find((item) => item.textContent.includes("开始 30 秒"));
  if (timerButton) {
    timerButton.textContent = "计时中";
    timerButton.disabled = true;
  }
  reviewTimer = window.setInterval(() => {
    if (!reviewSession) return clearReviewTimer();
    reviewSession.timerRemaining = Math.max(0, reviewSession.timerRemaining - 1);
    if (timerNode) timerNode.textContent = formatReviewTimer(reviewSession.timerRemaining);
    if (reviewSession.timerRemaining <= 0) {
      clearReviewTimer();
      if (timerButton) timerButton.textContent = "时间到";
    }
  }, 1000);
}

function clearReviewTimer() {
  if (reviewTimer) window.clearInterval(reviewTimer);
  reviewTimer = null;
  if (reviewSession) reviewSession.timerRunning = false;
}

function formatReviewTimer(seconds) {
  return `00:${String(Math.max(0, seconds || 0)).padStart(2, "0")}`;
}

async function requestReviewFeedback(card) {
  if (!reviewSession?.firstAnswer.trim()) {
    showToast("请先完成第一次回答。");
    return;
  }
  clearReviewTimer();
  reviewSession.phase = "feedback";
  reviewSession.feedback = buildLocalReviewFeedback(card);
  reviewSession.feedbackSource = "本地核对";
  reviewSession.feedbackError = "";
  cardView = "feedback";
  const useDeepSeek = state.settings.deepseekEnabled && Boolean(deepseekApiKey);
  isReviewFeedbackLoading = useDeepSeek;
  render();
  if (!useDeepSeek) return;

  const sessionCardId = card.id;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "ABILITY_LEDGER_DEEPSEEK_REVIEW_FEEDBACK",
      apiKey: deepseekApiKey,
      model: state.settings.deepseekModel,
      input: {
        cardName: card.name,
        level: card.level,
        question: reviewSession.question,
        answer: reviewSession.firstAnswer,
        reference: buildReviewReference(card)
      }
    });
    if (!response?.ok) throw new Error(response?.error || "DeepSeek 反馈失败。");
    if (reviewSession?.cardId !== sessionCardId) return;
    reviewSession.feedback = response.feedback;
    reviewSession.feedbackSource = "DeepSeek";
  } catch (error) {
    if (reviewSession?.cardId !== sessionCardId) return;
    reviewSession.feedbackError = `${error.message || String(error)}，已使用本地核对。`;
  } finally {
    if (reviewSession?.cardId === sessionCardId) {
      isReviewFeedbackLoading = false;
      render();
    }
  }
}

function buildLocalReviewFeedback(card) {
  const stage = stageTrainingConfig(card);
  return {
    strength: "已经完成了一次不看原文的主动提取，这比重新阅读更能暴露真实缺口。",
    gap: stage.feedbackGap,
    correction: card.threeSentence || card.oneLine || "技能卡缺少可用于核对的核心解释，请先补充知识内容。",
    retryQuestion: stage.retryQuestion
  };
}

function buildReviewReference(card) {
  const blocks = card.contentBlocks
    .filter((block) => ["importance", "core_question", "reasoning", "method", "distinction", "boundary"].includes(block.type))
    .slice(0, 6)
    .map((block) => `${block.title}：${block.items.length ? block.items.join("；") : block.text}`)
    .filter((item) => !item.endsWith("："));
  return [
    card.oneLine ? `一句话：${card.oneLine}` : "",
    card.threeSentence ? `结构化解释：${card.threeSentence}` : "",
    card.myCase ? `我的案例：${card.myCase}` : "",
    ...blocks
  ].filter(Boolean).join("\n");
}

async function completeReview(card) {
  if (!reviewSession?.rating) {
    showToast("请先评价第一次提取的难度。");
    return;
  }
  if (!reviewSession.secondAnswer.trim()) {
    showToast("请先完成二次回答。");
    return;
  }
  const reviewedAt = new Date();
  const stage = stageTrainingConfig(card);
  const score = reviewScoreFromRating(reviewSession.rating);
  const scheduleResult = applyReviewRating(card.reviewSchedule, reviewSession.rating, reviewedAt);
  const successful = score >= 2;
  const evidenceType = {
    L0: "understanding",
    L1: "recall",
    L2: "application",
    L3: "transfer",
    L4: "transfer"
  }[card.level] || "understanding";
  const shouldRecordLevelEvidence = successful || card.level !== "L0";
  const event = shouldRecordLevelEvidence ? {
    type: successful ? evidenceType : "recall",
    targetLevel: successful ? stage.targetLevel : card.level,
    summary: successful
      ? `${EVIDENCE_TYPE_LABELS[evidenceType]}：完成两次主动提取。`
      : "本轮提取仍然困难，保留回答等待下次复习。",
    recallScore: score,
    userEvidence: reviewSession.secondAnswer.trim(),
    createdAt: reviewedAt.toISOString()
  } : null;
  const reviewLog = {
    id: `review-${Date.now()}`,
    ...scheduleResult.fsrsLog,
    stageLevel: card.level,
    question: reviewSession.question,
    firstAnswer: reviewSession.firstAnswer.trim(),
    feedback: reviewSession.feedback?.gap || "",
    secondAnswer: reviewSession.secondAnswer.trim()
  };
  const withEvidence = normalizeSkillCard({
    ...card,
    reviewSchedule: scheduleResult.schedule,
    reviewLogs: [...card.reviewLogs, reviewLog],
    levelEvents: event ? [...card.levelEvents, event] : card.levelEvents,
    updatedAt: reviewedAt.toISOString()
  });
  const nextStage = stageTrainingConfig(withEvidence);
  const nextQuestion = nextStage.question;
  const nextCard = normalizeSkillCard({
    ...withEvidence,
    nextReview: nextQuestion,
    nextReviewDate: toISODate(new Date(scheduleResult.schedule.due)),
    reviewSchedule: scheduleResult.schedule,
    reviewLogs: withEvidence.reviewLogs,
    updatedAt: reviewedAt.toISOString()
  });
  const entry = normalizeEntry({
    date: todayISO(),
    kind: successful ? evidenceType : "recall",
    theme: card.name,
    oldRecall: card.name,
    recallScore: score,
    application: ["L2", "L3", "L4"].includes(card.level) ? reviewSession.secondAnswer.trim() : "",
    exposedIssue: reviewSession.feedback?.gap || "",
    nextReview: nextQuestion,
    nextReviewDate: toISODate(new Date(scheduleResult.schedule.due)),
    status: "完成两次主动提取"
  });

  reviewSession.phase = "complete";
  reviewSession.result = {
    ratingLabel: REVIEW_RATINGS[reviewSession.rating].label,
    schedule: scheduleResult.schedule,
    previousLevel: card.level,
    currentLevel: nextCard.level,
    levelChanged: card.level !== nextCard.level,
    gap: reviewSession.feedback?.gap || "",
    nextQuestion
  };
  cardView = "complete";
  await saveState({
    ...state,
    entries: [...state.entries, entry],
    skillCards: state.skillCards.map((item) => item.id === card.id ? nextCard : item)
  });
}

function stageTrainingConfig(card) {
  const configs = {
    L0: {
      title: "理解确认",
      shortTitle: "理解",
      eyebrow: "请先用自己的话说明：",
      question: `${card.name}是什么？先说清核心含义即可。`,
      requirements: ["一句自己的话", "核心含义", "暂不看原文"],
      feedbackGap: "检查回答是否真正说出了核心含义，而不是只重复概念名称。",
      retryQuestion: `现在只用一句自己的话说明：${card.name}到底是什么？`,
      targetLevel: "L1"
    },
    L1: {
      title: "30秒复述",
      shortTitle: "复述",
      eyebrow: "请独立解释：",
      question: `${card.name}是什么，为什么重要？`,
      requirements: ["是什么", "为什么重要", "结构清楚"],
      feedbackGap: "检查回答是否同时说明了“是什么”和“为什么重要”。",
      retryQuestion: `请用三句话重新解释${card.name}：定义、价值、一个关键点。`,
      targetLevel: "L2"
    },
    L2: {
      title: "现实应用",
      shortTitle: "应用",
      eyebrow: "请结合真实场景：",
      question: `你会在什么真实问题中使用${card.name}？具体采取什么行动？`,
      requirements: ["我的场景", "具体行动", "结果或反馈"],
      feedbackGap: "检查回答是否包含自己的真实场景和可以执行的具体行动。",
      retryQuestion: `只选一个真实场景，说明你会怎样使用${card.name}采取行动。`,
      targetLevel: "L3"
    },
    L3: {
      title: "迁移挑战",
      shortTitle: "迁移",
      eyebrow: "请迁移到陌生问题：",
      question: `换一个没有练过的场景，如何使用${card.name}进行推演？`,
      requirements: ["陌生场景", "推演过程", "适用边界"],
      feedbackGap: "检查场景是否真的陌生，以及推演中是否说明了适用边界。",
      retryQuestion: `换一个新场景，用“判断依据、行动、边界”重新推演${card.name}。`,
      targetLevel: "L4"
    },
    L4: {
      title: "巩固复盘",
      shortTitle: "连接",
      eyebrow: "请进行模型检验：",
      question: `${card.name}与另一个相关模型有什么冲突、互补或边界？`,
      requirements: ["模型比较", "反例", "新连接"],
      feedbackGap: "检查回答是否形成了真实的模型比较，而不是分别复述两个定义。",
      retryQuestion: `选择一个相关模型，说明它与${card.name}的互补关系和一个冲突边界。`,
      targetLevel: "L4"
    }
  };
  return configs[card.level] || configs.L0;
}

function formatEvidenceDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未记录";
  return date.toLocaleDateString("zh-CN");
}

function nextLevel(level) {
  const order = ["L0", "L1", "L2", "L3", "L4"];
  const index = order.indexOf(level);
  return order[Math.min(order.length - 1, Math.max(0, index + 1))];
}

function cardIcon(card) {
  const name = card.name || "";
  if (name.includes("激励")) return "badge-dollar-sign";
  if (name.includes("反向")) return "rotate-ccw";
  if (name.includes("安全")) return "shield-check";
  return "circle-dot";
}

function levelChip(level) {
  return el("span", { className: `level-chip level-${level}`, text: level || "L0" });
}

function stat(label, value) {
  return el("div", { className: "stat" }, [
    el("span", { text: label }),
    el("strong", { text: value })
  ]);
}

function chip(text) {
  return el("span", { className: "tag", text });
}

function input(value, placeholder) {
  return el("input", { className: "input", value, placeholder });
}

function textareaSmall(value, placeholder) {
  return el("textarea", { className: "textarea small", value, placeholder });
}

function selectScore(value) {
  return el("select", { className: "select score-select" }, Object.entries(SCORE_LABELS).map(([score, label]) => el("option", {
    value: score,
    text: label,
    selected: Number(score) === Number(value)
  })));
}

function button(label, onclick, variant = "") {
  return el("button", {
    type: "button",
    className: `button ${variant}`.trim(),
    text: label,
    onclick
  });
}

function empty(text) {
  return el("div", { className: "empty", text });
}

async function captureAndAnalyze() {
  try {
    isAnalyzing = true;
    importError = "";
    render();
    draftText = await captureLatestAssistant();
    await analyzeDraft();
  } catch (error) {
    importError = error.message || String(error);
    isAnalyzing = false;
    render();
  }
}

async function analyzeDraft(options = {}) {
  if (!draftText.trim()) {
    importError = "请先捕获或粘贴一段结算内容。";
    render();
    return;
  }
  isAnalyzing = true;
  importError = "";
  importPreview = null;
  importReport = null;
  render();
  try {
    let localResult = null;
    let localError = null;
    if (!options.forceDeepseek) {
      try {
        localResult = analyzeLedgerUpdate(draftText);
      } catch (error) {
        localError = error;
      }
    }
    const shouldUseDeepSeek = options.forceDeepseek
      || !localResult?.report.valid
      || localResult.report.confidence < 70;
    if (shouldUseDeepSeek && state.settings.deepseekEnabled && deepseekApiKey) {
      const response = await chrome.runtime.sendMessage({
        type: "ABILITY_LEDGER_DEEPSEEK_EXTRACT",
        apiKey: deepseekApiKey,
        model: state.settings.deepseekModel,
        sourceText: draftText
      });
      if (!response?.ok) throw new Error(response?.error || "DeepSeek 智能解析失败。");
      const deepseekResult = analyzeLedgerUpdate(response.data);
      if (!deepseekResult.report.valid) {
        throw new Error("DeepSeek 返回了合法 JSON，但没有识别到可写入的真实信息。");
      }
      deepseekResult.report.sourceFormat = "deepseek-canonical-v2";
      localResult = deepseekResult;
    }
    if (!localResult?.report.valid) {
      throw localError || new Error(localResult?.report.warnings?.[0] || "没有识别到有效结算。");
    }
    importPreview = localResult.update;
    importReport = localResult.report;
  } catch (error) {
    importError = error.message || String(error);
  } finally {
    isAnalyzing = false;
    render();
  }
}

async function confirmImport() {
  if (!importPreview || !importReport?.valid) return;
  await chrome.storage.local.set({ [LEDGER_UNDO_STATE_KEY]: state });
  canUndoImport = true;
  undoActionKind = "import";
  const counts = importReport.counts;
  const nextState = reconcileActiveTreeLearning(applyLedgerUpdate(state, importPreview));
  draftText = "";
  importPreview = null;
  importReport = null;
  importError = "";
  await saveState(nextState);
  showToast(`已写入 ${counts.entries} 条台账和 ${counts.skillCards} 张技能卡。`);
}

function reconcileActiveTreeLearning(nextState) {
  const treeId = nextState.exploration?.activeTreeId;
  const nodeId = nextState.exploration?.activeNodeId;
  if (!treeId || !nodeId) return nextState;
  const tree = nextState.knowledgeTrees.find((item) => item.id === treeId);
  if (!tree) return nextState;
  const evaluation = evaluateKnowledgeTree(tree, nextState.skillCards);
  const node = evaluation.byId.get(nodeId);
  const linkedCard = node?.linkedCards?.[0];
  if (!linkedCard) return nextState;
  const linkedTree = linkCardToTreeNode(tree, nodeId, linkedCard.id);
  return normalizeState({
    ...nextState,
    knowledgeTrees: replaceKnowledgeTree(nextState.knowledgeTrees, linkedTree),
    exploration: {
      activeTreeId: treeId,
      activeNodeId: "",
      learningStartedAt: ""
    }
  });
}

async function deleteTimelineEntry(entryId) {
  if (undoActionKind !== "delete") {
    await chrome.storage.local.set({ [LEDGER_UNDO_STATE_KEY]: state });
  }
  canUndoImport = true;
  undoActionKind = "delete";
  await saveState({
    ...state,
    entries: state.entries.filter((entry) => entry.id !== entryId)
  });
  showToast("记录已删除，可从上方撤销。");
}

async function undoLastChange() {
  const stored = await chrome.storage.local.get(LEDGER_UNDO_STATE_KEY);
  if (!stored[LEDGER_UNDO_STATE_KEY]) {
    canUndoImport = false;
    undoActionKind = "";
    showToast("没有可撤销的数据变更。");
    return;
  }
  await chrome.storage.local.remove(LEDGER_UNDO_STATE_KEY);
  canUndoImport = false;
  undoActionKind = "";
  await saveState(stored[LEDGER_UNDO_STATE_KEY]);
  showToast("已撤销上一步数据变更。");
}

async function saveDeepSeekSettings(model) {
  deepseekApiKey = apiKeyDraft.trim();
  await chrome.storage.local.set({
    [DEEPSEEK_API_KEY_STORAGE_KEY]: deepseekApiKey
  });
  await saveState({
    ...state,
    settings: {
      ...state.settings,
      deepseekModel: model,
      deepseekEnabled: state.settings.deepseekEnabled && Boolean(deepseekApiKey)
    }
  });
  deepseekStatus = deepseekApiKey ? "已保存，等待测试" : "未配置";
  showToast(deepseekApiKey ? "DeepSeek 设置已保存。" : "已移除 DeepSeek API Key。");
}

async function testDeepSeekConnection(model) {
  if (!apiKeyDraft.trim()) {
    deepseekStatus = "请先填写 API Key";
    render();
    return;
  }
  deepseekStatus = "正在测试…";
  render();
  try {
    const response = await chrome.runtime.sendMessage({
      type: "ABILITY_LEDGER_DEEPSEEK_TEST",
      apiKey: apiKeyDraft.trim(),
      model
    });
    if (!response?.ok) throw new Error(response?.error || "连接失败");
    deepseekStatus = "连接成功";
  } catch (error) {
    deepseekStatus = error.message || String(error);
  }
  render();
}

async function importBackup(event) {
  if (codexController) { showToast("请先停止训练生成，再导入备份。"); event.target.value = ""; return; }
  clearTimeout(codexDraftTimer);
  codexSession = null;
  reviewSession = null;
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const nextState = normalizeState(parsed);
    if (!window.confirm(`将用备份中的 ${nextState.entries.length} 条台账和 ${nextState.skillCards.length} 张技能卡替换当前数据，继续吗？`)) {
      event.target.value = "";
      return;
    }
    await chrome.storage.local.set({ [LEDGER_UNDO_STATE_KEY]: state });
    canUndoImport = true;
    await saveState(nextState);
    showToast("JSON 备份已导入。");
  } catch (error) {
    showToast(`导入失败：${error.message || String(error)}`);
  } finally {
    event.target.value = "";
  }
}

async function clearAllData() {
  if (codexController) { showToast("请先停止训练生成，再清空数据。"); return; }
  clearTimeout(codexDraftTimer);
  codexSession = null;
  reviewSession = null;
  if (!window.confirm("确定清空全部台账、技能卡、训练过程、地图记录和本地连接设置吗？此操作不可撤销。Codex 账号可另在设置中退出。")) return;
  await chrome.storage.local.remove([
    LEDGER_STATE_KEY,
    LEDGER_UNDO_STATE_KEY,
    DEEPSEEK_API_KEY_STORAGE_KEY,
    ONBOARDING_VERSION_STORAGE_KEY,
    CODEX_CONNECTION_KEY
  ]);
  codexStatus = null;
  codexMessage = "";
  state = createEmptyState();
  deepseekApiKey = "";
  apiKeyDraft = "";
  deepseekStatus = "未连接";
  canUndoImport = false;
  selectedCardId = fallbackCard.id;
  activeTab = "cards";
  showOnboarding = true;
  onboardingStep = 0;
  render();
  showToast("本地数据已清空。");
}

async function captureLatestAssistant() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("没有可用的当前标签页。");
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "ABILITY_LEDGER_PAGE_ACTION",
    action: "capture-latest"
  });
  if (!response?.ok) throw new Error(response?.error || "捕获失败，请手动复制。");
  return response.text;
}

async function copyText(value) {
  await navigator.clipboard.writeText(value || "");
}

async function downloadText(filename, content, mimeType) {
  await chrome.runtime.sendMessage({
    type: "ABILITY_LEDGER_DOWNLOAD_TEXT",
    filename,
    content,
    mimeType
  });
}

function showToast(message) {
  toast = message;
  render();
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast = "";
    render();
  }, 2600);
}

function icon(name) {
  return el("img", {
    className: "icon-image",
    src: `../assets/lucide/${name}.svg`,
    alt: "",
    "aria-hidden": "true"
  });
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
  list.filter(Boolean).forEach((child) => {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

// Codex connection and durable in-panel training. Credentials stay outside ledger exports.
function renderCodexSettings() {
  const operation = codexStatus?.operation;
  const waiting = ["waiting", "exchanging", "fetching_models"].includes(operation?.state);
  const models = codexStatus?.models || [];
  const input = el("input", { className: "input", id: "codex-pair-code", type: "password", autocomplete: "off", placeholder: "启动窗口中的配对码" });
  const modelSelect = el("select", { className: "input", id: "codex-model", onchange: async event => {
    await saveState({ ...state, settings: { ...state.settings, codexModel: event.target.value, codexEffort: "" } });
  } }, [el("option", { value: "", text: "请选择模型", selected: !state.settings.codexModel }), ...models.map(m => el("option", {
    value: m.slug, text: m.display_name || m.slug, selected: state.settings.codexModel === m.slug
  }))]);
  const model = models.find(m => m.slug === state.settings.codexModel);
  const effort = el("select", { className: "input", id: "codex-effort", onchange: async event => {
    await saveState({ ...state, settings: { ...state.settings, codexEffort: event.target.value } });
  } }, [el("option", { value: "", text: "模型默认", selected: !state.settings.codexEffort }), ...(model?.supported_reasoning_levels || []).map(value => el("option", {
    value, text: value, selected: state.settings.codexEffort === value
  }))]);
  return el("section", { className: "settings-section codex-settings" }, [
    el("h2", { className: "panel-title", text: "Codex 学习教练" }),
    el("p", { className: "copy", text: "登录你的 ChatGPT 套餐，在知行簿完成出题、反馈、二次复述和确认入账。" }),
    el("p", { className: "copy", text: "先双击项目中的“启动知行簿”，保持启动窗口打开。首次使用需配对。" }),
    el("label", { className: "field-label", for: "codex-pair-code", text: "本地服务配对码" }), input,
    el("div", { className: "actions" }, [button("配对本地服务", () => codexAction(async () => { await codexClient.pair(input.value.trim()); })),
      button("检查连接", () => codexAction())]),
    el("p", { className: "copy", role: "status", text: codexBusy ? "正在连接…" : codexMessage || (codexStatus?.connection === "connected" ? "账号已登录" : "尚未连接 Codex") }),
    codexStatus ? el("div", {}, [
      el("p", { className: "copy", text: `模型目录：${models.length} 个${codexStatus.catalog_source ? ` · ${codexStatus.catalog_source}` : ""}` }),
      el("p", { className: "privacy-note", text: codexStatus.last_test ? `最近完成调用：${codexStatus.last_test.model} · ${new Date(codexStatus.last_test.completed_at * 1000).toLocaleString()}` : "尚未验证实际模型调用；登录与获取目录不代表推理成功。" }),
      operation?.error ? el("p", { className: "inline-alert error", text: `登录步骤未完成：${operation.error}。可刷新模型或重新登录。` }) : null,
      el("div", { className: "actions" }, [
        button(waiting ? "重新打开授权页" : "登录 Codex", () => waiting ? chrome.tabs.create({ url: operation.authorize_url }) : codexAction(async () => {
          codexStatus = await codexClient.request("/codex/oauth/start", {});
          if (codexStatus.operation?.authorize_url) await chrome.tabs.create({ url: codexStatus.operation.authorize_url });
        })),
        waiting ? button("取消登录", () => codexAction(() => codexClient.request("/codex/oauth/cancel", {}))) : null,
        codexStatus.connection === "connected" ? button("刷新模型", () => codexAction(() => codexClient.request("/codex/models/refresh", {}))) : null,
        codexStatus.connection === "connected" ? button("退出 Codex", () => codexAction(() => codexClient.request("/codex/logout", {}))) : null
      ]),
      waiting ? renderCodexCallbackRecovery() : null,
      el("label", { className: "field-label", for: "codex-model", text: "训练模型" }), modelSelect,
      el("label", { className: "field-label", for: "codex-effort", text: "推理强度" }), effort,
      button("测试模型调用", () => codexAction(async () => {
        if (!state.settings.codexModel) throw new Error("请先选择模型。");
        await codexClient.generate([{ role: "user", content: "只回答：连接成功" }], state.settings.codexModel, state.settings.codexEffort);
      }))
    ]) : null,
    el("p", { className: "privacy-note", text: "实验性 Codex 兼容连接。凭据由知行簿本地服务独立保存，不读取或修改 Codex CLI 登录。训练只发送当前卡片和本轮回答；限流或失败不会自动切换收费服务。" })
  ]);
}

function renderCodexCallbackRecovery() {
  const input = el("input", { className: "input", type: "url", id: "codex-callback", autocomplete: "off" });
  return el("details", {}, [el("summary", { text: "授权后没有返回？手动完成登录" }),
    el("label", { className: "field-label", for: "codex-callback", text: "粘贴授权后浏览器地址栏中的完整 localhost 回调地址" }), input,
    button("完成登录", () => codexAction(async () => {
      await codexClient.request("/codex/oauth/complete", { callback_url: input.value.trim() });
      input.value = "";
    }))]);
}

async function codexAction(action = async () => {}) {
  if (codexBusy) return;
  codexBusy = true;
  codexMessage = "";
  render();
  try {
    await action();
    codexStatus = await codexClient.request("/codex/status");
    codexMessage = codexStatus.reauth_required ? "登录已失效，请重新登录。" : codexStatus.connection === "connected" ? "账号已登录" : "本地服务已连接，请登录 Codex。";
  } catch (error) { codexMessage = error.message; }
  finally { codexBusy = false; render(); scheduleCodexPoll(); }
}

function scheduleCodexPoll() {
  clearTimeout(codexPollTimer);
  if (!["waiting", "exchanging", "fetching_models"].includes(codexStatus?.operation?.state)) return;
  codexPollTimer = setTimeout(() => void codexAction(), 1200);
}

async function persistTraining(session) {
  const history = state.trainingSessions || [];
  await saveState({ ...state, trainingSessions: [...history.filter(s => s.id !== session.id), { ...session, busy: false }] });
}

async function startCodexTraining(card) {
  if (codexController) { showToast("请先停止当前生成。"); return; }
  selectedCardId = card.id;
  activeTab = "cards";
  cardView = "codex-training";
  codexSession = (state.trainingSessions || []).findLast(s => s.cardId === card.id && !s.committed) || null;
  if (!codexSession) {
    codexSession = createTraining(card, state.settings.codexModel || "", state.settings.codexEffort || "");
    await persistTraining(codexSession);
  }
  if (codexSession.phase === "preview") {
    try {
      const checked = validateTrainingSettlement(codexSession, card, codexSession.settlement);
      reviewSession = { cardId: card.id, prompt: buildRecallPromptForCard(card), analysis: checked.update, report: checked.report,
        rating: codexSession.rating || "", codexTrainingId: codexSession.id, phase: "preview" };
    } catch (error) { codexSession.phase = "settlement"; codexSession.error = error.message; }
  }
  render();
  if (!codexSession.question) await runCodexTraining();
}

function renderCodexTraining() {
  const card = selectedCard();
  const s = codexSession;
  if (!s) return el("main", { className: "screen" }, [renderSubHead("知行簿训练", returnToDeck)]);
  const phaseLabels = { question: "准备题目", feedback: "核对第一次回答", settlement: "生成结算", preview: "确认结算" };
  const answer = el("textarea", { className: "textarea", id: "codex-answer", value: s.draft, disabled: s.busy || s.phase === "preview",
    placeholder: s.feedback ? "针对刚才的反馈，用自己的话重新回答" : "先不用看参考资料，用自己的话回答",
    oninput: event => { s.draft = event.target.value; clearTimeout(codexDraftTimer); codexDraftTimer = setTimeout(() => void persistTraining(s), 350); } });
  const stream = el("p", { className: "codex-stream", id: "codex-stream", text: codexStream || "正在思考…", role: "status" });
  const canAnswer = !s.busy && ((s.phase === "question" && s.question) || (s.phase === "feedback" && s.feedback));
  const preview = s.phase === "preview" && reviewSession?.analysis ? renderChatGPTSettlementPreview(card, reviewSession) : null;
  return el("main", { className: "screen codex-training" }, [
    renderSubHead("知行簿训练", () => { clearTimeout(codexDraftTimer); void persistTraining(s); returnToDeck(); }),
    el("section", { className: "review-context-strip" }, [el("strong", { text: card.name }), levelChip(card.level),
      el("span", { className: "copy", text: `${s.model || "未选模型"} · ${phaseLabels[s.phase] || s.phase}` })]),
    el("p", { className: "privacy-note", text: "训练和草稿保存在本地。确认入账前，不改变等级和复习日期。情境练习不等于真实应用。" }),
    ...s.turns.map((turn, index) => el("article", { className: `codex-turn ${turn.role}` }, [
      el("strong", { text: turn.role === "user" ? "我的回答" : "学习教练" }),
      el("p", { className: "codex-turn-text", text: s.phase === "preview" && index === s.turns.length - 1 ? turn.content.split("```knowledge_ledger_update")[0].trim() || "训练结束，请检查下方结算。" : turn.content })
    ])),
    !s.firstAnswer && !s.busy ? el("div", { className: "actions" }, [
      button(s.evidenceMode === "real-application" ? "切换为复述与情境练习" : "改为真实应用复盘", async () => {
        s.evidenceMode = s.evidenceMode === "real-application" ? "practice" : "real-application";
        s.question = ""; s.turns = []; s.draft = ""; s.error = "";
        await persistTraining(s);
        await runCodexTraining();
      })
    ]) : null,
    s.busy ? stream : null,
    s.error ? el("p", { className: "inline-alert error", role: "alert", text: s.error }) : null,
    s.busy ? button("停止生成", () => codexController?.abort()) : null,
    !s.busy && s.phase !== "preview" && !canAnswer ? button("重试本轮生成", runCodexTraining, "primary") : null,
    !s.busy && s.error && state.settings.codexModel && state.settings.codexModel !== s.model ? button("使用设置中的新模型重试", async () => {
      s.model = state.settings.codexModel; s.reasoningEffort = state.settings.codexEffort || "";
      await persistTraining(s); await runCodexTraining();
    }) : null,
    canAnswer ? el("section", { className: "codex-composer" }, [
      s.evidenceMode === "real-application" && !s.firstAnswer ? renderApplicationFields(s) : null,
      el("label", { className: "field-label", for: "codex-answer", text: s.feedback ? "第二次回答" : "第一次回答" }), answer,
      button(s.feedback ? "提交二次回答并结算" : "提交第一次回答", submitCodexAnswer, "primary")
    ]) : null,
    preview,
    el("details", {}, [el("summary", { text: "训练记录与退出" }),
      el("p", { className: "copy", text: "完整过程随 JSON / Markdown 导出。放弃只删除本轮训练，不改知识卡。" }),
      button("放弃并删除本轮训练", async () => {
        if (codexController) { showToast("请先停止生成。"); return; }
        if (!window.confirm("删除本轮未入账训练及草稿？")) return;
        await saveState({ ...state, trainingSessions: state.trainingSessions.filter(item => item.id !== s.id) });
        codexSession = null; returnToDeck();
      })])
  ]);
}

async function submitCodexAnswer() {
  const s = codexSession;
  if (s?.busy || !s?.draft.trim()) { showToast("请先写下你的回答。"); return; }
  clearTimeout(codexDraftTimer);
  if (!s.firstAnswer && s.evidenceMode === "real-application" && (!s.applicationAction.trim() || !s.applicationResult.trim())) {
    showToast("真实应用复盘需要填写实际行动和观察结果；尚未实践可切回情境练习。"); return;
  }
  const answer = s.draft.trim() + (!s.firstAnswer && s.evidenceMode === "real-application" ? `\n实际行动：${s.applicationAction.trim()}\n观察结果：${s.applicationResult.trim()}` : "");
  if (answer.length > 12000) { showToast("回答过长，请控制在 12000 字以内。"); return; }
  s.turns.push({ role: "user", content: answer });
  if (!s.firstAnswer) { s.firstAnswer = answer; s.phase = "feedback"; }
  else { s.secondAnswer = answer; s.phase = "settlement"; }
  s.draft = "";
  await persistTraining(s);
  await runCodexTraining();
}

async function runCodexTraining() {
  const s = codexSession;
  if (!s || s.busy || codexController) return;
  const card = allRealCards().find(c => c.id === s.cardId);
  if (!card) { s.error = "知识卡已删除，请返回卡组。"; render(); return; }
  const controller = new AbortController();
  codexController = controller;
  s.busy = true; s.error = ""; codexStream = ""; render();
  try {
    if (!s.model) {
      s.model = state.settings.codexModel || "";
      s.reasoningEffort = state.settings.codexEffort || "";
    }
    if (!s.model) throw new Error("请先到设置中配对服务、登录 Codex 并选择训练模型，然后回来重试。");
    const result = await codexClient.generate(trainingMessages(s, card), s.model, s.reasoningEffort, delta => {
      codexStream += delta;
      const node = document.getElementById("codex-stream");
      if (node) node.textContent = codexStream;
    }, controller.signal);
    if (s.phase === "settlement") {
      const checked = validateTrainingSettlement(s, card, result.text);
      s.settlement = result.text;
      s.phase = "preview";
      reviewSession = { cardId: card.id, prompt: buildRecallPromptForCard(card), rawOutput: result.text, analysis: checked.update,
        report: checked.report, rating: "", phase: "preview", codexTrainingId: s.id };
    } else if (s.phase === "question") s.question = result.text;
    else s.feedback = result.text;
    s.turns.push({ role: "assistant", content: result.text });
  } catch (error) { s.error = error.message || "训练失败，可以重试。"; }
  finally {
    s.busy = false; codexStream = ""; codexController = null;
    await persistTraining(s);
    render();
    if (cardView === "codex-training") {
      const destination = s.phase === "preview" ? document.querySelector(".chatgpt-review-preview") : [...document.querySelectorAll(".codex-turn.assistant")].at(-1);
      destination?.scrollIntoView({ block: "start" });
    }
  }
}

function renderNewTrainingMaterial() {
  const title = el("input", { className: "input", id: "codex-material-title", placeholder: "例如：机会成本" });
  const material = el("textarea", { className: "textarea", id: "codex-material", placeholder: "粘贴书摘、文章片段或学习笔记。它们是参考材料，不是你的掌握证据。" });
  return el("details", { className: "codex-new-material" }, [
    el("summary", { text: "从新材料开始训练" }),
    el("label", { className: "field-label", for: "codex-material-title", text: "学习主题" }), title,
    el("label", { className: "field-label", for: "codex-material", text: "参考材料" }), material,
    button("收录为 L0 并开始训练", async () => {
      if (!title.value.trim() || !material.value.trim()) { showToast("请填写主题和参考材料。"); return; }
      if (material.value.length > 30000 || title.value.length > 120) { showToast("主题最多 120 字，材料最多 30000 字。"); return; }
      const existing = allRealCards().find(c => c.name === title.value.trim());
      if (existing) { showToast("已有同名卡片，已打开已有卡训练；新材料尚未合并。"); await startCodexTraining(existing); return; }
      const card = normalizeSkillCard({ name: title.value.trim(), contentBlocks: [{ type: "note", title: "参考材料", text: material.value.trim() }],
        sources: [{ type: "manual", title: title.value.trim(), excerpt: material.value.trim() }],
        levelEvents: [{ type: "capture", targetLevel: "L0", summary: "用户确认收录参考材料，尚无掌握证据。" }] });
      await saveState({ ...state, skillCards: [...state.skillCards, card] });
      await startCodexTraining(card);
    }, "primary")
  ]);
}

async function startNodeCodexTraining(tree, node) {
  const evaluated = evaluateKnowledgeTree(tree, allRealCards()).byId.get(node.id);
  if (!evaluated || evaluated.status === "locked" || evaluated.status === "candidate") { showToast("请先满足前置条件并确认节点。"); return; }
  const existing = evaluated.linkedCards[0];
  const card = existing || normalizeSkillCard({ name: node.title,
    contentBlocks: [{ type: "note", title: "知识树学习线索", text: node.summary || node.description || node.title }],
    sources: [{ type: "manual", title: tree.title, excerpt: node.description || node.summary || node.title }],
    levelEvents: [{ type: "capture", targetLevel: "L0", summary: "从已确认知识树选择学习，尚未验证理解。" }] });
  await saveState({ ...state, skillCards: existing ? state.skillCards : [...state.skillCards, card],
    exploration: { activeTreeId: tree.id, activeNodeId: node.id, learningStartedAt: new Date().toISOString() } });
  await startCodexTraining(card);
}

function renderTrainingHistory() {
  const sessions = state.trainingSessions || [];
  if (!sessions.length) return null;
  return el("details", { className: "codex-history" }, [el("summary", { text: `训练记录 · ${sessions.length} 次` }),
    ...sessions.slice().reverse().map(session => el("details", {}, [
      el("summary", { text: `${session.cardName} · ${session.committed ? "已入账" : "未入账"} · ${new Date(session.createdAt).toLocaleDateString()}` }),
      ...session.turns.map(turn => el("div", {}, [el("strong", { text: turn.role === "user" ? "我的回答" : "学习教练" }), el("p", { text: turn.content })])),
      session.draft ? el("p", { text: `草稿：${session.draft}` }) : null,
      button("删除这次训练过程", async () => {
        if (codexController) { showToast("请先停止当前生成。"); return; }
        if (!window.confirm("删除这次训练对话与草稿？已确认入账的台账和成长证据仍然保留。")) return;
        clearTimeout(codexDraftTimer);
        if (codexSession?.id === session.id) codexSession = null;
        await saveState({ ...state, trainingSessions: state.trainingSessions.filter(s => s.id !== session.id) });
      })
    ]))
  ]);
}

function renderApplicationFields(session) {
  return el("div", {}, [["applicationAction", "实际做了什么"], ["applicationResult", "观察到什么结果（包括无效果或失败）"]].flatMap(([key, label]) => [
    el("label", { className: "field-label", for: `codex-${key}`, text: label }),
    el("textarea", { className: "textarea", id: `codex-${key}`, value: session[key], oninput: event => {
      session[key] = event.target.value;
      clearTimeout(codexDraftTimer);
      codexDraftTimer = setTimeout(() => void persistTraining(session), 350);
    } })
  ]));
}
