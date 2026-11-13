// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import Tab from "./ServiceVersionsTab.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import config from "@/aws-exports";
import producer from "@/test/unit/fixtures/serviceVersions/producer.json";
import { CATALOG_COLUMN_SIZES } from "@/plugins/traces/servicesCatalogVersions";
const mocks = vi.hoisted(() => ({
  query: {} as any,
  discovery: {} as any,
  transitions: {} as any,
  verdicts: {} as any,
  open: vi.fn(),
  state: {} as any,
  update: vi.fn(),
  store: {} as any,
}));
vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));
vi.mock("vuex", () => ({ useStore: () => mocks.store }));
vi.mock("@tanstack/vue-query", () => ({
  useQuery: (() => {
    let count = 0;
    return () => [mocks.verdicts, mocks.discovery, mocks.query, mocks.transitions][++count % 4];
  })(),
}));
vi.mock("@/enterprise/composables/useVersionCompareDrawer", () => ({
  useVersionCompareDrawer: () => ({ open: mocks.open }),
}));
vi.mock("@/plugins/traces/composables/useServicePanelRoute", () => ({
  useServicePanelRoute: () => ({ state: mocks.state, update: mocks.update }),
}));
vi.mock("@/types/i18n", async (original) => ({
  ...(await original<object>()),
  useI18nTyped: () => ({ t: (key: string) => key }),
}));
function version(index: number, extra = {}) {
  return {
    version_key: `key-${index}`,
    version: `v${index}`,
    where_key: "k8s:/web",
    where: { kind: "k8s", k8s_cluster: "" },
    active: true,
    first_seen: index * 1000,
    last_seen: 30000,
    signals: { traces: { first_seen: 1, last_seen: 2 } },
    deploys: [],
    ...extra,
  };
}
function render(overrides: Record<string, unknown> = {}) {
  return mount(Tab, {
    props: { service: "svc" },
    global: {
      stubs: {
        OButton: {
          emits: ["click"],
          template: "<button @click=\"$emit('click', $event)\"><slot /></button>",
        },
        OCheckbox: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template:
            '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', !modelValue)" />',
        },
        OSearchInput: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        OSwitch: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template:
            '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', !modelValue)" />',
        },
        OSelect: { template: "<div><slot /></div>" },
        OSelectItem: true,
        OSkeleton: true,
        ServiceEnvChip: true,
        VerdictChip: { emits: ["open"], template: "<button @click=\"$emit('open')\" />" },
        ServicePanelVerdictCard: true,
        NoVersionState: true,
        ...overrides,
      },
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  config.isEnterprise = "true";
  mocks.store = {
    state: { selectedOrganization: { identifier: "org" }, userInfo: { email: "user" } },
  };
  mocks.state = ref({ where: "k8s:/web" });
  mocks.query = {
    data: ref({ versions: [version(2), version(1)], total: 2 }),
    isPending: ref(false),
    isError: ref(false),
    error: ref(null),
    refetch: vi.fn(),
  };
  mocks.discovery = { ...mocks.query };
  mocks.transitions = { ...mocks.query, data: ref({ deploys: [] }), isError: ref(false) };
  mocks.verdicts = { ...mocks.query, data: ref({ verdicts: [] }), isError: ref(false) };
});
it("shows loading, empty, error retry, and 403 distinctly", async () => {
  const wrapper = render();
  mocks.query.isPending.value = true;
  await flushPromises();
  expect(wrapper.find('[data-test="svcver-panel-loading"]').exists()).toBe(true);
  mocks.query.isPending.value = false;
  mocks.query.data.value = { versions: [], total: 0 };
  await flushPromises();
  expect(wrapper.find('[data-test="svcver-panel-empty"]').exists()).toBe(true);
  mocks.query.isError.value = true;
  await flushPromises();
  await wrapper.find('[data-test="svcver-retry"]').trigger("click");
  expect(mocks.query.refetch).toHaveBeenCalled();
  mocks.query.error.value = { response: { status: 403 } };
  await flushPromises();
  expect(wrapper.find('[data-test="svcver-panel-denied"]').exists()).toBe(true);
  expect(wrapper.find('[data-test="svcver-compare"]').exists()).toBe(false);
});
it("says there is only one version instead of asking for two", async () => {
  const wrapper = render();
  await flushPromises();
  expect(wrapper.get('[data-test="svcver-compare-hint"]').text()).toBe(
    "serviceVersions.panel.selectTwo",
  );
  mocks.query.data.value = { versions: [version(1)], total: 1 };
  await flushPromises();
  expect(wrapper.get('[data-test="svcver-compare-hint"]').text()).toBe(
    "serviceVersions.panel.onlyOneVersion",
  );
});
it("locks OSS without controls", () => {
  config.isEnterprise = "false";
  const wrapper = render();
  expect(wrapper.find('[data-test="svcver-panel-denied"]').exists()).toBe(true);
  expect(wrapper.find('[data-test="svcver-include-inactive"]').exists()).toBe(false);
});
it("pages history newest first, shows stopped versions by default and searches them", async () => {
  mocks.query.data.value.versions = Array.from({ length: 25 }, (_, i) => version(i));
  mocks.query.data.value.versions.push(version(99, { active: false, first_seen: 1 }));
  const wrapper = render();
  expect(wrapper.find('[data-test="svcver-version-key-24"]').exists()).toBe(true);
  expect(wrapper.find('[data-test="svcver-version-key-0"]').exists()).toBe(false);
  // Opening the panel must not focus the filter: an Escape typed there stays with it, so the panel stays open.
  const search = wrapper.find('[data-test="svcver-version-search"]');
  expect(search.element.closest("[data-no-autofocus]")).not.toBeNull();
  await wrapper.find('[data-test="svcver-version-search"]').setValue("v99");
  expect(wrapper.find('[data-test="svcver-version-key-99"]').exists()).toBe(true);
  expect(wrapper.find('[data-test="svcver-version-key-24"]').exists()).toBe(false);
  await wrapper.find('[data-test="svcver-include-inactive"]').setValue(false);
  expect(wrapper.find('[data-test="svcver-version-key-99"]').exists()).toBe(false);
});
it("labels the live current row, the baseline, and compares older rows against current", async () => {
  mocks.query.data.value.versions = [
    version(3),
    version(2, { active: false }),
    version(1, { active: false }),
  ];
  const wrapper = render();
  wrapper
    .findComponent({ name: "ServicePanelVerdictCard" })
    .vm.$emit("baseline", { version: "v2", image: null, source: "automatic" });
  await flushPromises();
  expect(wrapper.text()).toContain("serviceVersions.panel.live");
  expect(wrapper.text()).toContain("serviceVersions.panel.current");
  expect(wrapper.text()).toContain("serviceVersions.panel.baselineSource.automatic");
  expect(wrapper.find('[data-test="svcver-compare-key-2"]').exists()).toBe(false);
  await wrapper.find('[data-test="svcver-compare-key-1"]').trigger("click");
  expect(mocks.open).toHaveBeenCalledWith({
    service: "svc",
    where: "k8s:/web",
    a: "v3",
    b: "v1",
    fromPanel: true,
  });
});
it("gives the verdict column the catalog's verdict width, so the widest chip shows whole", () => {
  mocks.query.data.value.versions = [version(2), version(1, { active: false })];
  const columns = render().findComponent({ name: "OTable" }).props("columns") as {
    id: string;
    size: number;
  }[];
  expect(columns.find((column) => column.id === "verdict")?.size).toBe(
    CATALOG_COLUMN_SIZES.version_verdict,
  );
});
it("compares two rows newest first, disables third and clears on where change", async () => {
  mocks.query.data.value.versions = [version(1), version(2), version(3)];
  const wrapper = render();
  await wrapper.find('[data-test="svcver-select-key-1"]').setValue(true);
  await wrapper.find('[data-test="svcver-select-key-2"]').setValue(true);
  expect(wrapper.find('[data-test="svcver-select-key-3"]').attributes("disabled")).toBeDefined();
  await wrapper.find('[data-test="svcver-compare"]').trigger("click");
  expect(mocks.open).toHaveBeenCalledWith({
    service: "svc",
    where: "k8s:/web",
    a: "v2",
    b: "v1",
    fromPanel: true,
  });
  mocks.state.value.where = "other";
  await flushPromises();
  expect(wrapper.find('[data-test="svcver-compare"]').attributes("disabled")).toBeDefined();
});
it("opens exact transitions, shows real purge count and no-cluster hint", async () => {
  mocks.query.data.value.purged_versions = 3;
  mocks.query.data.value.versions = [
    version(2, {
      deploys: [{ version: "v2", at: 1000, deploy_key: "rollback", kind: "rollback" }],
    }),
  ];
  const wrapper = render();
  expect(wrapper.find('[data-test="svcver-no-cluster"]').exists()).toBe(true);
  expect(wrapper.text()).toContain("serviceVersions.panel.purged");
  await wrapper.find('[data-test="svcver-expand-key-2"]').trigger("click");
  await wrapper.find('[data-test="svcver-deploy-rollback"]').trigger("click");
  expect(mocks.open).toHaveBeenCalledWith(
    expect.objectContaining({ a: "v2", deployKey: "rollback", fromPanel: true }),
  );
});
it("disables restricted identities, lists no version-less row and omits absent purge footer", () => {
  mocks.query.data.value.versions = [version(1, { restricted: true }), version(2, { version: "" })];
  const wrapper = render();
  expect(wrapper.find('[data-test="svcver-select-key-1"]').attributes("disabled")).toBeDefined();
  expect(wrapper.find('[data-test="svcver-select-key-2"]').exists()).toBe(false);
  expect(wrapper.find('[data-test="svcver-version-key-2"]').exists()).toBe(false);
  expect(wrapper.text()).not.toContain("serviceVersions.panel.purged");
});
it("shows only the setup guide for a service that sends no version", async () => {
  mocks.query.data.value = { versions: [version(1, { version: "", env: "prod" })], total: 1 };
  const wrapper = render();
  await flushPromises();
  expect(wrapper.findComponent({ name: "NoVersionState" }).exists()).toBe(true);
  expect(wrapper.find('[data-test="svcver-compare-hint"]').exists()).toBe(false);
  expect(wrapper.text()).not.toContain("serviceVersions.panel.onlyOneVersion");
  expect(wrapper.find('[data-test="svcver-versions-table"]').exists()).toBe(false);
  expect(wrapper.find('[data-test="svcver-panel-empty"]').exists()).toBe(false);
  expect(wrapper.find('[data-test="svcver-compare"]').exists()).toBe(false);
  const setup = wrapper.findComponent({ name: "NoVersionState" });
  expect(setup.props("where")).toBe("k8s:/web");
  expect(setup.props("identity")).toEqual(expect.objectContaining({ version_key: "key-1" }));
});
it("counts only versioned rows when saying there is one version", async () => {
  mocks.query.data.value = {
    versions: [version(1), version(2, { version: "" })],
    total: 2,
  };
  const wrapper = render();
  await flushPromises();
  expect(wrapper.get('[data-test="svcver-compare-hint"]').text()).toBe(
    "serviceVersions.panel.onlyOneVersion",
  );
  expect(wrapper.findComponent({ name: "NoVersionState" }).props("where")).toBeFalsy();
});
it("preserves registry rows on verdict failure and retries both reads", async () => {
  mocks.verdicts.isError.value = true;
  mocks.transitions.isError.value = true;
  const wrapper = render();
  expect(wrapper.find('[data-test="svcver-version-key-2"]').exists()).toBe(true);
  expect(wrapper.find('[data-test="svcver-panel-partial-error"]').exists()).toBe(true);
  await wrapper.find('[data-test="svcver-panel-verdict-retry"]').trigger("click");
  expect(mocks.verdicts.refetch).toHaveBeenCalled();
  expect(mocks.transitions.refetch).toHaveBeenCalled();
});
it("chooses a stable initial where for a graph node without a location", () => {
  mocks.state.value.where = "";
  mocks.discovery.data.value.versions = [
    version(1, { where_key: "env:z" }),
    version(2, { where_key: "env:a" }),
  ];
  render();
  expect(mocks.update).toHaveBeenCalledWith("env:a", "versions");
});
it("reads a recorded deploy that has no verdict yet as Not enough data, as the catalog does", async () => {
  mocks.query.data.value.versions = [
    version(2, {
      deploys: [{ version: "v2", from_version: "v1", at: 2000, deploy_key: "d2", kind: "deploy" }],
    }),
    version(1, { deploys: [{ version: "v1", at: 1000, deploy_key: "d1", kind: "deploy" }] }),
  ];
  const wrapper = render();
  await flushPromises();
  expect(wrapper.get('[data-test="svcver-verdict-key-2"]').text()).toBe("Not enough data");
  expect(wrapper.find('[data-test="svcver-verdict-key-1"]').exists()).toBe(false);
  mocks.verdicts.isError.value = true;
  await flushPromises();
  expect(wrapper.find('[data-test="svcver-verdict-key-2"]').exists()).toBe(false);
});
it("hands the card a pre-existing latest version and the tracking epoch", () => {
  mocks.query.data.value.tracking = structuredClone(producer.versions_tracking);
  mocks.query.data.value.versions = [
    version(2, {
      deploys: [{ version: "v2", at: 2000, deploy_key: "seed", kind: "pre_existing" }],
    }),
  ];
  const card = render().findComponent({ name: "ServicePanelVerdictCard" });
  expect(card.props("preExisting")).toBe(true);
  expect(card.props("tracking")).toEqual(producer.versions_tracking);
});
it("names a where outside Kubernetes in the where select and transitions, never default", async () => {
  const outside = {
    where_key: "default",
    where: { kind: "default" },
    env: "default",
    no_env: true,
  };
  mocks.state = ref({ where: "default" });
  mocks.query.data.value = { versions: [version(2, outside), version(1, outside)], total: 2 };
  mocks.discovery = {
    ...mocks.query,
    data: ref({ versions: [version(2, outside), version(3)], total: 2 }),
  };
  const wrapper = render();
  await flushPromises();
  const option = wrapper.get('[data-test="svcver-where-option-default"]');
  expect(option.attributes("label")).toBe("serviceVersions.where.outside");
  expect(wrapper.get('[data-test="svcver-where-option-k8s:/web"]').attributes("label")).toBe("web");
  const card = wrapper.getComponent({ name: "ServicePanelVerdictCard" });
  expect(card.props("whereLabel")).toBe("serviceVersions.where.outside");
});

