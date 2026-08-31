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

import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it, vi } from "vitest";

// Reka portals popover content into <body>; render it inline instead so the
// integration block below can assert on it. Same shim OPopover.spec.ts uses.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return { ...actual, PopoverPortal: actual.PopoverContent };
});

import en from "@/locales/languages/en-US.json";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import type { JourneySuggestion } from "@/utils/synthetics/journeySuggestions";

import JourneySuggestions from "./JourneySuggestions.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

// The trigger slot is `as-child` in the real OPopover, so the chip's own click
// is what opens it — the stub catches the bubbled event on its wrapper.
const OPopoverStub = {
  props: ["open", "ariaLabel"],
  emits: ["update:open"],
  template: `
    <div class="o-popover-stub">
      <span class="o-popover-trigger" @click="$emit('update:open', !open)"><slot name="trigger" /></span>
      <div v-if="open" class="o-popover-content"><slot /></div>
    </div>`,
};
const OTooltipStub = {
  props: ["content", "disabled"],
  template:
    '<span class="o-tooltip-stub" :data-content="content" :data-disabled="String(disabled)" />',
};
const OIconStub = { template: "<i />" };
// `emits` matters: the real OButton declares `click`, so a parent's @click is
// consumed as an emit listener and never reaches $attrs. A stub without it
// leaves onClick in $attrs too and every handler fires twice.
const OButtonStub = {
  emits: ["click"],
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
};

const STUBS = {
  OPopover: OPopoverStub,
  OTooltip: OTooltipStub,
  OIcon: OIconStub,
  OButton: OButtonStub,
};

const ZERO_ASSERTION: JourneySuggestion = {
  id: "zero-assertion",
  severity: "warning",
  titleKey: "synthetics.journey.zeroAssertionTitle",
  descriptionKey: "synthetics.journey.zeroAssertionDescription",
  action: { kind: "add-assertion", labelKey: "synthetics.journey.zeroAssertionAdd" },
};

const NO_TEST_ATTRIBUTE: JourneySuggestion = {
  id: "no-test-attribute",
  severity: "warning",
  titleKey: "synthetics.journey.testIdMissingTitle",
  descriptionKey: "synthetics.journey.testIdMissingDescription",
  descriptionParams: { attr: "data-testid" },
};

const test = (name: string) => `[data-test="${name}"]`;
const CHIP = test("synthetics-journey-suggestions-chip");
const PANEL = test("synthetics-journey-suggestions-panel");

function render(suggestions: JourneySuggestion[]) {
  return mount(JourneySuggestions, {
    props: { suggestions },
    global: { plugins: [i18n], stubs: STUBS },
  });
}

