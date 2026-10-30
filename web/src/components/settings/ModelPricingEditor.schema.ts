// Copyright 2026 OpenObserve Inc.
//
// Validation schema for ModelPricingEditor.vue — scalars (name +
// match_pattern) and the dynamic tiers/prices array.
//
// The API model stores prices as a `{ key: perTokenPrice }` MAP; TanStack
// field-arrays operate on ARRAYS, so the form models prices as an array of
// `{ key, value }` rows (value held as PER-MILLION for display). The component
// converts map↔rows at edit-prefill and submit.
//
// Two structural rules with no single field to attach to — "default tier needs
// ≥1 non-zero price" and "a draft price has a value but no key" — stay as
// submit-handler guards (toasts), since they don't map to one OForm* field.
//
// Validation timing is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes what is valid.

import { z } from "zod";

const PURE_INT = /^\d+$/;
const HAS_SPACE = /\s/;
/** 24-hour clock time, `HH:MM` — the shape `OFormTime` binds. */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Strip Rust/PCRE inline flag groups that JavaScript RegExp doesn't understand
 * (e.g. `(?i)`, `(?ims)`). Flag-scoped groups like `(?i:...)` are left intact.
 */
export function stripInlineFlags(pattern: string): string {
  return pattern.replace(/\(\?[imsxu]+\)/g, "");
}

// One committed price row. `value` is held as PER-MILLION in the form.
export const priceRowSchema = z.object({
  key: z.string(),
  value: z.coerce.number(),
});

export const tierConditionSchema = z.object({
  usage_key: z.string(),
  operator: z.string(),
  value: z.coerce.number(),
});

// One recurring UTC time-of-day window. Bounds are held as `HH:MM` strings in the
// form (what OFormTime binds) and converted to minutes-past-midnight at submit.
// A window whose start is later than its end wraps past midnight.
export const tierWindowSchema = z.object({
  start: z.string(),
  end: z.string(),
});

export const SET_RULE_OPS = ["in", "not_in"];
export const PRESENCE_RULE_OPS = ["exists", "not_exists"];

export const NUMERIC_RULE_OPS = ["gt", "gte", "lt", "lte"];
export const KNOWN_RULE_OPS = [...SET_RULE_OPS, ...PRESENCE_RULE_OPS, ...NUMERIC_RULE_OPS];

// Limits mirror the backend's tier validation (config/src/meta/model_pricing.rs).
export const MAX_TIERS = 32;
export const MAX_RULES_PER_TIER = 8;
export const MAX_RULE_KEYS = 16;
export const MAX_RULE_VALUES = 64;
export const MAX_RULE_TEXT_BYTES = 256;
export const MAX_TIER_PRIORITY = 1000;
const USAGE_KEY_PREFIX = "usage.";
const utf8 = new TextEncoder();

// Keys and values stay comma-separated strings so one text input edits each list.
export const tierRuleSchema = z.object({
  keys: z.string(),
  op: z.string(),
  values: z.string(),
  value: z.union([z.number(), z.string()]).default(0),
});

