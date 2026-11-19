// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, afterEach } from "vitest";
import { computed, ref } from "vue";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import {
  pickSuggestion,
  suggestionQualifies,
  type AlertSuggestionId,
  type SuggestionContext,
} from "./alertSuggestions";
import type { AlertSettingId } from "./alertSettingTiers";
import { useAlertSuggestions } from "@/composables/alerts/useAlertSuggestions";
import { useAlertSettingTiers } from "@/composables/alerts/useAlertSettingTiers";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/services/product_analytics", () => ({ default: { track } }));

const t = i18n.global.t as unknown as TranslateFn;
const SIGNAL = { checks: 288, alerts: 11, singleCheckSpikes: 8, refires: 0, frequencyMinutes: 5 };

const ctx = (over: Partial<SuggestionContext> = {}): SuggestionContext => ({
  shape: "filters",
  kind: "scheduled",
  promql: "",
  ruleMode: false,
  backtest: null,
  resolvingDestinations: [],
  createsIncident: false,
  oncallSet: false,
  available: () => true,
  isSet: () => false,
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  track.mockClear();
});

describe("suggestionQualifies", () => {
  const promql = { shape: "promql" as const };
  it.each<[AlertSuggestionId, Partial<SuggestionContext>, boolean]>([
    ["ruleExpression", { ...promql, promql: "sum(x) > 5" }, true],
    ["ruleExpression", { ...promql, promql: 'x{a=">"}' }, false],
    ["ruleExpression", { ...promql, promql: "sum(x) > 5", ruleMode: true }, false],
    ["holdFor", { backtest: SIGNAL }, true],
    ["holdFor", { backtest: { ...SIGNAL, alerts: 2, singleCheckSpikes: 2 } }, false],
    ["holdFor", { backtest: null }, false],
    ["holdFor", { backtest: SIGNAL, isSet: (id) => id === "holdFor" }, false],
    ["keepFiring", { backtest: { ...SIGNAL, refires: 1 } }, true],
    ["keepFiring", { backtest: SIGNAL }, false],
    ["recovery", { resolvingDestinations: ["team-pager"] }, true],
    ["recovery", { createsIncident: true }, true],
    ["recovery", {}, false],
    ["recovery", { createsIncident: true, isSet: (id) => id === "recovery" }, false],
    ["oncall", { createsIncident: true }, true],
    ["oncall", { isSet: (id) => id === "priority" }, true],
    ["oncall", { createsIncident: true, available: (id) => id !== "oncall" }, false],
    ["priority", { createsIncident: true }, true],
    ["priority", {}, false],
  ])("%s %#", (id, over, expected) => {
    expect(suggestionQualifies(id, ctx(over))).toBe(expected);
  });
});

describe("pickSuggestion", () => {
  const both = ctx({ createsIncident: true });
  it.each<
    [string, ReadonlySet<AlertSuggestionId>, { id: AlertSuggestionId; queued: number } | null]
  >([
    ["three qualify: the first, two queued", new Set(), { id: "recovery", queued: 2 }],
    ["the first dismissed: the second", new Set(["recovery"]), { id: "oncall", queued: 1 }],
    [
      "the name's step adds priority last",
      new Set(["recovery", "oncall"]),
      { id: "priority", queued: 0 },
    ],
    ["none left", new Set(["recovery", "oncall", "priority"]), null],
  ])("%s", (_name, dismissed, expected) => {
    expect(pickSuggestion("notify", both, dismissed)).toEqual(expected);
  });
});

describe("useAlertSuggestions", () => {
  const setup = (scope: { user: string; org: string; alertId: string | null }) => {
    const tiers = useAlertSettingTiers({
      available: () => true,
      isSet: () => false,
      showAll: ref(false),
    });
    const s = ref(scope);
    const api = useAlertSuggestions({
      context: computed(() => ctx({ createsIncident: true })),
      scope: () => s.value,
      tiers,
      t,
    });
    return { api, tiers, s };
  };
  const memoryStorage = () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  };

  it("Not now survives blocked storage and moves on (Review Focus 3)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    const { api } = setup({ user: "a", org: "o", alertId: "x" });
    expect(() => api.notNow("recovery")).not.toThrow();
    expect(api.current("notify")?.id).toBe("oncall");
  });

  it("each user reads their own Not now", async () => {
    memoryStorage();
    const { api, s } = setup({ user: "a", org: "o", alertId: "x" });
    api.notNow("recovery");
    expect(api.current("notify")?.id).toBe("oncall");
    s.value = { user: "b", org: "o", alertId: "x" };
    await Promise.resolve();
    expect(api.current("notify")?.id).toBe("recovery");
    expect(setup({ user: "a", org: "o", alertId: "x" }).api.current("notify")?.id).toBe("oncall");
  });

  it("add() calls the registered onApply handler, reveals the setting and tracks alert_suggestion_applied once", () => {
    memoryStorage();
    const { api, tiers } = setup({ user: "a", org: "o", alertId: null });
    const handler = vi.fn();
    api.onApply("recovery", handler);
    api.add("recovery");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(tiers.isVisible("recovery" as AlertSettingId)).toBe(true);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("alert_suggestion_applied", { suggestion: "recovery" });
    expect(api.current("notify")?.id).toBe("oncall");
  });
});
