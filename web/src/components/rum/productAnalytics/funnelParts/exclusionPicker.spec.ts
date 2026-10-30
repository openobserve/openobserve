// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import type { NamedEvent } from "@/utils/rum/productAnalyticsModel";
import type { ExclusionStep, FunnelDef, StepRef } from "@/utils/rum/productAnalyticsQueries";

vi.mock("@/composables/rum/useStepOptions", async (importOriginal) => {
  const { useStepOptionsMock } = await import("@/utils/rum/__fixtures__/stepOptionsMock");
  return {
    ...(await importOriginal<object>()),
    default: useStepOptionsMock,
    useStepOptions: useStepOptionsMock,
  };
});

import {
  resetStepOptions,
  stepOptions,
  useStepOptionsMock,
} from "@/utils/rum/__fixtures__/stepOptionsMock";
import ExclusionPicker from "./ExclusionPicker.vue";

const dt = (id: string) => `[data-test="${id}"]`;
const PICKER = "rum-analytics-funnel-exclusion-picker";
const STEPS: StepRef[] = [
  { kind: "p", key: "/web" },
  { kind: "p", key: "/web/logs" },
  { kind: "p", key: "/web/billings" },
];
const defWith = (steps: StepRef[] = STEPS): FunnelDef => ({
  steps,
  unit: "sessions",
  window: "session",
  breakdown: null,
  x: [],
});
const SIGNUP = { id: "ev1", name: "Signup" } as NamedEvent;
const OPTIONS = [
  { label: "Pages", header: true, value: "header:p" },
  { label: "/web", value: "p:/web", icon: "article" },
  { label: "/web/logs", value: "p:/web/logs", icon: "article" },
  { label: "/web/billings", value: "p:/web/billings", icon: "article" },
  { label: "/web/ingestion", value: "p:/web/ingestion", icon: "article" },
  { label: "Clicks and custom actions", header: true, value: "header:c" },
  { label: "save-btn", value: "c:save-btn", icon: "ads-click", badge: "Event" },
  { label: "Named events", header: true, value: "header:e" },
  { label: "Signup", value: "e:ev1", icon: "bookmark" },
];

let wrapper: VueWrapper | null = null;
const mountPicker = (props: Record<string, unknown> = {}) => {
  wrapper = mount(ExclusionPicker, {
    props: { def: defWith(), events: [SIGNUP], eventsStatus: "ready", ...props },
    attachTo: document.body,
  });
  return wrapper;
};
const row = (w: VueWrapper, kind: string, key: string) =>
  w.find(dt(`${PICKER}-step-${kind}:${key}`));
const pick = async (w: VueWrapper, kind: string, key: string) => {
  expect(row(w, kind, key).exists()).toBe(true);
  await row(w, kind, key).trigger("click");
};
const apply = (w: VueWrapper) => w.find(dt(`${PICKER}-apply`));
const search = (w: VueWrapper) => w.find(`${dt("o-field-list-search")} input`);
const select = (w: VueWrapper, id: "from" | "to") =>
  w
    .findAllComponents({ name: "OSelect" })
    .find((c) => c.attributes("data-test") === `${PICKER}-${id}`);
const setMode = async (w: VueWrapper, mode: "between" | "within") => {
  w.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", mode);
  await w.vm.$nextTick();
};
const setSelect = async (w: VueWrapper, id: "from" | "to", value: number) => {
  select(w, id)!.vm.$emit("update:modelValue", value);
  await w.vm.$nextTick();
};
const seconds = (w: VueWrapper) =>
  w
    .findAllComponents({ name: "OInput" })
    .find((c) => c.attributes("data-test") === `${PICKER}-seconds`);
const applied = (w: VueWrapper) => w.emitted("apply") as [ExclusionStep][] | undefined;

