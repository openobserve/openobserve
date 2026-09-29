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

function tokenCount(value) {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined;
}

export function genAiResponseAttributes(data, text, requestedModel) {
  const info = data?.info || {};
  const inputTokens = tokenCount(info.tokens?.input);
  const outputTokens = tokenCount(info.tokens?.output);
  const cacheReadTokens = tokenCount(info.tokens?.cache?.read);
  const cacheWriteTokens = tokenCount(info.tokens?.cache?.write);
  const reasoningTokens = tokenCount(info.tokens?.reasoning);
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
    "gen_ai.usage.input_tokens": inputTokens,
    "gen_ai.usage.output_tokens": outputTokens,
    "gen_ai.usage.total_tokens": inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined,
    "gen_ai.usage.cache_read_tokens": cacheReadTokens,
    "gen_ai.usage.cache_write_tokens": cacheWriteTokens,
    "gen_ai.usage.cost": Number.isFinite(info.cost) && info.cost >= 0 ? info.cost : undefined,
    "ai.review.usage.reasoning_tokens": reasoningTokens,
    "ai.review.output.chars": text.length,
    "ai.review.output.sha256": sha256(text),
  };

  return cleanAttributes(attributes);
}
