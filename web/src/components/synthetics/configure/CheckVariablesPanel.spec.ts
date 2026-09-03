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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
// Real i18n plugin — the panel's hint line uses <i18n-t>, which the mocked
// useI18n() of sibling specs cannot resolve.
import i18n from "@/locales";
import { mockMonitorHttp } from "@/test/unit/mockData/synthetics";
import type { BrowserCheck, BrowserStep } from "@/types/synthetics";
import type { ResolvedVariable } from "@/components/synthetics/variables/resolved";

vi.mock("@/utils/uuid", () => ({ getUUID: vi.fn(() => "uuid-123") }));

const { resolvedVariablesGroupedMock } = vi.hoisted(() => ({
  resolvedVariablesGroupedMock: vi.fn(() => Promise.reject(new Error("no backend in specs"))),
}));
vi.mock("@/services/synthetics", () => ({
  default: { resolvedVariablesGrouped: resolvedVariablesGroupedMock },
}));

import CheckVariablesPanel from "./CheckVariablesPanel.vue";

// ── Stubs ───────────────────────────────────────────────────────────────────

const OInputStub = {
  // Without this, Vue also auto-inherits data-test onto the root div and
  // find() resolves to the div instead of the input.
  inheritAttrs: false,
  props: ["modelValue", "type", "error", "errorMessage", "placeholder"],
  emits: ["update:modelValue"],
  template: `<div>
    <input v-bind="$attrs" :value="modelValue" :type="type || 'text'" @input="$emit('update:modelValue', $event.target.value)" />
    <span v-if="error" class="o-input-error">{{ errorMessage }}</span>
  </div>`,
};

const OSwitchStub = {
  props: ["modelValue", "size"],
  template: '<input type="checkbox" :checked="modelValue" />',
};

const OButtonStub = {
  props: ["iconLeft", "iconOnly", "variant", "size", "ariaLabel"],
  emits: ["click"],
  template: `<button v-bind="$attrs" :aria-label="ariaLabel" @click="$emit('click')"><slot /></button>`,
};

const OBadgeStub = {
  props: ["variant", "size"],
  template: '<span v-bind="$attrs"><slot /></span>',
};

const OIconStub = {
  props: ["name", "size"],
  template: '<i v-bind="$attrs" />',
};

const OTooltipStub = {
  props: ["content", "side"],
  template: "<span />",
};

const OEmptyStateStub = {
  props: ["size", "illustration", "title", "description", "actionLabel", "actionIcon"],
  emits: ["action"],
  template: `<div v-bind="$attrs" class="empty-state-stub">{{ title }}
    <button v-if="actionLabel" class="empty-state-action" @click="$emit('action')">{{ actionLabel }}</button>
  </div>`,
};

const ODialogStub = {
  props: [
    "open",
    "size",
    "title",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "primaryButtonVariant",
  ],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `<div v-if="open" v-bind="$attrs" class="o-dialog-stub">
    <h2 class="dialog-title">{{ title }}</h2>
    <slot />
    <button class="dialog-primary" @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
    <button class="dialog-secondary" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
  </div>`,
};

const OSelectStub = {
  props: ["modelValue", "options", "label", "size"],
  emits: ["update:modelValue"],
  template: `<select v-bind="$attrs" :value="modelValue" @change="$emit('update:modelValue', $event.target.value)">
    <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
  </select>`,
};

const STUBS = {
  ODialog: ODialogStub,
  OInput: OInputStub,
  OSwitch: OSwitchStub,
  OButton: OButtonStub,
  OBadge: OBadgeStub,
  OIcon: OIconStub,
  OSelect: OSelectStub,
  OTooltip: OTooltipStub,
  OEmptyState: OEmptyStateStub,
};

// ── Fixtures / helpers ───────────────────────────────────────────────────────

const sel = (suffix = "") => `[data-test="synthetics-check-variables-panel${suffix}"]`;

const varBaseUrl = {
  id: "var-a",
  name: "BASE_URL",
  value: "https://example.com",
  secure: false,
  example: "",
};
const varToken = { id: "var-b", name: "TOKEN", value: "supersecret", secure: true, example: "" };

