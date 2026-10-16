// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

// Reka portals popover content into <body>; render it inline so the popovers can be asserted.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return { ...actual, PopoverPortal: actual.PopoverContent };
});

// The real toast is a no-op in jsdom, so the warning has to be observed through a mock.
const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

import en from "@/locales/languages/en-US.json";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import type { SyntheticsEnvironment, SyntheticsVariable } from "@/types/synthetics";
import JourneyStartPill from "./JourneyStartPill.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

const OTooltipStub = {
  name: "OTooltip",
  props: ["content", "disabled", "side"],
  template: '<span class="o-tooltip-stub" :data-content="content" />',
};
const OIconStub = { props: ["name", "size"], template: '<i :data-icon="name" />' };

const plain = (name: string, value: string): SyntheticsVariable => ({
  id: `var-${name}-${value}`,
  name,
  kind: "plain",
  value,
  has_value: true,
  description: "",
  example: "",
  tags: [],
  used_by_checks: 0,
  created_at: 0,
  updated_at: 0,
});
const env = (id: string, name: string, variables: SyntheticsVariable[] = []) =>
  ({
    id,
    name,
    description: "",
    is_global: false,
    created_at: 0,
    updated_at: 0,
    checks_count: 0,
    variables,
  }) as SyntheticsEnvironment;

const GLOBAL_ENV = { ...env("env-global", "global"), is_global: true };
const PROD = env("env-prod", "Production", [plain("BASE_URL", "https://prod.test")]);
const STG = env("env-stg", "Staging", [plain("BASE_URL", "https://stg.test")]);
const QA = env("env-qa", "QA", [plain("BASE_URL", "https://qa.test")]);
const ENVIRONMENTS = [GLOBAL_ENV, PROD, STG, QA];
const GLOBALS = [plain("BASE_URL", "https://global.test")];

const sel = (suffix: string) => `[data-test="synthetics-journey-start-pill${suffix}"]`;
const URL_HALF = sel("-url");
const ENVS_HALF = sel("-envs");
const ENVS_COUNT = sel("-envs-count");
const ENVS_LABEL = sel("-envs-label");
const URL_INPUT_FIELD = sel("-url-input-field");
const URL_INPUT_ERROR = sel("-url-input-error");

function mountPill(props: Record<string, unknown> = {}, attrs: Record<string, unknown> = {}) {
  return mount(JourneyStartPill, {
    attrs,
    props: {
      url: "{{BASE_URL}}/login",
      environments: ENVIRONMENTS,
      selectedIds: ["env-prod", "env-stg"],
      checkVariables: [],
      globals: GLOBALS,
      disabled: false,
      ...props,
    },
    // Attached: jsdom submits a form from its submit button only when connected.
    attachTo: document.body,
    global: { plugins: [i18n], stubs: { OTooltip: OTooltipStub, OIcon: OIconStub } },
  }) as VueWrapper;
}

function checkbox(w: VueWrapper, selector: string): DOMWrapper<Element> {
  const host = w.get(selector);
  return host.attributes("role") === "checkbox" ? host : host.get('[role="checkbox"]');
}

async function openUrl(w: VueWrapper) {
  await w.get(URL_HALF).trigger("click");
  await flushPromises();
}

async function closeUrl(w: VueWrapper) {
  w.findAllComponents(OPopover)[0].vm.$emit("update:open", false);
  await flushPromises();
}

async function openEnvs(w: VueWrapper) {
  await w.get(ENVS_HALF).trigger("click");
  await flushPromises();
}

