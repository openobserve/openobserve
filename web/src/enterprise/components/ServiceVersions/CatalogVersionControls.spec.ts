// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import Controls from "./CatalogVersionControls.vue";
import Counts from "./CatalogVersionControlsCounts.vue";
import Band from "./CatalogVersionControlsBand.vue";
import Cell from "./CatalogVersionsCell.vue";
import Chip from "./VerdictChip.vue";
import Setup from "./NoVersionState.vue";
import type { Scope, ServicesResponse, VerdictSummary } from "@/services/service_versions";
import { formatStamp } from "./VersionSummaryTiles.format";
import producer from "@/test/unit/fixtures/serviceVersions/producer.json";
const open = vi.hoisted(() => vi.fn());
vi.mock("@/enterprise/composables/useVersionCompareDrawer", () => ({
  useVersionCompareDrawer: () => ({ open }),
}));
vi.mock("@/types/i18n", async (original) => ({
  ...(await original<object>()),
  useI18nTyped: () => ({
    t: (key: string, params?: object) => `${key}${params ? JSON.stringify(params) : ""}`,
  }),
}));
const global = {
  plugins: [i18n],
  stubs: {
    OSelect: {
      props: ["disabled"],
      template: '<div :aria-disabled="disabled"><slot name="trigger" /><slot /></div>',
    },
    OSelectItem: { props: ["value", "label"], template: "<span>{{ label }}</span>" },
    OButton: {
      props: ["disabled"],
      emits: ["click"],
      template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
    },
    OTag: {
      props: ["label", "value", "dot", "clickable"],
      emits: ["click"],
      template:
        '<span :data-dot="String(dot)" :data-value="value" @click="$emit(\'click\', $event)">{{ label }}</span>',
    },
    OSkeleton: { template: "<div />" },
    OTooltip: { props: ["content"], template: '<i class="tip">{{ content }}</i>' },
    ODialog: { props: ["open"], template: '<div v-if="open" data-test="dialog"><slot /></div>' },
    ServiceEnvChip: { props: ["identity"], template: "<b>{{ identity.env }}</b>" },
  },
};
const verdict = (patch: Partial<VerdictSummary> = {}) =>
  ({
    version: "v4",
    version_key: "key4",
    verdict: "regressed",
    baseline: { version: "v3", rule: "previous", where_key: "east" },
    deploy: { kind: "deploy", at: Date.now() * 1000 - 3 * 3600e6, from_version: "v3" },
    ...patch,
  }) as VerdictSummary;
const scope: Scope = {
  service: "svc",
  scope_key: "scope",
  where_key: "east",
  env: "prod",
  env_source: "attribute",
  signals: ["traces"],
  newest_version: "v4",
  newest_version_key: "key4",
  current_version: "v4",
  active_versions: ["v4", "v3", "v2", "v1"],
  active_version_keys: { v4: "key4", v3: "key3", v2: "key2", v1: "key1" },
};
const data = (): ServicesResponse => ({
  services: [scope],
  envs: [{ env: "prod", where_keys: ["east"] }],
  verdict_status: "ok",
  verdict_counts: { regressed: 2, watch: 1 },
});
const controls = (props = {}) =>
  mount(Controls, {
    props: { data: data(), state: "ready", env: "", verdict: "", ...props },
    global,
  });
const band = (props = {}) =>
  mount(Band, {
    props: { data: data(), state: "ready", env: "", verdict: "", ...props },
    global,
  });
