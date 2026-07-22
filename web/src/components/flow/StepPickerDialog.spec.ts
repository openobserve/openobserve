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

// StepPickerDialog is the SHARED searchable "add next step" picker (Pipelines +
// Workflows). It is fully prop-driven: `items` in, `pick`/`close` out.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

import StepPickerDialog from "@/components/flow/StepPickerDialog.vue";

// ODialog portals its panel to document.body via reka-ui, which would move the
// picker's markup outside the wrapper. The stub renders the same default slot
// inline, so every assertion below runs against the REAL markup the picker
// renders (real OSearchInput / OIcon), while `update:open` stays observable.
const ODialogStub = {
  name: "ODialog",
  props: ["open", "title", "size"],
  emits: ["update:open"],
  template: `
    <div class="o-dialog-stub" :data-test="$attrs['data-test']" :data-open="open" :data-title="title" :data-size="size">
      <slot />
    </div>
  `,
};

const items = [
  {
    key: "condition",
    title: "Condition",
    description: "Filter records before continuing",
    icon: "alt-route",
    iconTint: "bg-amber-100 text-amber-700",
    node_type: "condition",
  },
  {
    key: "function",
    title: "Function",
    description: "Transform the payload with VRL",
    icon: "code",
    iconTint: "bg-blue-100",
    node_type: "function",
  },
  {
    key: "destination",
    title: "Send To Destination",
    description: "Deliver to an external destination",
    icon: "share",
    node_type: "destination",
  },
];

const globalConfig = {
  plugins: [i18n, store],
  stubs: { ODialog: ODialogStub },
};

function mountPicker(props: Record<string, any> = {}) {
  return mount(StepPickerDialog as any, {
    props: { items, title: "Add Next Step", ...props },
    global: globalConfig,
  });
}

const cards = (wrapper: any) => wrapper.findAll(".flow-step-card");
const dialog = (wrapper: any) => wrapper.findComponent({ name: "ODialog" });
const searchInput = (wrapper: any) => wrapper.find("input");

