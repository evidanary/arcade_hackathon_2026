import React, { useCallback, useEffect, useRef, useState } from "react";
import { CONTACT, onCall, startJob, studio } from "./api.js";

// Describe a design → Arcade draws the pattern → Arcade makes it a real
// product → Videoselz puts it on a Shopify store and makes its videos.

const JOB_POLL_MS = 3000;
const VIDEO_POLL_MS = 8000;
// What the progress bar assumes; Arcade says generation takes 1-2 minutes.
const EXPECTED_MS = { pattern: 90_000, product: 60_000 };
const DEFAULT_MARKUP = 2.5;
const CODE_KEY = "arcade-videoselz-code";
const REPO_URL = "https://github.com/evidanary/arcade_hackathon_2026";

const SWATCHES = [
  { hex: "#1F3A5F", name: "Navy" },
  { hex: "#3E7CB1", name: "Blue" },
  { hex: "#A7C7E7", name: "Sky" },
  { hex: "#F4EDE4", name: "Cream" },
  { hex: "#C9A227", name: "Mustard" },
  { hex: "#D98E73", name: "Terracotta" },
  { hex: "#B5485D", name: "Berry" },
  { hex: "#6B8F71", name: "Sage" },
  { hex: "#2F2F2F", name: "Charcoal" },
  { hex: "#FFFFFF", name: "White" },
];

const EXAMPLES = [
  { label: "Block-print florals", prompt: "Small blue and white block-print florals on natural linen, evenly spread as an all-over repeating pattern" },
  { label: "Lemons and leaves", prompt: "Hand-drawn lemons and leaves, Mediterranean summer, soft yellow and sage on cream, all-over repeat" },
  { label: "70s retro waves", prompt: "Bold 70s retro waves in terracotta, mustard and cream, smooth flowing stripes, all-over repeat" },
  { label: "Watercolour meadow", prompt: "Loose watercolour wildflower meadow: poppies, chamomile and grasses in terracotta, mustard and sage on warm cream, all-over repeat" },
];

const VIDEO_LABEL = { loop: "Banner loop", story: "Story", narrated: "Lifestyle video" };

const money = (amount, currency = "USD") => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
};

const storage = {
  get() {
    try {
      return sessionStorage.getItem(CODE_KEY) ?? "";
    } catch {
      return "";
    }
  },
  set(value) {
    try {
      if (value) sessionStorage.setItem(CODE_KEY, value);
      else sessionStorage.removeItem(CODE_KEY);
    } catch {
      // Private mode: the code just isn't remembered.
    }
  },
};

const scrollTo = (ref) =>
  setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);

/** Polls an Arcade job until it ends; calls onDone(job) once. Returns progress 0-95. */
function useArcadeJob(job, onDone, onError) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!job) return undefined;
    let cancelled = false;
    let timer;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const tick = async () => {
      try {
        const res = await studio("job", { jobId: job.jobId });
        if (cancelled) return;
        if (res.job.status === "succeeded") return onDone(res.job);
        if (res.job.status === "failed") return onError(res.job.error || "Arcade couldn't finish this job");
      } catch (err) {
        if (!cancelled) return onError(err.message);
      }
      timer = setTimeout(tick, JOB_POLL_MS);
    };
    timer = setTimeout(tick, JOB_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(clock);
    };
    // onDone/onError are recreated each render; the job is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);
  if (!job) return null;
  return Math.min(95, Math.round(((now - job.startedAt) / EXPECTED_MS[job.kind]) * 100));
}

/* ---------- small pieces ---------- */

function Spinner({ small }) {
  return <span className={small ? "spinner spinner-small" : "spinner"} aria-hidden="true" />;
}

function Button({ children, loading, variant = "secondary", className = "", ...props }) {
  return (
    <button type="button" className={`btn btn-${variant} ${className}`} disabled={loading || props.disabled} {...props}>
      {loading && <Spinner small />}
      <span>{children}</span>
    </button>
  );
}

