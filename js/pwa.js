const status = document.getElementById("offline-status");
const installButton = document.getElementById("install-app");
let installPrompt;
let offlineReady = false;
let setupMessage = "Preparing offline access…";
let updateReady = false;
function showStatus() {
  status.textContent = updateReady
    ? "Update downloaded. Close all trainer windows and reopen to use it."
    : offlineReady
      ? navigator.onLine
        ? "Ready for offline study."
        : "Offline — your words and progress are available."
      : setupMessage;
}
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener("click", async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  installButton.hidden = true;
  await prompt.prompt();
});
window.addEventListener("appinstalled", () => {
  installButton.hidden = true;
  installPrompt = null;
});
window.addEventListener("online", showStatus);
window.addEventListener("offline", showStatus);
async function prepareOffline() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    setupMessage =
      "Offline access requires HTTPS or localhost and a browser with service worker support.";
    showStatus();
    return;
  }
  showStatus();
  try {
    const registration = await navigator.serviceWorker.register(
      new URL("../sw.js", import.meta.url),
      { updateViaCache: "none" },
    );
    const watch = (worker) => {
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && registration.active) {
          updateReady = true;
          showStatus();
        } else if (worker.state === "redundant" && !offlineReady) {
          setupMessage = "Offline setup failed. Reopen while online to retry.";
          showStatus();
        }
      });
    };
    watch(registration.installing);
    registration.addEventListener("updatefound", () =>
      watch(registration.installing),
    );
    await navigator.serviceWorker.ready;
    offlineReady = true;
    updateReady = !!registration.waiting;
    showStatus();
  } catch {
    setupMessage =
      "Offline setup is unavailable. You can study online; reopen while online to retry.";
    showStatus();
  }
}
prepareOffline();
