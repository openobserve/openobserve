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

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import users from "@/services/users";
import LogsNoFtsPanel from "./LogsNoFtsPanel.vue";

beforeEach(() => {
  store.state.userInfo.role = "admin";
});
afterEach(() => {
  delete store.state.userInfo.role;
});

const mountPanel = (streams: { name: string; hasTextFields: boolean }[], props = {}) =>
  mount(LogsNoFtsPanel, {
    props: { streams, ...props },
    global: { plugins: [i18n], provide: { store } },
  });

describe("LogsNoFtsPanel (J3 with scan mode off)", () => {
  it("describes whole-query replacement without empty quotes", () => {
    const wrapper = mountPanel([{ name: "nofts", hasTextFields: true }], { term: "" });
    expect(wrapper.text()).not.toContain("“”");
    expect(wrapper.text()).toContain("clear the whole query");
    expect(wrapper.text()).toContain("keeping excluded words");
    wrapper.unmount();
  });

  it("names the stream and offers all three recovery actions (AC-C1.1)", async () => {
    const wrapper = mountPanel([{ name: "nofts_b", hasTextFields: true }]);
    const panel = wrapper.find('[data-test="logs-no-fts-panel"]');

    expect(panel.text()).toContain("Full-text search fields are not configured for nofts_b");
    expect(panel.text()).toContain("Search field values");
    expect(wrapper.find('[data-test="logs-no-fts-search-fields-btn"]').exists()).toBe(true);

    expect(wrapper.get('[data-test="logs-no-fts-configure-btn"]').text()).toContain(
      "Configure full-text search fields",
    );
    await wrapper.find('[data-test="logs-no-fts-configure-btn"]').trigger("click");
    expect(wrapper.emitted("configure")).toEqual([["nofts_b"]]);
  });

  it("keeps a certainly denied administrative card focusable and reacts when denial clears", async () => {
    store.state.userInfo.role = "viewer";
    const wrapper = mountPanel([{ name: "nofts_b", hasTextFields: true }], {
      configureDenied: true,
    });
    const card = wrapper.get('[data-test="logs-no-fts-configure-btn"]');
    expect(card.attributes("aria-disabled")).toBe("true");
    expect(card.attributes("disabled")).toBeUndefined();
    expect(wrapper.text()).toContain("You need permission to edit stream settings.");
    await card.trigger("click");
    expect(wrapper.emitted("configure")).toBeUndefined();
    await wrapper.setProps({ configureDenied: false });
    await card.trigger("click");
    expect(wrapper.emitted("configure")).toEqual([["nofts_b"]]);
    delete store.state.userInfo.role;
    wrapper.unmount();
  });

  it.each([undefined, "viewer", "member", "root", "editor"])(
    "keeps the settings route available for role %s without waiting on membership",
    async (role) => {
      store.state.userInfo.role = role;
      const lookup = vi.spyOn(users, "orgUsers").mockImplementation(() => new Promise(() => {}));
      const wrapper = mountPanel([{ name: "nofts_b", hasTextFields: true }]);
      const card = wrapper.get('[data-test="logs-no-fts-configure-btn"]');
      expect(card.attributes("aria-disabled")).toBeUndefined();
      expect(wrapper.text()).not.toContain("You need permission to edit stream settings.");
      expect(wrapper.text()).toContain("Makes full-text search fast for this stream.");
      await card.trigger("click");
      expect(wrapper.emitted("configure")).toEqual([["nofts_b"]]);
      expect(lookup).not.toHaveBeenCalled();
      wrapper.unmount();
      lookup.mockRestore();
    },
  );

  it("says a stream has no text fields at all (AC3.7)", () => {
    const wrapper = mountPanel([{ name: "nofts_c", hasTextFields: false }]);
    expect(wrapper.text()).toContain("This stream has no text fields to search.");
    expect(wrapper.find('[data-test="logs-no-fts-configure-btn"]').exists()).toBe(true);
  });

  it("names streams with no text fields when several are blocked", () => {
    const wrapper = mountPanel([
      { name: "nofts_b", hasTextFields: true },
      { name: "nofts_c", hasTextFields: false },
    ]);
    expect(wrapper.text()).toContain("The selected streams have no full-text fields");
    expect(wrapper.find('[data-test="logs-no-fts-no-text-streams"]').text()).toBe(
      "Not searched: nofts_c (no text fields).",
    );
  });
});
