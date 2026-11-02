import { createHash } from "node:crypto";

function isAttributePrimitive(value) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

export function cleanAttributeValue(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    const cleaned = value.filter(item => item !== undefined && item !== null && item !== "");
    if (cleaned.length === 0) return undefined;
    const itemType = typeof cleaned[0];
    if (
      isAttributePrimitive(cleaned[0])
      && cleaned.every(item => typeof item === itemType && isAttributePrimitive(item))
    ) {
      return cleaned;
    }
    return JSON.stringify(cleaned).slice(0, 1024);
  }
  if (typeof value === "object") return JSON.stringify(value).slice(0, 1024);
  return value;
}

export function cleanAttributes(attributes = {}) {
  const cleaned = {};
  for (const [key, rawValue] of Object.entries(attributes)) {
    const value = cleanAttributeValue(rawValue);
    if (value !== undefined) cleaned[key] = value;
  }
  return cleaned;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function genAiRequestAttributes(systemInstructions, userMessage) {
  return {
    "gen_ai.system_instructions": JSON.stringify([
      { type: "text", content: systemInstructions },
    ]),
    "gen_ai.input.messages": JSON.stringify([
      {
        role: "user",
        parts: [{ type: "text", content: userMessage }],
      },
    ]),
    "ai.review.system_instructions.chars": systemInstructions.length,
    "ai.review.system_instructions.sha256": sha256(systemInstructions),
    "ai.review.input.chars": userMessage.length,
    "ai.review.input.sha256": sha256(userMessage),
  };
}

const PEAK_HOURS_UTC = [[1, 4], [6, 10]];

function tokenCount(value) {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined;
}

// Sums the cost and tokens of several opencode sessions (retried attempts of one call); either side may be missing.
export function addUsage(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const sum = (x, y) => (tokenCount(x) ?? 0) + (tokenCount(y) ?? 0);
  return {
    cost: (Number.isFinite(a.cost) ? a.cost : 0) + (Number.isFinite(b.cost) ? b.cost : 0),
    tokens: {
      input: sum(a.tokens?.input, b.tokens?.input),
      output: sum(a.tokens?.output, b.tokens?.output),
      reasoning: sum(a.tokens?.reasoning, b.tokens?.reasoning),
      cache: {
        read: sum(a.tokens?.cache?.read, b.tokens?.cache?.read),
        write: sum(a.tokens?.cache?.write, b.tokens?.cache?.write),
      },
    },
  };
}

// opencode takes one flat price, so the configs hold DeepSeek's peak rate and every other hour bills at half of it.
export function isPeakPricing(at) {
  const hour = at.getUTCHours();
  const weekday = at.getUTCDay() % 6 !== 0;
  return weekday && PEAK_HOURS_UTC.some(([start, end]) => start <= hour && hour < end);
}

export function genAiUsageAttributes(usage, at = new Date()) {
  const peak = isPeakPricing(at);
  const nonCachedInputTokens = tokenCount(usage?.tokens?.input);
  const visibleOutputTokens = tokenCount(usage?.tokens?.output);
  const cacheReadTokens = tokenCount(usage?.tokens?.cache?.read);
  const cacheWriteTokens = tokenCount(usage?.tokens?.cache?.write);
  const reasoningTokens = tokenCount(usage?.tokens?.reasoning);
  // opencode splits cache and reasoning out; OpenObserve expects input to include cache and output to include reasoning.
  const inputTokens = nonCachedInputTokens === undefined
    ? undefined
    : nonCachedInputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);
  const outputTokens = visibleOutputTokens === undefined
    ? undefined
    : visibleOutputTokens + (reasoningTokens ?? 0);

  return cleanAttributes({
    "gen_ai.usage.input_tokens": inputTokens,
    "gen_ai.usage.output_tokens": outputTokens,
    "gen_ai.usage.total_tokens": inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined,
    "gen_ai.usage.cache_read.input_tokens": cacheReadTokens,
    "gen_ai.usage.cache_creation.input_tokens": cacheWriteTokens,
    "gen_ai.usage.cost": Number.isFinite(usage?.cost) && usage.cost >= 0 ? usage.cost * (peak ? 1 : 0.5) : undefined,
    "ai.llm.pricing_peak": peak,
    "ai.usage.reasoning_tokens": reasoningTokens,
  });
}

export function genAiResponseAttributes(data, text, requestedModel, at = new Date()) {
  const info = data?.info || {};
  const responseModel = info.modelID || requestedModel;

  const attributes = {
    "gen_ai.output.messages": JSON.stringify([
      {
        role: "assistant",
        parts: [{ type: "text", content: text }],
      },
    ]),
    "gen_ai.response.id": info.id,
    "gen_ai.response.model": responseModel,
    "gen_ai.response.finish_reasons": info.finish ? [String(info.finish)] : undefined,
    ...genAiUsageAttributes(info, at),
    "ai.review.output.chars": text.length,
    "ai.review.output.sha256": sha256(text),
  };

  return cleanAttributes(attributes);
}
