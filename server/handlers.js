import { timingSafeEqual } from "node:crypto";
import {
  createPattern,
  createProduct,
  getCategory,
  getJob,
  getProduct,
  listCategories,
  refinePattern,
} from "./arcade.js";

// The two server endpoints the page calls:
//   /api/arcade     the Arcade API: patterns, products, categories, job polling
//   /api/videoselz  hands a finished product to Videoselz and reads its videos
// Both take { op, input, code } and answer { success, ... }.

export const CONTACT = "yash@videoselz.com";
const MAX_PROMPT = 1000;
const HEX = /^#[0-9a-fA-F]{6}$/;

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const required = (value, name) => {
  if (!value) throw new HttpError(400, `${name} is required`);
  return value;
};

const needsCode = () => !!process.env.ACCESS_CODE;

/** Steps that cost money need the access code (ACCESS_CODE), when one is set. */
function checkCode(given) {
  const expected = process.env.ACCESS_CODE;
  if (!expected) return;
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(401, `That access code isn't right. Email ${CONTACT} for one.`);
  }
}

// ── /api/arcade ───────────────────────────────────────────────────────────────

const ARCADE_OPS = {
  status: async () => ({ needsCode: needsCode() }),
  checkCode: async ({ code }) => {
    checkCode(code);
    return {};
  },
  categories: async () => ({ categories: await listCategories() }),
  category: async ({ input }) => {
    const selections = input.selections && typeof input.selections === "object" ? input.selections : {};
    return { category: await getCategory(required(text(input.categoryId, 200), "categoryId"), selections) };
  },
  createPattern: async ({ input, code }) => {
    checkCode(code);
    const prompt = required(text(input.prompt, MAX_PROMPT), "A design description");
    const colors = Array.isArray(input.colors) ? input.colors.filter((c) => HEX.test(c)).slice(0, 10) : [];
    return { job: await createPattern({ prompt, colors, key: text(input.requestKey, 64) }) };
  },
  refinePattern: async ({ input, code }) => {
    checkCode(code);
    return {
      job: await refinePattern({
        patternId: required(text(input.patternId, 200), "patternId"),
        instruction: required(text(input.instruction, MAX_PROMPT), "An edit instruction"),
        key: text(input.requestKey, 64),
      }),
    };
  },
  createProduct: async ({ input, code }) => {
    checkCode(code);
    if (!input.selections || typeof input.selections !== "object") throw new HttpError(400, "selections is required");
    return {
      job: await createProduct({
        patternId: required(text(input.patternId, 200), "patternId"),
        categoryId: required(text(input.categoryId, 200), "categoryId"),
        selections: input.selections,
        key: text(input.requestKey, 64),
      }),
    };
  },
  job: async ({ input }) => ({ job: await getJob(required(text(input.jobId, 200), "jobId")) }),
  product: async ({ input }) => ({ product: await getProduct(required(text(input.productId, 200), "productId")) }),
};

// ── /api/videoselz ────────────────────────────────────────────────────────────

/** Calls the Videoselz import route (Gadget), which owns Shopify and the video pipeline. */
async function videoselz(op, input) {
  const url = process.env.VIDEOSELZ_URL;
  const key = process.env.VIDEOSELZ_KEY;
  if (!url || !key) throw new HttpError(500, "VIDEOSELZ_URL and VIDEOSELZ_KEY aren't set on the server.");
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-videoselz-key": key },
      body: JSON.stringify({ op, input }),
      signal: AbortSignal.timeout(50_000),
    });
  } catch {
    throw new HttpError(503, `Can't reach Videoselz right now. Try again in a few seconds, or email ${CONTACT}.`);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // A platform error page.
  }
  if (!res.ok || !body?.success) {
    throw new HttpError(res.status >= 400 && res.status < 500 ? res.status : 503, body?.error ?? `Videoselz answered ${res.status}.`);
  }
  return body;
}

const VIDEOSELZ_OPS = {
  // Reads the finished product from Arcade here, then hands Videoselz
  // everything it needs; Videoselz never calls Arcade.
  publish: async ({ input, code }) => {
    checkCode(code);
    const product = await getProduct(required(text(input.productId, 200), "productId"));
    const price = Number(input.price);
    const res = await videoselz("import", {
      arcadeProductId: product.productId,
      title: text(input.title, 255) || product.title,
      price: Number.isFinite(price) && price > 0 ? price.toFixed(2) : null,
      description: product.description,
      careInstructions: product.careInstructions,
      maker: product.maker,
      images: product.images.slice(0, 10),
    });
    return { published: res.published };
  },
  videos: async ({ input }) => {
    const productId = text(input.productId, 40);
    if (!/^\d+$/.test(productId)) throw new HttpError(400, "productId is required");
    const res = await videoselz("videos", { productId });
    return { videos: res.videos };
  },
};

// ── shared ────────────────────────────────────────────────────────────────────

async function run(ops, body) {
  const op = String(body?.op ?? "");
  const handler = ops[op];
  if (!handler) return { status: 400, body: { success: false, error: `Unknown operation: ${op}` } };
  const input = body.input && typeof body.input === "object" ? body.input : {};
  try {
    return { status: 200, body: { success: true, ...(await handler({ input, code: body.code })) } };
  } catch (error) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status >= 500) console.error(`${op} failed:`, error.message);
    return { status, body: { success: false, error: error.message, ...(error.retry ? { retry: true } : {}), ...(error.extra ?? {}) } };
  }
}

export const handleArcade = (body) => run(ARCADE_OPS, body);
export const handleVideoselz = (body) => run(VIDEOSELZ_OPS, body);

/** Wraps a handler as a Node (req, res) function, for Vercel and the Vite dev server. */
export const asNodeHandler = (handle) => async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    return res.end();
  }
  let body = req.body;
  if (body === undefined) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = null;
    }
  } else if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  const result = body ? await handle(body) : { status: 400, body: { success: false, error: "The request body must be JSON" } };
  res.statusCode = result.status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(result.body));
};