function checkWith(
  variables: NonNullable<BrowserCheck["variables"]>,
  journey: BrowserStep[] = [],
): BrowserCheck {
  return { ...mockMonitorHttp, variables, journey };
}

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(CheckVariablesPanel, {
    props: { check: mockMonitorHttp, ...props },
    global: {
      plugins: [i18n],
      stubs: STUBS,
      // Vuex 4's useStore() injects by the string key "store".
      provide: { store: { state: { selectedOrganization: { identifier: "default" } } } },
    },
  }) as VueWrapper;
}

/** With zero variables the empty state's action is the only Add affordance. */
function openAddFromEmptyState(wrapper: VueWrapper) {
  return wrapper.find(sel("-empty")).find("button.empty-state-action").trigger("click");
}

function lastEmitted(wrapper: VueWrapper): BrowserCheck {
  const emitted = wrapper.emitted("update:check");
  expect(emitted).toBeTruthy();
  return emitted![emitted!.length - 1][0] as BrowserCheck;
}

describe("CheckVariablesPanel", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // ── Rendering ─────────────────────────────────────────────────────────────
  describe("rendering", () => {
    it("should render one card per variable with the count badge", () => {
      wrapper = mountPanel({ check: checkWith([varBaseUrl, varToken]) });

      expect(wrapper.find(sel()).exists()).toBe(true);
      expect(wrapper.find(sel("-card-0")).exists()).toBe(true);
      expect(wrapper.find(sel("-card-1")).exists()).toBe(true);
      expect(wrapper.find(sel("-card-2")).exists()).toBe(false);
      expect(wrapper.find(sel("-count")).text()).toBe("2");
    });

    it("should render the empty state with a zero count and no standalone Add button when there are no variables", () => {
      wrapper = mountPanel({ check: checkWith([]) });

      expect(wrapper.find(sel("-empty")).exists()).toBe(true);
      expect(wrapper.find(sel("-count")).text()).toBe("0");
      expect(wrapper.find(sel("-card-0")).exists()).toBe(false);
      // The empty state's action is the only Add affordance in this state.
      expect(wrapper.find(sel("-add-variable-btn")).exists()).toBe(false);
    });

    it("should render the standalone Add button instead of the empty state when variables exist", () => {
      wrapper = mountPanel({ check: checkWith([varBaseUrl]) });

      expect(wrapper.find(sel("-empty")).exists()).toBe(false);
      expect(wrapper.find(sel("-add-variable-btn")).exists()).toBe(true);
    });
  });

  // ── Add flow ──────────────────────────────────────────────────────────────
  describe("add flow", () => {
    it("should open the add form (hiding the empty state) via the empty state's action", async () => {
      wrapper = mountPanel({ check: checkWith([]) });

      expect(wrapper.find(sel("-add-form")).exists()).toBe(false);
      await openAddFromEmptyState(wrapper);

      expect(wrapper.find(sel("-add-form")).exists()).toBe(true);
      expect(wrapper.find(sel("-empty")).exists()).toBe(false);
    });

    it("should emit update:check with the appended variable (name trimmed) on Add", async () => {
      wrapper = mountPanel({ check: checkWith([varBaseUrl]) });

      await wrapper.find(sel("-add-variable-btn")).trigger("click");
      await wrapper.find(sel("-add-name-input")).setValue("  API_KEY  ");
      await wrapper.find(sel("-add-value-input")).setValue("abc123");
      await wrapper.find(sel("-add-btn")).trigger("click");

      const updated = lastEmitted(wrapper);
      expect(updated.variables).toHaveLength(2);
      expect(updated.variables![1]).toEqual({
        id: "uuid-123",
        name: "API_KEY",
        value: "abc123",
        secure: false,
        example: "",
      });
      // Immutable update — the incoming prop is untouched.
      expect((wrapper.props("check") as BrowserCheck).variables).toHaveLength(1);
    });

    it("should mark the new variable secure when the secure toggle was clicked", async () => {
      wrapper = mountPanel({ check: checkWith([]) });

      await openAddFromEmptyState(wrapper);
      await wrapper.find(sel("-add-name-input")).setValue("SECRET");
      await wrapper.find(sel("-add-value-input")).setValue("hush");
      await wrapper.find(sel("-add-secure-switch")).trigger("click");
      await wrapper.find(sel("-add-btn")).trigger("click");

      expect(lastEmitted(wrapper).variables![0].secure).toBe(true);
    });

    it("should close the form and emit nothing on Cancel", async () => {
      wrapper = mountPanel({ check: checkWith([]) });

      await openAddFromEmptyState(wrapper);
      await wrapper.find(sel("-add-name-input")).setValue("API_KEY");
      await wrapper.find(sel("-add-cancel-btn")).trigger("click");

      expect(wrapper.find(sel("-add-form")).exists()).toBe(false);
      expect(wrapper.emitted("update:check")).toBeUndefined();
    });

    // The form renders at the end of the list, which is off-screen once the
    // list is long — the pinned Add button must bring it into view.
    describe("scroll-to-form", () => {
      // jsdom does not implement scrollIntoView — install a spy.
      let scrollSpy: ReturnType<typeof vi.fn>;
      let originalScrollIntoView: unknown;

      beforeEach(() => {
        scrollSpy = vi.fn();
        originalScrollIntoView = (Element.prototype as any).scrollIntoView;
        (Element.prototype as any).scrollIntoView = scrollSpy;
      });

      afterEach(() => {
        (Element.prototype as any).scrollIntoView = originalScrollIntoView;
      });

      it("should scroll the add form into view when opened", async () => {
        wrapper = mountPanel({ check: checkWith([varBaseUrl]) });

        await wrapper.find(sel("-add-variable-btn")).trigger("click");
        await nextTick();

        expect(scrollSpy).toHaveBeenCalled();
      });

      it("should keep the typed draft and re-scroll when Add is pressed again", async () => {
        wrapper = mountPanel({ check: checkWith([varBaseUrl]) });

        await wrapper.find(sel("-add-variable-btn")).trigger("click");
        await wrapper.find(sel("-add-name-input")).setValue("API_KEY");
        scrollSpy.mockClear();

        // The pinned button stays reachable after the form scrolls away.
        await wrapper.find(sel("-add-variable-btn")).trigger("click");
        await nextTick();

        expect((wrapper.find(sel("-add-name-input")).element as HTMLInputElement).value).toBe(
          "API_KEY",
        );
        expect(scrollSpy).toHaveBeenCalled();
      });
    });
  });

  // ── Name validation ───────────────────────────────────────────────────────
  describe("name validation", () => {
    it("should show an error and block Add for an invalid name", async () => {
      wrapper = mountPanel({ check: checkWith([]) });

      await openAddFromEmptyState(wrapper);
      await wrapper.find(sel("-add-name-input")).setValue("1bad");

      expect(wrapper.find(".o-input-error").exists()).toBe(true);

      await wrapper.find(sel("-add-btn")).trigger("click");
      expect(wrapper.emitted("update:check")).toBeUndefined();
    });

    it("should block a duplicate name but allow a different-cased one", async () => {
      wrapper = mountPanel({ check: checkWith([varToken]) });

      await wrapper.find(sel("-add-variable-btn")).trigger("click");
      await wrapper.find(sel("-add-name-input")).setValue("TOKEN");

      expect(wrapper.find(".o-input-error").exists()).toBe(true);
      await wrapper.find(sel("-add-btn")).trigger("click");
      expect(wrapper.emitted("update:check")).toBeUndefined();

      // Duplicate check is case-sensitive — "token" is a different variable.
      await wrapper.find(sel("-add-name-input")).setValue("token");
      expect(wrapper.find(".o-input-error").exists()).toBe(false);

      await wrapper.find(sel("-add-btn")).trigger("click");
      expect(lastEmitted(wrapper).variables).toHaveLength(2);
    });

    it("should show the empty-name error only after an Add attempt, and emit nothing", async () => {
      wrapper = mountPanel({ check: checkWith([]) });

      await openAddFromEmptyState(wrapper);
      // A freshly opened form does not start red.
      expect(wrapper.find(".o-input-error").exists()).toBe(false);

      await wrapper.find(sel("-add-btn")).trigger("click");

      expect(wrapper.find(".o-input-error").exists()).toBe(true);
      expect(wrapper.emitted("update:check")).toBeUndefined();
    });
  });

  // ── Edit flow ─────────────────────────────────────────────────────────────
  describe("edit flow", () => {
    it("should open the edit form prefilled with the variable", async () => {
      wrapper = mountPanel({ check: checkWith([varBaseUrl, varToken]) });

      await wrapper.find(sel("-edit-0-btn")).trigger("click");

      expect(wrapper.find(sel("-edit-form-0")).exists()).toBe(true);
      const nameInput = wrapper.find(sel("-edit-name-0-input")).element as HTMLInputElement;
      const valueInput = wrapper.find(sel("-edit-value-0-input")).element as HTMLInputElement;
      expect(nameInput.value).toBe("BASE_URL");
      expect(valueInput.value).toBe("https://example.com");
    });

    it("should emit the updated array in place on Save", async () => {
      wrapper = mountPanel({ check: checkWith([varBaseUrl, varToken]) });

      await wrapper.find(sel("-edit-0-btn")).trigger("click");
      await wrapper.find(sel("-edit-name-0-input")).setValue("API_ROOT");
      await wrapper.find(sel("-edit-value-0-input")).setValue("https://api.example.com");
      await wrapper.find(sel("-edit-save-0-btn")).trigger("click");

      const updated = lastEmitted(wrapper);
      expect(updated.variables).toHaveLength(2);
      expect(updated.variables![0]).toEqual({
        ...varBaseUrl,
        name: "API_ROOT",
        value: "https://api.example.com",
      });
      expect(updated.variables![1]).toEqual(varToken);
    });

    it("should close the form and emit nothing on Cancel", async () => {
      wrapper = mountPanel({ check: checkWith([varBaseUrl]) });

      await wrapper.find(sel("-edit-0-btn")).trigger("click");
      await wrapper.find(sel("-edit-name-0-input")).setValue("CHANGED");
      await wrapper.find(sel("-edit-cancel-0-btn")).trigger("click");

      expect(wrapper.find(sel("-edit-form-0")).exists()).toBe(false);
      expect(wrapper.emitted("update:check")).toBeUndefined();
    });
  });

  // ── One form at a time ────────────────────────────────────────────────────
  describe("single open form", () => {
    it("should close an open edit form when the add form opens", async () => {
      wrapper = mountPanel({ check: checkWith([varBaseUrl]) });

      await wrapper.find(sel("-edit-0-btn")).trigger("click");
      expect(wrapper.find(sel("-edit-form-0")).exists()).toBe(true);

      await wrapper.find(sel("-add-variable-btn")).trigger("click");

      expect(wrapper.find(sel("-add-form")).exists()).toBe(true);
      expect(wrapper.find(sel("-edit-form-0")).exists()).toBe(false);
    });

    it("should close an open add form when an edit form opens", async () => {
      wrapper = mountPanel({ check: checkWith([varBaseUrl]) });

      await wrapper.find(sel("-add-variable-btn")).trigger("click");
      expect(wrapper.find(sel("-add-form")).exists()).toBe(true);

      await wrapper.find(sel("-edit-0-btn")).trigger("click");

      expect(wrapper.find(sel("-edit-form-0")).exists()).toBe(true);
      expect(wrapper.find(sel("-add-form")).exists()).toBe(false);
    });
  });

  // ── Secure variables ──────────────────────────────────────────────────────
  describe("secure variables", () => {
    it("should show no value on any row, and never the raw secret", () => {
      wrapper = mountPanel({ check: checkWith([varBaseUrl, varToken]) });

      expect(wrapper.find(sel("-value-1")).exists()).toBe(false);
      expect(wrapper.text()).not.toContain("supersecret");
    });

    it("should keep a plain variable's value off the row too", () => {
      wrapper = mountPanel({ check: checkWith([varBaseUrl]) });

      expect(wrapper.text()).not.toContain("https://example.com");
    });
  });

  // ── Usage counts ──────────────────────────────────────────────────────────
  describe("usage counts", () => {
    const journey: BrowserStep[] = [
      { id: "s1", action: "navigate", value: "{{BASE_URL}}/login" },
      { id: "s2", action: "type", selector: "{{BASE_URL}}", value: "user" },
      {
        id: "s3",
        action: "click",
        locator: { candidates: [{ kind: "css", value: "[data-token='{{TOKEN}}']" }] },
      },
    ];

    it("should count steps referencing the exact {{name}} token", () => {
      wrapper = mountPanel({ check: checkWith([varBaseUrl, varToken], journey) });

      expect(wrapper.find(sel("-usage-0-badge")).text()).toBe("2");
      expect(wrapper.find(sel("-usage-1-badge")).text()).toBe("1");
    });

    it("should show 0 for a variable that is not referenced, even by a superstring token", () => {
      // "BASE" is a prefix of "BASE_URL" — {{BASE_URL}} must not count for it.
      const varBase = { id: "var-c", name: "BASE", value: "x", secure: false, example: "" };
      wrapper = mountPanel({ check: checkWith([varBase], journey) });

      expect(wrapper.find(sel("-usage-0-badge")).text()).toBe("0");
    });
  });

  // ── Remove + undo ─────────────────────────────────────────────────────────
  describe("remove and undo", () => {
    const varThird = { id: "var-d", name: "THIRD", value: "3", secure: false, example: "" };

    /** Removal is gated behind a confirm dialog — click through it. */
    async function removeAt(w: VueWrapper, index: number) {
      await w.find(sel(`-remove-${index}-btn`)).trigger("click");
      await w.find(sel("-remove-dialog")).find("button.dialog-primary").trigger("click");
    }

    it("should ask for confirmation before removing anything", async () => {
      wrapper = mountPanel({ check: checkWith([varBaseUrl, varToken]) });

      expect(wrapper.find(sel("-remove-dialog")).exists()).toBe(false);
      await wrapper.find(sel("-remove-0-btn")).trigger("click");

      // Dialog is up and nothing has been removed yet.
      expect(wrapper.find(sel("-remove-dialog")).exists()).toBe(true);
      expect(wrapper.emitted("update:check")).toBeUndefined();
    });

    it("should keep the variable and close the dialog on Cancel", async () => {
      wrapper = mountPanel({ check: checkWith([varBaseUrl, varToken]) });

      await wrapper.find(sel("-remove-0-btn")).trigger("click");
      await wrapper.find(sel("-remove-dialog")).find("button.dialog-secondary").trigger("click");

      expect(wrapper.find(sel("-remove-dialog")).exists()).toBe(false);
      expect(wrapper.emitted("update:check")).toBeUndefined();
      expect(wrapper.find(sel("-undo-row")).exists()).toBe(false);
    });

    it("should emit update:check without the removed variable and show the undo row", async () => {
      wrapper = mountPanel({ check: checkWith([varBaseUrl, varToken, varThird]) });

      await removeAt(wrapper, 1);

      const updated = lastEmitted(wrapper);
      expect(updated.variables).toEqual([varBaseUrl, varThird]);
      expect(wrapper.find(sel("-undo-row")).exists()).toBe(true);
      // The dialog closes once confirmed.
      expect(wrapper.find(sel("-remove-dialog")).exists()).toBe(false);
    });

    it("should restore the variable at its original index on undo", async () => {
      wrapper = mountPanel({ check: checkWith([varBaseUrl, varToken, varThird]) });

      await removeAt(wrapper, 1);
      // Props-driven: hand the emitted check back before undoing.
      await wrapper.setProps({ check: lastEmitted(wrapper) });

      await wrapper.find(sel("-undo-btn")).trigger("click");

      expect(lastEmitted(wrapper).variables).toEqual([varBaseUrl, varToken, varThird]);
      expect(wrapper.find(sel("-undo-row")).exists()).toBe(false);
    });

    it("should hide the undo row after the 6s window elapses", async () => {
      vi.useFakeTimers();
      wrapper = mountPanel({ check: checkWith([varBaseUrl]) });

      await removeAt(wrapper, 0);
      await wrapper.setProps({ check: lastEmitted(wrapper) });
      expect(wrapper.find(sel("-undo-row")).exists()).toBe(true);

      vi.advanceTimersByTime(5999);
      await nextTick();
      expect(wrapper.find(sel("-undo-row")).exists()).toBe(true);

      vi.advanceTimersByTime(1);
      await nextTick();
      expect(wrapper.find(sel("-undo-row")).exists()).toBe(false);
    });
  });

  // ── Environment resolution ────────────────────────────────────────────────
  describe("environment resolution", () => {
    function row(over: Partial<ResolvedVariable> = {}): ResolvedVariable {
      return {
        name: "ORG",
        kind: "plain",
        scope: "global",
        overridden: false,
        example: "",
        description: "",
        has_value: true,
        ...over,
      };
    }

    const grouped = {
      environments: ["staging", "qa"],
      resolved: {
        staging: [
          row(),
          row({ name: "BASE_URL", scope: "staging", overridden: true }),
          row({ name: "BASE_URL", scope: "check" }),
          row({ name: "TOKEN", scope: "check" }),
        ],
        qa: [
          row(),
          row({ name: "BASE_URL", scope: "check" }),
          row({ name: "TOKEN", scope: "check" }),
        ],
      },
    };

    it("fetches once and offers exactly the check's environments", async () => {
      resolvedVariablesGroupedMock.mockResolvedValueOnce({ data: grouped } as never);
      wrapper = mountPanel({ check: checkWith([varBaseUrl, varToken]) });
      await flushPromises();

      const options = wrapper.find(sel("-resolve-as")).findAll("option");
      expect(options.map((o) => o.text())).toEqual(["staging", "qa"]);
      expect(resolvedVariablesGroupedMock).toHaveBeenCalledTimes(1);
    });

    it("switches environments client-side, without a second fetch", async () => {
      resolvedVariablesGroupedMock.mockResolvedValueOnce({ data: grouped } as never);
      wrapper = mountPanel({ check: checkWith([varBaseUrl, varToken]) });
      await flushPromises();

      // staging shows the shadowed inherited BASE_URL; qa has no such row.
      expect(wrapper.find("span.line-through").exists()).toBe(true);
      await wrapper.find(sel("-resolve-as")).setValue("qa");
      expect(wrapper.find("span.line-through").exists()).toBe(false);
      expect(resolvedVariablesGroupedMock).toHaveBeenCalledTimes(1);
    });

    it("counts the resolved set for the selected environment, not declarations", async () => {
      resolvedVariablesGroupedMock.mockResolvedValueOnce({ data: grouped } as never);
      wrapper = mountPanel({ check: checkWith([varBaseUrl, varToken]) });
      await flushPromises();

      // staging: ORG + effective BASE_URL + TOKEN — the shadowed row not counted.
      expect(wrapper.find(sel("-count")).text()).toBe("3");
    });

    it("shows the cap once the resolved count approaches it", async () => {
      const many = Array.from({ length: 41 }, (_, i) => row({ name: `VAR_${i}` }));
      resolvedVariablesGroupedMock.mockResolvedValueOnce({
        data: { environments: ["staging"], resolved: { staging: many } },
      } as never);
      wrapper = mountPanel({ check: checkWith([]) });
      await flushPromises();

      expect(wrapper.find(sel("-count")).text()).toBe("41 of 50");
    });

    it("falls back to the declaration count while nothing is resolved", async () => {
      wrapper = mountPanel({ check: checkWith([varBaseUrl, varToken]) });
      await flushPromises();

      expect(wrapper.find(sel("-count")).text()).toBe("2");
    });

    it("notes the fallback value when removing an override", async () => {
      resolvedVariablesGroupedMock.mockResolvedValueOnce({ data: grouped } as never);
      wrapper = mountPanel({ check: checkWith([varBaseUrl, varToken]) });
      await flushPromises();

      // varBaseUrl shadows staging's BASE_URL — removing it falls back there.
      await wrapper.find(sel("-remove-0-btn")).trigger("click");
      expect(wrapper.find(sel("-remove-dialog")).text()).toContain(
        "Steps using BASE_URL will now get the staging value.",
      );
    });
  });
});
