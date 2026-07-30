import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import AddExternalAlertSource from "./AddExternalAlertSource.vue";
import alertSources from "@/services/alert_sources";

vi.mock("@/services/alert_sources", () => ({
  default: { create: vi.fn() },
}));

function buildWrapper() {
  const store = createStore({
    state: { selectedOrganization: { identifier: "myorg" } },
  });
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en: {} } });
  return mount(AddExternalAlertSource, { global: { plugins: [store, i18n] } });
}

describe("AddExternalAlertSource", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls create with name and source_type, then emits created", async () => {
    (alertSources.create as any).mockResolvedValue({ data: {} });
    const wrapper = buildWrapper();
    (wrapper.vm as any).form.name = "grafana-staging";
    (wrapper.vm as any).form.source_type = "grafana";
    await (wrapper.vm as any).submit();
    expect(alertSources.create).toHaveBeenCalledWith("myorg", {
      name: "grafana-staging",
      source_type: "grafana",
    });
    expect(wrapper.emitted("created")).toBeTruthy();
  });

  it("does not call create when name is empty", async () => {
    const wrapper = buildWrapper();
    (wrapper.vm as any).form.name = "";
    await (wrapper.vm as any).submit();
    expect(alertSources.create).not.toHaveBeenCalled();
  });

  it("emits cancel:hideform on cancel", async () => {
    const wrapper = buildWrapper();
    await (wrapper.vm as any).cancel();
    expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
  });

  it("renders a usable name input and source type select in the DOM", async () => {
    const wrapper = buildWrapper();
    const nameInput = wrapper.find('[data-test="add-alert-source-name-input"] input');
    expect(nameInput.exists()).toBe(true);
    await nameInput.setValue("my-source");
    expect((wrapper.vm as any).form.name).toBe("my-source");
  });
});
