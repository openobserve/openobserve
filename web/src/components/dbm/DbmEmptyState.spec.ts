import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import DbmEmptyState from "./DbmEmptyState.vue";

/**
 * These tests describe the CHECKLIST contract: every check renders with its own
 * pass/fail verdict, never a single most-blocking cause alone. The checks that
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

  /**
   * The prop doc already promised this and the component did not do it: `null`
   * means the caller never counted, which is a different fact from "zero
   * arrived". Rendering the two the same way makes the checklist state a
   * failure it never observed — worse than a generic empty state, because it is
   * confidently wrong and sends the reader to instrument an already-instrumented
   * org.
   */
  describe("a check it could not evaluate is not a failure", () => {
    it("omits the trace check when the caller never counted traces", () => {
      expect(verdictOf(mountWith({ traceCount: null }), "traces")).toBe("absent");
    });

    it("still fails the trace check when the caller counted zero", () => {
      expect(verdictOf(mountWith({ traceCount: 0 }), "traces")).toBe("fail");
    });

    it("does not count an unevaluated check as a failure in the tally", () => {
      // enabled + permission pass, traces unknown, dbSpans fails.
      expect(mountWith({ traceCount: null, hasDbSpans: false }).text()).toContain(
        "2 pass, 1 doesn't",
      );
    });

    /**
     * The primary button offers to instrument. With traces uncounted we have no
     * evidence instrumentation is what is missing, so an unknown must not be
     * read as the failing check that decides the offer.
     */
    it("does not let an uncounted signal drive the diagnosis", () => {
      const wrapper = mountWith({ traceCount: null, neverAggregated: true });
      expect(verdictOf(wrapper, "counted")).toBe("fail");
      expect(verdictOf(wrapper, "traces")).toBe("absent");
    });
  });

  /**
   * The zero-trace org, as the pages actually render it: a never-instrumented
   * org's rollup offset is 0, so `neverAggregated` arrives `true` alongside
   * `traceCount: 0`. Before this contract the count was never wired, and the
   * only row such an org ever saw was "We haven't finished counting yet …
   * a few minutes" — indefinitely — framing a missing integration as a lagging
   * pipeline. `hasDbSpans` stays unsupplied here because the pages never probe
   * it, so these mounts are the shipped prop shape, not a convenient one.
   */
  describe("a zero-trace org is uninstrumented, not lagging", () => {
    const zeroTraceOrg = {
      traceCount: 0,
      neverAggregated: true,
      hasDbSpans: undefined,
    } as const;

    it("says monitoring is built from traces it has not sent, not that counting is slow", () => {
      const text = mountWith(zeroTraceOrg).text();
      expect(text).toContain("hasn't sent any yet");
      expect(text).not.toContain("haven't finished counting");
    });

    it("fails the trace check and drops the contradictory counting row", () => {
      const wrapper = mountWith(zeroTraceOrg);
      expect(verdictOf(wrapper, "traces")).toBe("fail");
      // The counting row's copy opens "Database calls have arrived" — the
      // opposite of the verdict one line above it.
      expect(verdictOf(wrapper, "counted")).toBe("absent");
    });

    it("offers instrumentation, not a retry of counting nothing", async () => {
      const wrapper = mountWith(zeroTraceOrg);
      await wrapper.find("[data-test='dbm-empty-state-instrument']").trigger("click");
      expect(wrapper.emitted("action")).toEqual([["not-instrumented"]]);
    });

    it("keeps the counting diagnosis for an org whose traces exist", () => {
      // The other side of the same coin: traces arriving + nothing counted IS
      // the lagging pipeline, and must keep saying so.
      const wrapper = mountWith({ neverAggregated: true });
      expect(verdictOf(wrapper, "traces")).toBe("ok");
      expect(verdictOf(wrapper, "counted")).toBe("fail");
    });
  });
});
