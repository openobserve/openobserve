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

// One grouped multi-select covering BOTH alert Destinations and (enterprise-only)
// Workflows. The backend keeps them as two fields, so option values are
// type-tagged (`dest:<name>` / `wf:<id>`) and split apart again on change.
// The OSelect is stubbed so we can drive `update:model-value` directly and read
// the normalized option list it receives.

import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, afterEach } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import AlertTargetsSelect from "./AlertTargetsSelect.vue";

const OSelectStub = {
  name: "OSelect",
  props: ["modelValue", "options", "multiple", "error", "collapsibleGroups"],
  emits: ["update:modelValue"],
  template: `<div class="o-select" :data-error="String(error)" :data-multiple="String(multiple)">
    <span class="o-select-empty"><slot name="empty" /></span>
  </div>`,
};

const baseProps = {
  destinations: [] as string[],
  workflows: [] as string[],
  destinationOptions: [] as any[],
  workflowOptions: [] as any[],
  workflowsEnabled: false,
};

function createWrapper(props: Record<string, any> = {}) {
  return mount(AlertTargetsSelect, {
    global: {
      plugins: [i18n, store],
      stubs: {
        OSelect: OSelectStub,
        OIcon: { name: "OIcon", props: ["name", "size"], template: "<i />" },
      },
    },
    props: { ...baseProps, ...props },
  });
}

const select = (wrapper: any) => wrapper.findComponent({ name: "OSelect" });