describe("Versions tab at 1600 px", () => {
  const COLUMNS_WIDTH_AT_1600 = 850;
  // measured at 1600 px: the widest action is a baseline label (109 px) beside the 24 px expand icon
  const NEEDS = {
    first_seen: 98,
    last_seen: 114,
    signals: 105,
    verdict: 169,
    action: 156,
    version: 166,
  };
  it("sizes its columns to fill the table exactly, each wide enough for its content", async () => {
    const wrapper = render();
    await flushPromises();
    const columns = wrapper.findComponent(OTable).props("columns") as {
      id: string;
      size: number;
    }[];
    expect(columns.reduce((sum, column) => sum + column.size, 0)).toBe(COLUMNS_WIDTH_AT_1600);
    for (const [id, need] of Object.entries(NEEDS))
      expect(columns.find((column) => column.id === id)!.size).toBeGreaterThanOrEqual(need);
  });

  it("labels each row action in a word, with the full pair on hover, and expands every row's history the same way", async () => {
    mocks.query.data.value = {
      versions: [
        version(2, {
          deploys: [
            { version: "v2", at: 2000, deploy_key: "d2", kind: "deploy" },
            { version: "v2", at: 1500, deploy_key: "d1", kind: "redeploy" },
          ],
        }),
        version(1),
      ],
      total: 2,
    };
    const wrapper = render({
      OTooltip: { props: ["content"], template: '<i data-test="tip">{{ content }}</i>' },
    });
    await flushPromises();
    const compare = wrapper.get('[data-test="svcver-compare-wrap-key-1"]');
    const link = compare.get('[data-test="svcver-compare-key-1"]');
    expect(link.text()).toBe("serviceVersions.actions.compare");
    expect(link.attributes("variant")).toBe("ghost-primary");
    expect(link.attributes("size")).toBe("chip");
    expect(compare.get('[data-test="tip"]').text()).toBe("serviceVersions.panel.compareTo");
    const current = wrapper.get('[data-test="svcver-expand-key-2"]');
    expect(current.text()).toBe("");
    expect(current.attributes("aria-label")).toBe("serviceVersions.panel.deployCount");
    expect(current.attributes("size")).toBe("icon-chip");
    expect(wrapper.text()).toContain("serviceVersions.panel.current");
    expect(wrapper.text()).not.toContain("serviceVersions.panel.currentTransitions");
  });
});
describe("the baseline row", () => {
  it("keeps the baseline label and the expand icon of a row with deploy history in one action cell", async () => {
    mocks.query.data.value.versions = [
      version(3),
      version(2, {
        active: false,
        deploys: [{ version: "v2", at: 2000, deploy_key: "d2", kind: "deploy" }],
      }),
    ];
    const wrapper = render();
    wrapper
      .findComponent({ name: "ServicePanelVerdictCard" })
      .vm.$emit("baseline", { version: "v2", source: "automatic" });
    await flushPromises();
    const cell = wrapper.get('[data-test="svcver-baseline-key-2"]').element.closest("td")!;
    expect(cell.querySelector('[data-test="svcver-expand-key-2"]')).not.toBeNull();
    const columns = wrapper.findComponent(OTable).props("columns") as {
      id: string;
      size: number;
    }[];
    expect(columns.find((column) => column.id === "action")!.size).toBeGreaterThanOrEqual(156);
  });
  it("marks only the build the card compares against, never its sibling build", async () => {
    const build = (index: number, image: string, first_seen: number) =>
      version(index, { version: "v2", image, version_images: 2, active: false, first_seen });
    mocks.query.data.value.versions = [
      version(3),
      build(2, "1f08369", 2000),
      build(4, "8ebf1f7", 1500),
    ];
    const wrapper = render();
    wrapper
      .findComponent({ name: "ServicePanelVerdictCard" })
      .vm.$emit("baseline", { version: "v2", image: "1f08369", source: "last_good" });
    await flushPromises();
    const marks = wrapper.findAll('[data-test^="svcver-baseline-key-"]');
    expect(marks.map((mark) => mark.attributes("data-test"))).toEqual(["svcver-baseline-key-2"]);
    expect(marks[0].text()).toBe("serviceVersions.panel.baselineSource.last_good");
    expect(wrapper.find('[data-test="svcver-compare-key-4"]').exists()).toBe(true);
  });
});
