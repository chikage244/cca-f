// Minimal hash-based router.
// Route patterns look like "#/history/:index". Params are extracted from
// the hash and passed to the view's render(container, params).

let routes = [];
let defaultRoute = "#/";
let container = null;
let currentView = null;
let currentUnmount = null;

/**
 * Register a route.
 * @param {string} pattern - e.g. "#/", "#/quiz", "#/history/:index"
 * @param {{ render: Function, unmount?: Function }} view
 */
export function registerRoute(pattern, view) {
  const paramNames = [];
  const regexStr = pattern
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        paramNames.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  const regex = new RegExp(`^${regexStr}$`);
  routes.push({ pattern, regex, paramNames, view });
}

/**
 * Set the default route to use when no hash (or "#") is present.
 * @param {string} pattern
 */
export function setDefaultRoute(pattern) {
  defaultRoute = pattern;
}

/**
 * Initialize the router: set the mount container and start listening.
 * @param {HTMLElement} mountEl
 */
export function initRouter(mountEl) {
  container = mountEl;
  window.addEventListener("hashchange", handleRouteChange);
  handleRouteChange();
}

function parseHash() {
  let hash = window.location.hash || defaultRoute;
  if (hash === "#" || hash === "") hash = defaultRoute;
  // Strip a single trailing slash (except for the root route itself).
  if (hash.length > 2 && hash.endsWith("/")) hash = hash.slice(0, -1);
  return hash;
}

function matchRoute(hash) {
  for (const route of routes) {
    const m = route.regex.exec(hash);
    if (m) {
      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = m[i + 1];
      });
      return { route, params };
    }
  }
  return null;
}

function handleRouteChange() {
  if (!container) return;
  const hash = parseHash();
  const matched = matchRoute(hash) || matchRoute(defaultRoute);
  if (!matched) return;

  if (currentUnmount) {
    try {
      currentUnmount();
    } catch (err) {
      console.error("Error during view unmount:", err);
    }
    currentUnmount = null;
  }

  container.innerHTML = "";
  currentView = matched.route.view;
  currentView.render(container, matched.params);
  currentUnmount = typeof currentView.unmount === "function" ? currentView.unmount : null;

  document.dispatchEvent(
    new CustomEvent("routechange", { detail: { hash, params: matched.params } })
  );
}

/**
 * Navigate programmatically to a hash route.
 * @param {string} hash
 */
export function navigate(hash) {
  if (window.location.hash === hash) {
    handleRouteChange();
  } else {
    window.location.hash = hash;
  }
}