describe("AlertTargetsSelect", () => {
  afterEach(() => vi.clearAllMocks());

  describe("model value (combined, type-tagged)", () => {
    it("is empty when nothing is selected", () => {
      const wrapper = createWrapper();
      expect(select(wrapper).props("modelValue")).toEqual([]);
    });

    it("tags destinations with `dest:` and workflows with `wf:`", () => {
      const wrapper = createWrapper({
        destinations: ["slack", "pagerduty"],
        workflows: ["wf-1"],
        workflowsEnabled: true,
      });
      expect(select(wrapper).props("modelValue")).toEqual([
        "dest:slack",
        "dest:pagerduty",
        "wf:wf-1",
      ]);
    });

    it("tolerates null/undefined destinations and workflows props", () => {
      const wrapper = createWrapper({
        destinations: undefined as any,
        workflows: null as any,
      });
      expect(select(wrapper).props("modelValue")).toEqual([]);
    });

    it("is always a multi-select", () => {
      const wrapper = createWrapper();
      expect(select(wrapper).props("multiple")).not.toBe(false);
    });
  });

  describe("options", () => {
    it("OSS: a plain destinations list with no group headers and no workflows", () => {
      const wrapper = createWrapper({
        destinationOptions: ["slack", "email"],
        workflowOptions: [{ label: "Escalate", value: "wf-1" }],
        workflowsEnabled: false,
      });
      expect(select(wrapper).props("options")).toEqual([
        { label: "slack", value: "dest:slack" },
        { label: "email", value: "dest:email" },
      ]);
    });

    it("enterprise: grouped headers with destinations then workflows", () => {
      const wrapper = createWrapper({
        destinationOptions: ["slack"],
        workflowOptions: [{ label: "Escalate", value: "wf-1" }],
        workflowsEnabled: true,
      });
      expect(select(wrapper).props("options")).toEqual([
        { header: true, label: "Destinations" },
        { label: "slack", value: "dest:slack" },
        { header: true, label: "Workflows" },
        { label: "Escalate", value: "wf:wf-1" },
      ]);
    });

    it("normalizes {label,value} destination options", () => {
      const wrapper = createWrapper({
        destinationOptions: [{ label: "Slack #ops", value: "slack" }],
      });
      expect(select(wrapper).props("options")).toEqual([
        { label: "Slack #ops", value: "dest:slack" },
      ]);
    });

    it("normalizes plain-string workflow options", () => {
      const wrapper = createWrapper({
        workflowOptions: ["wf-1"],
        workflowsEnabled: true,
      });
      expect(select(wrapper).props("options")).toContainEqual({
        label: "wf-1",
        value: "wf:wf-1",
      });
    });

    it("falls back to the value as the label when an option has no label", () => {
      const wrapper = createWrapper({
        destinationOptions: [{ value: "slack" } as any],
      });
      expect(select(wrapper).props("options")).toEqual([
        { label: "slack", value: "dest:slack" },
      ]);
    });

    it("tolerates null/undefined option lists", () => {
      const wrapper = createWrapper({
        destinationOptions: undefined as any,
        workflowOptions: null as any,
        workflowsEnabled: true,
      });
      // headers still render, both groups empty
      expect(select(wrapper).props("options")).toEqual([
        { header: true, label: "Destinations" },
        { header: true, label: "Workflows" },
      ]);
    });
  });

  describe("selection change (splitting the tagged values)", () => {
    it("splits a mixed selection back into destinations + workflows", async () => {
      const wrapper = createWrapper({ workflowsEnabled: true });
      select(wrapper).vm.$emit("update:modelValue", [
        "dest:slack",
        "wf:wf-1",
        "dest:email",
      ]);
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted("update:destinations")?.[0]).toEqual([
        ["slack", "email"],
      ]);
      expect(wrapper.emitted("update:workflows")?.[0]).toEqual([["wf-1"]]);
    });

    it("emits an empty workflows array when only destinations are picked", async () => {
      const wrapper = createWrapper();
      select(wrapper).vm.$emit("update:modelValue", ["dest:slack"]);
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted("update:destinations")?.[0]).toEqual([["slack"]]);
      expect(wrapper.emitted("update:workflows")?.[0]).toEqual([[]]);
    });

    it("emits two empty arrays when the selection is cleared", async () => {
      const wrapper = createWrapper({ destinations: ["slack"] });
      select(wrapper).vm.$emit("update:modelValue", []);
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted("update:destinations")?.[0]).toEqual([[]]);
      expect(wrapper.emitted("update:workflows")?.[0]).toEqual([[]]);
    });

    it("treats a non-array payload as an empty selection", async () => {
      const wrapper = createWrapper();
      select(wrapper).vm.$emit("update:modelValue", undefined);
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted("update:destinations")?.[0]).toEqual([[]]);
      expect(wrapper.emitted("update:workflows")?.[0]).toEqual([[]]);
    });

    it("preserves names that themselves contain the tag prefix text", async () => {
      const wrapper = createWrapper();
      select(wrapper).vm.$emit("update:modelValue", ["dest:dest:weird"]);
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted("update:destinations")?.[0]).toEqual([
        ["dest:weird"],
      ]);
    });
  });

  // The component exists to stop the "shake": propsCombined forces
  // destinations-first order, but the control keeps the user's CLICK order in an
  // internal `model` and only re-syncs when the value SET actually changes — so a
  // round-trip (emit → parent → props) must NOT reorder the selection.
  describe("ordered model (anti-shake)", () => {
    it("keeps the click order across a props round-trip (no reorder, no re-sync)", async () => {
      const wrapper = createWrapper({
        workflowsEnabled: true,
        destinationOptions: ["slack"],
        workflowOptions: [{ label: "Escalate", value: "wf-1" }],
      });
      // user picks the WORKFLOW first, then the destination
      select(wrapper).vm.$emit("update:modelValue", ["wf:wf-1", "dest:slack"]);
      await wrapper.vm.$nextTick();
      expect(select(wrapper).props("modelValue")).toEqual([
        "wf:wf-1",
        "dest:slack",
      ]);

      // parent echoes the split fields back as props (destinations-first order)
      await wrapper.setProps({ destinations: ["slack"], workflows: ["wf-1"] });
      await wrapper.vm.$nextTick();

      // same SET → the watch must NOT reassign → click order is preserved
      expect(select(wrapper).props("modelValue")).toEqual([
        "wf:wf-1",
        "dest:slack",
      ]);
    });

    it("DOES re-sync when the incoming set genuinely differs (external edit load)", async () => {
      const wrapper = createWrapper({ workflowsEnabled: true });
      await wrapper.setProps({ destinations: ["slack", "email"], workflows: [] });
      await wrapper.vm.$nextTick();
      expect(select(wrapper).props("modelValue")).toEqual([
        "dest:slack",
        "dest:email",
      ]);
    });
  });

  describe("collapsible groups gate", () => {
    it("enables collapsible groups only in enterprise", () => {
      expect(
        select(createWrapper({ workflowsEnabled: true })).props("collapsibleGroups"),
      ).toBe(true);
      expect(
        select(createWrapper({ workflowsEnabled: false })).props("collapsibleGroups"),
      ).toBe(false);
    });
  });

  describe("error state", () => {
    it("is not in error by default", () => {
      const wrapper = createWrapper();
      expect(select(wrapper).props("error")).toBeFalsy();
    });

    it("forwards the error prop to the select", () => {
      const wrapper = createWrapper({ error: true });
      expect(select(wrapper).props("error")).toBe(true);
      expect(wrapper.find(".o-select").attributes("data-error")).toBe("true");
    });
  });

  describe("empty slot", () => {
    it("OSS: says no destinations are available", () => {
      const wrapper = createWrapper({ workflowsEnabled: false });
      expect(wrapper.find(".o-select-empty").text()).toBe(
        "No destinations available",
      );
    });

    it("enterprise: says no destinations OR workflows are available", () => {
      const wrapper = createWrapper({ workflowsEnabled: true });
      expect(wrapper.find(".o-select-empty").text()).toBe(
        "No Destinations Or Workflows Available",
      );
    });
  });

  describe("action buttons", () => {
    it("emits refresh", async () => {
      const wrapper = createWrapper();
      await wrapper
        .find('[data-test="alert-settings-refresh-destinations-btn"]')
        .trigger("click");
      expect(wrapper.emitted("refresh")).toHaveLength(1);
    });

    it("emits create-destination", async () => {
      const wrapper = createWrapper();
      await wrapper.find('[data-test="create-destination-btn"]').trigger("click");
      expect(wrapper.emitted("create-destination")).toHaveLength(1);
    });

    it("hides the Create Workflow button in OSS", () => {
      const wrapper = createWrapper({ workflowsEnabled: false });
      expect(wrapper.find('[data-test="create-workflow-btn"]').exists()).toBe(
        false,
      );
    });

    it("shows and emits create-workflow in enterprise", async () => {
      const wrapper = createWrapper({ workflowsEnabled: true });
      const btn = wrapper.find('[data-test="create-workflow-btn"]');
      expect(btn.exists()).toBe(true);
      await btn.trigger("click");
      expect(wrapper.emitted("create-workflow")).toHaveLength(1);
    });
  });

  // ── Malformed / partially-loaded lists ─────────────────────────────────────
  // REGRESSION: with the backend unreachable, `getFormattedDestinations` maps
  // `destination.name` over rows that have no `name`, producing [undefined].
  // `norm()` then read `.value` off undefined INSIDE a computed, which throws
  // during render — and because this control sits in the alert form, the whole
  // page went blank instead of simply showing an empty dropdown. A degraded API
  // must degrade the list, never the page.
  describe("resilience to malformed option/selection data", () => {
    it("renders (does not throw) when destinationOptions contains undefined", () => {
      expect(() =>
        createWrapper({ destinationOptions: [undefined, null, "slack"] }),
      ).not.toThrow();
    });

    it("drops the bad entries and keeps the good ones", () => {
      const wrapper = createWrapper({
        destinationOptions: [undefined, "slack", null, "", "pagerduty"],
      });
      expect(select(wrapper).props("options")).toEqual([
        { label: "slack", value: "dest:slack" },
        { label: "pagerduty", value: "dest:pagerduty" },
      ]);
    });

    it("drops object options whose value is missing", () => {
      const wrapper = createWrapper({
        workflowsEnabled: true,
        workflowOptions: [
          { label: "no value" },
          { id: "wf-1", name: "nope" },
          { label: "Escalate", value: "wf-1" },
        ],
      });
      const values = (select(wrapper).props("options") as any[])
        .filter((o) => !o.header)
        .map((o) => o.value);
      expect(values).toEqual(["wf:wf-1"]);
    });

    it("survives an ENTIRELY empty API response (backend down)", () => {
      const wrapper = createWrapper({
        destinationOptions: [undefined, undefined],
        workflowOptions: [undefined],
        workflowsEnabled: true,
      });
      const rows = (select(wrapper).props("options") as any[]).filter(
        (o) => !o.header,
      );
      expect(rows).toEqual([]);
    });

    it("ignores nullish entries in the SELECTION as well", () => {
      const wrapper = createWrapper({
        destinations: [undefined, "slack", null] as any,
        workflows: [null, "wf-1"] as any,
        workflowsEnabled: true,
      });
      expect(select(wrapper).props("modelValue")).toEqual([
        "dest:slack",
        "wf:wf-1",
      ]);
    });

    it("ignores non-string values coming back from the control", async () => {
      const wrapper = createWrapper({ workflowsEnabled: true });
      await select(wrapper).vm.$emit("update:modelValue", [
        null,
        "dest:slack",
        undefined,
        "wf:wf-1",
      ]);
      expect(wrapper.emitted("update:destinations")!.at(-1)).toEqual([
        ["slack"],
      ]);
      expect(wrapper.emitted("update:workflows")!.at(-1)).toEqual([["wf-1"]]);
    });
  });
});
