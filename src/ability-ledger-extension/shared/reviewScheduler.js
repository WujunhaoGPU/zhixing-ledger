import {
  Rating,
  createEmptyCard,
  fsrs
} from "../vendor/ts-fsrs.mjs";

export const REVIEW_RATINGS = {
  again: {
    value: Rating.Again,
    label: "忘记",
    description: "没有想起来，或答案方向明显错误"
  },
  hard: {
    value: Rating.Hard,
    label: "困难",
    description: "依赖提示，或遗漏了关键关系"
  },
  good: {
    value: Rating.Good,
    label: "正常",
    description: "能够独立回答，只有小的遗漏"
  },
  easy: {
    value: Rating.Easy,
    label: "轻松",
    description: "快速、准确，而且能够补充例子或边界"
  }
};

const RATING_KEYS = Object.keys(REVIEW_RATINGS);
const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 3650,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ["10m"],
  relearning_steps: ["10m"]
});

export function normalizeReviewSchedule(value, fallbackDue = new Date()) {
  const source = value && typeof value === "object" ? value : {};
  const empty = createEmptyCard(toDate(source.due || fallbackDue));
  return {
    due: toDate(source.due || empty.due).toISOString(),
    stability: finiteNumber(source.stability, empty.stability),
    difficulty: finiteNumber(source.difficulty, empty.difficulty),
    elapsedDays: integer(source.elapsedDays ?? source.elapsed_days, empty.elapsed_days),
    scheduledDays: integer(source.scheduledDays ?? source.scheduled_days, empty.scheduled_days),
    learningSteps: integer(source.learningSteps ?? source.learning_steps, empty.learning_steps),
    reps: integer(source.reps, empty.reps),
    lapses: integer(source.lapses, empty.lapses),
    state: integer(source.state, empty.state),
    lastReview: source.lastReview || source.last_review
      ? toDate(source.lastReview || source.last_review).toISOString()
      : ""
  };
}

export function normalizeReviewLogs(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeReviewLog(item)).filter(Boolean);
}

export function applyReviewRating(schedule, ratingKey, reviewedAt = new Date()) {
  const rating = REVIEW_RATINGS[ratingKey];
  if (!rating) throw new Error("未知的复习评价。");
  const current = normalizeReviewSchedule(schedule, reviewedAt);
  const result = scheduler.next(toFsrsCard(current), toDate(reviewedAt), rating.value);
  return {
    schedule: fromFsrsCard(result.card),
    fsrsLog: {
      rating: ratingKey,
      ratingValue: rating.value,
      dueBefore: current.due,
      dueAfter: result.card.due.toISOString(),
      scheduledDays: result.card.scheduled_days,
      stability: result.card.stability,
      difficulty: result.card.difficulty,
      reviewedAt: toDate(reviewedAt).toISOString()
    }
  };
}

export function buildReviewPlan(cards, now = new Date(), limit = 3) {
  const endOfToday = endOfLocalDay(now);
  const candidates = (Array.isArray(cards) ? cards : [])
    .map((card) => ({
      card,
      schedule: normalizeReviewSchedule(card.reviewSchedule, card.nextReviewDate || card.createdAt || now)
    }));
  const dueReview = candidates
    .filter(({ card, schedule }) => card.level !== "L0" && toDate(schedule.due) <= endOfToday)
    .sort(compareReviewCandidates);
  const dueLearning = candidates
    .filter(({ card, schedule }) => card.level === "L0" && toDate(schedule.due) <= endOfToday)
    .sort(compareReviewCandidates);

  const queue = dueReview.slice(0, dueLearning.length ? Math.max(0, limit - 1) : limit);
  if (dueLearning.length && queue.length < limit) queue.push(dueLearning[0]);
  dueReview.slice(queue.filter(({ card }) => card.level !== "L0").length).forEach((candidate) => {
    if (queue.length < limit && !queue.some(({ card }) => card.id === candidate.card.id)) queue.push(candidate);
  });

  return {
    queue: queue.map(({ card }) => card),
    dueReview: dueReview.map(({ card }) => card),
    dueLearning: dueLearning.map(({ card }) => card),
    totalDue: dueReview.length + dueLearning.length
  };
}