describe("catalog filters", () => {
  it.each(["loading", "locked", "error"] as const)("disables both filters while %s", (state) => {
    const wrapper = controls({ state });
    expect(wrapper.find('[data-test="svcver-verdict-filter"]').attributes("aria-disabled")).toBe(
      "true",
    );
    expect(wrapper.find('[data-test="svcver-env-filter"]').attributes("aria-disabled")).toBe(
      "true",
    );
  });
  it("disables only the verdict filter when verdicts are unavailable", () => {
    const wrapper = controls({ data: { ...data(), verdict_status: "unavailable" } });
    expect(wrapper.find('[data-test="svcver-verdict-filter"]').attributes("aria-disabled")).toBe(
      "true",
    );
    expect(wrapper.find('[data-test="svcver-env-filter"]').attributes("aria-disabled")).toBe(
      "false",
    );
    expect(wrapper.text()).toContain("serviceVersions.catalog.disabled");
    expect(wrapper.find(".tip").text()).toBe("serviceVersions.catalog.unavailable");
  });
  it("lists the design's verdict options and adds rare states only when present", () => {
    const wrapper = controls();
    for (const value of ["ok", "watch", "regressed", "insufficient", "not_serving", "no_version"])
      expect(wrapper.find(`[data-test="svcver-verdict-option-${value}"]`).exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-verdict-option-pre_existing"]').exists()).toBe(false);
    const preexisting = controls({
      data: {
        ...data(),
        services: [{ ...scope, newest_verdict: verdict({ state: "pre_existing" }) }],
      },
    });
    expect(preexisting.find('[data-test="svcver-verdict-option-pre_existing"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="svcver-env-option-prod"]').exists()).toBe(true);
  });
  it("offers every env in the set and shows an env the scope was only also seen in", () => {
    const golden = structuredClone(producer.two_env.services) as ServicesResponse;
    const wrapper = controls({ env: "staging", data: { ...data(), ...golden } });
    expect(wrapper.find('[data-test="svcver-env-option-staging"]').exists()).toBe(true);
    expect(wrapper.find("b").text()).toBe("staging");
  });
});
describe("catalog verdict counts", () => {
  it("uses response-level counts without an env and applies the filter on click", async () => {
    const wrapper = mount(Counts, { props: { data: data(), state: "ready", env: "" }, global });
    expect(wrapper.get('[data-test="svcver-count-regressed"]').text()).toContain('"count":2');
    expect(wrapper.find('[data-test="svcver-count-not_serving"]').exists()).toBe(false);
    await wrapper.get('[data-test="svcver-count-regressed"]').trigger("click");
    expect(wrapper.emitted("verdict")).toEqual([["regressed"]]);
  });
  it("recounts from scopes for a selected env", () => {
    const services = [
      { ...scope, newest_verdict: verdict() },
      { ...scope, env: "dev" },
    ];
    const wrapper = mount(Counts, {
      props: { data: { ...data(), services }, state: "ready", env: "prod" },
      global,
    });
    expect(wrapper.get('[data-test="svcver-count-regressed"]').text()).toContain('"count":1');
  });
  it("counts only the scopes the table shows, not the org-wide verdict_counts", () => {
    const shown = { ...scope, newest_verdict: verdict({ verdict: "ok" }) };
    const wrapper = mount(Counts, {
      props: { data: data(), scopes: [shown], state: "ready", env: "" },
      global,
    });
    expect(wrapper.find('[data-test="svcver-count-regressed"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="svcver-catalog-counts"]').exists()).toBe(false);
  });
  it("hides counts when verdicts are unavailable", () => {
    const wrapper = mount(Counts, {
      props: { data: { ...data(), verdict_status: "unavailable" }, state: "ready", env: "" },
      global,
    });
    expect(wrapper.find('[data-test="svcver-catalog-counts"]').exists()).toBe(false);
  });
});
describe("catalog bands", () => {
  it.each(["loading", "locked"] as const)("distinguishes %s from empty", (state) => {
    const wrapper = band({ state });
    expect(
      wrapper
        .find(`[data-test="svcver-catalog-${state === "locked" ? "denied" : state}"]`)
        .exists(),
    ).toBe(true);
    expect(wrapper.find('[data-test="svcver-catalog-empty"]').exists()).toBe(false);
  });
  it("leaves an empty org to the table's no-services state, with no notice of its own", () => {
    const wrapper = band({ data: { ...data(), services: [] } });
    expect(wrapper.find('[data-test="svcver-catalog-error"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="svcver-notice-slot"]').element.children).toHaveLength(0);
    expect(wrapper.text()).not.toContain("serviceVersions.catalog.empty");
  });
  it("puts the registry failure above the table with Retry, naming both disabled filters", async () => {
    const wrapper = band({ state: "error" });
    const error = wrapper.get('[data-test="svcver-catalog-error"]');
    expect(error.text()).toContain("versionsUnavailableTitle: version tracking did not respond");
    expect(error.text()).toContain("Trace metrics below are current");
    expect(error.text()).toContain("The Env and Deploy verdict filters are disabled");
    expect(error.attributes("role")).toBe("alert");
    expect(error.classes()).toContain("bg-status-error-bg");
    await wrapper.get('[data-test="svcver-retry"]').trigger("click");
    expect(wrapper.emitted("refresh")).toHaveLength(1);
  });
  it("names a verdict-only outage separately", () => {
    const wrapper = band({
      data: { ...data(), verdict_status: "unavailable" },
    });
    expect(wrapper.get('[data-test="svcver-catalog-error"]').text()).toContain(
      "verdictsUnavailableTitle: trace metrics below are current",
    );
  });
  it("shows the launch banner only when every versioned scope is pre-existing", () => {
    const preexisting = { ...scope, newest_verdict: verdict({ state: "pre_existing" }) };
    const wrapper = band({
      data: {
        ...data(),
        services: [preexisting, { ...scope, scope_key: "none", newest_version: null }],
      },
    });
    expect(wrapper.find('[data-test="svcver-launch-day"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-show-no-version"]').exists()).toBe(false);
    expect(band().find('[data-test="svcver-launch-day"]').exists()).toBe(false);
  });
  it("counts no-version services and applies the filter from Show them", async () => {
    const services = [
      { ...scope, newest_verdict: verdict() },
      { ...scope, scope_key: "a", newest_version: "" },
      { ...scope, scope_key: "b", newest_version: null },
    ];
    const wrapper = band({ data: { ...data(), services } });
    expect(wrapper.get('[data-test="svcver-no-version-band"]').text()).toContain(
      'noVersionBandCount{"count":2} send no version, so they get',
    );
    await wrapper.get('[data-test="svcver-show-no-version"]').trigger("click");
    expect(wrapper.emitted("verdict")).toEqual([["no_version"]]);
  });
  it("turns into the setup hint under the No version filter and opens the setup", async () => {
    const services = [
      { ...scope, newest_version: null },
      { ...scope, newest_verdict: verdict() },
    ];
    const wrapper = band({ data: { ...data(), services }, verdict: "no_version", env: "prod" });
    expect(wrapper.get('[data-test="svcver-no-version"]').text()).toContain(
      '{"count":1,"total":2} prod service sends no version',
    );
    expect(wrapper.find('[data-test="svcver-no-version-setup"]').exists()).toBe(false);
    await wrapper.get('[data-test="svcver-how-to-version"]').trigger("click");
    expect(wrapper.find('[data-test="svcver-no-version-setup"]').exists()).toBe(true);
  });
});
describe("catalog version cells", () => {
  it.each(["loading", "locked", "error"] as const)(
    "renders %s without fabricated no-version",
    (state) => {
      const wrapper = mount(Cell, { props: { state }, global });
      expect(
        wrapper.find(`[data-test="svcver-cell-${state === "locked" ? "denied" : state}"]`).exists(),
      ).toBe(true);
      expect(wrapper.text()).not.toContain("serviceVersions.catalog.noVersionCell");
    },
  );
  it("shows the serving version, other live versions and opens it", async () => {
    const wrapper = mount(Cell, { props: { scope }, global });
    expect(wrapper.get('[data-test="svcver-version-scope-key4"]').text()).toBe("v4");
    expect(wrapper.get('[data-test="svcver-live-count"]').text()).toContain('"count":3');
    await wrapper.get('[data-test="svcver-version-scope-key4"]').trigger("click");
    expect(open).toHaveBeenCalledWith({ service: "svc", where: "east", a: "v4" });
  });
  it("shows a rollback as the current version with its origin", () => {
    const wrapper = mount(Cell, {
      props: { scope: { ...scope, current_version: "v3", previous_version: "v4" } },
      global,
    });
    expect(wrapper.get('[data-test="svcver-version-scope-key3"]').text()).toBe("v3");
    expect(wrapper.get('[data-test="svcver-rollback-note"]').text()).toContain('"version":"v4"');
  });
  it("opens the exact verdict transition with a baseline subline", async () => {
    const wrapper = mount(Cell, {
      props: {
        scope: { ...scope, newest_verdict: verdict({ deploy_key: "deploy" }) },
        content: "verdict",
      },
      global,
    });
    expect(wrapper.get('[data-test="svcver-verdict-subline"]').text()).toBe(
      'serviceVersions.catalog.vsBaseline{"version":"v3"}',
    );
    await wrapper.get('[data-test="svcver-verdict-scope-key4"]').trigger("click");
    expect(open).toHaveBeenCalledWith({
      service: "svc",
      where: "east",
      a: "v4",
      deployKey: "deploy",
    });
  });
  it("says where an env-fallback baseline ran", () => {
    const wrapper = mount(Cell, {
      props: {
        scope: {
          ...scope,
          newest_verdict: verdict({
            baseline: { version: "v3", rule: "env_fallback", where_key: "k8s:c2/web" },
          }),
        },
        content: "verdict",
      },
      global,
    });
    expect(wrapper.get('[data-test="svcver-verdict-subline"]').text()).toContain(
      '"where":"c2 · web"',
    );
  });
  it("shows a relative deploy time and none for pre-existing", () => {
    const deployed = mount(Cell, {
      props: { scope: { ...scope, newest_verdict: verdict() }, content: "deployed" },
      global,
    });
    expect(deployed.get('[data-test="svcver-deployed"]').text()).toBe(
      'serviceVersions.catalog.hoursAgo{"count":3}',
    );
    const preexisting = mount(Cell, {
      props: {
        scope: { ...scope, newest_verdict: verdict({ state: "pre_existing" }) },
        content: "deployed",
      },
      global,
    });
    const mark = preexisting.get('[data-test="svcver-deployed"] [data-test="svcver-not-compared"]');
    expect(mark.get('[aria-hidden="true"]').text()).toBe("—");
    expect(mark.get(".tip").text()).toBe("serviceVersions.catalog.noDeployRecorded");
    expect(mark.get(".sr-only").text()).toBe("serviceVersions.catalog.noDeployRecorded");
  });
  it.each([
    ["a versioned scope with no deploy", { ...scope }],
    ["a scope that sends no version", { ...scope, newest_version: null }],
    ["a row with no scope", undefined],
  ])("says why Deployed is empty for %s", (_, value) => {
    const cell = mount(Cell, { props: { scope: value, content: "deployed" }, global });
    expect(cell.get('[data-test="svcver-deployed"] .tip').text()).toBe(
      "serviceVersions.catalog.noDeployRecorded",
    );
  });
  it("distinguishes unknown identity from a known no-version service", () => {
    expect(mount(Cell, { global }).text()).toBe("—");
    expect(
      mount(Cell, {
        props: { scope: { ...scope, newest_version: "", active_versions: [""] } },
        global,
      }).text(),
    ).toContain("serviceVersions.catalog.noVersionCell");
  });
  it("keeps versions but withholds verdicts when only verdicts are unavailable", () => {
    const versions = mount(Cell, { props: { scope, unavailable: true }, global });
    expect(versions.find('[data-test="svcver-version-scope-key4"]').exists()).toBe(true);
    const verdicts = mount(Cell, {
      props: { scope, unavailable: true, content: "verdict" },
      global,
    });
    expect(verdicts.find('[data-test="svcver-cell-error"]').exists()).toBe(true);
  });
  it.each(["versions", "verdict", "deployed"] as const)(
    "shows a muted dash whose hover says unavailable in the %s cell when versions fail",
    (content) => {
      const cell = mount(Cell, { props: { scope, state: "error", content }, global });
      const error = cell.get('[data-test="svcver-cell-error"]');
      expect(error.text()).toBe("—serviceVersions.catalog.cellUnavailable");
      expect(error.get(".tip").text()).toBe("serviceVersions.catalog.cellUnavailable");
    },
  );
  it("labels a rolled-back row from its newest transition, vs the version it left", async () => {
    // A real producer scope and stored verdict, reshaped as a catalog row for a rollback transition.
    const stored = structuredClone(producer.regressed.stored_verdict) as unknown as VerdictSummary;
    const rolledBack = {
      ...(structuredClone(producer.two_env.services.services[0]) as Scope),
      newest_version: "2.0.0",
      current_version: "1.0.0",
      previous_version: "2.0.0",
      newest_verdict: {
        ...stored,
        version: "1.0.0",
        verdict: "ok",
        rollback_outcome: "recovered",
        baseline: { version: "2.0.0", rule: "previous" },
      },
    } as Scope;
    const cell = mount(Cell, { props: { scope: rolledBack, content: "verdict" }, global });
    const chip = cell.get(
      `[data-test="svcver-verdict-${rolledBack.scope_key}-${stored.version_key}"]`,
    );
    expect(chip.attributes("data-value")).toBe("rollback_recovered");
    expect(cell.get('[data-test="svcver-verdict-subline"]').text()).toBe(
      'serviceVersions.catalog.vsServingBefore{"version":"2.0.0"}',
    );
    await chip.trigger("click");
    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({ a: "1.0.0", deployKey: stored.deploy_key }),
    );
    const versions = mount(Cell, { props: { scope: rolledBack }, global });
    expect(versions.get('[data-test="svcver-rollback-note"]').text()).toContain("2.0.0");
  });
  it("shows First version for a real producer scope's lone version with no verdict", () => {
    const first = structuredClone(producer.two_env.services.services[0]) as Scope;
    const cell = mount(Cell, { props: { scope: first, content: "verdict" }, global });
    expect(
      cell
        .get(`[data-test="svcver-verdict-${first.scope_key}-first-version"]`)
        .attributes("data-value"),
    ).toBe("first_version");
  });
  it("reads a thin version change after tracking started as Not enough data with its deploy time", () => {
    const thin = {
      ...scope,
      previous_version: "v3",
      newest_verdict: verdict({ verdict: "insufficient", reason_code: "insufficient_sample" }),
    } as Scope;
    const chip = mount(Cell, { props: { scope: thin, content: "verdict" }, global });
    expect(chip.find('[data-value="first_version"]').exists()).toBe(false);
    expect(chip.find('[data-value="insufficient"]').exists()).toBe(true);
    const deployed = mount(Cell, { props: { scope: thin, content: "deployed" }, global });
    expect(deployed.find(".tip").exists()).toBe(false);
    expect(deployed.get('[data-test="svcver-deployed"]').text()).toContain("hoursAgo");
  });
});
describe("a deploy recorded but not judged yet", () => {
  const unjudged = { ...scope, previous_version: "v3", tracking_started: true } as Scope;
  it("reads Not enough data and claims no missing deploy", () => {
    const chip = mount(Cell, { props: { scope: unjudged, content: "verdict" }, global });
    expect(chip.get('[data-test="svcver-verdict-scope-unjudged"]').attributes("data-value")).toBe(
      "insufficient",
    );
    const deployed = mount(Cell, { props: { scope: unjudged, content: "deployed" }, global });
    expect(deployed.get('[data-test="svcver-deployed"]').text()).toBe("—");
    expect(deployed.text()).not.toContain("noDeployRecorded");
  });
});
describe("verdict chip", () => {
  it("dots outcomes but not pre-existing, and keeps the row click out", async () => {
    const outer = vi.fn();
    const wrapper = mount(
      {
        components: { Chip },
        template: '<div @click="outer"><Chip :verdict="v" @open="opened" /></div>',
        setup: () => ({ v: verdict(), outer, opened: open }),
      },
      { global },
    );
    expect(wrapper.get('[data-value="regressed"]').attributes("data-dot")).toBe("true");
    open.mockClear();
    await wrapper.get('[data-value="regressed"]').trigger("click");
    expect(open).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    const pre = mount(Chip, {
      props: { verdict: verdict({ state: "pre_existing" }), tooltip: "since" },
      global,
    });
    expect(pre.get('[data-value="pre_existing"]').attributes("data-dot")).toBe("false");
    expect(pre.find(".tip").text()).toBe("since");
  });
});
describe("no-version setup", () => {
  it("copies valid one-line snippets for the service", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const wrapper = mount(Setup, { props: { service: "cart", env: "prod" }, global });
    await wrapper.get('[data-test="svcver-copy-otel"]').trigger("click");
    await wrapper.get('[data-test="svcver-copy-sdk"]').trigger("click");
    expect(writeText).toHaveBeenCalledWith(
      "OTEL_RESOURCE_ATTRIBUTES=service.version=${RELEASE_VERSION},deployment.environment.name=${ENV}",
    );
    expect(writeText).toHaveBeenCalledWith(
      'openobserveRum.init({ service: "cart", env: "prod", version: import.meta.env.VITE_APP_VERSION })',
    );
    expect(wrapper.attributes("data-test")).toBe("svcver-no-version");
  });
});