describe("StepPickerDialog", () => {
  let wrapper: any = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.clearAllMocks();
  });

  describe("dialog shell", () => {
    it("mounts and renders the dialog open", () => {
      wrapper = mountPicker();
      expect(wrapper.exists()).toBe(true);
      expect(dialog(wrapper).props("open")).toBe(true);
    });

    it("passes the title through and uses the md size", () => {
      wrapper = mountPicker({ title: "Add Next Step" });
      expect(dialog(wrapper).props("title")).toBe("Add Next Step");
      expect(dialog(wrapper).props("size")).toBe("md");
    });

    it('data-test on the dialog uses the default "flow-step" prefix', () => {
      wrapper = mountPicker();
      expect(wrapper.find('[data-test="flow-step-dialog"]').exists()).toBe(true);
    });

    it("data-test on the dialog honours a custom testPrefix", () => {
      wrapper = mountPicker({ testPrefix: "workflow-step" });
      expect(wrapper.find('[data-test="workflow-step-dialog"]').exists()).toBe(true);
    });
  });

  describe("item cards", () => {
    it("renders one card per item", () => {
      wrapper = mountPicker();
      expect(cards(wrapper)).toHaveLength(3);
    });

    it("renders nothing but the empty state when items is empty", () => {
      wrapper = mountPicker({ items: [] });
      expect(cards(wrapper)).toHaveLength(0);
      expect(wrapper.text()).toContain("No matches");
    });

    it("stamps `${testPrefix}-${item.key}` on each card", () => {
      wrapper = mountPicker({ testPrefix: "workflow-step" });
      expect(wrapper.find('[data-test="workflow-step-condition"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-step-function"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-step-destination"]').exists()).toBe(true);
    });

    it("renders the title and description of each item", () => {
      wrapper = mountPicker();
      const text = wrapper.text();
      expect(text).toContain("Condition");
      expect(text).toContain("Filter records before continuing");
      expect(text).toContain("Send To Destination");
    });

    it("applies the item's iconTint classes to the icon square", () => {
      wrapper = mountPicker();
      const square = wrapper.find('[data-test="flow-step-condition"]').find("div");
      expect(square.classes()).toContain("bg-amber-100");
      expect(square.classes()).toContain("text-amber-700");
    });

    it("renders the item's icon", () => {
      wrapper = mountPicker();
      const icons = wrapper.findAllComponents({ name: "OIcon" });
      const names = icons.map((i: any) => i.props("name"));
      expect(names).toContain("alt-route");
      expect(names).toContain("code");
      expect(names).toContain("share");
    });

    it('falls back to the "help" icon when an item has no icon', () => {
      wrapper = mountPicker({ items: [{ key: "x", title: "X" }] });
      const names = wrapper.findAllComponents({ name: "OIcon" }).map((i: any) => i.props("name"));
      expect(names).toContain("help");
    });

    it("omits the description line when the item has no description", () => {
      wrapper = mountPicker({ items: [{ key: "x", title: "X" }] });
      const card = wrapper.find('[data-test="flow-step-x"]');
      expect(card.text()).toBe("X");
      expect(card.findAll(".text-xs")).toHaveLength(0);
    });
  });

  describe("search / filter", () => {
    it("shows every item when the search box is empty", () => {
      wrapper = mountPicker();
      expect(cards(wrapper)).toHaveLength(3);
    });

    it("filters by title (case-insensitive)", async () => {
      wrapper = mountPicker();
      await searchInput(wrapper).setValue("FUNC");
      expect(cards(wrapper)).toHaveLength(1);
      expect(wrapper.find('[data-test="flow-step-function"]').exists()).toBe(true);
    });

    it("filters by description", async () => {
      wrapper = mountPicker();
      await searchInput(wrapper).setValue("vrl");
      expect(cards(wrapper)).toHaveLength(1);
      expect(wrapper.find('[data-test="flow-step-function"]').exists()).toBe(true);
    });

    it("matches multiple items on a shared term", async () => {
      wrapper = mountPicker();
      await searchInput(wrapper).setValue("o");
      expect(cards(wrapper).length).toBeGreaterThan(1);
    });

    it("trims whitespace-only input and treats it as no query", async () => {
      wrapper = mountPicker();
      await searchInput(wrapper).setValue("   ");
      expect(cards(wrapper)).toHaveLength(3);
    });

    it("trims a padded query before matching", async () => {
      wrapper = mountPicker();
      await searchInput(wrapper).setValue("  condition  ");
      expect(cards(wrapper)).toHaveLength(1);
      expect(wrapper.find('[data-test="flow-step-condition"]').exists()).toBe(true);
    });

    it("shows the empty state when nothing matches", async () => {
      wrapper = mountPicker();
      await searchInput(wrapper).setValue("zzz-nothing");
      expect(cards(wrapper)).toHaveLength(0);
      expect(wrapper.text()).toContain("No matches");
    });

    it("shows a custom noMatchText when nothing matches", async () => {
      wrapper = mountPicker({ noMatchText: "Nothing Found" });
      await searchInput(wrapper).setValue("zzz-nothing");
      expect(wrapper.text()).toContain("Nothing Found");
    });

    it("tolerates items with missing title / description while filtering", async () => {
      wrapper = mountPicker({
        items: [{ key: "blank" } as any, { key: "keep", title: "Keep Me" }],
      });
      await searchInput(wrapper).setValue("keep");
      expect(cards(wrapper)).toHaveLength(1);
      expect(wrapper.find('[data-test="flow-step-keep"]').exists()).toBe(true);
    });

    it("restores every card when the query is cleared", async () => {
      wrapper = mountPicker();
      await searchInput(wrapper).setValue("function");
      expect(cards(wrapper)).toHaveLength(1);
      await searchInput(wrapper).setValue("");
      expect(cards(wrapper)).toHaveLength(3);
    });
  });

  describe("search input props", () => {
    it("uses the default placeholder and testPrefix-derived data-test", () => {
      wrapper = mountPicker();
      const search = wrapper.findComponent({ name: "OSearchInput" });
      // Defaults now come from the locale rather than a hardcoded English
      // string — asserted against the key so a copy change doesn't break this,
      // and a missing key (which renders the raw path) still fails.
      const expected = i18n.global.t("common.search") as string;
      expect(search.props("placeholder")).toBe(expected);
      expect(expected).not.toBe("common.search");
      expect(search.props("clearable")).toBe(true);
      expect(wrapper.find('[data-test="flow-step-search"]').exists()).toBe(true);
    });

    it("honours a custom searchPlaceholder", () => {
      wrapper = mountPicker({ searchPlaceholder: "Search Steps" });
      expect(wrapper.findComponent({ name: "OSearchInput" }).props("placeholder")).toBe(
        "Search Steps",
      );
    });
  });

  describe("emits", () => {
    it("emits `pick` with the whole item (extra fields echoed back) when a card is clicked", async () => {
      wrapper = mountPicker();
      await wrapper.find('[data-test="flow-step-destination"]').trigger("click");
      const picked = wrapper.emitted("pick");
      expect(picked).toHaveLength(1);
      expect(picked![0][0]).toMatchObject({
        key: "destination",
        title: "Send To Destination",
        node_type: "destination",
      });
    });

    it("emits `pick` with the filtered item after a search", async () => {
      wrapper = mountPicker();
      await searchInput(wrapper).setValue("condition");
      await wrapper.find(".flow-step-card").trigger("click");
      expect((wrapper.emitted("pick")![0][0] as any).key).toBe("condition");
    });

    it("does not emit `close` when a card is picked", async () => {
      wrapper = mountPicker();
      await wrapper.find('[data-test="flow-step-condition"]').trigger("click");
      expect(wrapper.emitted("close")).toBeUndefined();
    });

    it("emits `close` when the dialog reports update:open=false", async () => {
      wrapper = mountPicker();
      dialog(wrapper).vm.$emit("update:open", false);
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted("close")).toHaveLength(1);
    });

    it("does NOT emit `close` when the dialog reports update:open=true", async () => {
      wrapper = mountPicker();
      dialog(wrapper).vm.$emit("update:open", true);
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted("close")).toBeUndefined();
    });
  });

  describe("reactivity to the items prop", () => {
    it("re-renders when items are replaced", async () => {
      wrapper = mountPicker();
      expect(cards(wrapper)).toHaveLength(3);
      await wrapper.setProps({ items: [{ key: "only", title: "Only One" }] });
      expect(cards(wrapper)).toHaveLength(1);
      expect(wrapper.text()).toContain("Only One");
    });

    it("keeps the active query applied against the new items", async () => {
      wrapper = mountPicker();
      await searchInput(wrapper).setValue("function");
      await wrapper.setProps({ items: [{ key: "only", title: "Only One" }] });
      expect(cards(wrapper)).toHaveLength(0);
      expect(wrapper.text()).toContain("No matches");
    });
  });
});
