import { randomUUID } from "node:crypto";

// Arcade API client (https://docs.arcade.ai). Runs only on the server
// (api/*.js), because it sends ARCADE_API_KEY.
//
// Every call is a POST with a JSON body to platform.arcade.ai/v1. Calls that
// start work take a requestId (idempotency key) and return a job, which is
// polled with jobs/get. Image URLs are short-lived, so they're read fresh
// rather than stored.

const BASE_URL = "https://platform.arcade.ai/v1";
// products/create can take a while to answer; the function itself may run 60 s.
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 2;

// Arcade's edge rejects requests without a User-Agent naming the client and a contact.
const userAgent = () => `arcade-videoselz/1.0 (${process.env.ARCADE_CONTACT || "yash@videoselz.com"})`;

export class ArcadeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    // 409: a request with the same requestId is still starting. The page
    // asks again with the same key, so no second job is started.
    this.retry = status === 409;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function errorMessage(status, data, text) {
  if (status === 401) return "The Arcade API key is missing, invalid or expired.";
  if (status === 403 && !data) return "Arcade's edge rejected the request (check the User-Agent).";
  if (status === 409) return "Arcade is still starting this. Retrying…";
  if (status === 429) return "Arcade is rate-limiting requests; try again in a minute.";
  const fieldErrors = data?.data?.fieldErrors;
  const detail = fieldErrors
    ? ` (${Object.entries(fieldErrors).map(([k, v]) => `${k}: ${[].concat(v).join(", ")}`).join("; ")})`
    : "";
  return `${data?.message ?? text ?? "Arcade request failed"}${detail}`.slice(0, 500);
}

/** One API call. Retries 429 and 5xx once; 409 goes back to the page to retry. */
async function call(procedure, body = {}) {
  if (!process.env.ARCADE_API_KEY) throw new ArcadeError("ARCADE_API_KEY isn't set on the server.", 500);
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE_URL}/${procedure}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.ARCADE_API_KEY}`,
          "Content-Type": "application/json",
          "User-Agent": userAgent(),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // A start call that timed out may still be running at Arcade; the
      // page's retry with the same requestId picks it up.
      if (body.requestId) throw new ArcadeError("Arcade is still starting this. Retrying…", 409);
      if (attempt < MAX_ATTEMPTS) continue;
      throw new ArcadeError(`Arcade didn't answer (${procedure}): ${error.message}`, 504);
    }

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Plain-text errors (400 malformed, 403 edge, 413).
    }
    if (res.ok) return data;

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 5) * 1000 : 1500);
      continue;
    }
    throw new ArcadeError(errorMessage(res.status, data, text), res.status);
  }
}

// `key` comes from the page, one per click, so asking again reuses the
// same requestId and Arcade doesn't start a second job.
const requestId = (what, key) =>
  `arcade-videoselz-${what}-${typeof key === "string" && /^[A-Za-z0-9-]{8,64}$/.test(key) ? key : randomUUID()}`.slice(0, 128);

/** Print categories (pillows, napkins, …); jewelry is made differently and isn't offered here. */
export async function listCategories() {
  const data = await call("categories/list");
  return (data?.items ?? [])
    .filter((c) => c.world === "print")
    .map((c) => ({ categoryId: c.categoryId, name: c.name, imageUrl: c.imageUrl ?? null, group: c.category?.name ?? null }));
}

/** A category's options for the current selections: only values that can be made are `available`. */
export async function getCategory(categoryId, selections = {}) {
  const data = await call("categories/get", { categoryId, selections });
  return {
    categoryId: data.categoryId,
    name: data.name,
    options: data.options,
    selections: data.selections,
    canManufacture: data.canManufacture,
  };
}

export function createPattern({ prompt, colors, key }) {
  return call("patterns/create", {
    requestId: requestId("pattern", key),
    prompt,
    ...(colors?.length ? { colors } : {}),
  });
}

export function refinePattern({ patternId, instruction, key }) {
  return call("patterns/refine/edit", { requestId: requestId("edit", key), patternId, instruction });
}

export function createProduct({ patternId, categoryId, selections, key }) {
  return call("products/create", {
    requestId: requestId("product", key),
    patternId,
    categoryId,
    selections,
    // Fills the product's print area whatever the pattern's shape; without
    // it products/create fails when the aspect ratios differ.
    fit: { mode: "fill" },
  });
}

export async function getPattern(patternId) {
  const p = await call("patterns/get", { patternId });
  return { patternId: p.patternId, imageUrl: p.imageUrl, thumbnailUrl: p.thumbnailUrl, prompt: p.prompt };
}

export async function getProduct(productId) {
  const p = await call("products/get", { productId });
  return {
    productId: p.productId,
    title: p.title,
    categoryId: p.categoryId,
    selectionLabel: p.selectionLabel,
    images: (p.images ?? []).map((img) => img.url).filter(Boolean),
    imageUrl: p.imageUrl,
    description: p.description ?? "",
    careInstructions: p.careInstructions ?? "",
    maker: p.maker?.name ?? null,
    unitPrice: p.unitPrice ?? null,
    patternId: p.patternId,
  };
}

/** A job's state; once it has succeeded, the pattern or product it made. */
export async function getJob(jobId) {
  const job = await call("jobs/get", { jobId });
  const out = { jobId: job.jobId, kind: job.kind, status: job.status, error: job.error?.message ?? null };
  if (job.status !== "succeeded" || !job.result) return out;
  if (job.result.productId) out.product = await getProduct(job.result.productId);
  else if (job.result.patternId) out.pattern = await getPattern(job.result.patternId);
  return out;
}
