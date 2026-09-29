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

import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import en from "@/locales/languages/en-US.json";
import type { ReplayEnvironmentOption } from "@/components/synthetics/variables/replayInputs";
import OButton from "@/lib/core/Button/OButton.vue";
import ReplayEnvironmentMenu from "./ReplayEnvironmentMenu.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

// The menu content renders inline and always, so items can be read without driving reka's pointer events.
const ODropdownStub = {
  name: "ODropdown",
  props: ["open", "side", "align", "contentClass"],
  template:
    '<div class="o-dropdown-stub"><slot name="trigger" /><div class="o-dropdown-content"><slot /></div></div>',
};
const ODropdownItemStub = {
  name: "ODropdownItem",
  props: ["disabled", "iconLeft", "variant"],
  emits: ["select"],
  template:
    '<div role="menuitem" @click="$emit(\'select\', $event)"><slot name="icon-left" /><slot /><slot name="icon-right" /></div>',
};
const ODropdownGroupStub = {
  name: "ODropdownGroup",
  props: ["label"],
  template:
    '<div class="o-dropdown-group" :data-label="label"><span>{{ label }}</span><slot /></div>',
};
const ODropdownSeparatorStub = { name: "ODropdownSeparator", template: "<hr />" };
const OTooltipStub = {
  name: "OTooltip",
  props: ["content", "disabled", "side"],
  template: '<span class="o-tooltip-stub" :data-content="content" />',
};
const OIconStub = { props: ["name", "size"], template: '<i :data-icon="name" />' };

const STUBS = {
  ODropdown: ODropdownStub,
  ODropdownItem: ODropdownItemStub,
  ODropdownGroup: ODropdownGroupStub,
  ODropdownSeparator: ODropdownSeparatorStub,
  OTooltip: OTooltipStub,
  OIcon: OIconStub,
};

const PROD: ReplayEnvironmentOption = {
  id: "env-prod",
  name: "Production",
  host: "prod.test",
  inTest: true,
};
const STG: ReplayEnvironmentOption = {
  id: "env-stg",
  name: "Staging",
  host: "stg.test",
  inTest: true,
};
const QA: ReplayEnvironmentOption = { id: "env-qa", name: "QA", host: "qa.test", inTest: false };
const GLOBAL: ReplayEnvironmentOption = {
  id: "",
  name: "Global",
  host: "global.test",
  inTest: true,
};

const TRIGGER = '[data-test="synthetics-journey-replay-menu-trigger"]';
const item = (key: string) => `[data-test="synthetics-journey-replay-menu-env-${key}"]`;

function mountMenu(props: Record<string, unknown> = {}) {
  return mount(ReplayEnvironmentMenu, {
    props: { options: [PROD, STG, QA], selectedId: "env-stg", disabled: false, ...props },
    global: { plugins: [i18n], stubs: STUBS },
  }) as VueWrapper;
}

