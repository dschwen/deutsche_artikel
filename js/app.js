import { loadCatalog } from "./catalog.js";
import {
  openStorage,
  reconcile,
  getState,
  presentNext,
  grade,
  skip,
  newSession,
  allowMoreNewWords,
  exportProgress,
  importProgress,
  validateBackup,
  eraseProgress,
} from "./storage.js";
const el = (id) => document.getElementById(id);
let db,
  catalog,
  current = null,
  feedback = null,
  busy = false,
  started = false,
  initialized = false,
  timer,
  sessionId;
const channel = globalThis.BroadcastChannel
  ? new BroadcastChannel("deutsche-artikel")
  : null;
const notify = () => channel?.postMessage("changed");
function showError(error) {
  el("error").textContent =
    `${error.message ?? error} Please retry the action or refresh. Your saved progress is kept.`;
  el("error").hidden = false;
  el("retry").hidden = false;
}
function clearError() {
  el("error").hidden = true;
  el("retry").hidden = true;
}
function setBusy(value) {
  busy = value;
  el("answer-fields").disabled = value || !!feedback || !initialized;
  el("next").disabled = value;
  el("start").disabled = value || !initialized;
  for (const id of ["revisit", "learn-more", "check-due"])
    el(id).disabled = value || !initialized;
}
async function action(fn) {
  if (busy) return;
  setBusy(true);
  clearError();
  try {
    await fn();
  } catch (e) {
    showError(e);
  } finally {
    setBusy(false);
  }
}
async function refreshOverview() {
  const state = await getState(db);
  const s = state.summary;
  el("due-count").textContent = s.due;
  el("learning-count").textContent = s.learning;
  el("new-count").textContent = s.newRemaining;
  el("totals").textContent =
    `${s.learned} words practiced · ${s.reviews} graded answers · ${s.reviews ? Math.round((s.correct / s.reviews) * 100) : 0}% correct choices (including guesses).`;
  sessionId = state.meta.find((m) => m.key === "sessionId")?.value;
  const completed = state.reviews.filter((r) =>
    state.presentations.some(
      (p) => p.id === r.presentationId && p.sessionId === sessionId,
    ),
  ).length;
  el("session-progress").textContent = started
    ? `${completed} answers this session`
    : "";
  const skipped = state.presentations.some(
    (p) => p.sessionId === sessionId && p.status === "skipped",
  );
  el("revisit").hidden = !skipped;
  el("learn-more").hidden = s.newRemaining > 0 || s.unintroduced === 0;
  el("learn-more").textContent =
    `Learn ${Math.min(10, s.unintroduced)} more words`;
  el("finished-reason").textContent =
    s.newRemaining === 0 && s.unintroduced > 0
      ? "Take a break or learn another set."
      : skipped
        ? "Revisit your skipped words."
        : "More reviews will appear automatically.";
  clearTimeout(timer);
  // Refresh at least every minute for day boundaries, due times, and other tabs.
  timer = setTimeout(
    () => backgroundRefresh(),
    Math.max(1000, Math.min(60000, s.nextDue - Date.now() + 100)) || 60000,
  );
  return state;
}
async function nextQuestion() {
  const wasFinished = !el("finished").hidden;
  current = await presentNext(db, catalog);
  feedback = null;
  el("welcome").hidden = true;
  el("study").hidden = !current;
  el("finished").hidden = !!current;
  if (current) {
    const item = catalog.items.find((i) => i.id === current.wordId);
    el("answer-form").reset();
    el("check").disabled = true;
    el("feedback").hidden = true;
    el("next").hidden = true;
    el("noun").textContent = item.noun;
    el("translation").textContent = item.english;
    const state = await getState(db);
    const card = state.cards.find((c) => c.wordId === item.id);
    el("word-kind").textContent =
      card.phase === "new"
        ? "New word"
        : card.phase === "review"
          ? "Review"
          : "Review";
    el("word-stats").textContent =
      `Presented ${card.presentationCount} times · ${card.reviewCount} graded · ${card.correctCount} correct · ${card.incorrectCount} incorrect · ${card.revealedCount} revealed · ${card.guessedCount} correct guesses.`;
    el("noun").focus();
  }
  await refreshOverview();
  if (!current && !wasFinished) el("finished-title").focus();
}
async function submit(selected) {
  if (!current || feedback) return;
  await action(async () => {
    feedback = await grade(
      db,
      catalog,
      current.id,
      selected,
      el("guessed").checked,
    );
    const item = feedback.contentSnapshot;
    el("feedback").className = feedback.outcome === "correct" ? "" : "again";
    el("feedback").replaceChildren();
    const title = document.createElement("strong");
    title.lang = "de";
    title.textContent = `${item.acceptedArticles.join(" / ")} ${item.noun}`;
    const detail = document.createElement("span");
    detail.textContent =
      feedback.outcome === "correct"
        ? feedback.guessed
          ? "Correct (guessed)."
          : "Correct."
        : feedback.outcome === "revealed"
          ? "Answer revealed."
          : "Incorrect.";
    el("feedback").append(title, detail);
    el("feedback").hidden = false;
    el("next").hidden = false;
    el("feedback").focus();
    await refreshOverview();
    notify();
  });
}
async function backgroundRefresh() {
  if (!db || busy || document.hidden) return;
  try {
    const state = await refreshOverview();
    if (started && !feedback) {
      const own =
        current && state.presentations.find((p) => p.id === current.id);
      if (!current || own?.status !== "open") await action(nextQuestion);
    }
  } catch (e) {
    showError(e);
  }
}
async function init() {
  await action(async () => {
    catalog = await loadCatalog();
    db = await openStorage((message) => {
      initialized = false;
      showError(new Error(message));
      setBusy(busy);
    });
    await reconcile(db, catalog);
    await refreshOverview();
    initialized = true;
    for (const id of ["start", "export", "import", "persist", "erase"])
      el(id).disabled = false;
    if (!navigator.storage?.persist) el("persist").hidden = true;
  });
}
el("start").onclick = () =>
  action(async () => {
    started = true;
    await nextQuestion();
  });