describe("JourneyStartPill", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    mockToast.mockReset();
  });

  it("shows the URL as written, with its variables", () => {
    wrapper = mountPill();
    const half = wrapper.get(URL_HALF);
    expect(half.text()).toContain("{{BASE_URL}}/login");
    expect(half.text()).not.toContain("https://");
  });

  it("renders two separate controls, not a button group, and keeps the host's classes on the root", () => {
    wrapper = mountPill({}, { class: "max-md:order-last max-md:basis-full" });

    expect(wrapper.findComponent({ name: "OButtonGroup" }).exists()).toBe(false);
    const root = wrapper.element as HTMLElement;
    expect(root.tagName).toBe("DIV");
    expect([...root.classList]).toEqual(
      expect.arrayContaining(["max-md:order-last", "max-md:basis-full"]),
    );
    expect(root.contains(wrapper.get(URL_HALF).element)).toBe(true);
    expect(root.contains(wrapper.get(ENVS_HALF).element)).toBe(true);
  });

  it("the URL button shows no Opens label and a trailing edit icon in the secondary colour", () => {
    wrapper = mountPill();
    const half = wrapper.get(URL_HALF);

    expect(half.text()).not.toContain("Opens");
    const icons = half.findAll("[data-icon]");
    expect(icons.at(-1)?.attributes("data-icon")).toBe("edit");
    expect(icons.at(-1)?.classes()).toContain("text-text-secondary");
  });

  it("the URL button shows its text at normal weight, with or without a URL", () => {
    wrapper = mountPill();
    const urlSpan = wrapper
      .get(URL_HALF)
      .findAll("span")
      .filter((s) => s.text() === "{{BASE_URL}}/login")
      .at(-1);
    expect(urlSpan?.classes()).toContain("font-normal");
    wrapper.unmount();

    wrapper = mountPill({ url: "" });
    const emptySpan = wrapper
      .get(URL_HALF)
      .findAll("span")
      .filter((s) => s.text() === "Set a Starting URL")
      .at(-1);
    expect(emptySpan?.classes()).toContain("font-normal");
  });

  it("the URL button shows the URL monospaced and truncated", () => {
    wrapper = mountPill();
    const urlSpan = wrapper.get(URL_HALF).get(".font-mono");

    expect(urlSpan.text()).toBe("{{BASE_URL}}/login");
    expect(urlSpan.classes()).toEqual(expect.arrayContaining(["truncate", "font-normal"]));
  });

  it("below md both triggers are icon-only and keep their accessible names", () => {
    wrapper = mountPill();
    const url = wrapper.get(URL_HALF);
    const envs = wrapper.get(ENVS_HALF);

    const labels = [url, envs].flatMap((b) => b.findAll(".contents > span:not(.o-tooltip-stub)"));
    expect(labels.length).toBeGreaterThan(0);
    for (const span of labels) {
      expect(span.classes(), span.text()).toContain("max-md:hidden");
    }
    expect(url.get('[data-icon="language"]').classes()).not.toContain("md:hidden");
    expect(envs.get('[data-icon="layers"]').classes()).not.toContain("max-md:hidden");
    expect(url.attributes("aria-label")).toBeTruthy();
    expect(envs.attributes("aria-label")).toBeTruthy();
  });

  it("the Runs in button names the selected environments, or Global when none, with no count badge", () => {
    wrapper = mountPill({ selectedIds: [] });
    expect(wrapper.get(ENVS_HALF).text()).toContain("Runs in");
    expect(wrapper.get(ENVS_LABEL).text()).toBe("Global");
    expect(wrapper.find(ENVS_COUNT).exists()).toBe(false);
    expect(wrapper.findComponent({ name: "OBadge" }).exists()).toBe(false);
    wrapper.unmount();

    wrapper = mountPill({ selectedIds: ["env-prod", "env-stg"] });
    expect(wrapper.get(ENVS_LABEL).text()).toBe("Production, Staging");
    wrapper.unmount();

    // An environment the author cannot read is named by its id, as the picker lists it.
    wrapper = mountPill({ selectedIds: ["env-prod", "env-hidden"] });
    expect(wrapper.get(ENVS_LABEL).text()).toBe("Production, env-hidden");
  });

  it("a long list collapses to the first name and +N, with the full list in the tooltip", () => {
    const LONG = env("env-long", "Customer acceptance EU");
    wrapper = mountPill({
      environments: [...ENVIRONMENTS, LONG],
      selectedIds: ["env-prod", "env-long"],
    });
    expect(wrapper.get(ENVS_LABEL).text()).toBe("Production +1");
    wrapper.unmount();

    wrapper = mountPill({ selectedIds: ["env-prod", "env-stg", "env-qa"] });

    expect(wrapper.get(ENVS_LABEL).text()).toBe("Production +2");
    const tips = wrapper
      .findAllComponents(OTooltipStub)
      .map((c) => c.props("content") as string | undefined);
    expect(tips).toContain("Production, Staging, QA");
    expect(tips).not.toContain("Change environments");
  });

  it("the Runs in button leads with the layers icon and keeps its arrow", () => {
    wrapper = mountPill();
    const icons = wrapper.get(ENVS_HALF).findAll("[data-icon]");

    expect(icons.at(0)?.attributes("data-icon")).toBe("layers");
    expect(icons.at(-1)?.attributes("data-icon")).toBe("arrow-drop-down");
  });

  it("the Environments aria-label is plural: none, 1 selected, N selected", () => {
    wrapper = mountPill({ selectedIds: [] });
    expect(wrapper.get(ENVS_HALF).attributes("aria-label")).toBe(
      "Environments: none, Global values only. Change",
    );
    wrapper.unmount();

    wrapper = mountPill({ selectedIds: ["env-prod"] });
    expect(wrapper.get(ENVS_HALF).attributes("aria-label")).toBe(
      "Environments: 1 selected. Change",
    );
    wrapper.unmount();

    wrapper = mountPill({ selectedIds: ["env-prod", "env-stg", "env-hidden"] });
    expect(wrapper.get(ENVS_HALF).attributes("aria-label")).toBe(
      "Environments: 3 selected. Change",
    );
  });

  it("lists the URL each selected environment opens", async () => {
    wrapper = mountPill({ selectedIds: ["env-prod", "env-stg"] });
    await openUrl(wrapper);

    const text = wrapper.get("[data-o-popover-content]").text();
    expect(text).toContain("Starting URL");
    expect(text).toContain("Opened before step 1. Use a variable to change it per environment.");
    expect(text).toContain("Opens in this test's environments:");
    expect(text).toContain("Production");
    expect(text).toContain("https://prod.test/login");
    expect(text).toContain("Staging");
    expect(text).toContain("https://stg.test/login");
    expect(text).not.toContain("https://qa.test/login");
    expect(text).not.toContain("https://global.test/login");
  });

  it("shows the Global URL when no environment is selected", async () => {
    wrapper = mountPill({ selectedIds: [] });
    await openUrl(wrapper);

    const text = wrapper.get("[data-o-popover-content]").text();
    expect(text).toContain("Global");
    expect(text).toContain("https://global.test/login");
    expect(text).not.toContain("https://prod.test/login");
  });

  it("each valid edit emits the URL at once, placeholder kept and trimmed, with no Cancel or Apply", async () => {
    wrapper = mountPill();
    await openUrl(wrapper);
    expect((wrapper.get(URL_INPUT_FIELD).element as HTMLInputElement).value).toBe(
      "{{BASE_URL}}/login",
    );
    expect(wrapper.find(sel("-url-apply")).exists()).toBe(false);
    expect(wrapper.find(sel("-url-cancel")).exists()).toBe(false);
    expect(wrapper.emitted("update:url")).toBeUndefined();

    await wrapper.get(URL_INPUT_FIELD).setValue("{{BASE_URL}}/checkout");
    await vi.waitFor(() =>
      expect(wrapper.emitted("update:url")).toEqual([["{{BASE_URL}}/checkout"]]),
    );
    expect(wrapper.find(URL_INPUT_FIELD).exists()).toBe(true);

    await wrapper.get(URL_INPUT_FIELD).setValue("  https://shop.test/checkout  ");
    await vi.waitFor(() =>
      expect(wrapper.emitted("update:url")?.[1]).toEqual(["https://shop.test/checkout"]),
    );
  });

  it("an invalid URL shows the reason and emits nothing", async () => {
    wrapper = mountPill();
    await openUrl(wrapper);

    await wrapper.get(URL_INPUT_FIELD).setValue("not a url");

    await vi.waitFor(() =>
      expect(wrapper.get(URL_INPUT_ERROR).text()).toBe(
        "Enter a URL starting with http://, https:// or a variable placeholder",
      ),
    );
    expect(wrapper.emitted("update:url")).toBeUndefined();
    expect(wrapper.find(URL_INPUT_FIELD).exists()).toBe(true);
  });

  it("closing on an invalid draft warns that the Starting URL was not changed, with the reason", async () => {
    wrapper = mountPill();
    await openUrl(wrapper);
    await wrapper.get(URL_INPUT_FIELD).setValue("not a url");
    await flushPromises();

    await closeUrl(wrapper);

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith({
      variant: "warning",
      message:
        "Starting URL not changed: Enter a URL starting with http://, https:// or a variable placeholder",
    });
    expect(wrapper.emitted("update:url")).toBeUndefined();

    await openUrl(wrapper);
    expect((wrapper.get(URL_INPUT_FIELD).element as HTMLInputElement).value).toBe(
      "{{BASE_URL}}/login",
    );
  });

  it("closing on a valid or untouched draft warns about nothing", async () => {
    wrapper = mountPill();
    await openUrl(wrapper);
    await closeUrl(wrapper);

    await openUrl(wrapper);
    await wrapper.get(URL_INPUT_FIELD).setValue("https://shop.test/checkout");
    await vi.waitFor(() => expect(wrapper.emitted("update:url")).toHaveLength(1));
    await closeUrl(wrapper);

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("each checkbox change emits the new list at once, with no Cancel or Apply", async () => {
    wrapper = mountPill({ selectedIds: ["env-prod"] });
    await openEnvs(wrapper);
    expect(checkbox(wrapper, sel("-env-Production")).attributes("aria-checked")).toBe("true");
    expect(checkbox(wrapper, sel("-env-Staging")).attributes("aria-checked")).toBe("false");
    expect(wrapper.find(sel("-envs-apply")).exists()).toBe(false);
    expect(wrapper.find(sel("-envs-cancel")).exists()).toBe(false);

    await checkbox(wrapper, sel("-env-Staging")).trigger("click");
    await flushPromises();
    expect(wrapper.emitted("update:selected-ids")).toEqual([[["env-prod", "env-stg"]]]);
    expect(wrapper.find(sel("-env-Staging")).exists()).toBe(true);

    await checkbox(wrapper, sel("-env-Production")).trigger("click");
    await flushPromises();
    expect(wrapper.emitted("update:selected-ids")?.[1]).toEqual([[]]);
  });

  it("disables unchecked environments at the cap of 5", async () => {
    const named = ["A", "B", "C", "D", "E", "F"].map((n) =>
      env(`env-${n}`, `Env${n}`, [plain("BASE_URL", `https://${n}.test`)]),
    );
    wrapper = mountPill({
      environments: [GLOBAL_ENV, ...named],
      selectedIds: ["env-A", "env-B", "env-C", "env-D", "env-E"],
    });
    await openEnvs(wrapper);

    expect(checkbox(wrapper, sel("-env-EnvF")).attributes("disabled")).toBeDefined();
    expect(checkbox(wrapper, sel("-env-EnvA")).attributes("disabled")).toBeUndefined();
    expect(wrapper.text()).toContain("5 of 5 · Global values always apply");

    await checkbox(wrapper, sel("-env-EnvA")).trigger("click");
    expect(wrapper.emitted("update:selected-ids")).toEqual([
      [["env-B", "env-C", "env-D", "env-E"]],
    ]);
    await wrapper.setProps({ selectedIds: ["env-B", "env-C", "env-D", "env-E"] });
    await flushPromises();
    expect(checkbox(wrapper, sel("-env-EnvF")).attributes("disabled")).toBeUndefined();
    expect(wrapper.text()).toContain("4 of 5 · Global values always apply");
  });

  it("shows a selected environment the user cannot read as locked, with No access, and never removes it", async () => {
    wrapper = mountPill({ selectedIds: ["env-prod", "env-hidden"] });
    await openEnvs(wrapper);

    expect(wrapper.get(sel("-env-locked")).text()).toContain("env-hidden");
    expect(wrapper.text()).toContain("No access");
    expect(wrapper.find('[data-icon="lock"]').exists()).toBe(true);
    const box = checkbox(wrapper, sel("-env-locked"));
    expect(box.attributes("aria-checked")).toBe("true");
    expect(box.attributes("disabled")).toBeDefined();

    await checkbox(wrapper, sel("-env-Staging")).trigger("click");
    await flushPromises();

    const emitted = wrapper.emitted("update:selected-ids")![0][0] as string[];
    expect(emitted).toHaveLength(3);
    expect(emitted).toEqual(expect.arrayContaining(["env-prod", "env-hidden", "env-stg"]));
  });

  it("every trigger has an accessible name and a tooltip", () => {
    wrapper = mountPill({ selectedIds: ["env-prod", "env-stg"] });

    expect(wrapper.get(URL_HALF).attributes("aria-label")).toBe(
      "Starting URL: {{BASE_URL}}/login. Edit",
    );
    expect(wrapper.get(ENVS_HALF).attributes("aria-label")).toBe(
      "Environments: 2 selected. Change",
    );

    const tips = wrapper
      .findAllComponents(OTooltipStub)
      .map((c) => c.props("content") as string | undefined);
    expect(tips).toContain("Edit Starting URL");
    expect(tips).toContain("Change environments");
  });

  it("disabled while locked", async () => {
    wrapper = mountPill({ disabled: true });

    expect(wrapper.get(URL_HALF).attributes("disabled")).toBeDefined();
    expect(wrapper.get(ENVS_HALF).attributes("disabled")).toBeDefined();

    await openUrl(wrapper);
    await openEnvs(wrapper);
    expect(wrapper.find(URL_INPUT_FIELD).exists()).toBe(false);
    expect(wrapper.find(sel("-env-Production")).exists()).toBe(false);
  });
});