describe("ExclusionPicker", () => {
  beforeEach(() => resetStepOptions(OPTIONS));
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("lists the options under their kind headers, an event by its name, with the custom badge", () => {
    const w = mountPicker();
    expect(useStepOptionsMock).toHaveBeenCalledTimes(1);
    const [opts] = useStepOptionsMock.mock.calls[0];
    expect(opts.kinds()).toEqual(["e", "p", "c", "r"]);
    expect(opts.events()).toEqual([SIGNUP]);
    expect(stepOptions.load).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain("Pages");
    expect(w.text()).toContain("Named events");
    const logs = row(w, "p", "/web/logs");
    expect(logs.text()).toContain("Page");
    expect(logs.text()).toContain("/web/logs");
    expect(row(w, "e", "ev1").text()).toContain("Signup");
    expect(row(w, "e", "ev1").text()).not.toContain("ev1");
    expect(row(w, "c", "save-btn").text()).toContain("Event");
    expect(search(w).attributes("placeholder")).toBe("Pick a page or click");
    expect(w.find('[role="alert"]').exists()).toBe(false);
    expect(apply(w).exists()).toBe(false);
  });

  it("the search narrows the list at once, hides empty groups, and reaches the server after 300 ms", async () => {
    vi.useFakeTimers();
    const w = mountPicker();
    await search(w).setValue("logs");
    expect(row(w, "p", "/web/logs").exists()).toBe(true);
    expect(row(w, "p", "/web").exists()).toBe(false);
    expect(w.text()).toContain("Pages");
    expect(w.text()).not.toContain("Named events");
    expect(stepOptions.onSearch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(stepOptions.onSearch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stepOptions.onSearch).toHaveBeenCalledTimes(1);
    expect(stepOptions.onSearch).toHaveBeenCalledWith("logs");
    await search(w).setValue("nothing-like-it");
    expect(w.find(dt(`${PICKER}-no-step`)).exists()).toBe(true);
  });

  it("picking a row moves to the step's range over the whole funnel, and Apply emits it", async () => {
    const w = mountPicker();
    await pick(w, "p", "/web/ingestion");
    expect(row(w, "p", "/web/ingestion").exists()).toBe(false);
    const head = w.find(dt(`${PICKER}-step`));
    expect(head.text()).toContain("/web/ingestion");
    expect(w.find(dt(`${PICKER}-back`)).exists()).toBe(true);
    expect(select(w, "from")!.props("modelValue")).toBe(1);
    expect(select(w, "to")!.props("modelValue")).toBe(3);
    expect(w.find('[role="alert"]').exists()).toBe(false);
    expect(apply(w).attributes("disabled")).toBeUndefined();
    await apply(w).trigger("click");
    expect(applied(w)).toEqual([[{ step: { kind: "p", key: "/web/ingestion" }, a: 1, b: 3 }]]);
    expect(w.emitted("cancel")).toBeUndefined();
  });

  it("an event row applies the event by id and shows its name", async () => {
    const w = mountPicker();
    await pick(w, "e", "ev1");
    expect(w.find(dt(`${PICKER}-step`)).text()).toContain("Signup");
    await apply(w).trigger("click");
    expect(applied(w)).toEqual([[{ step: { kind: "e", key: "ev1" }, a: 1, b: 3 }]]);
  });

  it("Cancel emits cancel and nothing else", async () => {
    const w = mountPicker();
    await pick(w, "p", "/web/ingestion");
    await w.find(dt(`${PICKER}-cancel`)).trigger("click");
    expect(w.emitted("cancel")).toHaveLength(1);
    expect(applied(w)).toBeUndefined();
  });

  it("a page strictly inside the span says why and blocks Apply until the span is narrowed", async () => {
    const w = mountPicker();
    await pick(w, "p", "/web/logs");
    const invalid = w.find(dt(`${PICKER}-invalid`));
    expect(invalid.attributes("role")).toBe("alert");
    expect(invalid.text()).toContain("step 3 already did this at step 2");
    expect(apply(w).attributes("disabled")).toBeDefined();
    await apply(w).trigger("click");
    expect(applied(w)).toBeUndefined();
    await setSelect(w, "to", 2);
    expect(w.find(dt(`${PICKER}-invalid`)).exists()).toBe(false);
    expect(apply(w).attributes("disabled")).toBeUndefined();
    await apply(w).trigger("click");
    expect(applied(w)).toEqual([[{ step: { kind: "p", key: "/web/logs" }, a: 1, b: 2 }]]);
  });

  it("step a's and step b's own pages are valid for a between range", async () => {
    const w = mountPicker();
    await pick(w, "p", "/web");
    expect(w.find('[role="alert"]').exists()).toBe(false);
    expect(apply(w).attributes("disabled")).toBeUndefined();
    await w.find(dt(`${PICKER}-back`)).trigger("click");
    await pick(w, "p", "/web/billings");
    expect(w.find('[role="alert"]').exists()).toBe(false);
    expect(apply(w).attributes("disabled")).toBeUndefined();
  });

  it("Within on step a's own page says why and blocks Apply", async () => {
    const w = mountPicker();
    await pick(w, "p", "/web");
    await setMode(w, "within");
    expect(w.find(dt(`${PICKER}-invalid`)).text()).toContain("page of step 1");
    expect(apply(w).attributes("disabled")).toBeDefined();
    expect(
      w
        .findAllComponents({ name: "OSelect" })
        .some((c) => c.attributes("data-test") === `${PICKER}-to`),
    ).toBe(false);
    expect(seconds(w)!.props("modelValue")).toBe(5);
  });

  it("switching a within range on the last step of a 2-step funnel to between stays in range", async () => {
    const w = mountPicker({
      def: defWith(STEPS.slice(0, 2)),
      initial: { step: { kind: "p", key: "/x" }, a: 2, withinMs: 5000 },
    });
    await setMode(w, "between");
    expect(select(w, "from")!.props("modelValue")).toBe(1);
    expect(select(w, "to")!.props("modelValue")).toBe(2);
    await apply(w).trigger("click");
    expect(applied(w)).toEqual([[{ step: { kind: "p", key: "/x" }, a: 1, b: 2 }]]);
  });

  it("a seconds value that is empty, not a number, 0 or above a day says why and blocks Apply", async () => {
    const w = mountPicker();
    await pick(w, "p", "/web/ingestion");
    await setMode(w, "within");
    const setSeconds = async (v: string) => {
      seconds(w)!.vm.$emit("update:modelValue", v);
      await w.vm.$nextTick();
    };
    for (const bad of ["", "abc", "0", "0.0003", "0.5", "100000"]) {
      await setSeconds(bad);
      const invalid = w.find(dt(`${PICKER}-seconds-invalid`));
      expect(invalid.exists()).toBe(true);
      expect(invalid.attributes("role")).toBe("alert");
      expect(invalid.text()).toBe("Enter a number of seconds from 1 to 86400");
      expect(apply(w).attributes("disabled")).toBeDefined();
    }
    await setSeconds("12");
    expect(w.find(dt(`${PICKER}-seconds-invalid`)).exists()).toBe(false);
    expect(apply(w).attributes("disabled")).toBeUndefined();
    await apply(w).trigger("click");
    expect(applied(w)).toEqual([
      [{ step: { kind: "p", key: "/web/ingestion" }, a: 1, withinMs: 12000 }],
    ]);
  });

  it("a typed seconds value applies on an edited within range", async () => {
    const w = mountPicker({ initial: { step: { kind: "p", key: "/x" }, a: 2, withinMs: 5000 } });
    seconds(w)!.vm.$emit("update:modelValue", "2");
    await w.vm.$nextTick();
    await apply(w).trigger("click");
    expect(applied(w)).toEqual([[{ step: { kind: "p", key: "/x" }, a: 2, withinMs: 2000 }]]);
  });

  it("back returns to the list and asks for the options again; the next pick keeps the edited range", async () => {
    const w = mountPicker();
    await pick(w, "p", "/web/logs");
    await setSelect(w, "to", 2);
    await w.find(dt(`${PICKER}-back`)).trigger("click");
    expect(row(w, "p", "/web/ingestion").exists()).toBe(true);
    expect(stepOptions.load).toHaveBeenCalledTimes(2);
    await pick(w, "p", "/web/ingestion");
    expect(select(w, "to")!.props("modelValue")).toBe(2);
    await apply(w).trigger("click");
    expect(applied(w)).toEqual([[{ step: { kind: "p", key: "/web/ingestion" }, a: 1, b: 2 }]]);
  });

  it("an edited exclusion opens on its own range, with the step still changeable", () => {
    const w = mountPicker({ initial: { step: { kind: "p", key: "/web/ingestion" }, a: 2, b: 3 } });
    expect(stepOptions.load).not.toHaveBeenCalled();
    expect(w.find(dt(`${PICKER}-step`)).text()).toContain("/web/ingestion");
    expect(select(w, "from")!.props("modelValue")).toBe(2);
    expect(select(w, "to")!.props("modelValue")).toBe(3);
    expect(w.find(dt(`${PICKER}-back`)).exists()).toBe(true);
    expect(w.find(dt(`${PICKER}-back`)).attributes("aria-label")).toBe("Change step");
  });

  it("a search with no local match shows loading while the server is asked, then says nothing matched", async () => {
    const w = mountPicker();
    await search(w).setValue("nothing-like-it");
    stepOptions.loading.value = true;
    await w.vm.$nextTick();
    expect(w.find(dt(`${PICKER}-loading`)).exists()).toBe(true);
    expect(w.find(dt(`${PICKER}-loading`)).text()).toBe("Loading steps…");
    expect(w.find(dt(`${PICKER}-no-step`)).exists()).toBe(false);
    stepOptions.loading.value = false;
    await w.vm.$nextTick();
    expect(w.find(dt(`${PICKER}-loading`)).exists()).toBe(false);
    expect(w.find(dt(`${PICKER}-no-step`)).exists()).toBe(true);
  });

  it("says it is loading, offers Retry after a failure, and names an empty list", async () => {
    stepOptions.loading.value = true;
    const w = mountPicker();
    expect(w.find(dt(`${PICKER}-loading`)).text()).toBe("Loading steps…");
    expect(row(w, "p", "/web").exists()).toBe(false);
    stepOptions.loading.value = false;
    stepOptions.options.value = [];
    stepOptions.failed.value = true;
    await w.vm.$nextTick();
    expect(w.text()).toContain("Pages and clicks could not be loaded.");
    await w.find(dt(`${PICKER}-retry`)).trigger("click");
    expect(stepOptions.load).toHaveBeenCalledTimes(2);
    stepOptions.failed.value = false;
    stepOptions.noCustom.value = true;
    await w.vm.$nextTick();
    expect(w.find(dt(`${PICKER}-no-step`)).text()).toContain("No options found");
    expect(w.find(dt(`${PICKER}-no-custom`)).text()).toContain("No custom actions");
  });
});
