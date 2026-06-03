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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import UsageMemberList from "./UsageMemberList.vue";

function mountList(members: any[] = [], modelValue = "") {
  return mount(UsageMemberList, {
    props: { members, modelValue },
    global: {
      plugins: [store, i18n],
      stubs: { OTabs: true, OTab: true },
    },
  });
}

describe("UsageMemberList.vue", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("current org display", () => {
    it("shows current org separately when it's a super org (not in members list)", () => {
      wrapper = mountList([{ id: "child-1", name: "Child One" }]);
      // Current org from store is "default", which is not in members
      expect(wrapper.vm.currentOrgToShow).toBeTruthy();
      expect(wrapper.vm.currentOrgToShow.primary).toBe("default Organization");
    });

    it("hides current org section when it's a member org (in members list)", () => {
      wrapper = mountList([{ id: "default", name: "Default Org" }]);
      // Current org is in members, so it shouldn't show separately
      expect(wrapper.vm.currentOrgToShow).toBeNull();
    });
  });

  describe("member options", () => {
    it("lists only member organizations (no all-members entry)", () => {
      wrapper = mountList([{ id: "child-1", name: "Child One" }]);
      expect(wrapper.vm.filteredOptions).toHaveLength(1);
      expect(wrapper.vm.filteredOptions[0].value).toBe("child-1");
    });

    it("shows member name as primary and identifier as secondary", () => {
      wrapper = mountList([{ id: "child-1", name: "Child One" }]);
      const opt = wrapper.vm.filteredOptions[0];
      expect(opt.value).toBe("child-1");
      expect(opt.primary).toBe("Child One");
      expect(opt.secondary).toBe("child-1");
      expect(opt.title).toBe("Child One | child-1");
    });

    it("falls back to the identifier when no name is present", () => {
      wrapper = mountList([{ id: "child-2", name: "" }]);
      const opt = wrapper.vm.filteredOptions[0];
      expect(opt.primary).toBe("child-2");
      expect(opt.secondary).toBe("");
      expect(opt.title).toBe("child-2");
    });
  });

  describe("search", () => {
    beforeEach(() => {
      wrapper = mountList([
        { id: "acme-global", name: "Acme Global" },
        { id: "globex-corp", name: "Globex Corp" },
      ]);
    });

    it("filters by organization name (case-insensitive)", async () => {
      wrapper.vm.searchQuery = "acme";
      await nextTick();
      const values = wrapper.vm.filteredOptions.map((o: any) => o.value);
      expect(values).toEqual(["acme-global"]);
    });

    it("filters by organization identifier", async () => {
      wrapper.vm.searchQuery = "globex-corp";
      await nextTick();
      const values = wrapper.vm.filteredOptions.map((o: any) => o.value);
      expect(values).toEqual(["globex-corp"]);
    });

    it("returns no options when nothing matches", async () => {
      wrapper.vm.searchQuery = "no-such-org";
      await nextTick();
      expect(wrapper.vm.filteredOptions).toHaveLength(0);
    });
  });

  describe("v-model", () => {
    it("emits update:modelValue when the active member changes", () => {
      wrapper = mountList([{ id: "child-1", name: "Child One" }], "");
      wrapper.vm.activeMember = "child-1";
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual(["child-1"]);
    });

    it("reflects the modelValue prop as the active member", () => {
      wrapper = mountList([{ id: "child-1", name: "Child One" }], "child-1");
      expect(wrapper.vm.activeMember).toBe("child-1");
    });
  });
});
