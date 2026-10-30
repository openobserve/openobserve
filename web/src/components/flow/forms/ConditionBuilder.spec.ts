// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { describe, it, expect, afterEach } from "vitest";
import i18n from "@/locales";
import ConditionBuilder from "./ConditionBuilder.vue";

const leaf = (column: string, value: unknown, operator = "=", logicalOperator = "AND") => ({
  filterType: "condition",
  column,
  operator,
  value,
  values: [],
  logicalOperator,
  id: `id-${column}`,
});

const v2 = (...conditions: unknown[]) => ({
  filterType: "group",
  logicalOperator: "AND",
  groupId: "root-id",
  conditions,
});

const fields = [
  { label: "level", value: "level", type: "Utf8" },
  { label: "meta.alert_name", value: "meta_alert_name", type: "Utf8" },
];

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

function createWrapper(props: Record<string, unknown> = {}) {
  wrapper = mount(ConditionBuilder, {
    attachTo: document.body,
    global: { plugins: [i18n] },
    props: { fields, ...props },
  });
  return wrapper;
}

const submit = () => (wrapper!.vm as any).submit();
const builder = () => wrapper!.findComponent({ name: "FilterBuilder" });

describe("ConditionBuilder (pipeline + workflow host of the shared FilterBuilder)", () => {
  describe("saved rules round-trip unchanged when untouched", () => {
    const fixtures: Record<string, unknown> = {
      "V2 with nested group, lowercase operator and ignore_case": v2(
        leaf("level", "error", "contains"),
        { ...leaf("service", "api", "Contains"), ignore_case: true },
        {
          filterType: "group",
          logicalOperator: "OR",
          groupId: "g1",
          conditions: [leaf("status", 500, ">="), leaf("host", "a", "NotContains", "OR")],
        },
      ),
      "V2 written by the backend (no ids)": {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "a",
            operator: "=",
            value: "1",
            logicalOperator: "AND",
          },
        ],
      },
      "V1 backend {and: [...]}": { and: [{ column: "level", operator: "=", value: "error" }] },
      "V0 flat list": [{ column: "level", operator: "=", value: "error" }],
    };

    for (const [name, saved] of Object.entries(fixtures)) {
      it(`pipeline: ${name}`, async () => {
        createWrapper({ initialConditions: saved, profile: "pipeline" });
        await flushPromises();
        const payload = await submit();
        expect(JSON.stringify(payload.conditions)).toBe(JSON.stringify(saved));
        // The backend reads a missing version as V1, the only shape a V0/V1 rule parses as.
        if ((saved as any).filterType === "group") expect(payload.version).toBe(2);
        else expect(payload).not.toHaveProperty("version");
      });
    }

    it("pipeline: an edited V1 rule is converted and sent as V2", async () => {
      createWrapper({
        initialConditions: { and: [{ column: "level", operator: "=", value: "error" }] },
        profile: "pipeline",
      });
      await flushPromises();
      const next = v2(leaf("level", "warn"));
      builder().vm.$emit("update:modelValue", next);
      await flushPromises();
      const payload = await submit();
      expect(payload.version).toBe(2);
      expect(payload.conditions).toEqual(next);
    });

    it("workflow: an untouched V1 rule keeps its shape and is complete", async () => {
      const saved = { or: [{ column: "meta_alert_name", operator: "=", value: "cpu" }] };
      createWrapper({
        initialConditions: saved,
        profile: "workflow",
        optional: true,
        normalizeColumnNames: true,
      });
      const payload = await submit();
      expect(payload).toEqual({ conditions: saved, complete: true });
    });

    it("workflow: keeps an underscore rule byte-identical", async () => {
      const saved = v2(leaf("meta_alert_name", "cpu"));
      createWrapper({
        initialConditions: saved,
        profile: "workflow",
        optional: true,
        normalizeColumnNames: true,
      });
      const payload = await submit();
      expect(JSON.stringify(payload.conditions)).toBe(JSON.stringify(saved));
      expect(payload.complete).toBe(true);
    });
  });

  it("renders the shared vertical builder with the page's own test ids", () => {
    createWrapper({ initialConditions: v2(leaf("level", "error")) });
    expect(wrapper!.find('[data-test="condition-builder-row-0"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="condition-builder-chip-level"]').exists()).toBe(true);
    expect(builder().props("profile")).toBe("pipeline");
  });

  it("shows a flattened workflow column by its dotted label on the chip, as the picker does", () => {
    createWrapper({ initialConditions: v2(leaf("meta_alert_name", "cpu")), profile: "workflow" });
    expect(wrapper!.find('[data-test="condition-builder-chip-meta_alert_name-field"]').text()).toBe(
      "meta.alert_name",
    );
  });

  it("maps page fields onto builder fields, keeping the dotted label", () => {
    createWrapper();
    expect(builder().props("fields")).toEqual([
      { name: "level", label: "level", type: "string" },
      { name: "meta_alert_name", label: "meta.alert_name", type: "string" },
    ]);
  });

  it("pipeline: an empty rule blocks save and says why", async () => {
    createWrapper();
    await expect(submit()).resolves.toBeNull();
    await flushPromises();
    expect(wrapper!.find('[data-test="condition-builder-issues"]').text()).toContain(
      "Add at least one filter",
    );
  });

  it("pipeline: an unfinished condition blocks save with the fill-all message", async () => {
    createWrapper({ initialConditions: v2(leaf("level", "")) });
    await expect(submit()).resolves.toBeNull();
    await flushPromises();
    expect(wrapper!.find('[data-test="add-condition-error"]').exists()).toBe(true);
  });

  it("workflow: never blocks, flags an unfinished rule incomplete", async () => {
    createWrapper({
      initialConditions: v2(leaf("level", "")),
      profile: "workflow",
      optional: true,
    });
    const payload = await submit();
    expect(payload.complete).toBe(false);
    expect(payload.conditions.conditions[0].column).toBe("level");
  });

  it("workflow: an unset rule saves as the backend's pass-through rule, flagged incomplete", async () => {
    createWrapper({ profile: "workflow", optional: true });
    const payload = await submit();
    expect(payload.complete).toBe(false);
    expect(payload.conditions.conditions).toEqual([
      expect.objectContaining({ column: "", operator: "=", value: "" }),
    ]);
  });

  it("writes the builder's edits back and normalizes dotted columns on submit", async () => {
    createWrapper({ profile: "workflow", optional: true, normalizeColumnNames: true });
    const edited = v2(leaf("meta.alert_name", ["a", "b"], "in"));
    builder().vm.$emit("update:modelValue", edited);
    await flushPromises();
    const payload = await submit();
    expect(payload.conditions.conditions[0]).toMatchObject({
      column: "meta_alert_name",
      operator: "in",
      value: ["a", "b"],
    });
    expect(edited.conditions[0]).toMatchObject({ column: "meta.alert_name" });
  });

  it("exposes the live value for the drawer's discard check", async () => {
    createWrapper({ initialConditions: v2(leaf("level", "error")) });
    const next = v2(leaf("level", "warn"));
    builder().vm.$emit("update:modelValue", next);
    await flushPromises();
    expect((wrapper!.vm as any).conditionGroup).toEqual(next);
  });

  describe("unknown-column warning (workflows)", () => {
    it("warns for a column the payload cannot resolve, with a suggestion", () => {
      createWrapper({
        profile: "workflow",
        optional: true,
        normalizeColumnNames: true,
        initialConditions: v2(leaf("alert_name", "x")),
      });
      const warning = wrapper!.find('[data-test="condition-builder-unknown-column-warning"]');
      expect(warning.text()).toContain("alert_name");
      expect(warning.text()).toContain("meta.alert_name");
    });

    it("stays inert without normalizeColumnNames (pipelines)", () => {
      createWrapper({ initialConditions: v2(leaf("alert_name", "x")) });
      expect(wrapper!.find('[data-test="condition-builder-unknown-column-warning"]').exists()).toBe(
        false,
      );
    });
  });
});