export function splitList(value: string): string[] {
  return String(value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** The usage type after a case-insensitive `usage.` prefix, or null for an attribute key. */
export function usageKeySuffix(key: string): string | null {
  const k = String(key ?? "").trim();
  return k.slice(0, USAGE_KEY_PREFIX.length).toLowerCase() === USAGE_KEY_PREFIX
    ? k.slice(USAGE_KEY_PREFIX.length)
    : null;
}

/** Mirrors the backend's `ranks_tiers()`: any rule or non-zero priority switches off first-match. */
export function ranksTiers(
  tiers: Array<{ rules?: unknown[]; priority?: number | string }>,
): boolean {
  return tiers.some((t) => (t.rules ?? []).length > 0 || (Number(t.priority) || 0) !== 0);
}

export const tierSchema = z.object({
  name: z.string(),
  // null for the default (first) tier; an object for conditional tiers.
  condition: tierConditionSchema.nullable().optional(),
  // Recurring UTC hours this tier is limited to. Empty = always active.
  utc_windows: z.array(tierWindowSchema).default([]),
  rules: z.array(tierRuleSchema).default([]),
  priority: z.coerce.number().int().default(0),
  prices: z.array(priceRowSchema).default([]),
  // Staging "add price" row — non-validated form state, auto-committed at submit.
  draftKey: z.string().optional().default(""),
  draftValue: z.coerce.number().optional().default(0),
});

export const makeModelPricingSchema = (
  t: (_key: string, _named?: Record<string, unknown>) => string,
) =>
  z
    .object({
      name: z.string(),
      match_pattern: z.string(),
      tiers: z.array(tierSchema).default([]),
    })
    .superRefine((val, ctx) => {
      // ── name ──────────────────────────────────────────────────────────────
      const name = String(val.name ?? "");
      if (!name.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["name"],
          message: t("modelPricing.nameRequired"),
        });
      } else if (name.length > 256) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["name"],
          message: t("modelPricing.nameTooLong"),
        });
      }

      // ── match_pattern ─────────────────────────────────────────────────────
      const pattern = String(val.match_pattern ?? "");
      if (!pattern.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["match_pattern"],
          message: t("modelPricing.patternRequired"),
        });
      } else if (pattern.length > 512) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["match_pattern"],
          message: t("modelPricing.patternTooLong"),
        });
      } else {
        try {
          new RegExp(stripInlineFlags(pattern));
        } catch (e: any) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["match_pattern"],
            message: t("modelPricing.invalidRegex", { error: e.message }),
          });
        }
      }

      // ── tiers / prices ────────────────────────────────────────────────────
      (val.tiers ?? []).forEach((tier, i) => {
        if (i >= MAX_TIERS) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["tiers", i, "name"],
            message: t("modelPricing.tooManyTiers", { max: MAX_TIERS }),
          });
        }
        const priority = Number(tier.priority ?? 0);
        if (Number.isFinite(priority) && Math.abs(priority) > MAX_TIER_PRIORITY) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["tiers", i, "priority"],
            message: t("modelPricing.tierPriorityRange", {
              name: tier.name || `#${i + 1}`,
              max: MAX_TIER_PRIORITY,
            }),
          });
        }

        // committed price-row keys: not pure-int, no spaces
        (tier.prices ?? []).forEach((row, j) => {
          const k = String(row.key ?? "").trim();
          if (k && PURE_INT.test(k)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["tiers", i, "prices", j, "key"],
              message: t("modelPricing.usageKeyPureInteger"),
            });
          } else if (k && HAS_SPACE.test(k)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["tiers", i, "prices", j, "key"],
              message: t("modelPricing.usageKeyContainsSpaces"),
            });
          }
        });

        // non-default tier condition.usage_key: not a pure integer
        if (i > 0 && tier.condition) {
          const ck = String(tier.condition.usage_key ?? "").trim();
          if (ck && PURE_INT.test(ck)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["tiers", i, "condition", "usage_key"],
              message: t("modelPricing.tierUsageKeyPlainNumber", {
                name: tier.name || `#${i + 1}`,
              }),
            });
          }
        }

        // UTC time windows: both bounds must be HH:MM and must differ. Equal
        // bounds are ambiguous ("never" vs "always"), so the tier must instead
        // drop the window to be always active.
        const tierLabel = tier.name || `#${i + 1}`;
        (tier.utc_windows ?? []).forEach((win, w) => {
          const start = String(win.start ?? "").trim();
          const end = String(win.end ?? "").trim();
          const startOk = HHMM.test(start);
          const endOk = HHMM.test(end);
          if (!startOk) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["tiers", i, "utc_windows", w, "start"],
              message: t("modelPricing.timeWindowInvalid", { name: tierLabel }),
            });
          }
          if (!endOk) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["tiers", i, "utc_windows", w, "end"],
              message: t("modelPricing.timeWindowInvalid", { name: tierLabel }),
            });
          }
          if (startOk && endOk && start === end) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["tiers", i, "utc_windows", w, "end"],
              message: t("modelPricing.timeWindowSameBounds", { name: tierLabel }),
            });
          }
        });

        // A rule without keys, set values or a finite threshold can never match.
        (tier.rules ?? []).forEach((rule, r) => {
          const keyIssue = ruleKeysIssue(rule, r, tierLabel, t);
          if (keyIssue) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["tiers", i, "rules", r, "keys"],
              message: keyIssue,
            });
          }
          const opIssue = ruleOpIssue(rule, tierLabel, t);
          if (opIssue) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["tiers", i, "rules", r, "op"],
              message: opIssue,
            });
          }
          const values = splitList(rule.values);
          const valuesIssue = !SET_RULE_OPS.includes(rule.op)
            ? ""
            : values.length
              ? listIssue(values, MAX_RULE_VALUES, tierLabel, t)
              : t("modelPricing.ruleValuesRequired", { name: tierLabel });
          if (valuesIssue) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["tiers", i, "rules", r, "values"],
              message: valuesIssue,
            });
          }
          const threshold = String(rule.value ?? "").trim();
          if (
            NUMERIC_RULE_OPS.includes(rule.op) &&
            (threshold === "" || !Number.isFinite(Number(threshold)))
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["tiers", i, "rules", r, "value"],
              message: t("modelPricing.ruleValueRequired", { name: tierLabel }),
            });
          }
        });
      });
    });