function Alert({ tone = "critical", children, onDismiss }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === "critical" ? "alert" : "status"}>
      <div className="alert-body">{children}</div>
      {onDismiss && (
        <button type="button" className="alert-close" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}

function Progress({ value, label }) {
  if (value === null) return null;
  return (
    <div className="progress" aria-live="polite">
      <div className="progress-label">
        <Spinner small />
        <span>{label}</span>
        <span className="progress-pct">{value}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function Step({ number, title, hint, done, active, innerRef, children }) {
  return (
    <section ref={innerRef} className={`step${active ? " step-active" : ""}${done ? " step-done" : ""}`}>
      <header className="step-head">
        <span className="step-num">{done ? "✓" : number}</span>
        <div>
          <h2>{title}</h2>
          {hint && <p className="step-hint">{hint}</p>}
        </div>
      </header>
      <div className="step-body">{children}</div>
    </section>
  );
}

function Stepper({ stage }) {
  const steps = ["Design", "Product", "Videos"];
  return (
    <ol className="stepper" aria-label="Progress">
      {steps.map((name, i) => {
        const n = i + 1;
        const state = stage > n ? "done" : stage === n ? "current" : "todo";
        return (
          <li key={name} className={`stepper-item stepper-${state}`}>
            <span className="stepper-dot">{state === "done" ? "✓" : n}</span>
            <span>{name}</span>
          </li>
        );
      })}
    </ol>
  );
}

function AccessCard({ needsCode, code, unlocked, onUnlock, onLock, inputRef }) {
  const [value, setValue] = useState(code);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState(null);

  if (!needsCode) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!value.trim()) return;
    setChecking(true);
    setProblem(null);
    try {
      await studio("checkCode", {}, value.trim());
      onUnlock(value.trim());
    } catch (err) {
      setProblem(err.message);
    } finally {
      setChecking(false);
    }
  };

  if (unlocked) {
    return (
      <div className="access access-on">
        <span className="access-icon" aria-hidden="true">✓</span>
        <div className="grow">
          <strong>Unlocked</strong>
          <p>You can generate patterns, products and videos.</p>
        </div>
        <button type="button" className="link" onClick={onLock}>Change code</button>
      </div>
    );
  }

  return (
    <form className="access" onSubmit={submit}>
      <div className="access-top">
        <span className="access-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </span>
        <div>
          <strong>Enter your access code</strong>
          <p>Generating uses real Arcade credits, so each visitor needs a code.</p>
        </div>
      </div>
      <div className="access-row">
        <input
          ref={inputRef}
          className="input access-input"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Access code"
          autoComplete="off"
          aria-label="Access code"
        />
        <Button variant="primary" type="submit" loading={checking} disabled={!value.trim()}>
          Unlock
        </Button>
      </div>
      {problem ? <p className="access-error">{problem}</p> : <p className="access-help">No code? Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>}
    </form>
  );
}

function VideoTile({ video }) {
  const story = video.variant === "story";
  return (
    <figure className="video-tile">
      <div className="video-frame">
        {video.outputUrl ? (
          <video src={video.outputUrl} muted loop autoPlay playsInline className={story ? "video-story" : "video-wide"} />
        ) : video.status === "generating" ? (
          <div className="video-wait">
            <Spinner />
            <span>Generating</span>
          </div>
        ) : (
          <span className="muted">No preview</span>
        )}
      </div>
      <figcaption>
        <span className="video-kind">{story ? "Story" : VIDEO_LABEL[video.variant] ?? video.variant}</span>
        <strong className="video-title">{story && video.concept ? video.concept : VIDEO_LABEL[video.variant] ?? video.variant}</strong>
        <div className="video-meta">
          <span className={`badge badge-${video.status}`}>
            {video.status === "generating" ? "In progress" : video.status === "ready" ? "Ready" : "Failed"}
          </span>
          {video.outputUrl && (
            <a href={video.outputUrl} target="_blank" rel="noreferrer">Open ↗</a>
          )}
        </div>
      </figcaption>
    </figure>
  );
}

function CallLog({ calls }) {
  return (
    <details className="calls">
      <summary>
        <span className="calls-dot" aria-hidden="true" />
        Behind the scenes
        <span className="calls-count">{calls.length} Arcade API {calls.length === 1 ? "call" : "calls"}</span>
      </summary>
      {calls.length === 0 ? (
        <p className="muted">Calls to the Arcade API appear here as you go.</p>
      ) : (
        <ol>
          {calls.map((c, i) => (
            <li key={i}>
              <span className="calls-time">{c.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              <code>POST /v1/{c.call}</code>
              <span className={c.status < 300 ? "calls-ok" : "calls-bad"}>{c.status}</span>
              <span className="calls-ms">{c.ms} ms</span>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

/* ---------- page ---------- */

export default function App() {
  const [status, setStatus] = useState(null);
  const [down, setDown] = useState(null);
  const [code, setCode] = useState(storage.get);
  const [unlocked, setUnlocked] = useState(false);
  // { message, step }: shown in the card of the step that failed.
  const [error, setErrorState] = useState(null);
  const setError = (message, step = "page") => setErrorState(message ? { message, step } : null);
  const [starting, setStarting] = useState(null);
  const [calls, setCalls] = useState([]);

  // 1. Design
  const [prompt, setPrompt] = useState("");
  const [colors, setColors] = useState([]);
  const [patternJob, setPatternJob] = useState(null);
  const [patterns, setPatterns] = useState([]);
  const [pattern, setPattern] = useState(null);
  const [instruction, setInstruction] = useState("");

  // 2. Product
  const [categories, setCategories] = useState(null);
  const [category, setCategory] = useState(null);
  const [pickedId, setPickedId] = useState(null);
  const [choices, setChoices] = useState({});
  const [loadingCategory, setLoadingCategory] = useState(false);
  const [productJob, setProductJob] = useState(null);
  const [product, setProduct] = useState(null);

  // 3. Send to Videoselz
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null);
  const [videos, setVideos] = useState([]);

  const codeInput = useRef(null);
  const productRef = useRef(null);
  const configRef = useRef(null);
  const sendRef = useRef(null);
  const videosRef = useRef(null);
  const videoTimer = useRef(null);

  useEffect(() => onCall((entry) => setCalls((list) => [...list, entry].slice(-40))), []);

  useEffect(() => {
    studio("status")
      .then(async (res) => {
        setStatus(res);
        // A code remembered from earlier in this tab is checked again.
        const saved = storage.get();
        if (res.needsCode && saved) {
          studio("checkCode", {}, saved)
            .then(() => setUnlocked(true))
            .catch(() => storage.set(""));
        }
        const cats = await studio("categories");
        setCategories(cats.categories);
      })
      .catch((err) => setDown(err.message));
  }, []);

  const canSpend = status && (!status.needsCode || unlocked);

  const unlock = (value) => {
    setCode(value);
    storage.set(value);
    setUnlocked(true);
  };

  const lock = () => {
    setUnlocked(false);
    setCode("");
    storage.set("");
    setTimeout(() => codeInput.current?.focus(), 50);
  };

  const askForCode = () => {
    codeInput.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => codeInput.current?.focus(), 300);
  };

  const patternProgress = useArcadeJob(
    patternJob,
    (job) => {
      setPatternJob(null);
      if (!job.pattern) return setError("Arcade finished but returned no pattern; try again.", "design");
      const first = !pattern;
      setPattern(job.pattern);
      setPatterns((list) => [job.pattern, ...list.filter((p) => p.patternId !== job.pattern.patternId)].slice(0, 6));
      setInstruction("");
      if (first) scrollTo(productRef);
    },
    (message) => {
      setPatternJob(null);
      setError(message, "design");
    },
  );

  const productProgress = useArcadeJob(
    productJob,
    (job) => {
      setProductJob(null);
      if (!job.product) return setError("Arcade finished but returned no product; try again.", "product");
      const p = job.product;
      setProduct(p);
      setTitle(p.title ?? "");
      const cost = Number(p.unitPrice?.amount);
      setPrice(Number.isFinite(cost) ? (Math.ceil(cost * DEFAULT_MARKUP) - 0.01).toFixed(2) : "");
      setSent(null);
      setVideos([]);
      scrollTo(sendRef);
    },
    (message) => {
      setProductJob(null);
      setError(message, "product");
    },
  );

  const run = async (step, kind, fn) => {
    setError(null);
    setStarting(kind);
    try {
      await fn();
    } catch (err) {
      setError(err.message, step);
    } finally {
      setStarting(null);
    }
  };

  const generate = () =>
    run("design", "pattern", async () => {
      const res = await startJob("createPattern", { prompt, colors }, code);
      setPatternJob({ ...res.job, kind: "pattern", startedAt: Date.now() });
    });

  const refine = () =>
    run("design", "pattern", async () => {
      const res = await startJob("refinePattern", { patternId: pattern.patternId, instruction }, code);
      setPatternJob({ ...res.job, kind: "pattern", startedAt: Date.now() });
    });

  const loadCategory = useCallback(async (categoryId, nextChoices) => {
    setLoadingCategory(true);
    setErrorState(null);
    try {
      const res = await studio("category", { categoryId, selections: nextChoices });
      setCategory(res.category);
    } catch (err) {
      setErrorState({ message: err.message, step: "product" });
    } finally {
      setLoadingCategory(false);
    }
  }, []);

  const pickCategory = (categoryId) => {
    setPickedId(categoryId);
    setChoices({});
    setCategory(null);
    setProduct(null);
    loadCategory(categoryId, {});
    // On narrow screens the options sit under the tiles; bring them into view.
    if (window.matchMedia("(max-width: 900px)").matches) scrollTo(configRef);
  };

  const choose = (key, value) => {
    const next = { ...choices, [key]: value };
    setChoices(next);
    loadCategory(category.categoryId, next);
  };

  const makeProduct = () =>
    run("product", "product", async () => {
      const res = await startJob(
        "createProduct",
        { patternId: pattern.patternId, categoryId: category.categoryId, selections: category.selections },
        code,
      );
      setProductJob({ ...res.job, kind: "product", startedAt: Date.now() });
    });

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await studio("publish", { productId: product.productId, title, price }, code);
      setSent(res.published);
      scrollTo(videosRef);
    } catch (err) {
      setError(err.message, "send");
    } finally {
      setSending(false);
    }
  };

  const startOver = () => {
    setPrompt("");
    setColors([]);
    setPattern(null);
    setPatterns([]);
    setCategory(null);
    setPickedId(null);
    setChoices({});
    setProduct(null);
    setSent(null);
    setVideos([]);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // After sending: the product's videos, until none is still generating.
  useEffect(() => {
    clearTimeout(videoTimer.current);
    if (!sent?.shopifyProductId) return undefined;
    const poll = async () => {
      let list = null;
      try {
        const res = await studio("videos", { productId: String(sent.shopifyProductId) });
        list = res.videos;
        setVideos(list);
      } catch {
        // The next poll tries again.
      }
      const finished = list?.length > 0 && !list.some((v) => v.status === "generating");
      if (!finished) videoTimer.current = setTimeout(poll, VIDEO_POLL_MS);
    };
    poll();
    return () => clearTimeout(videoTimer.current);
  }, [sent]);

  const toggleColor = (hex) =>
    setColors((list) => (list.includes(hex) ? list.filter((c) => c !== hex) : [...list, hex].slice(0, 10)));

  const cost = product?.unitPrice ? Number(product.unitPrice.amount) : null;
  const margin = cost && Number(price) > 0 ? Number(price) - cost : null;
  const preview = product?.images?.[0] ?? pattern?.imageUrl ?? null;
  const busy = !!patternJob || !!productJob || !!starting;
  const stage = sent ? 4 : product ? 3 : pattern ? 2 : 1;
  const readyVideos = videos.filter((v) => v.status === "ready").length;

  const errorFor = (step) =>
    error?.step === step && <Alert onDismiss={() => setError(null)}>{error.message}</Alert>;

  const lockedNote = !canSpend && status?.needsCode && (
    <button type="button" className="locked-note" onClick={askForCode}>
      Enter your access code at the top to start →
    </button>
  );

  /* ----- step 1 ----- */
  const designStep = (
    <Step number={1} title="Describe your design" hint="Arcade draws an all-over pattern from your words." done={!!pattern} active={stage === 1}>
      <textarea
        className="input prompt"
        rows={4}
        maxLength={1000}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. Small blue and white block-print florals on natural linen"
        disabled={!!patternJob}
        aria-label="Describe the pattern"
      />
      <div className="chips" aria-label="Ideas">
        <span className="chips-label">Ideas</span>
        {EXAMPLES.map((example) => (
          <button key={example.label} type="button" className="chip" onClick={() => setPrompt(example.prompt)} disabled={!!patternJob}>
            {example.label}
          </button>
        ))}
      </div>
      <div className="field">
        <span className="label">Colours <span className="muted">· optional</span></span>
        <div className="swatches">
          {SWATCHES.map(({ hex, name }) => (
            <button
              key={hex}
              type="button"
              className={colors.includes(hex) ? "swatch swatch-on" : "swatch"}
              style={{ background: hex }}
              onClick={() => toggleColor(hex)}
              title={name}
              aria-label={name}
              aria-pressed={colors.includes(hex)}
            />
          ))}
        </div>
      </div>
      <div className="actions">
        <Button
          variant="primary"
          onClick={generate}
          loading={starting === "pattern" || (!!patternJob && !pattern)}
          disabled={!prompt.trim() || busy || !canSpend}
        >
          {pattern ? "Generate a new pattern" : "Generate pattern"}
        </Button>
        {lockedNote}
      </div>
      <Progress value={pattern ? null : patternProgress} label="Arcade is drawing your pattern" />
      {errorFor("design")}

      {pattern && (
        <div className="refine">
          <label className="field grow">
            <span className="label">Tweak it</span>
            <input
              className="input"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. make the flowers larger and the background warmer"
              disabled={!!patternJob}
            />
          </label>
          <Button onClick={refine} loading={starting === "pattern" || (!!patternJob && !!pattern)} disabled={!instruction.trim() || busy}>
            Apply
          </Button>
        </div>
      )}
      {pattern && <Progress value={patternProgress} label="Arcade is redrawing your pattern" />}
      {patterns.length > 1 && (
        <div className="versions">
          <span className="label">Versions</span>
          <div className="versions-row">
            {patterns.map((p) => (
              <button
                key={p.patternId}
                type="button"
                className={p.patternId === pattern.patternId ? "version version-on" : "version"}
                onClick={() => setPattern(p)}
                aria-label="Use this version"
              >
                <img src={p.thumbnailUrl ?? p.imageUrl} alt="" />
              </button>
            ))}
          </div>
        </div>
      )}
    </Step>
  );

  /* ----- step 2 ----- */
  const picked = categories?.find((c) => c.categoryId === pickedId);
  const productStep = (
    <Step
      number={2}
      title="Choose the product"
      hint="Pick what Arcade should make, then its options."
      done={!!product}
      active={stage === 2}
      innerRef={productRef}
    >
      {!pattern ? (
        <p className="empty">Generate a pattern first.</p>
      ) : !categories ? (
        <Spinner />
      ) : (
        <div className="picker">
          <div className="cat-grid" role="listbox" aria-label="Product types">
            {categories.map((c) => (
              <button
                key={c.categoryId}
                type="button"
                role="option"
                aria-selected={pickedId === c.categoryId}
                className={pickedId === c.categoryId ? "cat cat-on" : "cat"}
                onClick={() => pickCategory(c.categoryId)}
                disabled={!!productJob}
              >
                <span className="cat-img">{c.imageUrl && <img src={c.imageUrl} alt="" />}</span>
                <span className="cat-name">{c.name}</span>
                {c.group && <span className="cat-group">{c.group}</span>}
              </button>
            ))}
          </div>

          <div className="config" ref={configRef}>
            {!pickedId ? (
              <div className="config-empty">
                <span aria-hidden="true">←</span>
                <p>Pick a product to see its options.</p>
              </div>
            ) : !category ? (
              <div className="config-empty">
                <Spinner />
                <p>Loading {picked?.name ?? "options"}…</p>
              </div>
            ) : (
              <>
                <div className="config-head">
                  {picked?.imageUrl && <img src={picked.imageUrl} alt="" />}
                  <div>
                    <span className="label">Selected</span>
                    <strong>{category.name}</strong>
                  </div>
                  {loadingCategory && <Spinner small />}
                </div>
                <div className="config-options">
                  {category.options.map((option) => (
                    <label key={option.key} className="field">
                      <span className="label">{option.label}</span>
                      <select
                        className="input"
                        value={category.selections[option.key]}
                        onChange={(e) => choose(option.key, e.target.value)}
                        disabled={loadingCategory || !!productJob}
                      >
                        {option.values
                          .filter((v) => v.available || v.value === category.selections[option.key])
                          .map((v) => (
                            <option key={v.value} value={v.value}>
                              {v.label}
                            </option>
                          ))}
                      </select>
                    </label>
                  ))}
                </div>
                {!category.canManufacture && (
                  <Alert tone="warning">This combination can't be made. Change one of the options.</Alert>
                )}
                <Button
                  variant="primary"
                  className="btn-block"
                  onClick={makeProduct}
                  disabled={!category.canManufacture || loadingCategory || busy || !canSpend}
                  loading={starting === "product" || !!productJob}
                >
                  {`Create ${category.name}`}
                </Button>
                <Progress value={productProgress} label="Arcade is building the product and its photos" />
                {errorFor("product")}
              </>
            )}
          </div>
        </div>
      )}
    </Step>
  );

  const doneSummary = pattern && product && (
    <section className="summary">
      <img src={pattern.thumbnailUrl ?? pattern.imageUrl} alt="" />
      <div className="grow">
        <strong>Pattern ✓ · {category?.name ?? "Product"} ✓</strong>
        <p className="muted truncate">{product.selectionLabel || prompt}</p>
      </div>
      {!sent && (
        <button type="button" className="link" onClick={() => setProduct(null)}>
          Change
        </button>
      )}
    </section>
  );

  /* ----- step 3 ----- */
  const sendStep = product && (
    <Step
      number={3}
      title="Sell it with videos"
      hint="Videoselz lists it on Shopify and makes 3 story videos and a banner loop."
      done={!!sent}
      active={stage === 3}
      innerRef={sendRef}
    >
      {product.images.length > 1 && (
        <div className="thumbs">
          {product.images.slice(0, 6).map((url) => (
            <img key={url} src={url} alt="" />
          ))}
        </div>
      )}
      <label className="field">
        <span className="label">Product title</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!!sent} />
      </label>
      <div className="pricing">
        <label className="field">
          <span className="label">Your price</span>
          <div className="price-input">
            <span>$</span>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={!!sent}
            />
          </div>
        </label>
        <div className="econ">
          <div>
            <span className="label">Arcade makes it for</span>
            <strong>{cost !== null ? money(cost, product.unitPrice.currency) : "—"}</strong>
          </div>
          <div>
            <span className="label">You keep</span>
            <strong className={margin !== null && margin > 0 ? "good" : "bad"}>
              {margin !== null ? money(margin, product.unitPrice.currency) : "—"}
            </strong>
          </div>
        </div>
      </div>
      {errorFor("send")}
      {!sent ? (
        <div className="actions">
          <Button variant="accent" className="btn-large" onClick={send} loading={sending} disabled={!canSpend}>
            Send to Videoselz
          </Button>
          {lockedNote}
        </div>
      ) : (
        <div className="sent" ref={videosRef}>
          <Alert tone="success">
            {sent.mock ? (
              "Preview: nothing was published."
            ) : (
              <>
                <strong>{sent.title}</strong> is on the Videoselz demo store. Its videos are being made now; each one
                also goes on the product page when it's ready.
              </>
            )}
          </Alert>
          <div className="videos-head">
            <h3>Videos</h3>
            <span className="muted">{videos.length ? `${readyVideos} of ${videos.length} ready` : "Starting…"}</span>
          </div>
          {videos.length > 0 ? (
            <div className="videos">
              {[...videos]
                .sort((a, b) => (b.variant === "loop") - (a.variant === "loop"))
                .map((v) => (
                  <VideoTile key={v.id} video={v} />
                ))}
            </div>
          ) : (
            !sent.mock && (
              <div className="videos">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="video-tile video-skeleton" />
                ))}
              </div>
            )
          )}
          <div className="actions">
            <Button onClick={startOver}>Design another</Button>
          </div>
        </div>
      )}
    </Step>
  );

  return (
    <div className="app">
      <nav className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path d="M8 5l11 7-11 7z" fill="currentColor" />
            </svg>
          </span>
          <span>Arcade <span className="brand-x">×</span> Videoselz</span>
        </div>
        <div className="topbar-links">
          <a href="#how">How it works</a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub ↗</a>
        </div>
      </nav>

      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Arcade hackathon 2026</p>
          <h1>
            Design a product.
            <br />
            <em>Get its videos.</em>
          </h1>
          <p className="lead">
            Describe a pattern and <a href="https://www.arcade.ai" target="_blank" rel="noreferrer">Arcade</a> turns it
            into a real, made-to-order product. Videoselz lists it on Shopify and makes its story videos and a banner loop.
          </p>
        </div>
        <AccessCard
          needsCode={status?.needsCode}
          code={code}
          unlocked={unlocked}
          onUnlock={unlock}
          onLock={lock}
          inputRef={codeInput}
        />
      </header>

      {down && <Alert>{down}</Alert>}

      <Stepper stage={stage} />

      <main className="workspace">
        <div className="steps">
          {product ? doneSummary : (
            <>
              {designStep}
              {productStep}
            </>
          )}
          {sendStep}
        </div>

        <aside className={preview || patternJob ? "preview" : "preview preview-empty"}>
          <div className="preview-card">
            <div className="preview-head">
              <span className="label">{product ? "Your product" : pattern ? "Your pattern" : "Preview"}</span>
              {product?.unitPrice && <span className="preview-price">{money(price || cost, product.unitPrice.currency)}</span>}
            </div>
            <div className={`preview-img${patternJob && !pattern ? " preview-loading" : ""}`}>
              {preview ? (
                <img src={preview} alt={product?.title ?? "Pattern"} />
              ) : patternJob ? (
                <div className="preview-wait">
                  <Spinner />
                  <span>Drawing… {patternProgress ?? 0}%</span>
                </div>
              ) : (
                <div className="preview-wait">
                  <span className="preview-glyph" aria-hidden="true">✦</span>
                  <span>Your design appears here</span>
                </div>
              )}
            </div>
            {product ? (
              <div className="preview-meta">
                <strong>{title || product.title}</strong>
                {product.selectionLabel && <span className="muted">{product.selectionLabel}</span>}
                {product.maker && <span className="muted">Made by {product.maker}</span>}
              </div>
            ) : pattern ? (
              <p className="muted preview-prompt">{prompt}</p>
            ) : null}
          </div>
          <CallLog calls={calls} />
        </aside>
      </main>

      <section className="how" id="how">
        <h2>How it works</h2>
        <div className="how-grid">
          <article>
            <span className="how-num">01</span>
            <h3>Arcade draws the pattern</h3>
            <p>Your words and colours go to Arcade, which generates a seamless pattern you can tweak.</p>
            <code>patterns/create · patterns/refine/edit</code>
          </article>
          <article>
            <span className="how-num">02</span>
            <h3>Arcade makes the product</h3>
            <p>Only options that can really be manufactured are offered. Arcade returns mockups, care notes and a unit cost.</p>
            <code>categories/get · products/create · products/get</code>
          </article>
          <article>
            <span className="how-num">03</span>
            <h3>Videoselz sells it</h3>
            <p>Videoselz lists the product on Shopify and makes 3 short story videos and a banner loop for its page.</p>
            <code>Shopify Admin API · Videoselz</code>
          </article>
        </div>
      </section>

      <footer className="footer">
        <span>Built with the <a href="https://docs.arcade.ai" target="_blank" rel="noreferrer">Arcade API</a> and Videoselz.</span>
        <span>
          Questions: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </span>
      </footer>
    </div>
  );
}
