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
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import type { SyntheticsVariable } from "@/types/synthetics";

vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: vi.fn() }),
}));
vi.mock("@/services/synthetics", () => ({ default: {} }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

import SyntheticsVariablesList from "./SyntheticsVariablesList.vue";

const OBadgeStub = {
  props: ["variant", "size"],
  template: '<span v-bind="$attrs" :data-variant="variant"><slot /></span>',
};

function variable(over: Partial<SyntheticsVariable> = {}): SyntheticsVariable {
  return {
    id: "v1",
    name: "BASE_URL",
    kind: "plain",
    description: "",
    example: "",
    tags: [],
    value: "https://shop.example",
    has_value: true,
    used_by_checks: 0,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

function mountList(variables: SyntheticsVariable[]) {
  return mount(SyntheticsVariablesList, {
    props: { variables, environment: "staging" },
    global: {
      plugins: [i18n],
      provide: { store: { state: { selectedOrganization: { identifier: "default" } } } },
      stubs: {
        OBadge: OBadgeStub,
        OTooltip: { template: "<span><slot /></span>" },
        SyntheticsVariableForm: true,
        SyntheticsSplitVariableDialog: true,
        SyntheticsDuplicateVariableDialog: true,
      },
    },
  }) as VueWrapper;
}

const emptyBadge = '[data-test="synthetics-variable-value-empty"]';
const plainValue = '[data-test="synthetics-variable-plain-value"]';
const secretValue = '[data-test="synthetics-variable-secret-value"]';

const LOCALE = "en-us";
const VALUE_EMPTY_KEY = "synthetics.variables.valueEmpty";
const SENTINEL = "SENTINEL_EMPTY";

function valueEmptyMessage(): unknown {
  return (i18n.global.getLocaleMessage(LOCALE) as any).synthetics?.variables?.valueEmpty;
}

describe("SyntheticsVariablesList — value cell", () => {
  let wrapper: VueWrapper;
  let original: unknown;

  beforeEach(() => {
    original = valueEmptyMessage();
    i18n.global.mergeLocaleMessage(LOCALE, {
      synthetics: { variables: { valueEmpty: SENTINEL } },
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    i18n.global.mergeLocaleMessage(LOCALE, {
      synthetics: { variables: { valueEmpty: original } },
    });
  });

  it("ships the Empty label as a locale message", () => {
    expect(typeof original, `${VALUE_EMPTY_KEY} must exist in en-US.json`).toBe("string");
  });

  it("flags a plain variable with an empty value instead of a blank cell", () => {
    wrapper = mountList([variable({ value: "", has_value: false })]);
    const badge = wrapper.find(emptyBadge);
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe(SENTINEL);
    expect(badge.attributes("data-variant")).toBe("warning");
    expect(wrapper.find(plainValue).exists()).toBe(false);
  });

  it("shows a plain variable's value with no Empty badge", () => {
    wrapper = mountList([variable({ value: "https://shop.example" })]);
    expect(wrapper.find(plainValue).text()).toBe("https://shop.example");
    expect(wrapper.find(emptyBadge).exists()).toBe(false);
  });

  it("leaves a secret row on its mask, never the Empty badge", () => {
    wrapper = mountList([
      variable({ id: "s1", name: "TOKEN", kind: "secret", value: undefined, has_value: true }),
      variable({ id: "s2", name: "UNSET", kind: "secret", value: undefined, has_value: false }),
    ]);
    const masks = wrapper.findAll(secretValue);
    expect(masks).toHaveLength(2);
    expect(masks[0].text()).toBe("••••••");
    expect(masks[1].text()).toContain("Not set");
    expect(wrapper.find(emptyBadge).exists()).toBe(false);
  });
});