type Translate = (_key: string, _named?: Record<string, unknown>) => string;
type RuleInput = { keys: string; op: string };

/** The list-length or byte-length violation of a rule's keys or values, or "". */
function listIssue(items: string[], max: number, name: string, t: Translate): string {
  if (items.length > max) {
    return t("modelPricing.ruleListTooLong", {
      name,
      maxKeys: MAX_RULE_KEYS,
      maxValues: MAX_RULE_VALUES,
    });
  }
  if (items.some((v) => utf8.encode(v).length > MAX_RULE_TEXT_BYTES)) {
    return t("modelPricing.ruleTextTooLong", { name, max: MAX_RULE_TEXT_BYTES });
  }
  return "";
}

function ruleKeysIssue(rule: RuleInput, index: number, name: string, t: Translate): string {
  const keys = splitList(rule.keys);
  if (!keys.length) return t("modelPricing.ruleKeyRequired", { name });
  if (index >= MAX_RULES_PER_TIER) {
    return t("modelPricing.tooManyRules", { name, max: MAX_RULES_PER_TIER });
  }
  const tooLong = listIssue(keys, MAX_RULE_KEYS, name, t);
  if (tooLong) return tooLong;
  if (keys.some((k) => usageKeySuffix(k)?.trim() === "")) {
    return t("modelPricing.ruleUsageKeyBare", { name });
  }
  return "";
}

function ruleOpIssue(rule: RuleInput, name: string, t: Translate): string {
  if (!KNOWN_RULE_OPS.includes(rule.op)) {
    return t("modelPricing.ruleOperatorUnknown", { name, op: rule.op });
  }
  if (
    PRESENCE_RULE_OPS.includes(rule.op) &&
    splitList(rule.keys).some((k) => usageKeySuffix(k) !== null)
  ) {
    return t("modelPricing.rulePresenceOnUsage", { name });
  }
  return "";
}

export type ModelPricingForm = z.infer<ReturnType<typeof makeModelPricingSchema>>;
export type ModelPricingTier = z.infer<typeof tierSchema>;
export type ModelPricingTierWindow = z.infer<typeof tierWindowSchema>;
export type ModelPricingTierRule = z.infer<typeof tierRuleSchema>;
export type ModelPricingPriceRow = z.infer<typeof priceRowSchema>;

type TieTier = {
  condition?: { usage_key?: string; operator?: string; value?: number | string } | null;
  utc_windows?: Array<{ start?: string; end?: string }>;
  rules?: Array<{ keys?: string; op?: string; values?: string; value?: number | string }>;
  priority?: number | string;
};

/** Same normalization as the backend, so `serviceTier` and `service_tier` are one key. */
function normalizeRuleKey(key: string): string {
  return key.toLowerCase().replace(/[_.-]/g, "");
}

/** Mirrors the backend's set match: case-insensitive, and numerically equal numbers are one value. */
function normalizeRuleValue(value: string): string {
  const n = Number(value);
  return value.trim() !== "" && Number.isFinite(n) ? String(n) : value.toLowerCase();
}

function restrictionItems(tier: TieTier): string[] {
  const items: string[] = [];
  const c = tier.condition;
  if (c) items.push(`c:${String(c.usage_key ?? "").trim()}|${c.operator}|${Number(c.value)}`);
  if ((tier.utc_windows ?? []).length) items.push(`w:${JSON.stringify(tier.utc_windows)}`);
  for (const rule of tier.rules ?? []) {
    const keys = splitList(rule.keys ?? "")
      .map(normalizeRuleKey)
      .join(",");
    const values = splitList(rule.values ?? "")
      .map(normalizeRuleValue)
      .sort()
      .join(",");
    const value = NUMERIC_RULE_OPS.includes(rule.op ?? "") ? Number(rule.value) : "";
    items.push(`r:${keys}|${rule.op}|${values}|${value}`);
  }
  return items;
}

/** One-sided bound of a usage condition; eq / neq return null and never prove exclusivity. */
function conditionRange(c: NonNullable<TieTier["condition"]>) {
  const v = Number(c.value);
  if (c.operator === "gt" || c.operator === "gte") return { lo: v, loStrict: c.operator === "gt" };
  if (c.operator === "lt" || c.operator === "lte") return { hi: v, hiStrict: c.operator === "lt" };
  return null;
}

