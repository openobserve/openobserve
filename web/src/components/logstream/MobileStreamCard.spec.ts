import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import i18n from "@/locales";
import MobileStreamCard from "./MobileStreamCard.vue";

const mountCard = (row: Record<string, any>, showDocCount = true) =>
  mount(MobileStreamCard, {
    props: { row, showDocCount },
    global: { plugins: [Quasar, i18n] },
  });

describe("MobileStreamCard", () => {
  const logsRow = {
    name: "k8s_logs",
    stream_type: "logs",
    doc_num: "12,345",
    storage_size: "42 MB",
    compressed_size: "10 MB",
  };

  it("renders the stream name", () => {
    const w = mountCard(logsRow);
    expect(w.find(".mobile-stream-card__title").text()).toBe("k8s_logs");
  });

  it("renders a stream type badge with the matching tone", () => {
    const w = mountCard({ ...logsRow, stream_type: "metrics" });
    const badge = w.find(".mobile-stream-card__badge");
    expect(badge.text()).toBe("metrics");
    expect(badge.classes()).toContain("mobile-stream-card__badge--metrics");
  });

  it("builds a meta line with doc count + sizes", () => {
    const w = mountCard(logsRow);
    const meta = w.find(".mobile-stream-card__meta").text();
    expect(meta).toContain("12,345 docs");
    expect(meta).toContain("42 MB");
    expect(meta).toContain("10 MB compressed");
  });

  it("omits doc count when showDocCount is false", () => {
    const w = mountCard(logsRow, false);
    const meta = w.find(".mobile-stream-card__meta").text();
    expect(meta).not.toContain("docs");
    expect(meta).toContain("42 MB");
  });

  it("skips meta when stats are placeholders", () => {
    const w = mountCard({
      name: "empty",
      stream_type: "logs",
      doc_num: "--",
      storage_size: "-- MB",
      compressed_size: "-- MB",
    });
    expect(w.find(".mobile-stream-card__meta").exists()).toBe(false);
  });

  it("emits click with row on tap", async () => {
    const w = mountCard(logsRow);
    await w.find(".mobile-stream-card").trigger("click");
    expect(w.emitted("click")).toBeTruthy();
    expect(w.emitted("click")![0]).toEqual([logsRow]);
  });

  it("emits each menu action with the row", () => {
    const w = mountCard(logsRow);
    const vm = w.vm as any;
    const actions = ["explore", "schema", "delete"];
    for (const action of actions) vm.$emit(action, logsRow);
    for (const action of actions) {
      expect(w.emitted(action)).toBeTruthy();
      expect(w.emitted(action)![0]).toEqual([logsRow]);
    }
  });

  it("does not propagate card click from the overflow button", async () => {
    const w = mountCard(logsRow);
    const more = w.find(".mobile-stream-card__more");
    await more.trigger("click");
    expect(w.emitted("click")).toBeFalsy();
  });

  it("rounds high-precision storage floats for readability", () => {
    const w = mountCard({
      ...logsRow,
      storage_size: "0.0014781951904296875 MB",
      compressed_size: "0.010556221008300781 MB",
    });
    const meta = w.find(".mobile-stream-card__meta").text();
    expect(meta).not.toContain("0.0014781951904296875");
    expect(meta).not.toContain("0.010556221008300781");
    expect(meta).toContain("MB");
  });

  it("preserves already-formatted sizes untouched", () => {
    const w = mountCard({ ...logsRow, storage_size: "42.5 MB" });
    expect(w.find(".mobile-stream-card__meta").text()).toContain("42.5 MB");
  });

  it("emits delete when swipe-right handler is invoked", () => {
    const w = mountCard(logsRow);
    const reset = vi.fn();
    (w.vm as any).onSwipeRight({ reset });
    expect(w.emitted("delete")).toBeTruthy();
    expect(w.emitted("delete")![0]).toEqual([logsRow]);
    expect(reset).toHaveBeenCalled();
  });
});
