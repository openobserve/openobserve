// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import i18n from "@/locales";
import { gt } from "@/types/i18n";
import Cell from "./CatalogVersionsCell.vue";
import Tab from "./ServiceVersionsTab.vue";
import type { Scope, Version } from "@/services/service_versions";
import { capImageRows, dayRange } from "./versionImages";
import { compareTitle, compareTitleText, versionImageLabel } from "@/utils/serviceVersionsCopy";
import { verdictSubline } from "@/plugins/traces/servicesCatalogVersions";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  query: {} as Record<string, unknown>,
  discovery: {} as Record<string, unknown>,
  transitions: {} as Record<string, unknown>,
  verdicts: {} as Record<string, unknown>,
  state: {} as unknown,
}));
vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));
vi.mock("vuex", () => ({
  useStore: () => ({
    state: { selectedOrganization: { identifier: "org" }, userInfo: { email: "user" } },
  }),
}));
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
  useServicePanelRoute: () => ({ state: mocks.state, update: vi.fn() }),
}));

const tip = {
  OTooltip: {
    props: ["content"],
    template: "<div><slot /><slot name='content'>{{ content }}</slot></div>",
  },
};
const scope = (patch: Partial<Scope> = {}): Scope => ({
  service: "payments-api",
  scope_key: "pay",
  where_key: "k8s:eu-a/payments",
  where: { kind: "k8s", k8s_cluster: "eu-a", k8s_namespace: "payments" },
  env: "prod",
  env_source: "namespace",
  signals: ["traces"],
  newest_version: "1.8.3",
  newest_version_key: "k183",
  current_version: "1.8.3",
  current_image: "4d5e6f7",
  current_image_ref: "ghcr.io/acme/payments-api:1.8.3",
  current_version_images: 1,
  current_version_source: "container.image.tag",
  current_compare_disabled: false,
  current_compare_disabled_reason: null,
  active_versions: ["1.8.3"],
  active_version_rows: [
    {
      version: "1.8.3",
      version_key: "k183",
      image: "4d5e6f7",
      image_ref: "ghcr.io/acme/payments-api:1.8.3",
      version_images: 1,
      compare_disabled: false,
      compare_disabled_reason: null,
    },
  ],
  ...patch,
});
const cell = (value: Scope, content: "versions" | "verdict" = "versions") =>
  mount(Cell, {
    props: { scope: value, content },
    global: { plugins: [i18n], stubs: { ...tip, VerdictChip: true } },
  });

describe("version labels", () => {
  it("suffixes every image once a version has two or more, and never a single one", () => {
    expect(versionImageLabel("2.4.0", "9c1e4b7", 2, gt)).toBe("2.4.0 · img 9c1e4b7");
    expect(versionImageLabel("2.3.9", "abcdef0", 1, gt)).toBe("2.3.9");
    expect(versionImageLabel("2.4.0", null, 3, gt)).toBe("2.4.0");
  });

  it("writes the compare title with each side's image", () => {
    const title = compareTitle(
      { compared: "2.4.0", baseline: "2.4.0", comparedImage: "9c1e4b7", baselineImage: "3f9c2ab" },
      gt,
    );
    expect(compareTitleText(title, gt)).toEqual({
      baseline: "2.4.0 · img 3f9c2ab",
      compared: "2.4.0 · img 9c1e4b7",
    });
  });

  it("names the baseline build in the catalog verdict sub-line from its own count", () => {
    const value = scope({
      newest_verdict: {
        verdict_key: "v",
        version_key: "k",
        service: "cart",
        where_key: "k8s:eu-a/payments",
        version: "2.4.0",
        image: "9c1e4b7",
        version_images: 2,
        verdict: "watch",
        baseline: { version: "2.4.0", image: "3f9c2ab", version_images: 2, rule: "previous" },
      },
    });
    expect(verdictSubline(value, gt)).toContain("2.4.0 · img 3f9c2ab");
    const single = structuredClone(value);
    single.newest_verdict!.baseline!.version_images = 1;
    expect(verdictSubline(single, gt)).not.toContain("img");
  });
});

