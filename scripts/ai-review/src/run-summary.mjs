import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const SUMMARY_FILE = "review-run-summary.json";
const TOKEN_FIELDS = ["input", "output", "reasoning", "cache_read", "cache_write"];
const PRICE_FIELDS = ["input", "output", "cache_read", "cache_write"];

function known(value) {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

// opencode splits cache and reasoning out of input and output; a field the provider did not report stays null, never zero.
export function normalizeTokens(raw) {
  return {
    input: known(raw?.input),
    output: known(raw?.output),
    reasoning: known(raw?.reasoning),
    cache_read: known(raw?.cache?.read),
    cache_write: known(raw?.cache?.write),
  };
}

// A total is only stated when every session reported the field: a partial sum would read as a complete one.
export function sumTokens(list) {
  return Object.fromEntries(TOKEN_FIELDS.map(field => {
    const values = list.map(tokens => tokens[field]);
    return [field, values.every(v => v !== null) ? values.reduce((a, b) => a + b, 0) : null];
  }));
}

// REVIEW_TOKEN_PRICES: USD per million tokens for input, output, cache_read, cache_write; reasoning is priced as output.
export function parseTokenPrices(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { prices: null, problem: "" };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { prices: null, problem: "REVIEW_TOKEN_PRICES is not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { prices: null, problem: "REVIEW_TOKEN_PRICES must be a JSON object" };
  const unknownKeys = Object.keys(parsed).filter(key => !PRICE_FIELDS.includes(key));
  if (unknownKeys.length > 0) return { prices: null, problem: `REVIEW_TOKEN_PRICES has unknown keys: ${unknownKeys.join(", ")}` };
  const prices = {};
  for (const field of PRICE_FIELDS) {
    const value = parsed[field];
    if (value === undefined || value === null) {
      prices[field] = null;
    } else if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      prices[field] = value;
    } else {
      return { prices: null, problem: `REVIEW_TOKEN_PRICES.${field} must be a non-negative number` };
    }
  }
  return { prices, problem: "" };
}

// Null unless every token count and every price the counts need is known; a zero count needs no price.
export function sessionCost(tokens, prices) {
  if (!prices || TOKEN_FIELDS.some(field => tokens[field] === null)) return null;
  const lines = [
    [tokens.input, prices.input],
    [tokens.output + tokens.reasoning, prices.output],
    [tokens.cache_read, prices.cache_read],
    [tokens.cache_write, prices.cache_write],
  ];
  let total = 0;
  for (const [count, price] of lines) {
    if (count === 0) continue;
    if (price === null) return null;
    total += (count / 1_000_000) * price;
  }
  return total;
}

export class RunSummary {
  constructor({ traceId, prices = null, now = Date.now }) {
    this.traceId = traceId;
    this.prices = prices;
    this.now = now;
    this.startedAt = now();
    this.sessions = [];
    this.open = new Set();
    this.state = { tier: null, agents: [], kept: [], keptKnown: false, folds: null };
  }

  startSession({ agent, pass = null, attempt }) {
    const session = { agent, pass, attempt, startedAt: this.now() };
    this.open.add(session);
    return session;
  }

  endSession(session, { outcome, tokens, error = null }) {
    this.open.delete(session);
    const counts = normalizeTokens(tokens);
    this.sessions.push({
      agent: session.agent,
      pass: session.pass,
      attempt: session.attempt,
      duration_ms: this.now() - session.startedAt,
      outcome,
      tokens: counts,
      cost: sessionCost(counts, this.prices),
      ...(error ? { error } : {}),
    });
  }

  // A session still open at exit (the run timed out under it) was billed for something nobody read back.
  closeOpenSessions() {
    for (const session of [...this.open]) this.endSession(session, { outcome: "interrupted", tokens: null });
  }

  totals() {
    const tokens = sumTokens(this.sessions.map(s => s.tokens));
    const costs = this.sessions.map(s => s.cost);
    return {
      sessions: this.sessions.length,
      tokens,
      cost: costs.every(c => c !== null) ? costs.reduce((a, b) => a + b, 0) : null,
      complete: TOKEN_FIELDS.every(field => tokens[field] !== null),
    };
  }

  build({ outcome, error = null }) {
    this.closeOpenSessions();
    return {
      trace_id: this.traceId,
      duration_ms: this.now() - this.startedAt,
      outcome,
      tier: this.state.tier,
      agents: this.state.agents,
      ...(this.state.folds ? { folds: this.state.folds } : {}),
      kept_findings: this.state.kept,
      kept_findings_known: this.state.keptKnown,
      sessions: this.sessions,
      totals: this.totals(),
      ...(error ? { error } : {}),
    };
  }
}

// Written beside the findings artifact; the harness reads it even when the run ended in an error.
export function writeRunSummary(dir, summary) {
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, SUMMARY_FILE);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(summary, null, 2)}\n`);
  renameSync(tmp, path);
  return path;
}