function provablyExclusive(a: TieTier, b: TieTier): boolean {
  const setRule = (r: NonNullable<TieTier["rules"]>[number]) =>
    r.op === "in" || r.op === "not_in"
      ? {
          op: r.op,
          keys: splitList(r.keys ?? "")
            .map(normalizeRuleKey)
            .join(","),
          values: splitList(r.values ?? "").map(normalizeRuleValue),
        }
      : null;
  for (const ra of (a.rules ?? []).map(setRule)) {
    if (!ra) continue;
    for (const rb of (b.rules ?? []).map(setRule)) {
      if (!rb || rb.keys !== ra.keys) continue;
      if (ra.op === "in" && rb.op === "in" && !rb.values.some((v) => ra.values.includes(v)))
        return true;
      const [inc, exc] = ra.op === "in" ? [ra, rb] : [rb, ra];
      if (inc.op === "in" && exc.op === "not_in" && inc.values.every((v) => exc.values.includes(v)))
        return true;
    }
  }
  if (a.condition && b.condition && a.condition.usage_key === b.condition.usage_key) {
    const ra = conditionRange(a.condition);
    const rb = conditionRange(b.condition);
    const lower = ra && "lo" in ra ? ra : rb && "lo" in rb ? rb : null;
    const upper = ra && "hi" in ra ? ra : rb && "hi" in rb ? rb : null;
    if (lower && upper && lower !== upper) {
      const lo = lower.lo as number;
      const hi = upper.hi as number;
      if (hi < lo || (hi === lo && (lower.loStrict || upper.hiStrict))) return true;
    }
  }
  return false;
}

/** Pairs of tier indexes the backend would break by list order alone, because neither priority, restriction count, exclusivity nor a covering tier separates them. */
export function findAmbiguousTiers(tiers: TieTier[]): Array<[number, number]> {
  if (!ranksTiers(tiers)) return [];
  const info = tiers.map((tier, i) => {
    const items = restrictionItems(tier);
    return { i, tier, items, priority: Number(tier.priority) || 0 };
  });
  const candidates = info.filter((t) => t.i > 0 && t.items.length > 0);
  const outranks = (k: (typeof info)[number], x: (typeof info)[number]) =>
    k.priority > x.priority || (k.priority === x.priority && k.items.length > x.items.length);
  const pairs: Array<[number, number]> = [];
  for (let a = 0; a < candidates.length; a++) {
    for (let b = a + 1; b < candidates.length; b++) {
      const x = candidates[a];
      const y = candidates[b];
      if (x.priority !== y.priority || x.items.length !== y.items.length) continue;
      if (provablyExclusive(x.tier, y.tier)) continue;
      // A tier built only from x's and y's restrictions matches every span both match.
      const union = new Set([...x.items, ...y.items]);
      const covered = candidates.some(
        (k) => outranks(k, x) && k.items.every((item) => union.has(item)),
      );
      if (!covered) pairs.push([x.i, y.i]);
    }
  }
  return pairs;
}

/** First-match mode only: `[earlier, later]` pairs where the earlier tier matches every span the later one does, so the later one is never selected. */
export function findUnreachableTiers(tiers: TieTier[]): Array<[number, number]> {
  if (ranksTiers(tiers)) return [];
  const restricted = tiers
    .map((tier, i) => ({ i, tier }))
    .filter(({ i, tier }) => i > 0 && restrictionItems(tier).length > 0);
  const pairs: Array<[number, number]> = [];
  restricted.forEach((later, b) => {
    const earlier = restricted.slice(0, b).find((x) => covers(x.tier, later.tier));
    if (earlier) pairs.push([earlier.i, later.i]);
  });
  return pairs;
}

/** Whether every restriction of `wide` holds wherever all of `narrow`'s restrictions hold. */
function covers(wide: TieTier, narrow: TieTier): boolean {
  const narrowItems = new Set(restrictionItems(narrow));
  return restrictionItems(wide).every(
    (item) =>
      narrowItems.has(item) ||
      (item.startsWith("c:") && conditionImplies(narrow.condition, wide.condition)),
  );
}

/** Whether `narrow`'s usage condition can only hold where `wide`'s also holds. */
function conditionImplies(narrow: TieTier["condition"], wide: TieTier["condition"]): boolean {
  if (!narrow || !wide) return false;
  if (String(narrow.usage_key ?? "").trim() !== String(wide.usage_key ?? "").trim()) return false;
  const n = conditionRange(narrow);
  const w = conditionRange(wide);
  if (!n || !w) return false;
  if (w.lo !== undefined && n.lo !== undefined) {
    return n.lo > w.lo || (n.lo === w.lo && (!!n.loStrict || !w.loStrict));
  }
  if (w.hi !== undefined && n.hi !== undefined) {
    return n.hi < w.hi || (n.hi === w.hi && (!!n.hiStrict || !w.hiStrict));
  }
  return false;
}
