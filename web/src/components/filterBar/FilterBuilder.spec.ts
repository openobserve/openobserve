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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import FilterBuilder from "./FilterBuilder.vue";
import type { FilterProfileName } from "./filterProfiles";
import type { FilterField } from "@/utils/query/filterBar";

const fields: FilterField[] = [
  { name: "level", type: "string" },
  { name: "service", type: "string" },
  { name: "status", type: "number" },
];

const DT = "fb";

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

const leaf = (column: string, value: unknown, logicalOperator = "AND", operator = "=") => ({
  filterType: "condition",
  column,
  operator,
  value,
  logicalOperator,
});

const v2 = (...conditions: unknown[]) => ({
  filterType: "group",
  logicalOperator: "AND",
  groupId: "root-id",
  conditions,
});

function mountBuilder(
  profile: FilterProfileName,
  modelValue: unknown,
  props: Record<string, unknown> = {},
) {
  const state = { value: modelValue as any, valid: [] as boolean[] };
  wrapper = mount(FilterBuilder, {
    attachTo: document.body,
    props: {
      profile,
      modelValue,
      fields,
      dataTest: DT,
      loadValues: vi.fn(async () => ["error", "warn"]),
      "onUpdate:modelValue": async (next: unknown) => {
        state.value = next;
        await wrapper!.setProps({ modelValue: next });
      },
      "onUpdate:valid": (valid: boolean) => state.valid.push(valid),
      ...props,
    },
  });
  return state;
}

const find = (id: string) => wrapper!.find(`[data-test="${DT}-${id}"]`);
const input = () =>
  document.body.querySelector<HTMLInputElement>(`[data-test="${DT}-search"]`) ??
  document.body.querySelector<HTMLInputElement>(`[data-test="${DT}-input"]`);
const rowKeys = () =>
  Array.from(document.body.querySelectorAll(`[data-test^="${DT}-suggest-item-"]`)).map((row) =>
    row.getAttribute("data-test")!.replace(`${DT}-suggest-item-`, ""),
  );

async function type(text: string) {
  const field = input()!;
  field.value = text;
  field.dispatchEvent(new Event("input"));
  await flushPromises();
}

async function press(key: string) {
  input()!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  await flushPromises();
  await nextTick();
}

async function click(id: string) {
  await find(id).trigger("click");
  await flushPromises();
}

async function pickRow(key: string) {
  Array.from(document.body.querySelectorAll(`[data-test^="${DT}-suggest-item-"]`))
    .find((row) => row.getAttribute("data-test") === `${DT}-suggest-item-${key}`)!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushPromises();
}

/** Builds `field = value` through the open picker. */
async function addEq(field: string, value: string) {
  await type(field);
  await press("Enter");
  await pickRow("eq");
  await type(value);
  await press("Enter");
}