export function cardsDueForDate(cards, date, today = new Date()) {
  const target = localDateISO(date);
  const todayIso = localDateISO(today);
  return (Array.isArray(cards) ? cards : []).filter((card) => {
    const schedule = normalizeReviewSchedule(card.reviewSchedule, card.nextReviewDate || card.createdAt || today);
    const due = localDateISO(schedule.due);
    return target === todayIso ? due <= target : due === target;
  });
}

export function reviewsCompletedForDate(cards, date) {
  const target = localDateISO(date);
  return (Array.isArray(cards) ? cards : []).reduce((total, card) => (
    total + normalizeReviewLogs(card.reviewLogs)
      .filter((log) => localDateISO(log.reviewedAt) === target).length
  ), 0);
}

export function reviewReason(card, now = new Date()) {
  const schedule = normalizeReviewSchedule(card.reviewSchedule, card.nextReviewDate || card.createdAt || now);
  if (card.level === "L0") return "新收录，尚未形成自己的理解";
  const overdue = differenceInCalendarDays(now, schedule.due);
  const logs = normalizeReviewLogs(card.reviewLogs);
  const lastRating = logs.at(-1)?.rating;
  if (overdue > 0) {
    return `已逾期 ${overdue} 天${lastRating && ["again", "hard"].includes(lastRating) ? "，上次提取仍然困难" : ""}`;
  }
  if (lastRating === "again") return "上次没有成功提取，今天需要重新学习";
  if (lastRating === "hard") return "上次依赖提示，今天需要独立回答";
  return schedule.reps ? "已到间隔复习时间" : "尚未建立稳定的复习记录";
}

export function nextDueSummary(schedule, now = new Date()) {
  const normalized = normalizeReviewSchedule(schedule, now);
  const due = toDate(normalized.due);
  const days = differenceInCalendarDays(due, now);
  if (days <= 0) return "今天稍后";
  if (days === 1) return "明天";
  return `${days} 天后`;
}

export function reviewScoreFromRating(ratingKey) {
  return {
    again: 0,
    hard: 1,
    good: 2,
    easy: 3
  }[ratingKey] ?? 0;
}

export function isReviewRating(value) {
  return RATING_KEYS.includes(value);
}

function normalizeReviewLog(value) {
  if (!value || typeof value !== "object") return null;
  const rating = String(value.rating || "").toLowerCase();
  if (!isReviewRating(rating)) return null;
  return {
    id: value.id || `review-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    rating,
    ratingValue: REVIEW_RATINGS[rating].value,
    stageLevel: String(value.stageLevel || ""),
    question: String(value.question || ""),
    firstAnswer: String(value.firstAnswer || ""),
    feedback: String(value.feedback || ""),
    secondAnswer: String(value.secondAnswer || ""),
    dueBefore: toDate(value.dueBefore || value.reviewedAt || new Date()).toISOString(),
    dueAfter: toDate(value.dueAfter || value.reviewedAt || new Date()).toISOString(),
    scheduledDays: integer(value.scheduledDays, 0),
    stability: finiteNumber(value.stability, 0),
    difficulty: finiteNumber(value.difficulty, 0),
    reviewedAt: toDate(value.reviewedAt || new Date()).toISOString()
  };
}

function toFsrsCard(schedule) {
  return {
    due: toDate(schedule.due),
    stability: schedule.stability,
    difficulty: schedule.difficulty,
    elapsed_days: schedule.elapsedDays,
    scheduled_days: schedule.scheduledDays,
    learning_steps: schedule.learningSteps,
    reps: schedule.reps,
    lapses: schedule.lapses,
    state: schedule.state,
    last_review: schedule.lastReview ? toDate(schedule.lastReview) : undefined
  };
}

function fromFsrsCard(card) {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review?.toISOString() || ""
  };
}

function compareReviewCandidates(a, b) {
  const dueDiff = toDate(a.schedule.due) - toDate(b.schedule.due);
  if (dueDiff) return dueDiff;
  if (a.schedule.lapses !== b.schedule.lapses) return b.schedule.lapses - a.schedule.lapses;
  return String(a.card.name).localeCompare(String(b.card.name), "zh-CN");
}

function endOfLocalDay(value) {
  const date = toDate(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function differenceInCalendarDays(a, b) {
  const first = startOfLocalDay(a);
  const second = startOfLocalDay(b);
  return Math.round((first - second) / 86400000);
}

function startOfLocalDay(value) {
  const date = toDate(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function localDateISO(value) {
  const date = toDate(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value);
  const text = String(value || "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T09:00:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function integer(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
