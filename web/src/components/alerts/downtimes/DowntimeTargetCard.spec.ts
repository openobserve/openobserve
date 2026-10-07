// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { ALL_FOLDERS, defaultDowntimeValues } from "@/utils/downtimes/downtimeForm";
import store from "@/test/unit/helpers/store";
import common from "@/services/common";
import DowntimeTargetCard from "./DowntimeTargetCard.vue";

const toast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({ useToast: () => ({ toast }) }));

vi.mock("@/composables/downtimes/useDowntimeItems", () => ({
  useDowntimeItems: () => ({
    items: ref([
      { id: "a1", name: "payments-db-replica-lag", folderId: "payments", tags: [] },
      { id: "a2", name: "ops-disk", folderId: "ops", tags: [] },
    ]),
    query: { isPending: ref(false) },
  }),
}));

vi.mock("@/services/common", async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  return {
    ...actual,
    default: {
      ...actual.default,
      list_Folders: vi.fn(() => Promise.resolve({ data: { list: [] } })),
    },
  };
});

const mountCard = (module: "alerts" | "synthetics" = "alerts", idsOpen = true) => {
  let form!: ReturnType<typeof useOForm<any>>;
  const Host = defineComponent({
    setup() {
      const values = defaultDowntimeValues(Date.parse("2026-09-17T12:00:00Z"), "UTC");
      values.targets.alerts.ids_open = idsOpen;
      values.targets.alerts.ids = idsOpen ? ["a1", "a2"] : [];
      form = useOForm({ defaultValues: values });
      return () => h(OForm, { form }, () => h(DowntimeTargetCard, { module }));
    },
  });
  const wrapper = mount(Host, { global: { plugins: [store] } });
  return { wrapper, form: () => form };
};

describe("DowntimeTargetCard", () => {
  it("clears All folders when a folder is picked, and drops items outside it", async () => {
    const { wrapper, form } = mountCard();
    form().setFieldValue("targets.alerts.folders", [ALL_FOLDERS, "payments"]);
    await flushPromises();
    expect(form().state.values.targets.alerts.folders).toEqual(["payments"]);
    expect(form().state.values.targets.alerts.ids).toEqual(["a1"]);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "info",
        message: expect.stringContaining("1 chosen item"),
      }),
    );
    wrapper.unmount();
  });

  it("clears the chosen folders when All folders is picked", async () => {
    const { wrapper, form } = mountCard();
    form().setFieldValue("targets.alerts.folders", ["payments"]);
    await flushPromises();
    form().setFieldValue("targets.alerts.folders", ["payments", ALL_FOLDERS]);
    await flushPromises();
    expect(form().state.values.targets.alerts.folders).toEqual([ALL_FOLDERS]);
    wrapper.unmount();
  });

  it("keeps the folder picker usable when the module's folders load", async () => {
    const { wrapper } = mountCard("alerts", false);
    await flushPromises();
    const picker = wrapper.find('[data-test="downtime-target-alerts-folders"]');
    expect(picker.find("[disabled]").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("You don't have access to alert folders.");
    expect(wrapper.find('[data-test="downtime-target-alerts-add-items"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("disables the folder picker with a hint when the module's folders answer 403", async () => {
    vi.mocked(common.list_Folders).mockRejectedValueOnce({ response: { status: 403 } });
    const { wrapper, form } = mountCard("synthetics", false);
    await flushPromises();
    const picker = wrapper.find('[data-test="downtime-target-synthetics-folders"]');
    expect(picker.find("[disabled]").exists()).toBe(true);
    expect(wrapper.text()).toContain("You don't have access to synthetics folders.");
    expect(wrapper.find('[data-test="downtime-target-synthetics-add-items"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="downtime-target-synthetics-add-tags"]').exists()).toBe(false);
    expect(form().state.values.targets.synthetics.folders).toEqual([ALL_FOLDERS]);
    expect(common.list_Folders).toHaveBeenCalledWith(expect.any(String), "synthetics", {
      skipAccessToast: true,
    });
    wrapper.unmount();
  });
});