describe("ReplayEnvironmentMenu", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("marks the selected environment with a check and announces it as selected", () => {
    wrapper = mountMenu();

    const selected = wrapper.get(item("env-stg"));
    expect(selected.find('[data-icon="check"]').exists()).toBe(true);
    expect(selected.find(".sr-only").text()).toBe("Selected");
    expect(selected.find(".text-accent").text()).toBe("Staging");
    expect(selected.text()).toContain("stg.test");

    const other = wrapper.get(item("env-prod"));
    expect(other.find('[data-icon="check"]').exists()).toBe(false);
    expect(other.text()).not.toContain("Selected");
    expect(other.find(".text-accent").exists()).toBe(false);
    expect(other.text()).toContain("Production");
    expect(other.text()).toContain("prod.test");
  });

  it("groups environments outside the test under Not in this test's environments", () => {
    wrapper = mountMenu();

    const outside = wrapper
      .findAll(".o-dropdown-group")
      .find((g) => g.attributes("data-label") === "Not in this test's environments");
    expect(outside).toBeDefined();
    expect(outside!.find(item("env-qa")).exists()).toBe(true);
    expect(outside!.find(item("env-prod")).exists()).toBe(false);
    expect(outside!.find(item("env-stg")).exists()).toBe(false);

    wrapper.unmount();
    wrapper = mountMenu({ options: [PROD, STG] });
    expect(wrapper.text()).not.toContain("Not in this test's environments");
  });

  it("emits the chosen environment", async () => {
    wrapper = mountMenu();
    await wrapper.get(item("env-qa")).trigger("click");
    expect(wrapper.emitted("update:selected-id")).toEqual([["env-qa"]]);

    wrapper.unmount();
    wrapper = mountMenu({ options: [GLOBAL, PROD], selectedId: "env-prod" });
    await wrapper.get(item("global")).trigger("click");
    expect(wrapper.emitted("update:selected-id")).toEqual([[""]]);
  });

  it("renders the trigger, enabled, even when the org offers a single environment", () => {
    wrapper = mountMenu({ options: [PROD], selectedId: "env-prod" });
    const trigger = wrapper.get(TRIGGER);
    expect(trigger.attributes("disabled")).toBeUndefined();
    expect(wrapper.find(item("env-prod")).exists()).toBe(true);
  });

  it("shows the trigger for a one-environment test when the org has other environments", () => {
    wrapper = mountMenu({ options: [PROD, QA], selectedId: "env-prod" });
    expect(wrapper.find(TRIGGER).exists()).toBe(true);
    expect(wrapper.find(item("env-qa")).exists()).toBe(true);
  });

  it("the trigger reads In and the selected environment, with the dns icon and a caret", () => {
    wrapper = mountMenu();
    const trigger = wrapper.get(TRIGGER);
    expect(trigger.text()).toContain("In");
    expect(trigger.text()).toContain("Staging");
    expect(trigger.get(".text-text-secondary").text()).toBe("In");
    const icons = trigger.findAll("[data-icon]").map((i) => i.attributes("data-icon"));
    expect(icons[0]).toBe("dns");
    expect(icons.at(-1)).toBe("arrow-drop-down");
  });

  it("the trigger is a labelled outline button", () => {
    wrapper = mountMenu();
    const trigger = wrapper
      .findAllComponents(OButton)
      .find((b) => b.attributes("data-test") === "synthetics-journey-replay-menu-trigger");
    expect(trigger?.props("variant")).toBe("outline");
    expect(trigger?.props("size")).toBe("xs");
  });

  it("the trigger has a name and a tooltip, and follows disabled", async () => {
    wrapper = mountMenu();
    const trigger = wrapper.get(TRIGGER);
    expect(trigger.attributes("aria-label")).toBe("Replay environment: Staging");
    expect(trigger.attributes("disabled")).toBeUndefined();
    const tips = wrapper.findAllComponents(OTooltipStub).map((c) => c.props("content"));
    expect(tips).toContain("Replay environment");

    await wrapper.setProps({ disabled: true });
    expect(wrapper.get(TRIGGER).attributes("disabled")).toBeDefined();
  });

  it("marks the trigger when a typed secret failed in the last replay", async () => {
    const DOT = '[data-test="synthetics-journey-replay-menu-secret-failed"]';
    wrapper = mountMenu({ secretsNeeded: 1, secretsEntered: 1, secretFailed: true });
    expect(wrapper.get(TRIGGER).find(DOT).exists()).toBe(true);

    await wrapper.setProps({ secretFailed: false });
    expect(wrapper.get(TRIGGER).find(DOT).exists()).toBe(false);
  });

  it("says the choice is for this session only", () => {
    wrapper = mountMenu();
    expect(wrapper.text()).toContain("Replay and record in");
    expect(wrapper.text()).toContain("This session only — not saved with the test.");
  });

  describe("secrets", () => {
    const SECRETS = '[data-test="synthetics-journey-replay-menu-secrets"]';

    it("shows Secrets · 1 of 2 entered only when secrets are needed", async () => {
      wrapper = mountMenu({ secretsNeeded: 2, secretsEntered: 1 });
      const entry = wrapper.get(SECRETS);
      expect(entry.text()).toContain("Secrets · 1 of 2 entered");
      expect(entry.attributes("aria-label")).toBe(
        "Secrets for Staging replays: 1 of 2 entered. Edit",
      );

      await entry.trigger("click");
      expect(wrapper.emitted("edit-secrets")).toHaveLength(1);

      wrapper.unmount();
      wrapper = mountMenu({ secretsNeeded: 0, secretsEntered: 0 });
      expect(wrapper.find(SECRETS).exists()).toBe(false);
      expect(wrapper.text()).not.toContain("Secrets ·");
    });

    it("shows a red dot when a typed secret failed in the last replay", () => {
      wrapper = mountMenu({ secretsNeeded: 1, secretsEntered: 1, secretFailed: true });
      expect(wrapper.get(SECRETS).find(".bg-status-error-text").exists()).toBe(true);

      wrapper.unmount();
      wrapper = mountMenu({ secretsNeeded: 1, secretsEntered: 1, secretFailed: false });
      expect(wrapper.get(SECRETS).find(".bg-status-error-text").exists()).toBe(false);
    });

    it("shows the arrow when the org has one environment but secrets are needed", () => {
      wrapper = mountMenu({
        options: [PROD],
        selectedId: "env-prod",
        secretsNeeded: 1,
        secretsEntered: 0,
      });
      expect(wrapper.find(TRIGGER).exists()).toBe(true);
      expect(wrapper.find(SECRETS).exists()).toBe(true);
    });
  });
});
