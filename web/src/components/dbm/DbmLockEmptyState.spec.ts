import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import DbmLockEmptyState, { type DbmLockCheck } from "./DbmLockEmptyState.vue";
import { raw } from "@/types/i18n";

/**
 * The two empty states mean OPPOSITE things and must never be confused: an
 * operator who reads "no deadlocks" while collection is broken is being
 * actively misled. These tests pin the difference the user can actually see.
 */
const checks: DbmLockCheck[] = [
  { id: "reading", status: "ok", title: raw("We are reading the logs"), detail: raw("12s ago") },
  { id: "log", status: "fail", title: raw("No database log"), detail: raw("point your collector") },
  { id: "note", status: "note", title: raw("Worth knowing"), detail: raw("two log lines") },
];

const mountWith = (props: Record<string, unknown>) =>
  mount(DbmLockEmptyState, {
    props: {
      healthy: true,
      title: raw("No deadlocks"),
      description: raw("That is the healthy normal."),
      checklistTitle: raw("How we know"),
      checks,
      ...props,
    },
    global: { plugins: [i18n] },
  });

describe("DbmLockEmptyState", () => {
  describe("healthy vs not-collecting", () => {
    it("renders the healthy state in the success tone with its reassurance pill", () => {
      const wrapper = mountWith({
        healthy: true,
        collectionHealthyLabel: raw("Collection healthy"),
      });
      const pill = wrapper.find("[data-test='dbm-lock-empty-state-healthy-pill']");
      expect(pill.exists()).toBe(true);
      expect(pill.text()).toContain("Collection healthy");
    });

    it("does NOT show the reassurance pill when collection is the problem", () => {
      const wrapper = mountWith({ healthy: false });
      expect(wrapper.find("[data-test='dbm-lock-empty-state-healthy-pill']").exists()).toBe(false);
    });

    // The two states MUST stay visually distinguishable — an operator who reads
    // "no deadlocks" when collection is broken is being actively misled. That
    // distinction now rides on the shared OEmptyState illustration rather than a
    // bespoke icon badge, so this asserts the illustration, not the chrome.
    it("shows a different illustration for healthy vs not-collecting", () => {
      const healthy = mountWith({ healthy: true });
      const broken = mountWith({ healthy: false });
      // `check` = we looked and all is well. `data-scene` = nothing is arriving.
      expect(healthy.findComponent({ name: "EmptyCheck" }).exists()).toBe(true);
      expect(broken.findComponent({ name: "EmptyCheck" }).exists()).toBe(false);
    });

    it("keeps the success tone on the healthy reassurance", () => {
      expect(mountWith({ healthy: true }).html()).toContain("bg-status-success-bg");
    });
  });

  describe("the checklist", () => {
    it("renders every check, not only the failing one", () => {
      const wrapper = mountWith({});
      for (const id of ["reading", "log", "note"]) {
        expect(wrapper.find(`[data-test='dbm-lock-empty-state-check-${id}']`).exists()).toBe(true);
      }
    });

    it("marks each verdict with its own glyph", () => {
      const wrapper = mountWith({});
      const glyph = (id: string) =>
        wrapper.find(`[data-test='dbm-lock-empty-state-check-${id}'] span`).text().trim();
      expect(glyph("reading")).toBe("✓");
      expect(glyph("log")).toBe("✕");
      expect(glyph("note")).toBe("!");
    });

    it("shows each check's detail — the specific fix, not a generic link", () => {
      expect(mountWith({}).text()).toContain("point your collector");
    });
  });

  describe("actions", () => {
    it("emits the action id the caller keyed on", async () => {
      const wrapper = mountWith({
        actions: [{ id: "recipe", label: raw("Show me the collector config"), primary: true }],
      });
      await wrapper.find("[data-test='dbm-lock-empty-state-action-recipe']").trigger("click");
      expect(wrapper.emitted("action")?.[0]).toEqual(["recipe"]);
    });

    it("renders no action row when the caller offers none", () => {
      expect(mountWith({}).find("[data-test^='dbm-lock-empty-state-action-']").exists()).toBe(
        false,
      );
    });
  });
});
