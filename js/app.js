// App entry point: registers routes, wires up the tab bar, applies the
// saved theme, and boots the router.

import { initRouter, registerRoute, setDefaultRoute } from "./router.js";
import { get, ensureSchema } from "./store.js";
import * as dashboard from "./dashboard.js";
import * as quiz from "./quiz.js";
import * as review from "./review.js";
import * as flashcards from "./flashcards.js";
import * as exam from "./exam.js";
import * as history from "./history.js";
import * as settings from "./settings.js";

function applySavedTheme() {
  const settingsData = get("settings", {});
  const theme = settingsData.theme || "system";
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") {
    root.setAttribute("data-theme", theme);
  } else {
    root.removeAttribute("data-theme");
  }
}

function syncTabBarActiveState() {
  const hash = window.location.hash || "#/";
  const tabs = document.querySelectorAll(".tab-bar__item");
  tabs.forEach((tab) => {
    const route = tab.dataset.route;
    const isActive = route === "#/" ? hash === "#/" || hash === "" || hash === "#" : hash.startsWith(route);
    tab.classList.toggle("is-active", isActive);
  });
}

function registerRoutes() {
  registerRoute("#/", dashboard);
  registerRoute("#/quiz", quiz);
  registerRoute("#/review", review);
  registerRoute("#/cards", flashcards);
  registerRoute("#/exam", exam);
  registerRoute("#/history", history);
  registerRoute("#/history/:index", history);
  registerRoute("#/settings", settings);
  setDefaultRoute("#/");
}

function boot() {
  ensureSchema();
  applySavedTheme();
  registerRoutes();

  const viewContainer = document.getElementById("view");
  initRouter(viewContainer);

  syncTabBarActiveState();
  document.addEventListener("routechange", syncTabBarActiveState);
}

boot();
