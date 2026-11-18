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

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import SqlFilterBuilder from "./SqlFilterBuilder.vue";
import ConfirmDialogProvider from "@/components/ConfirmDialogProvider.vue";
import OChipInput from "@/lib/forms/ChipInput/OChipInput.vue";
import type { FilterField } from "@/utils/query/filterBar";

const fields: FilterField[] = [
  { name: "level", type: "string" },
  { name: "status", type: "number" },
];

let wrapper: VueWrapper | null = null;
let provider: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  provider?.unmount();
  provider = null;
  document.body.innerHTML = "";
});

const mountBuilder = (query: string, extra: { maxRows?: number } = {}) => {
  wrapper = mount(SqlFilterBuilder, {
    attachTo: document.body,
    props: { query, fields, dataTest: "b", ...extra },
  });
  return wrapper;
};

const chips = () => wrapper!.findAll('[data-test^="b-bar-chip-"][data-test$="-field"]');

describe("SqlFilterBuilder", () => {
  it("draws a filter-mode query as chips, with no preview line to cut off", () => {
    mountBuilder("level = 'error' AND status >= 500");
    expect(chips()).toHaveLength(2);
    expect(wrapper!.find('[data-test="b-preview"]').exists()).toBe(false);
  });

  it("blends the bar into the editor surface instead of drawing an input frame", () => {
    mountBuilder("");
    expect(wrapper!.find('[data-test="b-bar-field"]').classes()).not.toContain("border");
  });

  it("activates like a click on the bar: focuses the caret and opens the field list", async () => {
    mountBuilder("level = 'error'");
    (wrapper!.vm as unknown as { activate: () => void }).activate();
    await flushPromises();
    expect(document.activeElement).toBe(wrapper!.find('[data-test="b-bar-input"]').element);
    expect(wrapper!.emitted("focus")).toHaveLength(1);
  });

  it("caps the bar at three lines unless the host lifts the cap", () => {
    mountBuilder("");
    expect(wrapper!.findComponent(OChipInput).props("maxRows")).toBe(3);
    wrapper!.unmount();
    mountBuilder("", { maxRows: 0 });
    expect(wrapper!.findComponent(OChipInput).props("maxRows")).toBe(0);
  });

  it("re-reads the query when it changes outside the bar", async () => {
    mountBuilder("level = 'error'");
    await wrapper!.setProps({ query: "level = 'error' AND status = 1" });
    expect(chips()).toHaveLength(2);
  });

  it("writes the compiled query back when a chip is removed", async () => {
    mountBuilder("level = 'error' AND status = 1");
    await wrapper!.find('[data-test="b-bar-chip-status-remove"]').trigger("click");
    expect(wrapper!.emitted("update:query")).toEqual([["level = 'error'"]]);
  });

  it("re-reads its own last query when the page sets it again after another change", async () => {
    mountBuilder("level = 'error' AND status = 1");
    await wrapper!.find('[data-test="b-bar-chip-status-remove"]').trigger("click");
    await wrapper!.setProps({ query: "level = 'error'" });
    await wrapper!.setProps({ query: "status = 2" });
    expect(chips()).toHaveLength(1);
    await wrapper!.setProps({ query: "level = 'error'" });
    expect(chips().map((chip) => chip.text())).toEqual(["level"]);
    await wrapper!.setProps({ query: "upper(level) = 'x'" });
    expect(wrapper!.find('[data-test="b-unparsable"]').exists()).toBe(true);
    await wrapper!.setProps({ query: "level = 'error'" });
    expect(wrapper!.find('[data-test="b-unparsable"]').exists()).toBe(false);
  });

  it("re-reads an earlier emitted query the page restores without echoing it first", async () => {
    mountBuilder("level = 'error' AND status = 1");
    await wrapper!.find('[data-test="b-bar-chip-status-remove"]').trigger("click");
    await wrapper!.setProps({ query: "status = 2" });
    await wrapper!.setProps({ query: "level = 'error'" });
    expect(chips().map((chip) => chip.text())).toEqual(["level"]);
  });

  it("offers to keep a query it cannot draw as text, or clear it and build", async () => {
    provider = mount(ConfirmDialogProvider, { attachTo: document.body });
    mountBuilder("upper(level) = 'ERROR'");
    expect(wrapper!.find('[data-test="b-unparsable"]').exists()).toBe(true);
    await wrapper!.find('[data-test="b-keep-query"]').trigger("click");
    expect(wrapper!.emitted("exit")).toHaveLength(1);
    await wrapper!.find('[data-test="b-clear-and-build"]').trigger("click");
    await flushPromises();
    const dialog = () =>
      document.body.querySelector<HTMLElement>('[data-test="confirm-dialog-provider"]');
    dialog()!.querySelector<HTMLElement>('[data-test="o-dialog-primary-btn"]')!.click();
    await flushPromises();
    expect(wrapper!.emitted("update:query")).toEqual([[""]]);
    expect(wrapper!.find('[data-test="b-bar-input"]').exists()).toBe(true);
  });

  it("asks before Clear and build discards the query, and keeps it on Cancel", async () => {
    provider = mount(ConfirmDialogProvider, { attachTo: document.body });
    mountBuilder("upper(level) = 'ERROR'");
    await wrapper!.find('[data-test="b-clear-and-build"]').trigger("click");
    await flushPromises();
    const dialog = document.body.querySelector<HTMLElement>(
      '[data-test="confirm-dialog-provider"]',
    );
    expect(dialog?.textContent).toContain("Clear the query?");
    expect(wrapper!.emitted("update:query")).toBeUndefined();
    dialog!.querySelector<HTMLElement>('[data-test="o-dialog-secondary-btn"]')!.click();
    await flushPromises();
    expect(wrapper!.emitted("update:query")).toBeUndefined();
    expect(wrapper!.find('[data-test="b-unparsable"]').exists()).toBe(true);
  });

  it("draws a value with a backslash before a quote again after a reload", () => {
    mountBuilder("level != ('x\\' || '''y')");
    expect(wrapper!.find('[data-test="b-unparsable"]').exists()).toBe(false);
    expect(wrapper!.find('[data-test="b-bar-chip-level-value"]').text()).toBe("x\\'y");
  });

  it("shows the query it cannot draw, so the running filter stays visible", () => {
    mountBuilder("NOT (level = 'error')");
    expect(wrapper!.find('[data-test="b-unparsable-query"]').text()).toBe("NOT (level = 'error')");
  });

  it("draws an OR query with its connector", () => {
    mountBuilder("level = 'a' OR level = 'b'");
    expect(wrapper!.find('[data-test="b-bar-connector-1"]').exists()).toBe(true);
  });

  describe("groups that keep AND and OR apart", () => {
    const logFields: FilterField[] = [
      { name: "level", type: "string" },
      { name: "svc_name", type: "string" },
      { name: "code", type: "number" },
    ];
    const ALL_AND = "svc_name = 'alpha' AND level = 'error' AND code = 500";
    const emitted = () => (wrapper!.emitted("update:query") ?? []).map(([sql]) => sql);
    const find = (id: string) => wrapper!.find(`[data-test="b-bar-${id}"]`);
    // The page writes each emitted query back, as Logs does.
    const mountLive = (query: string) => {
      wrapper = mount(SqlFilterBuilder, {
        attachTo: document.body,
        props: {
          query,
          fields: logFields,
          dataTest: "b",
          "onUpdate:query": (next: string) => wrapper!.setProps({ query: next }),
        },
      });
    };
    const click = async (id: string) => {
      await find(id).trigger("click");
      await flushPromises();
    };
    // A group must read as a box on the bar, as clearly as the chips' own borders.
    const expectBox = (id: string) => {
      expect(find(id).exists()).toBe(true);
      expect(find(id).classes()).toContain("border-border-strong");
    };

    it("draws the group an added AND makes after an OR as a box", async () => {
      mountLive("level = 'error' OR level = 'warn'");
      await find("input").trigger("click");
      await flushPromises();
      const input = document.body.querySelector<HTMLInputElement>('[data-test="b-bar-input"]')!;
      input.value = "svc_name=alpha";
      input.dispatchEvent(new Event("input"));
      await flushPromises();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await flushPromises();
      expect(emitted().at(-1)).toBe("(level = 'error' OR level = 'warn') AND svc_name = 'alpha'");
      expectBox("group-0");
    });

    const typeInBar = async (value: string) => {
      const input = document.body.querySelector<HTMLInputElement>('[data-test="b-bar-input"]')!;
      input.value = value;
      input.dispatchEvent(new Event("input"));
      await flushPromises();
    };
    const pressInBar = async (key: string) => {
      document.body
        .querySelector('[data-test="b-bar-input"]')!
        .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      await flushPromises();
    };

    it("gives the row back untouched when a group started after an OR run is left empty", async () => {
      mountLive("level = 'error' OR level = 'warn'");
      await find("input").trigger("click");
      await flushPromises();
      await typeInBar("(");
      expect(emitted()).toEqual([]);
      await pressInBar("Escape");
      const elsewhere = document.createElement("button");
      document.body.appendChild(elsewhere);
      elsewhere.focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await flushPromises();
      expect(emitted()).toEqual([]);
      expect(wrapper!.find('[data-test^="b-bar-group-"]').exists()).toBe(false);
      expect(find("connector-1").text()).toBe("OR");
    });

    it("boxes the OR run once a condition lands in a group started after it", async () => {
      mountLive("level = 'error' OR level = 'warn'");
      await find("input").trigger("click");
      await flushPromises();
      await typeInBar("(");
      await typeInBar("svc_name=alpha");
      await pressInBar("Enter");
      expect(emitted()).toEqual(["(level = 'error' OR level = 'warn') AND svc_name = 'alpha'"]);
      expectBox("group-0");
    });

    it("draws a loaded `a OR b AND c` with its AND run as a box", () => {
      mountLive("level = 'error' OR level = 'warn' AND code = 500");
      expectBox("group-1");
      expect(find("ungroup-1").exists()).toBe(false);
    });

    it.each([
      ["connector-2", "(svc_name = 'alpha' AND level = 'error') OR code = 500", "connector-1"],
      ["connector-1", "(svc_name = 'alpha' OR level = 'error') AND code = 500", "connector-0-1"],
    ])(
      "flips %s and boxes what precedes it in one click, and a second click restores the row",
      async (connector, grouped, flippedAt) => {
        mountLive(ALL_AND);
        await click(connector);
        expect(emitted()).toEqual([grouped]);
        expectBox("group-0");
        expect(find(flippedAt).text()).toBe("OR");
        expect(find("ungroup-0").exists()).toBe(false);
        await click(flippedAt);
        expect(emitted()).toEqual([grouped, ALL_AND]);
        expect(find("group-0").exists()).toBe(false);
        expect(["connector-1", "connector-2"].map((id) => find(id).text())).toEqual(["AND", "AND"]);
      },
    );
  });
});
