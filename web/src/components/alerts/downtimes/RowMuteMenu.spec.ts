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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { dropdownStubs } from "@/test/unit/helpers/dropdownStubs";
import RowMuteMenu from "./RowMuteMenu.vue";

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const own = {
  id: "d1",
  name: "Quick mute",
  ends_at: 4_102_444_800_000_000,
  version: 3,
  folder_id: "ops",
  end_here: true,
};

let wrapper: VueWrapper<any>;

const mountMenu = async (props: Record<string, unknown> = {}) => {
  wrapper = mount(RowMuteMenu, {
    props: {
      downtime: own,
      extendTestPrefix: "row-extend",
      endTest: "row-end-mute",
      mutedByTest: "row-muted-by",
      ...props,
    },
    global: { plugins: [i18n, store], stubs: dropdownStubs },
  });
  await flushPromises();
  return wrapper;
};

const find = (test: string) => wrapper.find(`[data-test="${test}"]`);

describe("RowMuteMenu", () => {
  beforeEach(() => push.mockReset());
  afterEach(() => wrapper?.unmount());

  it("offers Extend and End mute for a mute this row owns, and emits them", async () => {
    await mountMenu();
    expect(find("row-extend-1h").exists()).toBe(true);
    expect(find("row-extend-until").exists()).toBe(true);
    expect(find("row-extend-until-clear").exists()).toBe(false);
    expect(find("row-end-mute").text()).toBe("End mute now");
    expect(find("row-muted-by").exists()).toBe(false);
    await find("row-extend-1h").trigger("click");
    await find("row-extend-until").trigger("click");
    await find("row-end-mute").trigger("click");
    expect(wrapper.emitted("preset")).toEqual([[3600]]);
    expect(wrapper.emitted("until")).toHaveLength(1);
    expect(wrapper.emitted("end")).toHaveLength(1);
  });

  it("offers Until it clears only where the caller asks for it, for an alert", async () => {
    await mountMenu({ untilClear: true });
    await find("row-extend-until-clear").trigger("click");
    expect(wrapper.emitted("untilClear")).toHaveLength(1);
  });

  it("counts the groups a parent row ends", async () => {
    const groups = [
      { alert_id: "a1", group_key: "k1" },
      { alert_id: "a1", group_key: "k2" },
    ];
    await mountMenu({ downtime: { ...own, alert_groups: groups }, countGroups: true });
    expect(find("row-end-mute").text()).toBe("End mute (2 groups)");
    await mountMenu({ downtime: { ...own, alert_groups: groups } });
    expect(find("row-end-mute").text()).toBe("End mute now");
  });

  it("shows only Muted by for a shared downtime, which opens it in its own folder", async () => {
    await mountMenu({ downtime: { ...own, name: "Weekly patch window", end_here: false } });
    expect(find("row-extend-1h").exists()).toBe(false);
    expect(find("row-end-mute").exists()).toBe(false);
    expect(find("row-muted-by").text()).toBe("Muted by Weekly patch window");
    await find("row-muted-by").trigger("click");
    expect(push).toHaveBeenCalledWith({
      name: "downtimeDetail",
      params: { id: "d1" },
      query: { org_identifier: "default", folder: "ops" },
    });
  });

  it("reads a chip from an older node, with no end_here, as shared", async () => {
    const { end_here: _ignored, ...old } = own;
    await mountMenu({ downtime: old });
    expect(find("row-end-mute").exists()).toBe(false);
    expect(find("row-muted-by").exists()).toBe(true);
  });
});
