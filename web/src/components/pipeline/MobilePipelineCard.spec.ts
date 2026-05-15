import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import i18n from "@/locales";
import MobilePipelineCard from "./MobilePipelineCard.vue";

const mountCard = (
  row: Record<string, any>,
  isEnterprise = false,
) =>
  mount(MobilePipelineCard, {
    props: { row, isEnterprise },
    global: { plugins: [Quasar, i18n] },
  });

describe("MobilePipelineCard", () => {
  const baseRow = {
    pipeline_id: "p-1",
    name: "IngestErrors",
    type: "scheduled",
    stream_name: "prod_logs",
    stream_type: "logs",
    frequency: "5 Mins",
    period: "10 Mins",
    enabled: true,
  };

  it("renders title and source badge", () => {
    const w = mountCard(baseRow);
    expect(w.find(".mobile-pipeline-card__title").text()).toBe("IngestErrors");
    expect(w.find(".mobile-pipeline-card__badge").text()).toBe("scheduled");
  });

  it("renders subtitle with stream_type and source", () => {
    const w = mountCard(baseRow);
    const subtitle = w.find(".mobile-pipeline-card__subtitle").text();
    expect(subtitle).toContain("logs");
    expect(subtitle).toContain("scheduled");
  });

  it("shows Enabled state when row.enabled is true", () => {
    const w = mountCard(baseRow);
    expect(w.find(".mobile-pipeline-card__state").text()).toBe("Enabled");
    expect(w.find(".mobile-pipeline-card__state").classes()).toContain("is-on");
  });

  it("shows Paused and disabled modifier when row.enabled is false", () => {
    const w = mountCard({ ...baseRow, enabled: false });
    expect(w.find(".mobile-pipeline-card__state").text()).toBe("Paused");
    expect(w.find(".mobile-pipeline-card").classes()).toContain(
      "mobile-pipeline-card--disabled",
    );
  });

  it("renders meta items with stream_name and cadence", () => {
    const w = mountCard(baseRow);
    const meta = w.find(".mobile-pipeline-card__meta").text();
    expect(meta).toContain("prod_logs");
    expect(meta).toContain("5 Mins");
  });

  it("falls back to period when frequency is '--'", () => {
    const w = mountCard({ ...baseRow, frequency: "--", period: "30 Mins" });
    const meta = w.find(".mobile-pipeline-card__meta").text();
    expect(meta).toContain("30 Mins");
  });

  it("renders an error badge when last_error is present", () => {
    const w = mountCard({
      ...baseRow,
      last_error: { last_error_timestamp: 0 },
    });
    expect(w.find(".mobile-pipeline-card__meta-error").exists()).toBe(true);
  });

  it("emits click with row on tap", async () => {
    const w = mountCard(baseRow);
    await w.find(".mobile-pipeline-card").trigger("click");
    expect(w.emitted("click")).toBeTruthy();
    expect(w.emitted("click")![0]).toEqual([baseRow]);
  });

  it("emits click on Enter keydown", async () => {
    const w = mountCard(baseRow);
    await w.find(".mobile-pipeline-card").trigger("keydown.enter");
    expect(w.emitted("click")).toBeTruthy();
  });

  it("emits each menu action with the row", () => {
    const w = mountCard(baseRow, true);
    const vm = w.vm as any;
    const actions = ["toggle", "edit", "export", "backfill", "delete"];
    for (const action of actions) vm.$emit(action, baseRow);
    for (const action of actions) {
      expect(w.emitted(action)).toBeTruthy();
      expect(w.emitted(action)![0]).toEqual([baseRow]);
    }
  });

  it("does not propagate card click from the overflow button", async () => {
    const w = mountCard(baseRow);
    const more = w.find(".mobile-pipeline-card__more");
    await more.trigger("click");
    expect(w.emitted("click")).toBeFalsy();
  });

  it("emits toggle when swipe-left handler is invoked", () => {
    const w = mountCard(baseRow);
    const reset = vi.fn();
    (w.vm as any).onSwipeLeft({ reset });
    expect(w.emitted("toggle")).toBeTruthy();
    expect(w.emitted("toggle")![0]).toEqual([baseRow]);
    expect(reset).toHaveBeenCalled();
  });

  it("emits delete when swipe-right handler is invoked", () => {
    const w = mountCard(baseRow);
    const reset = vi.fn();
    (w.vm as any).onSwipeRight({ reset });
    expect(w.emitted("delete")).toBeTruthy();
    expect(w.emitted("delete")![0]).toEqual([baseRow]);
    expect(reset).toHaveBeenCalled();
  });

  it("exposes canBackfill only for enterprise scheduled pipelines", () => {
    const enterprise = mountCard(baseRow, true);
    expect((enterprise.vm as any).canBackfill).toBe(true);
    const nonEnterprise = mountCard(baseRow, false);
    expect((nonEnterprise.vm as any).canBackfill).toBe(false);
    const realtime = mountCard(
      { ...baseRow, type: "realtime" },
      true,
    );
    expect((realtime.vm as any).canBackfill).toBe(false);
  });
});
