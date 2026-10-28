import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { raw } from "@/types/i18n";
import type { PresetInfo, PresetPreview } from "@/composables/iam/useRolePresets";

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

const PRESETS: PresetInfo[] = [
  {
    id: "readonly",
    section: "builtin",
    titleKey: "iam.editRole.presetReadonlyTitle",
    descriptionKey: "iam.editRole.presetReadonlyDescription",
    icon: "visibility",
    tone: "other",
  },
];

const preview = (): PresetPreview => ({
  status: "ready",
  adds: ["stream:_all_default:AllowList", "stream:_all_default:AllowGet"],
  restores: [],
  skipped: 0,
  stillMissing: [],
});

async function mountSummary(
  props: Partial<{
    modules: SummaryModule[];
    loading: boolean;
    previewPreset: (id: string) => PresetPreview;
  }> = {},
) {
  const wrapper = mount(RoleSummary, {
    global: { plugins: [i18n, store, router] },
    props: {
      modules: [],
      loading: false,
      applying: false,
      presets: PRESETS,
      previewPreset: preview,
      moduleLabel: (key: string) => raw(key),
      entityLabel: (_resource: string, entity: string) => raw(entity),
      summaryActions: (actions: string[]) =>
        actions.map((action) => ({ action, label: raw(action) })),
      ...props,
    },
  });
  await flushPromises();
  return wrapper;
}

const panel = '[data-test="edit-role-presets-panel"]';

describe("RoleSummary - empty role", () => {
  // The presets moved to the panel, so the empty state no longer repeats them as tiles.
  it("shows the empty state without preset tiles, next to the presets panel", async () => {
    const wrapper = await mountSummary();

    expect(wrapper.find('[data-test="edit-role-summary-empty"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-test="edit-role-summary-empty"] button')).toHaveLength(0);
    expect(wrapper.find(panel).exists()).toBe(true);
  });

  it("passes the preset the user adds from the panel up as `preset`", async () => {
    const wrapper = await mountSummary();

    await wrapper.find('[data-test="edit-role-preset-readonly"]').trigger("click");
    await wrapper.find('[data-test="edit-role-preset-apply"]').trigger("click");

    expect(wrapper.emitted("preset")).toEqual([["readonly"]]);
  });

  // Presets must not show counts while the saved grants are still loading.
  it("shows a spinner and no preset counts while loading", async () => {
    const wrapper = await mountSummary({ loading: true });

    expect(wrapper.find('[data-test="edit-role-summary-loading"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="edit-role-summary-empty"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="edit-role-preset-readonly-status"]').text()).toBe("");
    expect(wrapper.emitted("load-streams")).toBeUndefined();
  });

  it("passes the panel's stream list request up only when a stream preset opens", async () => {
    const wrapper = await mountSummary({
      previewPreset: () => ({
        status: "loading",
        adds: [],
        restores: [],
        skipped: 0,
        stillMissing: [],
      }),
    });
    expect(wrapper.emitted("load-streams")).toBeUndefined();

    await wrapper.find('[data-test="edit-role-preset-readonly"]').trigger("click");

    expect(wrapper.emitted("load-streams")).toHaveLength(1);
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

  it("keeps the presets panel once the role holds a grant", async () => {
    const wrapper = await mountSummary({ modules: [makeModule("stream")] });

    expect(wrapper.find('[data-test="edit-role-summary-empty"]').exists()).toBe(false);
    expect(wrapper.find(panel).exists()).toBe(true);
  });

  it("marks only a card with unsaved changes, with text for screen readers", async () => {
    const wrapper = await mountSummary({
      modules: [makeModule("stream", { added: 2, removed: 0 }), makeModule("dfolder")],
    });

    const dot = wrapper.find('[data-test="edit-role-summary-unsaved-stream"]');
    expect(dot.exists()).toBe(true);
    expect(dot.text()).toBe(String(i18n.global.t("iam.editRole.summaryPendingTitle")));
    expect(wrapper.find('[data-test="edit-role-summary-unsaved-dfolder"]').exists()).toBe(false);
  });
});
