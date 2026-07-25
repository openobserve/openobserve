// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";

// Resolve the three dimension labels the component reads via useI18n against the
// REAL en-US.json — so this spec guards the actual keys we ship.
vi.mock("vue-i18n", async () => {
  const en: any = (await import("@/locales/languages/en-US.json")).default;
  return {
    useI18n: vi.fn(() => ({
      t: (key: string) => {
        const msg = key.split(".").reduce((a: any, k) => (a == null ? a : a[k]), en);
        return typeof msg === "string" ? msg : key;
      },
    })),
  };
});

import AgentScopeCascade from "./AgentScopeCascade.vue";

// Stub OSelect so the spec asserts THIS component's OWN wiring — which option
// list feeds which dropdown, disabled state, label + data-test — not OSelect
// internals (covered by its own spec). The stub reflects `disabled` and the
// resolved option labels so the cascade's derivation is observable.
const OSelect = {
  props: ["modelValue", "label", "options", "disabled", "dataTest"],
  emits: ["update:modelValue"],
  template:
    '<div class="o-select" :data-test="dataTest" :data-disabled="disabled" :data-label="label">' +
    '<span class="opt" v-for="o in options" :key="String(o.value)" :data-value="o.value" @click="$emit(\'update:modelValue\', o.value)">{{ o.label }}</span>' +
    "</div>",
};

const stubs = { OSelect };

// UNSET sentinel mirrors useAgentScope's export; the parent already maps it to
// the unset i18n label in the option, so the component just renders o.label.
const UNSET = "__unset__";

const opt = (v: string, label?: string): SelectOption => ({
  label: label ?? v,
  value: v,
});

const baseProps = {
  prefix: "sessions-list",
  envs: [opt("prod"), opt("staging")],
  agentNames: [opt("checkout"), opt("search")],
  versions: [opt("1.0"), opt("2.0")],
  selectedEnv: "prod",
  selectedAgentName: "checkout",
  selectedVersion: "1.0",
};

const mountCascade = (overrides: Record<string, unknown> = {}) =>
  mount(AgentScopeCascade, {
    global: { stubs },
    props: { ...baseProps, ...overrides },
  });

describe("AgentScopeCascade", () => {
  it("renders three dropdowns labeled Env / Agent / Version with a data-test on each", () => {
    const w = mountCascade();
    const env = w.find('[data-test="sessions-list-cascade-env"]');
    const agent = w.find('[data-test="sessions-list-cascade-agent"]');
    const version = w.find('[data-test="sessions-list-cascade-version"]');
    expect(env.exists()).toBe(true);
    expect(agent.exists()).toBe(true);
    expect(version.exists()).toBe(true);
    // Labels resolve from the real i18n keys we ship.
    expect(env.attributes("data-label")).toBe("Env");
    expect(agent.attributes("data-label")).toBe("Agent");
    expect(version.attributes("data-label")).toBe("Version");
  });

  it("keeps every dropdown ENABLED even with a single option (no greyed-out look)", () => {
    // A disabled control reads as "broken"; single-option dimensions stay
    // enabled (the user can open them to see the one auto-selected value).
    const w = mountCascade({
      envs: [opt("prod")],
      agentNames: [opt("checkout"), opt("search")],
      versions: [opt("1.0")],
    });
    for (const dim of ["env", "agent", "version"]) {
      const disabled = w
        .find(`[data-test="sessions-list-cascade-${dim}"]`)
        .attributes("data-disabled");
      // undefined or "false" — never disabled.
      expect(disabled === "true").toBe(false);
    }
  });

  it("renders the UNSET option as the missing-dimension bucket alongside real values", () => {
    // The untagged bucket coexists WITH real values (here: "prod"), so it is an
    // OPTION labelled "(No env)" / "(No version)" — distinct from the whole
    // dropdown being empty (OSelect's own "No options found"). The parent
    // (useAgentScope) resolves the per-dimension label and hands it in on the
    // option; this component renders o.label verbatim.
    const w = mountCascade({
      envs: [opt(UNSET, "(No env)"), opt("prod")],
    });
    const envSelect = w.find('[data-test="sessions-list-cascade-env"]');
    const unsetOpt = envSelect.find(`.opt[data-value="${UNSET}"]`);
    expect(unsetOpt.exists()).toBe(true);
    expect(unsetOpt.text()).toBe("(No env)");
    // sanity: the real value is present too — this is NOT the empty-dropdown state
    expect(envSelect.find('.opt[data-value="prod"]').exists()).toBe(true);
  });

  it("re-derives agent + version options when env changes (options are prop-driven)", async () => {
    const w = mountCascade({
      agentNames: [opt("checkout")],
      versions: [opt("1.0")],
    });
    expect(
      w.find('[data-test="sessions-list-cascade-agent"]').findAll(".opt"),
    ).toHaveLength(1);

    // The parent (useAgentScope) re-derives the lower lists on env change; the
    // component reflects the new props immediately.
    await w.setProps({
      selectedEnv: "staging",
      agentNames: [opt("billing"), opt("payments")],
      versions: [opt("3.0"), opt("4.0")],
    });
    const agentOpts = w
      .find('[data-test="sessions-list-cascade-agent"]')
      .findAll(".opt");
    expect(agentOpts.map((o) => o.text())).toEqual(["billing", "payments"]);
    const versionOpts = w
      .find('[data-test="sessions-list-cascade-version"]')
      .findAll(".opt");
    expect(versionOpts.map((o) => o.text())).toEqual(["3.0", "4.0"]);
  });

  it("emits update:selectedEnv (v-model) when the env dropdown changes", async () => {
    const w = mountCascade();
    await w
      .find('[data-test="sessions-list-cascade-env"] .opt[data-value="staging"]')
      .trigger("click");
    expect(w.emitted("update:selectedEnv")).toBeTruthy();
    expect(w.emitted("update:selectedEnv")!.at(-1)).toEqual(["staging"]);
  });

  it("emits update:selectedAgentName + update:selectedVersion from their dropdowns", async () => {
    const w = mountCascade();
    await w
      .find('[data-test="sessions-list-cascade-agent"] .opt[data-value="search"]')
      .trigger("click");
    await w
      .find('[data-test="sessions-list-cascade-version"] .opt[data-value="2.0"]')
      .trigger("click");
    expect(w.emitted("update:selectedAgentName")!.at(-1)).toEqual(["search"]);
    expect(w.emitted("update:selectedVersion")!.at(-1)).toEqual(["2.0"]);
  });

  it("renders the Version dropdown by default (show-version defaults true)", () => {
    const w = mountCascade();
    expect(
      w.find('[data-test="sessions-list-cascade-version"]').exists(),
    ).toBe(true);
  });

  it("hides ONLY the Version dropdown when show-version is false (Env + Agent stay)", () => {
    const w = mountCascade({ showVersion: false });
    expect(w.find('[data-test="sessions-list-cascade-env"]').exists()).toBe(true);
    expect(
      w.find('[data-test="sessions-list-cascade-agent"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-test="sessions-list-cascade-version"]').exists(),
    ).toBe(false);
  });

  it("uses the passed prefix in every data-test (different page)", () => {
    const w = mountCascade({ prefix: "agent-graph" });
    expect(w.find('[data-test="agent-graph-cascade-env"]').exists()).toBe(true);
    expect(w.find('[data-test="agent-graph-cascade-agent"]').exists()).toBe(true);
    expect(w.find('[data-test="agent-graph-cascade-version"]').exists()).toBe(true);
  });
});
