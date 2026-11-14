import { DefaultScheduler } from "../vendor/fsrs.js";
export const CONFIG_ID = "ts-fsrs-6.0.0_fsrs7_steps-v1";
export const CONFIG = Object.freeze({
  version: "FSRS-7",
  desiredRetention: 0.9,
  enableShortTerm: true,
  learningSteps: ["1m", "10m"],
  relearningSteps: ["1m", "10m"],
  allowModelOverride: false,
  enableFuzz: false,
  maximumInterval: 365,
});
const scheduler = await DefaultScheduler(CONFIG);
function serialize(value) {
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, serialize(v)]),
    );
  return value;
}
export function restoreCard(card) {
  return {
    ...card,
    dueAt: new Date(card.dueAt),
    lastReviewAt:
      card.lastReviewAt === null ? null : new Date(card.lastReviewAt),
  };
}
export function validateStoredCard(card) {
  if (
    !card ||
    typeof card.cardId !== "string" ||
    !Number.isFinite(card.dueAt) ||
    !(card.lastReviewAt === null || Number.isFinite(card.lastReviewAt))
  )
    throw new Error("Invalid scheduler dates.");
  for (const key of [
    "stability",
    "stabilityFast",
    "difficulty",
    "reps",
    "lapses",
    "scheduledDays",
    "learningStep",
  ]) {
    if (!Number.isFinite(card[key]) || card[key] < 0)
      throw new Error(`Invalid scheduler field: ${key}`);
  }
  if (
    ![0, 1, 2, 3].includes(card.state) ||
    !["new", "learning", "review"].includes(card.scheduleStatus)
  )
    throw new Error("Invalid scheduler state.");
  // Exercise the library's own validation without mutating the imported card.
  scheduler.review({
    card: restoreCard(card),
    grade: 3,
    now: new Date(Math.max(card.dueAt, card.lastReviewAt ?? card.dueAt)),
  });
}
export function reviewCard({ storedCard, rating, nowMs, cardId }) {
  const card = storedCard
    ? restoreCard(storedCard)
    : scheduler.newCard({ cardId, now: new Date(nowMs) });
  const result = scheduler.review({
    card,
    grade: rating,
    now: new Date(nowMs),
  });
  return {
    nextStoredCard: serialize(result.card),
    dueAt: result.card.dueAt.getTime(),
    phase: result.card.state === 3 ? "relearning" : result.card.scheduleStatus,
    schedulerLog: serialize(result.revlog),
  };
}
