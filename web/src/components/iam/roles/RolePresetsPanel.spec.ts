import { describe, it, expect, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import type { PresetInfo, PresetPreview } from "@/composables/iam/useRolePresets";
import RolePresetsPanel from "@/components/iam/roles/RolePresetsPanel.vue";

const t = (key: string, named: Record<string, unknown> = {}, plural?: number) =>
  plural === undefined
    ? String(i18n.global.t(key, named))
    : String(i18n.global.t(key, named, plural));

const preset = (id: string, section: PresetInfo["section"], title: string): PresetInfo => ({
  id,
  section,
  titleKey: `iam.editRole.${title}Title`,
  descriptionKey: `iam.editRole.${title}Description`,
  icon: "visibility",
  tone: "alerting",
});

// Listed job-first on purpose: the panel orders sections, not the caller.
const PRESETS: PresetInfo[] = [
  preset("alert_manager", "job", "presetAlertManager"),
  preset("alert_viewer", "job", "presetAlertViewer"),
  preset("readonly", "builtin", "presetReadonly"),
  preset("dbm", "builtin", "presetDbm"),
];

const ORG_WIDE = "_all_default";

const LABELS: Record<string, string> = {
  afolder: "Alert Folders",
  destination: "Destinations",
  template: "Templates",
  stream: "Streams",
};

const ACTION_KEYS: Record<string, string> = {
  AllowAll: "iam.all",
  AllowList: "iam.list",
  AllowGet: "iam.get",
};

const ready = (overrides: Partial<PresetPreview> = {}): PresetPreview => ({
  status: "ready",
  adds: [],
  restores: [],
  skipped: 0,
  stillMissing: [],
  ...overrides,
});

const ALERT_MANAGER = ready({
  adds: [
    `afolder:${ORG_WIDE}:AllowAll`,
    `destination:${ORG_WIDE}:AllowAll`,
    `template:${ORG_WIDE}:AllowAll`,
    `stream:${ORG_WIDE}:AllowList`,
    `stream:${ORG_WIDE}:AllowGet`,
  ],
});

let wrapper: VueWrapper | undefined;
afterEach(() => wrapper?.unmount());

async function mountPanel(
  previews: Record<string, PresetPreview>,
  props: Partial<{ loading: boolean; applying: boolean; presets: PresetInfo[] }> = {},
) {
  wrapper = mount(RolePresetsPanel, {
    attachTo: document.body,
    global: { plugins: [i18n] },
    props: {
      presets: PRESETS,
      previewPreset: (id: string) => previews[id] ?? ready(),
      loading: false,
      applying: false,
      moduleLabel: (key: string) => raw(LABELS[key] ?? key),
      entityLabel: (_resource: string, entity: string) => raw(entity),
      summaryActions: (actions: string[]) =>
        actions.map((action) => ({ action, label: raw(t(ACTION_KEYS[action] ?? action)) })),
      ...props,
    },
  });
  await flushPromises();
  return wrapper;
}

const status = (w: VueWrapper, id: string) => w.find(`[data-test="edit-role-preset-${id}-status"]`);

async function openDetail(w: VueWrapper, id: string) {
  await w.find(`[data-test="edit-role-preset-${id}"]`).trigger("click");
  await flushPromises();
  return w.find('[data-test="edit-role-preset-detail"]');
}

describe("RolePresetsPanel - list", () => {
  it("lists Built-In before By Job, each with its own presets", async () => {
    const w = await mountPanel({});

    const sections = w.findAll('[data-test^="edit-role-preset-section-"]');
    expect(sections.map((section) => section.attributes("data-test"))).toEqual([
      "edit-role-preset-section-builtin",
      "edit-role-preset-section-job",
    ]);
    expect(sections[0].text()).toContain(t("iam.editRole.presetsSectionBuiltin"));
    expect(sections[0].find('[data-test="edit-role-preset-readonly"]').exists()).toBe(true);
    expect(sections[1].text()).toContain(t("iam.editRole.presetsSectionJob"));
    expect(sections[1].find('[data-test="edit-role-preset-alert_manager"]').exists()).toBe(true);
  });

  it("drops a section with no presets", async () => {
    const w = await mountPanel({}, { presets: PRESETS.filter((p) => p.section === "builtin") });

    expect(w.find('[data-test="edit-role-preset-section-job"]').exists()).toBe(false);
  });

  it("shows +N with a spoken count when the preset adds grants", async () => {
    const w = await mountPanel({ alert_manager: ALERT_MANAGER });

    expect(status(w, "alert_manager").text()).toBe("+5");
    expect(w.find('[data-test="edit-role-preset-alert_manager"]').text()).toContain(
      t("iam.editRole.presetAddsTooltip", { count: 5 }, 5),
    );
  });

  it("shows In Role only when the role already holds every grant", async () => {
    const w = await mountPanel({
      readonly: ready({ skipped: 12 }),
      dbm: ready({ noMatchingStreams: true }),
    });

    expect(status(w, "readonly").text()).toBe(t("iam.editRole.presetInRole"));
    // Nothing to add because no stream matched is not "already in the role".
    expect(status(w, "dbm").exists()).toBe(false);
  });

  // Every Edit Role visit would otherwise fetch the metrics and logs lists.
  it("asks for the stream lists only when a stream preset opens", async () => {
    const w = await mountPanel({ dbm: ready({ status: "loading" }), readonly: ready() });

    expect(status(w, "dbm").exists()).toBe(false);
    expect(w.emitted("load-streams")).toBeUndefined();

    await openDetail(w, "readonly");
    await w.find('[data-test="edit-role-preset-back"]').trigger("click");
    expect(w.emitted("load-streams")).toBeUndefined();

    await openDetail(w, "dbm");
    expect(w.emitted("load-streams")).toHaveLength(1);
    expect(w.find('[data-test="edit-role-preset-loading"]').exists()).toBe(true);
  });

  // A lookup that matched nothing must not stick: streams ingested since then show on the next open.
  it("asks for the stream lists each time a stream preset opens, even once ready", async () => {
    const w = await mountPanel({ dbm: ready({ noMatchingStreams: true }), readonly: ready() });

    await openDetail(w, "dbm");
    await w.find('[data-test="edit-role-preset-back"]').trigger("click");
    await openDetail(w, "dbm");
    await w.find('[data-test="edit-role-preset-back"]').trigger("click");
    await openDetail(w, "readonly");

    expect(w.emitted("load-streams")).toHaveLength(2);
  });

  it("shows a skeleton once the lists are asked for, and nothing when they fail", async () => {
    const w = await mountPanel({
      dbm: ready({ status: "loading" }),
      readonly: ready({ status: "failed", adds: ["stream:_all_default:AllowList"] }),
    });

    await openDetail(w, "dbm");
    await w.find('[data-test="edit-role-preset-back"]').trigger("click");

    expect(status(w, "dbm").attributes("aria-label")).toBe(t("iam.editRole.presetLoadingStreams"));
    expect(status(w, "dbm").text()).toBe("");
    expect(status(w, "readonly").exists()).toBe(false);
  });

  // Counts on the empty pre-load grant store would be wrong, so every badge waits.
  it("shows no counts and opens nothing while the saved grants load", async () => {
    const w = await mountPanel({ alert_manager: ALERT_MANAGER }, { loading: true });

    expect(status(w, "alert_manager").text()).toBe("");
    await w.find('[data-test="edit-role-preset-alert_manager"]').trigger("click");
    expect(w.find('[data-test="edit-role-preset-detail"]').exists()).toBe(false);
    expect(w.emitted("load-streams")).toBeUndefined();
  });
});

describe("RolePresetsPanel - detail", () => {
  it("opens the detail in place of the list and moves focus to Back", async () => {
    const w = await mountPanel({ alert_manager: ALERT_MANAGER });

    const detail = await openDetail(w, "alert_manager");

    expect(detail.exists()).toBe(true);
    expect(w.find('[data-test="edit-role-preset-section-builtin"]').exists()).toBe(false);
    expect(document.activeElement?.getAttribute("data-test")).toBe("edit-role-preset-back");
  });

  it("summarises the grants it adds and where it can write", async () => {
    const w = await mountPanel({ alert_manager: ALERT_MANAGER });

    const detail = await openDetail(w, "alert_manager");

    expect(detail.find('[data-test="edit-role-preset-summary"]').text()).toBe(
      `${t("iam.editRole.presetSummaryAdds", {
        permissions: t("iam.editRole.presetPermissionCount", { count: 5 }, 5),
        modules: t("iam.editRole.presetModuleCount", { count: 4 }, 4),
      })} ${t("iam.editRole.presetSummaryWrite", {
        modules: "Alert Folders, Destinations, and Templates",
      })}`,
    );
    expect(detail.find('[data-test="edit-role-preset-row-afolder:_all_default"]').text()).toContain(
      "Alert Folders",
    );
  });

  it("says view only when no grant writes", async () => {
    const w = await mountPanel({
      alert_viewer: ready({
        adds: [`afolder:${ORG_WIDE}:AllowList`, `afolder:${ORG_WIDE}:AllowGet`],
      }),
    });

    const detail = await openDetail(w, "alert_viewer");

    expect(detail.find('[data-test="edit-role-preset-summary"]').text()).toContain(
      t("iam.editRole.presetSummaryViewOnly"),
    );
    expect(detail.text()).toContain(
      t("iam.editRole.presetSummaryAdds", {
        permissions: t("iam.editRole.presetPermissionCount", { count: 2 }, 2),
        modules: t("iam.editRole.presetModuleCount", { count: 1 }, 1),
      }),
    );
  });

  it("says the role has everything and how many grants it skips", async () => {
    const w = await mountPanel({ readonly: ready({ skipped: 1 }) });

    const detail = await openDetail(w, "readonly");

    expect(detail.find('[data-test="edit-role-preset-summary"]').text()).toBe(
      t("iam.editRole.presetSummaryHasAll"),
    );
    expect(detail.find('[data-test="edit-role-preset-skipped"]').text()).toBe(
      t("iam.editRole.presetSummarySkipped", { count: 1 }, 1),
    );
  });

  it("lists what is still missing after adding", async () => {
    const w = await mountPanel({
      alert_viewer: ready({
        adds: [`destination:${ORG_WIDE}:AllowList`],
        stillMissing: [
          {
            module: "stream",
            actions: ["AllowGet"],
            neededBy: [{ module: "afolder", reasonKey: "companionReasonAlertStreams" }],
          },
        ],
      }),
    });

    const detail = await openDetail(w, "alert_viewer");

    expect(detail.find('[data-test="edit-role-preset-missing"]').text()).toBe(
      "Still missing after adding: Streams: Get",
    );
    expect(detail.find('[data-test="edit-role-preset-ok"]').exists()).toBe(false);
  });

  it("joins several gaps and their actions as lists", async () => {
    const w = await mountPanel({
      alert_viewer: ready({
        adds: [`afolder:${ORG_WIDE}:AllowAll`],
        stillMissing: [
          { module: "stream", actions: ["AllowList", "AllowGet"], neededBy: [] },
          { module: "destination", actions: ["AllowList"], neededBy: [] },
        ],
      }),
    });

    const detail = await openDetail(w, "alert_viewer");

    expect(detail.find('[data-test="edit-role-preset-missing"]').text()).toBe(
      "Still missing after adding: Streams: List and Get, Destinations: List",
    );
  });

  it("says nothing will be missing when no gap is left", async () => {
    const w = await mountPanel({ readonly: ready({ adds: [`afolder:${ORG_WIDE}:AllowList`] }) });

    const detail = await openDetail(w, "readonly");

    expect(detail.find('[data-test="edit-role-preset-ok"]').text()).toBe(
      t("iam.editRole.presetNothingMissing"),
    );
    expect(detail.find('[data-test="edit-role-preset-missing"]').exists()).toBe(false);
  });

  it("ignores the second click of a double click on Add and on the list row", async () => {
    const w = await mountPanel({
      alert_viewer: ready({ adds: [`afolder:${ORG_WIDE}:AllowAll`] }),
    });

    w.find('[data-test="edit-role-preset-alert_viewer"]').element.dispatchEvent(
      new MouseEvent("click", { detail: 2, bubbles: true }),
    );
    expect(w.find('[data-test="edit-role-preset-detail"]').exists()).toBe(false);

    await openDetail(w, "alert_viewer");
    w.find('[data-test="edit-role-preset-apply"]').element.dispatchEvent(
      new MouseEvent("click", { detail: 2, bubbles: true }),
    );
    expect(w.emitted("apply")).toBeUndefined();
  });

  // Applying only cancels the staged removal, so nothing is counted as added.
  it("says Keep, not Add, when every grant is a removal the admin staged", async () => {
    const w = await mountPanel({
      alert_viewer: ready({
        adds: [`afolder:${ORG_WIDE}:AllowAll`],
        restores: [`afolder:${ORG_WIDE}:AllowAll`],
      }),
    });

    const detail = await openDetail(w, "alert_viewer");
    const button = w.find('[data-test="edit-role-preset-apply"]');

    expect(detail.find('[data-test="edit-role-preset-summary"]').text()).toBe(
      t("iam.editRole.presetSummaryRestores", { count: 1 }, 1),
    );
    expect(button.text()).toBe(t("iam.editRole.presetRestoreButton", { count: 1 }, 1));
    expect(button.attributes("disabled")).toBeUndefined();
    await button.trigger("click");
    expect(w.emitted("apply")).toEqual([["alert_viewer"]]);
  });

  it("counts only new grants as added when some are staged removals", async () => {
    const w = await mountPanel({
      alert_manager: ready({
        adds: [
          `afolder:${ORG_WIDE}:AllowAll`,
          `destination:${ORG_WIDE}:AllowAll`,
          `stream:${ORG_WIDE}:AllowList`,
        ],
        restores: [`afolder:${ORG_WIDE}:AllowAll`],
      }),
    });

    expect(status(w, "alert_manager").text()).toBe("+2");
    const detail = await openDetail(w, "alert_manager");

    expect(detail.find('[data-test="edit-role-preset-summary"]').text()).toBe(
      [
        t("iam.editRole.presetSummaryAdds", {
          permissions: t("iam.editRole.presetPermissionCount", { count: 2 }, 2),
          modules: t("iam.editRole.presetModuleCount", { count: 2 }, 2),
        }),
        t("iam.editRole.presetSummaryWrite", { modules: "Alert Folders and Destinations" }),
        t("iam.editRole.presetSummaryRestores", { count: 1 }, 1),
      ].join(" "),
    );
    expect(w.find('[data-test="edit-role-preset-apply"]').text()).toBe(
      t("iam.editRole.presetAddButton", { count: 2 }, 2),
    );
  });

  it("names a restored write grant instead of saying view only", async () => {
    const w = await mountPanel({
      alert_manager: ready({
        adds: [
          `afolder:${ORG_WIDE}:AllowAll`,
          `stream:${ORG_WIDE}:AllowList`,
          `stream:${ORG_WIDE}:AllowGet`,
        ],
        restores: [`afolder:${ORG_WIDE}:AllowAll`],
      }),
    });

    const summary = (await openDetail(w, "alert_manager")).find(
      '[data-test="edit-role-preset-summary"]',
    );

    expect(summary.text()).toContain(
      t("iam.editRole.presetSummaryWrite", { modules: "Alert Folders" }),
    );
    expect(summary.text()).not.toContain(t("iam.editRole.presetSummaryViewOnly"));
    expect(summary.text()).toContain(
      t("iam.editRole.presetSummaryAdds", {
        permissions: t("iam.editRole.presetPermissionCount", { count: 2 }, 2),
        modules: t("iam.editRole.presetModuleCount", { count: 1 }, 1),
      }),
    );
  });

  it("disables Add with Nothing To Add when the role holds everything", async () => {
    const w = await mountPanel({ readonly: ready({ skipped: 3 }) });

    await openDetail(w, "readonly");
    const button = w.find('[data-test="edit-role-preset-apply"]');

    expect(button.text()).toBe(t("iam.editRole.presetNothingToAdd"));
    expect(button.attributes("disabled")).toBeDefined();
    await button.trigger("click");
    expect(w.emitted("apply")).toBeUndefined();
  });

  // A second Add while the first is staging could toggle its grants back off.
  it("keeps Add disabled while a preset is being applied", async () => {
    const w = await mountPanel({ alert_manager: ALERT_MANAGER }, { applying: true });

    await openDetail(w, "alert_manager");
    const button = w.find('[data-test="edit-role-preset-apply"]');
    await button.trigger("click");

    expect(button.attributes("disabled")).toBeDefined();
    expect(w.emitted("apply")).toBeUndefined();
  });

  it("keeps Add disabled while the stream lists load", async () => {
    const w = await mountPanel({ dbm: ready({ status: "loading" }) });

    await openDetail(w, "dbm");
    const button = w.find('[data-test="edit-role-preset-apply"]');

    expect(w.find('[data-test="edit-role-preset-loading"]').exists()).toBe(true);
    expect(button.text()).toBe(t("iam.editRole.presetLoadingStreams"));
    expect(button.attributes("disabled")).toBeDefined();
  });

  it("shows a failed stream load with Retry instead of claiming the role has everything", async () => {
    const w = await mountPanel({ dbm: ready({ status: "failed" }) });

    const detail = await openDetail(w, "dbm");

    expect(detail.find('[data-test="edit-role-preset-failed"]').text()).toContain(
      t("iam.editRole.presetStreamsFailed"),
    );
    expect(detail.text()).not.toContain(t("iam.editRole.presetSummaryHasAll"));
    expect(detail.text()).not.toContain(t("iam.editRole.presetNothingMissing"));
    expect(detail.text()).not.toContain(t("iam.editRole.presetNothingToAdd"));
    expect(w.find('[data-test="edit-role-preset-apply"]').exists()).toBe(false);
    expect(w.emitted("load-streams")).toHaveLength(1);

    await detail.find('[data-test="edit-role-preset-retry"]').trigger("click");

    expect(w.emitted("load-streams")).toHaveLength(2);
  });

  it("says no stream matched instead of claiming the role has everything", async () => {
    const w = await mountPanel({ dbm: ready({ noMatchingStreams: true }) });

    const detail = await openDetail(w, "dbm");

    expect(detail.find('[data-test="edit-role-preset-summary"]').text()).toBe(
      t("iam.editRole.presetNoMatchingStreams"),
    );
  });

  it("emits apply with the preset, then returns to the list on its row", async () => {
    const w = await mountPanel({ alert_manager: ALERT_MANAGER });

    await openDetail(w, "alert_manager");
    const button = w.find('[data-test="edit-role-preset-apply"]');
    expect(button.text()).toBe(t("iam.editRole.presetAddButton", { count: 5 }, 5));

    await button.trigger("click");
    await flushPromises();

    expect(w.emitted("apply")).toEqual([["alert_manager"]]);
    expect(w.find('[data-test="edit-role-preset-detail"]').exists()).toBe(false);
    expect(document.activeElement?.getAttribute("data-test")).toBe(
      "edit-role-preset-alert_manager",
    );
  });

  it("goes back to the list without applying", async () => {
    const w = await mountPanel({ alert_manager: ALERT_MANAGER });

    await openDetail(w, "alert_manager");
    await w.find('[data-test="edit-role-preset-back"]').trigger("click");
    await flushPromises();

    expect(w.find('[data-test="edit-role-preset-detail"]').exists()).toBe(false);
    expect(w.find('[data-test="edit-role-preset-alert_manager"]').exists()).toBe(true);
    expect(w.emitted("apply")).toBeUndefined();
    expect(document.activeElement?.getAttribute("data-test")).toBe(
      "edit-role-preset-alert_manager",
    );
  });
});

describe("RolePresetsPanel - close", () => {
  it("offers a named close button on the list and in a preset's detail", async () => {
    const w = await mountPanel({ alert_manager: ALERT_MANAGER });
    const close = () => w.find('[data-test="edit-role-presets-close"]');

    expect(close().attributes("aria-label")).toBe(t("iam.editRole.presetsClose"));
    await close().trigger("click");
    expect(w.emitted("close")).toHaveLength(1);

    await openDetail(w, "alert_manager");
    expect(close().exists()).toBe(true);
    await close().trigger("click");
    expect(w.emitted("close")).toHaveLength(2);
  });
});
