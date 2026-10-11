// The page talks only to this site's own server functions (api/*.js):
// /api/arcade calls the Arcade API with the key, /api/videoselz hands the
// finished product to Videoselz for Shopify and the videos. No key ever
// reaches the browser.
const VIDEOSELZ_OPS = new Set(["publish", "videos"]);
const endpoint = (op) => (VIDEOSELZ_OPS.has(op) ? "/api/videoselz" : "/api/arcade");

export const CONTACT = "yash@videoselz.com";

// The Arcade API procedure behind each step, shown in the "Behind the scenes" log.
export const ARCADE_CALL = {
  categories: "categories/list",
  category: "categories/get",
  createPattern: "patterns/create",
  refinePattern: "patterns/refine/edit",
  job: "jobs/get",
  createProduct: "products/create",
  product: "products/get",
  publish: "products/get",
  videos: "Videoselz videos",
};

const listeners = new Set();
export const onCall = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Runs one step. Throws an Error with a readable message on failure. */
export async function studio(op, input = {}, code) {
  const started = performance.now();
  let res;
  try {
    res = await fetch(endpoint(op), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, input, code }),
    });
  } catch {
    throw new Error(`Can't reach the server right now. Reload in a few seconds, or email ${CONTACT} if it keeps happening.`);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON: a platform error page.
  }
  const entry = { op, call: ARCADE_CALL[op] ?? op, status: res.status, ms: Math.round(performance.now() - started), at: new Date() };
  if (!["status", "checkCode", "job", "videos"].includes(op)) listeners.forEach((fn) => fn(entry));
  if (!res.ok || !body?.success) {
    const error = new Error(body?.error ?? `Videoselz answered ${res.status}. Email ${CONTACT} if this keeps happening.`);
    error.retry = !!body?.retry;
    throw error;
  }
  return body;
}

const RETRY_WAIT_MS = 5000;
const MAX_RETRIES = 12;

/**
 * Starts an Arcade job. One request key per click, so asking again while
 * Arcade is still starting the job reuses it instead of starting another.
 */
export async function startJob(op, input, code, onWaiting) {
  const requestKey = crypto.randomUUID();
  for (let attempt = 0; ; attempt++) {
    try {
      return await studio(op, { ...input, requestKey }, code);
    } catch (err) {
      if (!err.retry || attempt >= MAX_RETRIES) throw err;
      onWaiting?.();
      await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
    }
  }
}