describe("catalog version cell", () => {
  it("shows an image-only version plainly, its hover a sentence and the image reference", () => {
    const view = cell(scope());
    expect(view.get('[data-test="svcver-version-pay-k183"]').text()).toBe("1.8.3");
    expect(view.find('[data-test="svcver-version-image"]').exists()).toBe(false);
    const tipText = view.get('[data-test="svcver-version-source-tip"]').text();
    expect(tipText).toContain("1.8.3 · from the container image");
    expect(tipText).toContain("ghcr.io/acme/payments-api:1.8.3");
    expect(tipText).toContain("The service sends no service.version");
    expect(view.html()).not.toContain("container.image.tag");
  });

  it("gives a version that has no image source no hover", () => {
    const view = cell(scope({ current_version_source: "service.version" }));
    expect(view.find('[data-test="svcver-version-source-tip"]').exists()).toBe(false);
  });

  it("names a rebuilt version's image on the sub-line, opens that build and lists the other live builds", async () => {
    const rows = ["9c1e4b7", "3f9c2ab"].map((image, index) => ({
      version: "2.4.0",
      version_key: `k${index}`,
      image,
      image_ref: null,
      version_images: 2,
      compare_disabled: false,
      compare_disabled_reason: null,
    }));
    const view = cell(
      scope({
        current_version: "2.4.0",
        current_image: "9c1e4b7",
        current_version_images: 2,
        current_version_source: "service.version",
        active_versions: ["2.4.0"],
        active_version_rows: rows,
      }),
    );
    const button = view.get('[data-test="svcver-version-pay-k0"]');
    expect(button.text()).toBe("2.4.0");
    expect(view.get('[data-test="svcver-version-image"]').text()).toBe("img 9c1e4b7");
    expect(view.get('[data-test="svcver-live-count"]').text()).toContain("1");
    expect(view.text()).toContain("Also live: 2.4.0 · img 3f9c2ab");
    await button.trigger("click");
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({ a: "2.4.0", aImage: "9c1e4b7" }),
    );
  });

  it("puts another live build on the sub-line too, and draws none for a lone plain version", () => {
    const base = scope().active_version_rows![0];
    const view = cell(
      scope({
        active_versions: ["1.8.3", "1.8.2"],
        active_version_rows: [base, { ...base, version: "1.8.2", version_key: "k182" }],
      }),
    );
    const sub = view.get('[data-test="svcver-version-subline"]');
    expect(sub.find('[data-test="svcver-version-image"]').exists()).toBe(false);
    expect(sub.find('[data-test="svcver-live-count"]').exists()).toBe(true);
    expect(cell(scope()).find('[data-test="svcver-version-subline"]').exists()).toBe(false);
  });

  it("names three other live builds, then counts the rest", () => {
    const rows = ["a", "b", "c", "d", "e", "f", "g"].map((suffix, index) => ({
      version: index < 4 ? "2.4.0" : `2.3.${index}`,
      version_key: `k${suffix}`,
      image: `${suffix}${suffix}00000`.slice(0, 7),
      image_ref: null,
      version_images: index < 4 ? 4 : 1,
      compare_disabled: false,
      compare_disabled_reason: null,
    }));
    const view = cell(
      scope({
        current_version: "2.4.0",
        current_image: rows[0].image,
        current_version_images: 4,
        active_version_rows: rows,
      }),
    );
    expect(view.text()).toMatch(/Also live: 2\.4\.0 · img b+0+, 2\.4\.0 · img c+0+, .*and 3 more/);
  });

  it("disables a version known only from Kubernetes, with its reason", () => {
    const view = cell(
      scope({
        current_version_source: "k8s.pod.image",
        current_compare_disabled: true,
        current_compare_disabled_reason: "no_span_version",
      }),
    );
    expect(view.get('[data-test="svcver-version-pay-k183"]').attributes("disabled")).toBeDefined();
    expect(view.get('[data-test="svcver-compare-disabled-reason"]').text()).toBe(
      "Compare is off: spans carry no version yet",
    );
  });
});

