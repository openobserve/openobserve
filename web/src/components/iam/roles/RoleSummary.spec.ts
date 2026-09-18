import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { raw } from "@/types/i18n";

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false", isEnterprise: "true" },
}));

import RoleSummary, { type SummaryModule } from "@/components/iam/roles/RoleSummary.vue";

const makeModule = (moduleKey: string, overrides: Partial<SummaryModule> = {}): SummaryModule => ({
  moduleKey,
  label: raw(moduleKey),
  icon: "category",
  group: "data",
  granted: 3,
  description: raw(`${moduleKey} reach`),
  actions: [{ action: "AllowGet", label: raw("Get") }],
  ...overrides,
});

async function mountSummary(props: Partial<{ modules: SummaryModule[]; loading: boolean }> = {}) {
  const wrapper = mount(RoleSummary, {
    global: { plugins: [i18n, store, router] },
    props: { modules: [], loading: false, ...props },
  });
  await flushPromises();
  return wrapper;
}

describe("RoleSummary - empty role", () => {
  it("offers the presets when the role grants nothing", async () => {
    const wrapper = await mountSummary();

    expect(wrapper.find('[data-test="edit-role-summary-empty"]').exists()).toBe(true);
  });

  it("emits the preset the user picks", async () => {
    const wrapper = await mountSummary();
    const readonly = wrapper
      .findAll('[data-test="edit-role-summary-empty"] button')
      .find((button) =>
        button.text().includes(String(i18n.global.t("iam.editRole.presetReadonlyTitle"))),
      );

    await readonly!.trigger("click");

    expect(wrapper.emitted("preset")?.at(-1)).toEqual(["readonly"]);
  });

  // Presets must not flash while the saved grants are still loading.
  it("shows a spinner instead of the presets while loading", async () => {
    const wrapper = await mountSummary({ loading: true });

    expect(wrapper.find('[data-test="edit-role-summary-loading"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="edit-role-summary-empty"]').exists()).toBe(false);
  });
});

describe("RoleSummary - module cards", () => {
  it("renders one card per module with its grant count", async () => {
    const wrapper = await mountSummary({
      modules: [makeModule("stream", { granted: 3505 }), makeModule("dfolder")],
    });

    expect(wrapper.find('[data-test="edit-role-summary-module-stream"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="edit-role-summary-module-dfolder"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="edit-role-summary-granted-stream"]').text()).toBe(
      (3505).toLocaleString(),
    );
  });

  it("emits the module to open", async () => {
    const wrapper = await mountSummary({ modules: [makeModule("stream")] });

    await wrapper.find('[data-test="edit-role-summary-module-stream"]').trigger("click");

    expect(wrapper.emitted("open")?.at(-1)).toEqual(["stream"]);
  });

  it("does not offer the presets once the role holds a grant", async () => {
    const wrapper = await mountSummary({ modules: [makeModule("stream")] });

    expect(wrapper.find('[data-test="edit-role-summary-empty"]').exists()).toBe(false);
  });
});