describe("FilterBuilder", () => {
  describe("vertical layout (alerts engine tree)", () => {
    const saved = v2(leaf("level", "error"), leaf("service", "api", "OR"), {
      filterType: "group",
      logicalOperator: "AND",
      groupId: "g1",
      conditions: [leaf("status", 500, "AND", ">="), leaf("service", "web", "OR")],
    });

    it("draws one line per condition, Where only on the first line, groups as boxes with their own lines", () => {
      mountBuilder("alert", saved);
      expect(find("row-0").text()).toContain("Where");
      expect(find("connector-1").text()).toBe("OR");
      expect(find("group-2").exists()).toBe(true);
      expect(find("row-2-0").text()).not.toContain("Where");
      expect(find("connector-2-0").exists()).toBe(false);
      // A nested first line keeps the connector column, holding the group's collapse chevron.
      expect(find("row-2-0").find(".w-10").exists()).toBe(true);
      expect(find("row-2-0").find(`[data-test="${DT}-collapse-2"]`).exists()).toBe(true);
      expect(find("connector-2-1").text()).toBe("OR");
      expect(find("add-condition").exists()).toBe(true);
      expect(find("add-group").exists()).toBe(true);
      expect(find("add-condition-2").exists()).toBe(true);
      expect(find("add-group-2").exists()).toBe(true);
    });

    it("toggles one connector on its own and leaves the other saved leaves untouched", async () => {
      const state = mountBuilder("alert", saved);
      await click("connector-2-1");
      expect(state.value.conditions[2].conditions[1].logicalOperator).toBe("AND");
      expect(state.value.conditions[0]).toEqual(saved.conditions[0]);
      expect(state.value.conditions[1]).toEqual(saved.conditions[1]);
      expect(state.value.groupId).toBe("root-id");
    });

    it("adds a condition at the root from the Add condition button", async () => {
      const state = mountBuilder("alert", saved);
      await click("add-condition");
      await addEq("level", "warn");
      expect(state.value.conditions).toHaveLength(4);
      expect(state.value.conditions[3]).toMatchObject({
        column: "level",
        operator: "=",
        value: "warn",
      });
    });

    it("adds a condition inside a group from that group's button, typing on a line inside the group", async () => {
      const state = mountBuilder("alert", saved);
      await click("add-condition-2");
      expect(find("group-2").find(`[data-test="${DT}-draft-row"]`).exists()).toBe(true);
      expect(find("group-2").find(`[data-test="${DT}-input"]`).exists()).toBe(true);
      expect(document.body.querySelector(`[data-test="${DT}-search"]`)).toBeNull();
      await addEq("level", "info");
      expect(state.value.conditions[2].conditions).toHaveLength(3);
      expect(state.value.conditions[2].conditions[2]).toMatchObject({
        column: "level",
        value: "info",
      });
    });

    it("adds a condition below a line from its + button and leaves the other saved leaves as loaded", async () => {
      const state = mountBuilder("alert", saved);
      await click("add-after-0");
      expect(find("row-0").element.nextElementSibling?.getAttribute("data-test")).toBe(
        `${DT}-draft-row`,
      );
      await addEq("level", "warn");
      expect(state.value.conditions).toHaveLength(4);
      expect(state.value.conditions[1]).toMatchObject({ column: "level", value: "warn" });
      expect(state.value.conditions[0]).toEqual(saved.conditions[0]);
      expect(state.value.conditions[2]).toEqual(saved.conditions[1]);
      expect(state.value.conditions[3]).toEqual(saved.conditions[2]);
    });

    it("starts a group when ( is typed on a line and draws its line inside the new box", async () => {
      const state = mountBuilder("alert", v2(leaf("level", "error")));
      await click("add-condition");
      await type("(");
      expect(find("group-1").find(`[data-test="${DT}-input"]`).exists()).toBe(true);
      await addEq("service", "api");
      await type(")");
      await addEq("status", "1");
      expect(state.value.conditions[1].filterType).toBe("group");
      expect(state.value.conditions[1].conditions[0]).toMatchObject({ column: "service" });
      expect(state.value.conditions[2]).toMatchObject({ column: "status" });
    });

    it("opens a new group from Add group and puts the next condition in it", async () => {
      const state = mountBuilder("alert", v2(leaf("level", "error")));
      await click("add-group");
      const draftInGroup = find("group-1").find(`[data-test="${DT}-draft-row"]`);
      expect(draftInGroup.exists()).toBe(true);
      expect(draftInGroup.text()).not.toContain("Where");
      expect(draftInGroup.find(".w-10").exists()).toBe(true);
      await addEq("service", "api");
      expect(find("row-1-0").find(".w-10").exists()).toBe(true);
      expect(find("row-1").find(".w-10").exists()).toBe(true);
      expect(state.value.conditions[1].filterType).toBe("group");
      expect(state.value.conditions[1].conditions[0]).toMatchObject({
        column: "service",
        value: "api",
      });
    });

    it("nests groups without a depth limit and ungroups one back into its parent", async () => {
      const state = mountBuilder("alert", saved);
      await click("add-group-2");
      await addEq("level", "debug");
      expect(state.value.conditions[2].conditions[2].filterType).toBe("group");
      expect(find("add-group-2-2").exists()).toBe(true);
      // `AND (status OR service)` would read differently unbracketed, so it offers no ungroup.
      expect(find("ungroup-2").exists()).toBe(false);
      expect(find("ungroup-2-2").text()).toContain("Ungroup");
      await click("ungroup-2-2");
      expect(state.value.conditions).toHaveLength(3);
      expect(state.value.conditions[2].conditions).toHaveLength(3);
      expect(state.value.conditions[2].conditions[2]).toMatchObject({
        filterType: "condition",
        column: "level",
      });
    });

    it("ungroups an all-AND group after an OR, since AND binds tighter", async () => {
      const state = mountBuilder(
        "alert",
        v2(leaf("level", "error"), {
          filterType: "group",
          logicalOperator: "OR",
          groupId: "g1",
          conditions: [{ ...leaf("status", 500, "OR", ">=") }, leaf("service", "web", "AND")],
        }),
      );
      await click("ungroup-1");
      expect(state.value.conditions.map((c: any) => [c.column, c.logicalOperator])).toEqual([
        ["level", "AND"],
        ["status", "OR"],
        ["service", "AND"],
      ]);
    });

    it("ungroups in a per-group downtime only when the AND/OR stays the same", async () => {
      const pair = (key: string, value: string) => ({ type: "pair", key, operator: "=", value });
      mountBuilder("downtime", {
        type: "group",
        op: "and",
        items: [
          pair("a", "1"),
          { type: "group", op: "or", items: [pair("b", "2"), pair("c", "3")] },
        ],
      });
      expect(find("ungroup-1").exists()).toBe(false);
      wrapper!.unmount();
      const single = mountBuilder("downtime", {
        type: "group",
        op: "and",
        items: [{ type: "group", op: "or", items: [pair("b", "2"), pair("c", "3")] }],
      });
      await click("ungroup-0");
      expect(single.value).toMatchObject({ type: "group", op: "or" });
      expect(single.value.items.map((item: any) => item.key)).toEqual(["b", "c"]);
    });

    it("shows a ready line on an empty filter and validates unfinished conditions", async () => {
      const state = mountBuilder("pipeline", v2(leaf("level", "")));
      expect(state.valid.at(-1)).toBe(false);
      const chip = find("chip-level");
      expect(chip.attributes("data-invalid")).toBeUndefined();
      const issues = (
        wrapper!.vm as unknown as { validate: () => { nodeId: string | null }[] }
      ).validate();
      expect(issues.map((issue) => Boolean(issue.nodeId))).toEqual([true, false]);
      await nextTick();
      expect(find("chip-level").attributes("data-invalid")).toBe("true");
      const describedBy = find("chip-level-field").attributes("aria-describedby")!;
      expect(document.getElementById(describedBy)?.textContent).toBe(
        "Finish this filter or remove it",
      );

      wrapper!.unmount();
      mountBuilder("alert", null);
      expect(find("empty-row").exists()).toBe(true);
    });

    it("writes a chip's rule message under the bar but leaves an unfinished chip to its outline", async () => {
      mountBuilder("alert", v2(leaf("level", "")));
      (wrapper!.vm as unknown as { validate: () => unknown }).validate();
      await nextTick();
      expect(find("chip-level").attributes("data-invalid")).toBe("true");
      expect(find("issues").exists()).toBe(false);
      wrapper!.unmount();
      mountBuilder("rum-exclusion", [{ field: "Bad-Name", op: "in", values: ["x"] }]);
      (wrapper!.vm as unknown as { validate: () => unknown }).validate();
      await nextTick();
      expect(find("chip-Bad-Name").attributes("data-invalid")).toBe("true");
      expect(find("issues").text()).not.toBe("");
    });

    it("requires a condition where the page does", async () => {
      const state = mountBuilder("pipeline", null);
      expect(state.valid.at(-1)).toBe(false);
      wrapper!.unmount();
      // A workflow saves an empty rule anyway, but flags the node incomplete as before.
      expect(mountBuilder("workflow", null).valid.at(-1)).toBe(false);
      wrapper!.unmount();
      const optional = mountBuilder("alert", null);
      expect(optional.valid.at(-1)).toBe(true);
    });

    it("keeps a part it cannot show as a locked chip, saved back as loaded", async () => {
      const odd = { ...leaf("level", "x", "AND", "fuzzy") };
      const state = mountBuilder("alert", v2(odd, leaf("service", "api")));
      expect(find("chip-locked").exists()).toBe(true);
      expect(find("chip-locked-field").attributes("tabindex")).toBe("-1");
      await click("connector-1");
      expect(state.value.conditions[0]).toEqual(odd);
      await find("chip-locked-remove").trigger("click");
      await flushPromises();
      expect(state.value.conditions).toHaveLength(1);
    });
  });

  describe("connector modes", () => {
    const downtime = {
      type: "group",
      op: "and",
      items: [
        { type: "pair", key: "service", operator: "=", value: "payments" },
        {
          type: "group",
          op: "or",
          items: [
            { type: "pair", key: "host", operator: "=", value: "a" },
            { type: "pair", key: "host", operator: "=", value: "b" },
            { type: "pair", key: "host", operator: "=", value: "c" },
          ],
        },
      ],
    };

    it("per-group: one toggle sets every connector in that group", async () => {
      const state = mountBuilder("downtime", downtime);
      await click("connector-1-2");
      expect(state.value.items[1].op).toBe("and");
      expect(find("connector-1-1").text()).toBe("AND");
      expect(find("connector-1-2").text()).toBe("AND");
    });

    it("per-group: the root may be OR, as the backend allows", async () => {
      const state = mountBuilder("downtime", downtime);
      await click("connector-1");
      expect(state.value.op).toBe("or");
    });

    it("and-only: draws no OR control", () => {
      mountBuilder("anomaly", [
        { field: "level", operator: "=", value: "error" },
        { field: "service", operator: "<>", value: "api" },
      ]);
      expect(wrapper!.find(`[data-test^="${DT}-connector-"]`).exists()).toBe(false);
      expect(find("row-1").text()).toContain("AND");
      expect(find("add-group").exists()).toBe(false);
    });
  });

  describe("profile limits", () => {
    it("stops nesting at the downtime depth and offers only = and !=", async () => {
      const deep = {
        type: "group",
        op: "and",
        items: [
          {
            type: "group",
            op: "or",
            items: [
              {
                type: "group",
                op: "and",
                items: [{ type: "pair", key: "a", operator: "=", value: "1" }],
              },
            ],
          },
        ],
      };
      mountBuilder("downtime", deep);
      expect(find("add-group-0").exists()).toBe(true);
      expect(find("add-group-0-0").exists()).toBe(false);
      await click("add-condition");
      await type("level");
      await press("Enter");
      expect(rowKeys()).toEqual(["eq", "neq"]);
    });

    it("disables adding past the condition limit and says why", async () => {
      const pairs = Array.from({ length: 32 }, (_, i) => ({
        type: "pair",
        key: "host",
        operator: "=",
        value: `h${i}`,
      }));
      mountBuilder("downtime", { type: "group", op: "or", items: pairs });
      expect(find("add-condition").attributes("disabled")).toBeDefined();
      await find("input").trigger("click");
      await flushPromises();
      expect(rowKeys()).toEqual([]);
      expect(document.body.textContent).toContain("Up to 32 filters");
    });

    it("keeps one filter per field and caps the values of a RUM funnel rule", async () => {
      mountBuilder("rum-funnel", [{ field: "level", op: "in", values: ["error"] }]);
      await find("input").trigger("click");
      await flushPromises();
      expect(rowKeys()).not.toContain("level");
      expect(rowKeys()).toContain("service");
    });

    it("stops ticking values at the RUM limit and says so", async () => {
      const many = Array.from({ length: 21 }, (_, i) => `v${i}`);
      mountBuilder("rum-funnel", [], { loadValues: vi.fn(async () => many) });
      await find("input").trigger("click");
      await flushPromises();
      await type("service");
      await press("Enter");
      await pickRow("in");
      await vi.waitFor(() => expect(rowKeys()).toContain("v20"));
      for (const value of many) await pickRow(value);
      const portal = (id: string) =>
        document.body.querySelector<HTMLElement>(`[data-test="${DT}-${id}"]`)!;
      expect(portal("selected-count").textContent).toBe("Up to 20 values");
      portal("apply").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
      const saved = (wrapper!.props("modelValue") as { values: string[] }[])[0];
      expect(saved.values).toHaveLength(20);
    });

    it("lists extra values such as $variables first", async () => {
      mountBuilder("dashboard-panel", null, { extraValueSuggestions: () => ["$service"] });
      await find("input").trigger("click");
      await flushPromises();
      await type("level");
      await press("Enter");
      await pickRow("eq");
      await vi.waitFor(() => expect(rowKeys()[0]).toBe("$service"));
    });
  });

  describe("horizontal layout", () => {
    it("starts a group from the field picker and draws it as a box with an ungroup button", async () => {
      const state = mountBuilder("logs", "level = 'error'");
      await find("input").trigger("click");
      await flushPromises();
      await pickRow("\u0000group");
      await addEq("level", "warn");
      await type("or ");
      await addEq("service", "api");
      expect(state.value).toBe("level = 'error' AND (level = 'warn' OR service = 'api')");
      expect(find("group-1").exists()).toBe(true);
      expect(find("ungroup-1").exists()).toBe(false);
      await click("connector-1");
      await click("ungroup-1");
      expect(state.value).toBe("level = 'error' OR level = 'warn' OR service = 'api'");
    });

    it("nests parentheses typed at the caret to any depth", async () => {
      const state = mountBuilder("logs", "");
      await find("input").trigger("click");
      await flushPromises();
      await addEq("level", "a1");
      await type("(");
      await addEq("level", "b1");
      await type("or ");
      await type("(");
      await addEq("level", "c1");
      await addEq("service", "d1");
      await type(")");
      await type(")");
      expect(state.value).toBe(
        "level = 'a1' AND (level = 'b1' OR (level = 'c1' AND service = 'd1'))",
      );
    });

    it("writes an untouched SQL filter back as typed and keeps an unparsable one locked", async () => {
      const state = mountBuilder("logs", "count(*) > 1");
      expect(find("chip-locked").text()).toContain("count(*) > 1");
      await find("input").trigger("click");
      await flushPromises();
      await addEq("level", "a1");
      expect(state.value).toBe("(count(*) > 1) AND level = 'a1'");
    });
  });

  describe.each(["alert", "pipeline", "annotation"] as FilterProfileName[])(
    "adding inside a saved group (%s)",
    (profile) => {
      const saved = v2(leaf("level", "error"), {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [leaf("status", 500, "AND", ">="), leaf("service", "web", "OR")],
      });

      it.each(["add-condition-1", "add-group-1", "add-after-1-0"])(
        "opens the field list from %s",
        async (button) => {
          mountBuilder(profile, saved);
          await click(button);
          expect(find("group-1").find(`[data-test="${DT}-input"]`).exists()).toBe(true);
          expect(rowKeys()).toEqual(expect.arrayContaining(["level", "service", "status"]));
        },
      );
    },
  );

  describe("deep trees", () => {
    const nested = (depth: number, level = 1): Record<string, unknown> => ({
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        leaf("service", `checkout-service-${level}`),
        ...(level < depth ? [nested(depth, level + 1)] : []),
      ],
    });
    const deep = v2(leaf("level", "error"), nested(12));
    const deepestPath = Array.from({ length: 12 }, () => 1).join("-");
    const mountExpanded = async () => {
      mountBuilder("alert", deep);
      for (let toggle = find("expand-1-1-1"); toggle.exists(); toggle = nextFolded()) {
        await toggle.trigger("click");
      }
    };
    const nextFolded = () => wrapper!.find(`[data-test^="${DT}-expand-"]`);
    const lineOf = (chip: string) =>
      document.body
        .querySelectorAll(`[data-test="${DT}-chip-${chip}"]`)
        [chip === "level" ? 0 : 11].closest<HTMLElement>('[class*="group/line"]')!;

    it("keeps nested lines at a readable width so a deep vertical tree scrolls instead of squeezing", async () => {
      await mountExpanded();
      const lines = document.body.querySelector<HTMLElement>("[data-o-chip-lines]")!;
      expect(lines.classList).toContain("overflow-x-auto");
      expect(lines.firstElementChild!.classList).toContain("min-w-min");
      expect(lineOf("service").classList).toContain("min-w-80");
      expect(lineOf("service").classList).toContain("contain-inline-size");
      // A top-level line still fits the field, so a shallow tree is laid out as before.
      expect(lineOf("level").classList).toContain("min-w-0");
      expect(lineOf("level").classList).toContain("contain-inline-size");
    });

    it("keeps a deep group's actions on one line", async () => {
      await mountExpanded();
      const actions = find(`add-condition-${deepestPath}`).element.closest("div")!;
      expect(actions.classList).not.toContain("flex-wrap");
      expect(actions.textContent).toContain("Add group");
      expect(actions.textContent).toContain("Ungroup");
    });

    it("scrolls a deep chip into view when it takes focus", async () => {
      await mountExpanded();
      const lines = document.body.querySelector<HTMLElement>("[data-o-chip-lines]")!;
      const value = document.body.querySelectorAll<HTMLElement>(
        `[data-test="${DT}-chip-service-value"]`,
      )[11];
      Object.defineProperty(lines, "scrollWidth", { value: 2000, configurable: true });
      Object.defineProperty(lines, "clientWidth", { value: 600, configurable: true });
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
        this: HTMLElement,
      ) {
        const [left, right] = this === lines ? [0, 600] : this === value ? [1500, 1600] : [0, 0];
        return { left, right, top: 0, bottom: 20, width: right - left, height: 20 } as DOMRect;
      });
      value.focus();
      expect(lines.scrollLeft).toBe(1000);
      vi.restoreAllMocks();
    });

    it("lets a nested horizontal group grow past the bar instead of shrinking its chips", () => {
      mountBuilder("logs", "level = 'a' AND (level = 'b' OR (level = 'c' AND service = 'd'))");
      expect(find("group-1").classes()).toContain("min-w-min");
      expect(find("group-1-1").classes()).toContain("min-w-min");
      expect(find("group-1-1").classes()).not.toContain("min-w-0");
    });
  });

  describe("folded groups", () => {
    const group = (logicalOperator: string, ...conditions: unknown[]) => ({
      filterType: "group",
      logicalOperator,
      conditions,
    });
    // Root, then levels 2 and 3 open, the level-4 group folded on load.
    const fourDeep = (inner: unknown[]) =>
      v2(
        leaf("level", "error"),
        group(
          "AND",
          leaf("service", "api"),
          group("OR", leaf("status", 500), group("AND", ...inner)),
        ),
      );
    const vm = () => wrapper!.vm as unknown as { validate: () => unknown };

    it("loads groups past level 3 folded to one summary line, and unfolds them on click", async () => {
      mountBuilder(
        "alert",
        fourDeep([
          leaf("level", "warn"),
          leaf("service", "web"),
          group("OR", leaf("status", 1)),
          leaf("status", 2),
        ]),
      );
      expect(find("group-1").attributes("data-folded")).toBeUndefined();
      expect(find("group-1-1").attributes("data-folded")).toBeUndefined();
      expect(find("group-1-1-1").attributes("data-folded")).toBeDefined();
      expect(find("row-1-1-1-0").exists()).toBe(false);
      expect(find("summary-1-1-1").text()).toBe("level = warn AND service = web OR 2 more");
      expect(find("expand-1-1-1").attributes("aria-expanded")).toBe("false");

      await click("summary-1-1-1");
      expect(find("row-1-1-1-0").exists()).toBe(true);
      expect(find("collapse-1-1-1").attributes("aria-expanded")).toBe("true");
      // A nested group inside one that was just opened keeps its own fold.
      expect(find("group-1-1-1-2").attributes("data-folded")).toBeDefined();
      expect(find("summary-1-1-1-2").text()).toBe("status = 1");

      await click("collapse-1-1");
      expect(find("summary-1-1").text()).toBe("status = 500 AND (…)");
      await click("expand-1-1");
      expect(find("row-1-1-0").exists()).toBe(true);
    });

    it("keeps folding out of the saved value, so untouched groups save as loaded", async () => {
      const saved = fourDeep([leaf("level", "warn"), leaf("service", "web", "OR")]);
      const state = mountBuilder("alert", saved);
      await click("expand-1-1-1");
      await click("collapse-1-1");
      await click("expand-1-1");
      expect(state.value).toBe(saved);
      await click("connector-1");
      expect(state.value.conditions[1].logicalOperator).toBe("OR");
      expect(JSON.stringify(state.value.conditions[1].conditions)).toBe(
        JSON.stringify(saved.conditions[1].conditions),
      );
      expect(JSON.stringify(state.value.conditions[0])).toBe(JSON.stringify(saved.conditions[0]));
    });

    it("starts groups the user creates expanded, at any depth", async () => {
      mountBuilder("alert", v2(leaf("level", "error")));
      await click("add-group");
      await addEq("service", "api");
      await click("add-group-1");
      await addEq("status", "1");
      await click("add-group-1-1");
      await addEq("level", "warn");
      expect(find("group-1-1-1").attributes("data-folded")).toBeUndefined();
      expect(find("row-1-1-1-0").exists()).toBe(true);
      expect(find("collapse-1-1-1").exists()).toBe(true);
    });

    it("unfolds a group when validation finds a problem in it, and marks it once folded again", async () => {
      mountBuilder("alert", fourDeep([leaf("service", "web"), leaf("level", "")]));
      expect(find("summary-issue-1-1-1").exists()).toBe(false);
      vm().validate();
      await flushPromises();
      expect(find("summary-1-1-1").exists()).toBe(false);
      expect(find("chip-level").exists()).toBe(true);
      await click("collapse-1-1-1");
      expect(find("summary-issue-1-1-1").exists()).toBe(true);
      expect(find("summary-1-1-1").text()).toContain("Something in this group needs fixing");
    });

    it("unfolds a group when the caret steps into it", async () => {
      mountBuilder("alert", fourDeep([leaf("service", "web")]));
      input()!.focus();
      await press("ArrowLeft");
      await press("ArrowLeft");
      expect(find("summary-1-1-1").exists()).toBe(true);
      await press("ArrowLeft");
      expect(find("summary-1-1-1").exists()).toBe(false);
      expect(find("group-1-1-1").find(`[data-test="${DT}-input"]`).exists()).toBe(true);
    });

    it("adds below a folded group without unfolding it", async () => {
      mountBuilder("alert", fourDeep([leaf("service", "web")]));
      await click("add-condition-1-1");
      await addEq("level", "warn");
      await click("collapse-1-1");
      expect(find("summary-1-1").text()).toBe("status = 500 AND (…) AND 1 more");
      await click("add-after-1-1");
      expect(find("summary-1-1").exists()).toBe(true);
    });
  });

  it("re-reads a value changed by the page, but not its own echo", async () => {
    const state = mountBuilder("alert", v2(leaf("level", "error")));
    await click("add-condition");
    await addEq("service", "api");
    const ids = state.value.conditions.map((c: { id?: string }) => c.id);
    await wrapper!.setProps({ modelValue: v2(leaf("status", "1")) });
    await flushPromises();
    expect(find("chip-status").exists()).toBe(true);
    expect(ids).toHaveLength(2);
  });

  it("does not re-read a freshly built value equal to the one it holds", async () => {
    mountBuilder("alert", v2(leaf("level", "error")));
    await flushPromises();
    const before = find("chip-level").element;
    for (let i = 0; i < 3; i++) {
      await wrapper!.setProps({ modelValue: v2(leaf("level", "error")) });
      await flushPromises();
    }
    expect(find("chip-level").element).toBe(before);
  });
});
