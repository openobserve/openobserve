// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import FieldPanelRow from "./FieldPanelRow.vue";
import type { PanelField } from "./fieldPanel.types";

const FIELD: PanelField = {
  name: "service_name",
  dataType: "Utf8",
  ftsKey: false,
  isSchemaField: true,
  showValues: true,
};

function mountRow(onRowClick: () => void, armDrag: () => void) {
  const Host = defineComponent({
    setup: () => () =>
      h("div", { "data-test": "host-row", onClick: onRowClick }, [
        h(FieldPanelRow, {
          field: FIELD,
          actions: [],
          timestampColumn: "_timestamp",
          expandable: true,
          drag: true,
          dragEnabled: true,
          armDrag,
        }),
      ]),
  });
  return mount(Host, { attachTo: document.body });
}

describe("FieldPanelRow", () => {
  let wrapper: VueWrapper | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("keeps a drag grip click from toggling the row, while its mousedown still arms the drag", async () => {
    const onRowClick = vi.fn();
    const armDrag = vi.fn();
    wrapper = mountRow(onRowClick, armDrag);
    const grip = wrapper.find('[data-test="o-field-list-drag-indicator"]');

    await grip.trigger("mousedown");
    await grip.trigger("click");

    expect(armDrag).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("lets a click on the field label reach the row so it still toggles", async () => {
    const onRowClick = vi.fn();
    wrapper = mountRow(onRowClick, vi.fn());

    await wrapper.find('[data-test="logs-field-list-item-service_name"]').trigger("click");

    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  describe("Group by", () => {
    const groupByBtn = () =>
      wrapper!.find('[data-test="log-search-index-list-group-by-service_name-field-btn"]');
    const mountPlain = (props: Record<string, unknown> = {}) =>
      mount(FieldPanelRow, {
        props: { field: FIELD, actions: ["add-filter"], timestampColumn: "_timestamp", ...props },
      });

    it("is off unless the source offers it", () => {
      wrapper = mountPlain();
      expect(groupByBtn().exists()).toBe(false);
    });

    it("emits the field name when offered", async () => {
      wrapper = mountPlain({ groupBy: true });
      expect(groupByBtn().attributes("aria-label")).toBe("Group by this field");
      await groupByBtn().trigger("click");
      expect(wrapper.emitted("group-by")).toEqual([["service_name"]]);
    });

    it("marks the grouped field's row with the accent, not the column highlight", () => {
      wrapper = mountPlain({ grouped: true, highlight: true });
      const row = wrapper.find(".o-field-row").classes();
      expect(row).toContain("bg-accent/10!");
      expect(row).not.toContain("bg-field-list-row-hover-bg!");
    });
  });

  it("drops the add-filter action while filters are blocked", () => {
    wrapper = mount(FieldPanelRow, {
      props: { field: FIELD, actions: ["add-filter"], timestampColumn: "_timestamp" },
    });
    const addFilter = '[data-test="log-search-index-list-filter-service_name-field-btn"]';
    expect(wrapper.find(addFilter).exists()).toBe(true);
    wrapper.unmount();
    wrapper = mount(FieldPanelRow, {
      props: {
        field: FIELD,
        actions: ["add-filter"],
        timestampColumn: "_timestamp",
        filterBlocked: true,
      },
    });
    expect(wrapper.find(addFilter).exists()).toBe(false);
  });
});
