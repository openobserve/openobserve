import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import i18n from "@/locales";
import MobileEnrichmentTableCard from "./MobileEnrichmentTableCard.vue";

const mountCard = (row: Record<string, any>) =>
  mount(MobileEnrichmentTableCard, {
    props: { row },
    global: { plugins: [Quasar, i18n] },
  });

describe("MobileEnrichmentTableCard", () => {
  const fileRow = {
    name: "ip_lookup",
    doc_num: "1,234",
    storage_size: "2 MB",
  };
  const urlCompletedRow = {
    name: "geo_url",
    urlJobs: [{ id: "1", status: "completed" }],
    aggregateStatus: "completed",
    doc_num: "",
    storage_size: "",
  };

  it("renders the name", () => {
    const w = mountCard(fileRow);
    expect(w.find(".mobile-enrichment-card__title").text()).toBe("ip_lookup");
  });

  it("shows a file badge when there are no url jobs", () => {
    const w = mountCard(fileRow);
    expect(w.find(".mobile-enrichment-card__badge").text()).toBe("file");
  });

  it("shows an ok-tone url badge when aggregateStatus is completed", () => {
    const w = mountCard(urlCompletedRow);
    const badge = w.find(".mobile-enrichment-card__badge");
    expect(badge.text()).toContain("url");
    expect(badge.classes()).toContain("mobile-enrichment-card__badge--ok");
  });

  it("renders the meta line when doc_num + storage_size are set", () => {
    const w = mountCard(fileRow);
    expect(w.find(".mobile-enrichment-card__meta").text()).toBe(
      "1,234 docs · 2 MB",
    );
  });

  it("emits click with row on tap", async () => {
    const w = mountCard(fileRow);
    await w.find(".mobile-enrichment-card").trigger("click");
    expect(w.emitted("click")).toBeTruthy();
    expect(w.emitted("click")![0]).toEqual([fileRow]);
  });

  it("emits each menu action with the row", () => {
    const w = mountCard(fileRow);
    const vm = w.vm as any;
    const actions = ["explore", "schema", "edit", "delete"];
    for (const action of actions) vm.$emit(action, fileRow);
    for (const action of actions) {
      expect(w.emitted(action)).toBeTruthy();
      expect(w.emitted(action)![0]).toEqual([fileRow]);
    }
  });

  it("does not propagate card click from the overflow button", async () => {
    const w = mountCard(fileRow);
    const more = w.find(".mobile-enrichment-card__more");
    await more.trigger("click");
    expect(w.emitted("click")).toBeFalsy();
  });

  it("emits delete when swipe-right handler is invoked", () => {
    const w = mountCard(fileRow);
    const reset = vi.fn();
    (w.vm as any).onSwipeRight({ reset });
    expect(w.emitted("delete")).toBeTruthy();
    expect(w.emitted("delete")![0]).toEqual([fileRow]);
    expect(reset).toHaveBeenCalled();
  });

  it("hides Explore/Schema/Edit options for pending URL jobs", () => {
    const pendingRow = {
      name: "pending",
      urlJobs: [{ status: "pending" }],
      aggregateStatus: "pending",
    };
    const w = mountCard(pendingRow);
    const vm = w.vm as any;
    expect(vm.canExploreOrSchema).toBe(false);
    expect(vm.canEdit).toBe(false);
  });

  it("allows Edit but not Explore/Schema when URL jobs are failed", () => {
    const failedRow = {
      name: "failed",
      urlJobs: [{ status: "failed" }],
      aggregateStatus: "failed",
    };
    const w = mountCard(failedRow);
    const vm = w.vm as any;
    expect(vm.canExploreOrSchema).toBe(false);
    expect(vm.canEdit).toBe(true);
  });
});