el("answer-form").onchange = () => {
  el("check").disabled = !document.querySelector(
    'input[name="article"]:checked',
  );
};
el("answer-form").onsubmit = (e) => {
  e.preventDefault();
  const selected = document.querySelector('input[name="article"]:checked');
  if (selected) submit(selected.value);
};
el("reveal").onclick = () => submit(null);
el("skip").onclick = () =>
  action(async () => {
    await skip(db, current.id);
    notify();
    await nextQuestion();
  });
el("next").onclick = () => action(nextQuestion);
el("revisit").onclick = () =>
  action(async () => {
    await newSession(db);
    await nextQuestion();
  });
el("learn-more").onclick = () =>
  action(async () => {
    await allowMoreNewWords(db);
    notify();
    await nextQuestion();
  });
el("check-due").onclick = () => action(nextQuestion);
el("retry").onclick = () => location.reload();
el("export").onclick = () =>
  action(async () => {
    const data = await exportProgress(db);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `german-articles-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
el("import").onchange = () =>
  action(async () => {
    const file = el("import").files[0];
    if (!file) return;
    try {
      const data = validateBackup(JSON.parse(await file.text()));
      if (
        !confirm(
          "Replace all progress in this browser with this backup? Export your current progress first if you want to keep it.",
        )
      )
        return;
      await importProgress(db, data, catalog);
      current = null;
      feedback = null;
      started = true;
      await nextQuestion();
    } finally {
      el("import").value = "";
    }
  });
el("erase").onclick = () =>
  action(async () => {
    if (
      !confirm(
        "Erase all saved progress in this browser? This cannot be undone without a backup.",
      )
    )
      return;
    await eraseProgress(db);
    await reconcile(db, catalog);
    current = null;
    feedback = null;
    started = false;
    el("study").hidden = true;
    el("finished").hidden = true;
    el("welcome").hidden = false;
    await refreshOverview();
  });
el("persist").onclick = () =>
  action(async () => {
    const kept = await navigator.storage.persist();
    el("storage-status").textContent = kept
      ? "Storage persistence enabled. Keep exporting backups; clearing site data still erases progress."
      : "The browser did not grant persistent storage. You can still export a backup.";
  });
channel && (channel.onmessage = () => backgroundRefresh());
window.addEventListener("focus", backgroundRefresh);
document.addEventListener("visibilitychange", backgroundRefresh);
init();