describe("JourneySuggestions", () => {
  it("renders nothing at all when there is nothing to suggest", () => {
    const wrapper = render([]);

    expect(wrapper.find(CHIP).exists()).toBe(false);
    expect(wrapper.find(".o-popover-stub").exists()).toBe(false);
  });

  // The whole point: the chip costs one toolbar slot, not two cards of scroll.
  it("shows the count and no prose", () => {
    expect(render([ZERO_ASSERTION]).find(CHIP).text()).toBe("1");
    expect(render([ZERO_ASSERTION, NO_TEST_ATTRIBUTE]).find(CHIP).text()).toBe("2");
  });

  it("names itself on hover and to assistive tech, from the same string", () => {
    const wrapper = render([ZERO_ASSERTION]);

    // `⚠ 1` has an accessible name of "1" without this.
    expect(wrapper.find(CHIP).attributes("aria-label")).toContain("1 suggestion");
    expect(wrapper.find(".o-tooltip-stub").attributes("data-content")).toContain("1 suggestion");
  });

  it("pluralizes the count", () => {
    const label = render([ZERO_ASSERTION, NO_TEST_ATTRIBUTE]).find(CHIP).attributes("aria-label");

    expect(label).toContain("2 suggestions");
  });

  it("never opens on its own", () => {
    expect(render([ZERO_ASSERTION]).find(PANEL).exists()).toBe(false);
  });

  it("opens on click and shows every suggestion in full", async () => {
    const wrapper = render([ZERO_ASSERTION, NO_TEST_ATTRIBUTE]);

    await wrapper.find(CHIP).trigger("click");

    const panel = wrapper.find(PANEL);
    expect(panel.exists()).toBe(true);
    expect(panel.text()).toContain("This journey does not verify anything");
    expect(panel.text()).toContain("No test attributes found in this recording");
    // The description is interpolated, not printed raw.
    expect(panel.text()).toContain("data-testid");
    expect(panel.text()).not.toContain("{attr}");
  });

  // Hovering the chip you just clicked must not float a bubble over the panel.
  it("suppresses its own tooltip while the panel is open", async () => {
    const wrapper = render([ZERO_ASSERTION]);
    expect(wrapper.find(".o-tooltip-stub").attributes("data-disabled")).toBe("false");

    await wrapper.find(CHIP).trigger("click");

    expect(wrapper.find(".o-tooltip-stub").attributes("data-disabled")).toBe("true");
  });

  // Two stacked suggestions read as one wall of text without a rule between them.
  it("rules off one suggestion from the next, and the last from the footer", async () => {
    const one = render([ZERO_ASSERTION]);
    await one.find(CHIP).trigger("click");
    // Nothing to divide yet — only the footer's rule.
    expect(one.findAllComponents(OSeparator)).toHaveLength(1);

    const two = render([ZERO_ASSERTION, NO_TEST_ATTRIBUTE]);
    await two.find(CHIP).trigger("click");
    expect(two.findAllComponents(OSeparator)).toHaveLength(2);
  });

  // The warning colour asks whether the author is stuck; one line answers it.
  it("says that suggestions never block saving or running", async () => {
    const wrapper = render([ZERO_ASSERTION]);

    await wrapper.find(CHIP).trigger("click");

    expect(wrapper.find(test("synthetics-journey-suggestions-nonblocking")).exists()).toBe(true);
  });

  it("emits the action and closes", async () => {
    const wrapper = render([ZERO_ASSERTION]);
    await wrapper.find(CHIP).trigger("click");

    await wrapper
      .find(test("synthetics-journey-suggestion-action-zero-assertion"))
      .trigger("click");

    expect(wrapper.emitted("action")).toEqual([["add-assertion"]]);
    expect(wrapper.find(PANEL).exists()).toBe(false);
  });

  it("renders no button for a suggestion that has no action", async () => {
    const wrapper = render([NO_TEST_ATTRIBUTE]);

    await wrapper.find(CHIP).trigger("click");

    expect(wrapper.find(test("synthetics-journey-suggestion-no-test-attribute")).exists()).toBe(
      true,
    );
    expect(
      wrapper.find(test("synthetics-journey-suggestion-action-no-test-attribute")).exists(),
    ).toBe(false);
  });

  // A resolved suggestion takes the chip with it rather than leaving an empty one.
  it("disappears when its last suggestion is resolved", async () => {
    const wrapper = render([ZERO_ASSERTION]);
    await wrapper.find(CHIP).trigger("click");

    await wrapper.setProps({ suggestions: [] });

    expect(wrapper.find(CHIP).exists()).toBe(false);
    expect(wrapper.find(PANEL).exists()).toBe(false);
  });

  // Resolving a suggestion by hand (deleting the assert step, re-recording)
  // unmounts the popover but not this component. A leftover open flag would
  // hand the author an unrequested panel the next time one appears.
  it("comes back closed when a suggestion reappears", async () => {
    const wrapper = render([ZERO_ASSERTION]);
    await wrapper.find(CHIP).trigger("click");
    expect(wrapper.find(PANEL).exists()).toBe(true);

    await wrapper.setProps({ suggestions: [] });
    await wrapper.setProps({ suggestions: [ZERO_ASSERTION] });

    expect(wrapper.find(CHIP).exists()).toBe(true);
    expect(wrapper.find(PANEL).exists()).toBe(false);
  });
});

// Everything above stubs OPopover, so none of it proves the chip can open the
// real one. OBadge declares `inheritAttrs: false` and OPopover's trigger is
// `as-child` — precisely the combination that silently drops the click handler
// and leaves a chip that looks right and does nothing.
describe("JourneySuggestions on the real popover", () => {
  function renderReal(suggestions: JourneySuggestion[]) {
    return mount(JourneySuggestions, {
      props: { suggestions },
      global: { plugins: [i18n] },
    });
  }

  it("opens from the badge trigger", async () => {
    const wrapper = renderReal([ZERO_ASSERTION]);
    expect(wrapper.find(PANEL).exists()).toBe(false);

    await wrapper.find(CHIP).trigger("click");

    expect(wrapper.find(PANEL).exists()).toBe(true);
  });

  it("carries the accessible name through to the rendered trigger", () => {
    expect(renderReal([ZERO_ASSERTION]).find(CHIP).attributes("aria-label")).toContain(
      "1 suggestion",
    );
  });
});
