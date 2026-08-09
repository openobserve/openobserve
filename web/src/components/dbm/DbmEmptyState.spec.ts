import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import DbmEmptyState from "./DbmEmptyState.vue";

/**
 * These tests describe the CHECKLIST contract, which replaced the earlier
 * one-cause contract.
 *
 * The old component picked a single most-blocking cause and rendered only that.
 * It now renders every check with a pass/fail verdict, because the checks that
 * PASS are the reassurance — a user who can see "traces arriving ✓, access ✓,
 * no database spans ✗" knows which team to talk to, where a lone failure leaves
 * them wondering whether the rest is also broken. So the assertions here are
 * about the verdicts on the list, not about which cause "won".
 */
const HEALTHY = {
  permissionOk: true,
  enabled: true,
  traceCount: 1_200_000,
  hasDbSpans: true,
  neverAggregated: false,
  filtered: false,
  org: "default",
} as const;

const mountWith = (props: Partial<typeof HEALTHY>) =>
  mount(DbmEmptyState, {
    props: { ...HEALTHY, ...props },
    global: { plugins: [i18n] },
  });

/** The verdict on one check, read off its status glyph. */
const verdictOf = (wrapper: ReturnType<typeof mountWith>, id: string): string => {
  const row = wrapper.find(`[data-test='dbm-empty-check-${id}']`);
  if (!row.exists()) return "absent";
  const glyph = row.find("span").text().trim();
  return glyph === "✓" ? "ok" : glyph === "✕" ? "fail" : "note";
};

describe("DbmEmptyState", () => {
  describe("the checklist", () => {
    it("shows every check, not only the failing one", () => {
      const wrapper = mountWith({ hasDbSpans: false });
      expect(verdictOf(wrapper, "enabled")).toBe("ok");
      expect(verdictOf(wrapper, "traces")).toBe("ok");
      expect(verdictOf(wrapper, "permission")).toBe("ok");
      expect(verdictOf(wrapper, "dbSpans")).toBe("fail");
    });

    it("marks the feature flag as failing when it is off", () => {
      expect(verdictOf(mountWith({ enabled: false }), "enabled")).toBe("fail");
    });

    it("marks access as failing on a permission error", () => {
      expect(verdictOf(mountWith({ permissionOk: false }), "permission")).toBe("fail");
    });

    it("marks traces as failing when none arrived", () => {
      expect(verdictOf(mountWith({ traceCount: 0 }), "traces")).toBe("fail");
    });

    it("counts the traces it did find, so the pass is evidenced", () => {
      expect(mountWith({}).text()).toContain("1,200,000");
    });

    /**
     * A check it could not evaluate must not claim a pass. The schema probe is
     * optional, so when the caller does not supply it the row is absent rather
     * than ticked.
     */
    it("omits the database-span check when the caller did not probe for it", () => {
      expect(verdictOf(mountWith({ hasDbSpans: undefined }), "dbSpans")).toBe("absent");
    });

    it("adds the counting check only while counting is genuinely unfinished", () => {
      expect(verdictOf(mountWith({}), "counted")).toBe("absent");
      expect(verdictOf(mountWith({ neverAggregated: true }), "counted")).toBe("fail");
    });

    it("always closes with the what-happens-next note", () => {
      expect(verdictOf(mountWith({}), "also")).toBe("note");
    });
  });

  describe("the summary line", () => {
    it("counts passes and failures so the shape is readable before the list", () => {
      expect(mountWith({ hasDbSpans: false }).text()).toContain("3 pass, 1 doesn't");
    });

    it("pluralises when more than one check fails", () => {
      const text = mountWith({ hasDbSpans: false, traceCount: 0 }).text();
      expect(text).toContain("2 pass, 2 don't");
    });
  });

  describe("a filter is not a diagnosis", () => {
    /**
     * Emptiness the user caused by typing in the search box needs a way back,
     * not an investigation — so it short-circuits the whole checklist.
     */
    it("renders the plain filtered state instead of the checklist", () => {
      const wrapper = mountWith({ filtered: true });
      expect(wrapper.find("[data-test='dbm-empty-state-filtered']").exists()).toBe(true);
      expect(wrapper.find("[data-test='dbm-empty-state-checks']").exists()).toBe(false);
    });

    it("emits `filtered` so the caller clears the filters", async () => {
      const wrapper = mountWith({ filtered: true });
      await wrapper.find("button").trigger("click");
      expect(wrapper.emitted("action")).toEqual([["filtered"]]);
    });
  });

  describe("the primary action", () => {
    /** The first failing check decides what the button offers to fix. */
    it("routes to the permission fix when access failed", async () => {
      const wrapper = mountWith({ permissionOk: false });
      await wrapper.find("[data-test='dbm-empty-state-instrument']").trigger("click");
      expect(wrapper.emitted("action")).toEqual([["no-permission"]]);
    });

    it("routes to the flag when the feature is off", async () => {
      const wrapper = mountWith({ enabled: false });
      await wrapper.find("[data-test='dbm-empty-state-instrument']").trigger("click");
      expect(wrapper.emitted("action")).toEqual([["disabled"]]);
    });

    it("offers a retry rather than instrumentation while counting is pending", async () => {
      const wrapper = mountWith({ neverAggregated: true });
      await wrapper.find("[data-test='dbm-empty-state-instrument']").trigger("click");
      expect(wrapper.emitted("action")).toEqual([["not-counted"]]);
    });

    it("offers instrumentation when everything else passes", async () => {
      const wrapper = mountWith({ hasDbSpans: false });
      await wrapper.find("[data-test='dbm-empty-state-instrument']").trigger("click");
      expect(wrapper.emitted("action")).toEqual([["not-instrumented"]]);
    });

    /** Only offered when there is a trace to open. */
    it("offers the trace check only when traces exist", () => {
      expect(mountWith({}).find("[data-test='dbm-empty-state-check-trace']").exists()).toBe(true);
      expect(
        mountWith({ traceCount: 0 }).find("[data-test='dbm-empty-state-check-trace']").exists(),
      ).toBe(false);
    });
  });

  describe("plain language", () => {
    /**
     * The whole point of the copy rewrite: a DBA who has never read our docs
     * must be able to act on this screen. These are the words we shipped that
     * they would have had to look up.
     */
    it.each(["fingerprint", "top-N", "rollup", "live tail", "_other", "enrichment"])(
      "never says %s",
      (term) => {
        const text = mountWith({ hasDbSpans: false, neverAggregated: true }).text().toLowerCase();
        expect(text).not.toContain(term.toLowerCase());
      },
    );
  });
});
