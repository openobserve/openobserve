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
import { mount } from "@vue/test-utils";
import SessionCrossLinks from "@/components/rum/SessionCrossLinks.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const link = (name: string, fields: { name: string; alias?: string }[]) => ({
  name,
  url: "https://dash.example.com/d?id=${field.__value}&from=${start_time}&to=${end_time}",
  fields,
});

const setup = (enabled: boolean, crossLinks: unknown[]) => {
  store.commit("setConfig", { ...store.state.zoConfig, enable_cross_linking: enabled });
  store.commit("setOrganizationSettings", {
    ...store.state.organizationData.organizationSettings,
    cross_links: crossLinks,
  });
};

function mountComponent(fieldValue: unknown = "abc 1", range = () => ({ start: 1, end: 2 })) {
  return mount(SessionCrossLinks, {
    props: { fieldName: "session_id", fieldValue, range },
    global: {
      plugins: [i18n],
      provide: { store },
      stubs: {
        ODropdown: { template: '<div><slot name="trigger" /><slot /></div>' },
        ODropdownItem: {
          emits: ["select"],
          template: "<button @click=\"$emit('select', $event)\"><slot /></button>",
        },
        OTooltip: true,
      },
    },
  });
}

describe("SessionCrossLinks", () => {
  afterEach(() => {
    setup(false, []);
    vi.restoreAllMocks();
  });

  it.each([
    ["the flag is off", false, [link("A", [{ name: "session_id" }])], "abc", []],
    ["there are no links", true, [], "abc", []],
    ["a link is on another field", true, [link("A", [{ name: "other_id" }])], "abc", []],
    ["the value is empty", true, [link("A", [{ name: "session_id" }])], "", []],
    [
      "a stored alias would redirect another field",
      true,
      [link("A", [{ name: "trace_id", alias: "session_id" }])],
      "abc",
      [],
    ],
    ["a link is on the field", true, [link("A", [{ name: "session_id" }])], "abc", ["A"]],
    ["a link has no fields (always shown)", true, [link("A", [])], "abc", ["A"]],
    [
      "two links share a name",
      true,
      [link("A", [{ name: "session_id" }]), link("A", [])],
      "abc",
      ["A", "A"],
    ],
  ])("with %s lists the expected links", (_case, enabled, crossLinks, fieldValue, expected) => {
    setup(enabled, crossLinks);
    const wrapper = mountComponent(fieldValue);
    const items = wrapper.findAll("button[data-test^='session-cross-link-']");
    expect(items.map((item) => item.text())).toEqual(expected);
    expect(wrapper.find('[data-test="session-cross-links-btn"]').exists()).toBe(
      expected.length > 0,
    );
  });

  it("opens the resolved URL with the session id and the range read at click time", async () => {
    setup(true, [link("Session dashboard", [{ name: "session_id" }])]);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    let range = { start: 1700000000000000, end: 1700000060000000 };
    const wrapper = mountComponent("abc 1", () => range);
    range = { start: 1700000005000000, end: 1700000090000000 };

    await wrapper.find('[data-test="session-cross-link-Session dashboard"]').trigger("click");

    expect(openSpy).toHaveBeenCalledWith(
      "https://dash.example.com/d?id=abc%201&from=1700000005000000&to=1700000090000000",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