describe("Versions tab image builds", () => {
  const build = (image: string, index: number, extra: Partial<Version> = {}): Version => ({
    version_key: `k-${image}`,
    scope_key: "s",
    service_name: "cart",
    version: "2.4.0",
    image,
    image_ref: `ghcr.io/acme/cart@sha256:${image}`,
    version_images: 9,
    version_source: "service.version",
    where_key: "k8s:/web",
    where: { kind: "k8s", k8s_cluster: "", k8s_namespace: "web" },
    env: "prod",
    env_source: "attribute",
    active: index === 0,
    status: "active",
    first_seen: Date.UTC(2026, 10, 9 - index) * 1000,
    last_seen: Date.UTC(2026, 10, 9 - index, 12) * 1000,
    signals: { traces: { first_seen: 1, last_seen: 2 } },
    deploys: [],
    ...extra,
  });
  const images = ["9c1e4b7", "3f9c2ab", "77de019", "1111111", "2222222", "3333333", "4444444"];
  const versions = [
    ...images.map((image, index) => build(image, index)),
    build("abcdef0", 8, { version: "2.3.9", version_key: "k-239", version_images: 1 }),
    build("a01c3f2", 9, {
      version: "2.3.8",
      version_key: "k-238",
      version_images: 1,
      version_source: "k8s.pod.image",
      compare_disabled: true,
      compare_disabled_reason: "no_span_version",
    }),
  ];
  const result = (data: unknown) => ({
    data: ref(data),
    isPending: ref(false),
    isError: ref(false),
    error: ref(null),
    refetch: vi.fn(),
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state = ref({ where: "k8s:/web" });
    mocks.query = result({ versions, total: versions.length });
    mocks.discovery = result({ versions, total: versions.length });
    mocks.transitions = result({ deploys: [] });
    mocks.verdicts = result({ verdicts: [] });
  });
  const render = () =>
    mount(Tab, {
      props: { service: "cart" },
      global: {
        plugins: [i18n],
        stubs: {
          ...tip,
          ServiceEnvChip: true,
          VerdictChip: true,
          ServicePanelVerdictCard: true,
          NoVersionState: true,
          OSelect: { template: "<div><slot /></div>" },
          OSelectItem: true,
        },
      },
      attachTo: document.body,
    });

  it("shows the newest three builds of a version, then one line for the rest, and expands in place", async () => {
    const view = render();
    await flushPromises();
    const shown = () =>
      view
        .findAll('[data-test^="svcver-version-k-"]')
        .map((node) => node.attributes("data-test")?.replace("svcver-version-", ""));
    expect(shown()).toEqual(["k-9c1e4b7", "k-3f9c2ab", "k-77de019", "k-239", "k-238"]);
    const more = view.get('[data-test="svcver-versions-image-more"]');
    expect(more.text()).toContain("and 4 more images of 2.4.0");
    expect(more.text()).toContain("show them");
    expect(view.text()).toContain("2.4.0 · img 9c1e4b7");
    expect(view.text()).not.toContain("2.3.9 · img");
    await more.trigger("click");
    await flushPromises();
    expect(shown()).toEqual([...images.map((image) => `k-${image}`), "k-239", "k-238"]);
    expect(view.find('[data-test="svcver-versions-image-more"]').exists()).toBe(false);
  });

  it("says why a version known only from Kubernetes cannot be compared, and never prints the raw source key", async () => {
    const view = render();
    await flushPromises();
    expect(view.get('[data-test="svcver-compare-k-238"]').attributes("disabled")).toBeDefined();
    expect(view.get('[data-test="svcver-compare-wrap-k-238"]').text()).toContain(
      "Compare is off: spans carry no version yet",
    );
    expect(view.text()).toContain("2.3.8 · from the container image");
    expect(view.html()).not.toContain("k8s.pod.image");
    expect(view.html()).not.toContain("container.image.tag");
  });
});

describe("image row capping", () => {
  const rows = ["a", "b", "c", "d", "e"].map((key, index) => ({
    version: index < 4 ? "2.4.0" : "2.3.9",
    version_key: key,
    first_seen: 10 - index,
    last_seen: 20 - index,
  }));
  it("keeps one version's builds together and summarises past the cap", () => {
    const { rows: shown, more } = capImageRows(rows, 3);
    expect(shown.map((row) => row.version_key)).toEqual(["a", "b", "c", "e"]);
    expect(more).toEqual([{ version: "2.4.0", count: 1, from: 7, to: 17, after: "c" }]);
    expect(capImageRows(rows, 3, new Set(["2.4.0"])).more).toEqual([]);
  });
  it("prints a day range once when both ends share a day", () => {
    const day = Date.UTC(2026, 10, 3, 12) * 1000;
    expect(dayRange(day, day, "en-GB")).toBe("3 Nov");
    expect(dayRange(day, Date.UTC(2026, 10, 9, 12) * 1000, "en-GB")).toBe("3 Nov – 9 Nov");
  });
});