describe("real catalog selectors", () => {
  it("mounts the all options without invalid empty Reka values", async () => {
    const wrapper = mount(Controls, {
      props: { data: data(), state: "ready", env: "", verdict: "" },
      global: { ...global, stubs: { ...global.stubs, OSelect: false, OSelectItem: false } },
    });
    expect(wrapper.find('[data-test="svcver-env-filter-trigger"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-verdict-filter-trigger"]').exists()).toBe(true);
    await wrapper
      .get('[data-test="svcver-verdict-filter-trigger"]')
      .trigger("keydown", { key: "ArrowDown" });
    await flushPromises();
    const option = document.querySelector('[data-test="svcver-verdict-option-no_version"]');
    expect(option).not.toBeNull();
    option?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    expect(wrapper.emitted("verdict")).toEqual([["no_version"]]);
    wrapper.unmount();
  });
});
describe("deploy tracking warm-up", () => {
  const now = Date.now() * 1000;
  // A real producer's tracking window, moved so its warm-up is still running now.
  const produced = producer.services_tracking;
  const epoch = now - 60e6;
  const warming = { epoch, warmup_ends_at: epoch + produced.warmup_ends_at! - produced.epoch! };
  const preexisting = { ...scope, newest_verdict: verdict({ state: "pre_existing" }) };
  const tip = (tracking?: ServicesResponse["tracking"]) =>
    mount(Cell, { props: { scope: preexisting, content: "verdict", tracking }, global })
      .get(".tip")
      .text();
  it("says the one no-verdict sentence in the banner once the warm-up is over", () => {
    const wrapper = band({
      data: { ...data(), services: [preexisting], tracking: produced },
    });
    expect(wrapper.get('[data-test="svcver-launch-day"]').text()).toBe(
      `serviceVersions.sentence.preExistingSince{"epoch":"${formatStamp(produced.epoch!)}"}`,
    );
  });
  it("explains a Pre-existing chip seen during the warm-up with the banner's own sentence", () => {
    expect(tip(warming)).toContain("serviceVersions.catalog.warmingUp");
    expect(tip(warming)).not.toContain("preExisting");
  });
  it("leaves the no-verdict sentence to the banner while the banner shows it", () => {
    const cell = mount(Cell, {
      props: { scope: preexisting, content: "verdict", tracking: warming, explained: true },
      global,
    });
    expect(cell.find(".tip").exists()).toBe(false);
  });
});
describe("a scope deploy tracking has not reached yet", () => {
  const untracked = { ...scope, tracking_started: false } as Scope;
  it("shows no First version, verdict or Pre-existing chip, only the muted mark with the warm-up reason", () => {
    const cell = mount(Cell, { props: { scope: untracked, content: "verdict" }, global });
    expect(cell.find('[data-value="first_version"]').exists()).toBe(false);
    expect(cell.find('[data-value="pre_existing"]').exists()).toBe(false);
    const mark = cell.get('[data-test="svcver-verdict-scope-pre-tracking"]');
    expect(mark.get(".tip").text()).toBe("serviceVersions.catalog.warmingUpNoEpoch");
  });
  it("says tracking is warming up, with no time, in the one banner when no scope is tracked", () => {
    const wrapper = band({
      data: { ...data(), services: [untracked], tracking: { epoch: null, warmup_ends_at: null } },
    });
    expect(wrapper.get('[data-test="svcver-launch-day"]').text()).toBe(
      "serviceVersions.catalog.warmingUpNoEpoch",
    );
  });
  it("names the warm-up end in the banner and the mark as soon as the org has an epoch", () => {
    const epoch = Date.now() * 1000 - 10e6;
    const warmingOrg = { epoch, warmup_ends_at: epoch + 80e6 };
    const wrapper = band({ data: { ...data(), services: [untracked], tracking: warmingOrg } });
    const time = formatStamp(warmingOrg.warmup_ends_at);
    expect(wrapper.get('[data-test="svcver-launch-day"]').text()).toBe(
      `serviceVersions.catalog.warmingUp{"time":"${time}"}`,
    );
    const cell = mount(Cell, {
      props: { scope: untracked, content: "verdict", tracking: warmingOrg },
      global,
    });
    expect(cell.get('[data-test="svcver-verdict-scope-pre-tracking"] .tip').text()).toBe(
      `serviceVersions.catalog.warmingUp{"time":"${time}"}`,
    );
  });
  it("keeps the banner off while another scope already has verdicts", () => {
    const wrapper = band({
      data: {
        ...data(),
        services: [untracked, { ...scope, scope_key: "b", newest_verdict: verdict() }],
      },
    });
    expect(wrapper.find('[data-test="svcver-launch-day"]').exists()).toBe(false);
  });
});
describe("the version a catalog row shows", () => {
  it("shows the serving version and counts only other serving versions as live", () => {
    const cell = mount(Cell, {
      props: {
        scope: {
          ...scope,
          newest_version: "2.0",
          newest_version_key: "k2",
          current_version: "1.0",
          active_versions: ["1.0"],
          active_version_keys: { "1.0": "k1" },
        },
      },
      global,
    });
    expect(cell.get('[data-test="svcver-version-scope-k1"]').text()).toBe("1.0");
    expect(cell.find('[data-test="svcver-live-count"]').exists()).toBe(false);
  });
});
describe("a verdict chip of another version than the row shows", () => {
  // The stage6 canary row: 1.0 serves and is shown, the Not serving verdict is the canary 2.0's.
  const canary = (verdictVersion: string) =>
    mount(Cell, {
      props: {
        scope: {
          ...scope,
          current_version: "v3",
          newest_verdict: verdict({ version: verdictVersion, verdict: "not_serving" }),
        },
        content: "verdict",
      },
      global,
    });
  it("names the verdict's version before the chip, with the whole line on hover", () => {
    const wrapper = canary("v4");
    const version = wrapper.get('[data-test="svcver-chip-version"]');
    expect(version.text()).toContain("v4");
    expect(version.get(".tip").text()).toBe(
      'v4 · serviceVersions.verdict.notServing serviceVersions.catalog.vsBaseline{"version":"v3"}',
    );
  });
  it("names no version when the verdict is the shown version's own", () => {
    expect(canary("v3").find('[data-test="svcver-chip-version"]').exists()).toBe(false);
  });
});
