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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import StreamPickerFooter from "@/components/common/StreamPickerFooter.vue";
import { useHideInternalStreams } from "@/composables/useHideInternalStreams";

const KEY = "o2:hideInternalStreams:footer@example.com:footer-org";
const DT = "stream-picker";

const store = createStore({
  state: {
    userInfo: { email: "footer@example.com" },
    selectedOrganization: { identifier: "footer-org" },
  },
});

let setting!: ReturnType<typeof useHideInternalStreams>;
const Probe = defineComponent({
  setup() {
    setting = useHideInternalStreams();
    return () => h("div");
  },
});

const mounted: VueWrapper[] = [];

const mountFooter = (props: Record<string, unknown> = {}) => {
  const wrapper = mount(StreamPickerFooter, {
    props,
    global: { plugins: [store, i18n] },
  });
  mounted.push(wrapper);
  return wrapper;
};

const byTest = (wrapper: VueWrapper, id: string) => wrapper.find(`[data-test="${DT}-${id}"]`);

describe("StreamPickerFooter", () => {
  beforeEach(() => {
    localStorage.clear();
    mounted.push(mount(Probe, { global: { plugins: [store] } }));
    setting.hideInternalStreams.value = false;
  });

  afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
    localStorage.clear();
  });

  it("renders the labelled switch reflecting the shared setting", async () => {
    setting.hideInternalStreams.value = true;
    const wrapper = mountFooter();
    const button = byTest(wrapper, "hide-internal-switch-btn");
    expect(button.attributes("role")).toBe("switch");
    expect(button.attributes("aria-checked")).toBe("true");
    expect(wrapper.text()).toContain("Hide internal streams");
  });

  it("toggles the shared setting and persists it", async () => {
    const wrapper = mountFooter();
    await byTest(wrapper, "hide-internal-switch").trigger("click");
    expect(setting.hideInternalStreams.value).toBe(true);
    expect(localStorage.getItem(KEY)).toBe("true");
    await byTest(wrapper, "hide-internal-switch").trigger("click");
    expect(setting.hideInternalStreams.value).toBe(false);
  });

  it("announces the change in a polite live region", async () => {
    const wrapper = mountFooter();
    const live = byTest(wrapper, "announcement");
    expect(live.attributes("aria-live")).toBe("polite");
    expect(live.text()).toBe("");
    await byTest(wrapper, "hide-internal-switch").trigger("click");
    expect(live.text()).toBe("Internal streams hidden");
    await byTest(wrapper, "hide-internal-switch").trigger("click");
    expect(live.text()).toBe("Internal streams shown");
  });

  it("shows the hidden count and describes the switch with it", () => {
    setting.hideInternalStreams.value = true;
    const wrapper = mountFooter({ hiddenCount: 3 });
    const count = byTest(wrapper, "hidden-count");
    expect(count.text()).toBe("3 hidden");
    expect(count.attributes("id")).toBeTruthy();
    expect(byTest(wrapper, "hide-internal-switch-btn").attributes("aria-describedby")).toBe(
      count.attributes("id"),
    );
  });

  it("shows no count and no description when nothing is hidden", () => {
    const wrapper = mountFooter({ hiddenCount: 0 });
    expect(byTest(wrapper, "hidden-count").exists()).toBe(false);
    expect(byTest(wrapper, "search-match-count").exists()).toBe(false);
    expect(
      byTest(wrapper, "hide-internal-switch-btn").attributes("aria-describedby"),
    ).toBeUndefined();
  });

  it("leaves the count to the empty state when every stream is internal and hidden", () => {
    const wrapper = mountFooter({ hiddenCount: 3, onlyInternalHidden: true });
    expect(byTest(wrapper, "hidden-count").exists()).toBe(false);
  });

  it("replaces the hidden count with the search-match line while a search matches hidden streams", () => {
    setting.hideInternalStreams.value = true;
    const wrapper = mountFooter({ hiddenCount: 3, searchMatchCount: 2 });
    expect(byTest(wrapper, "hidden-count").exists()).toBe(false);
    const match = byTest(wrapper, "search-match-count");
    expect(match.text()).toBe("2 internal streams match");
    expect(byTest(wrapper, "hide-internal-switch-btn").attributes("aria-describedby")).toBe(
      match.attributes("id"),
    );
  });

  it("uses the singular for one search match", () => {
    const wrapper = mountFooter({ searchMatchCount: 1 });
    expect(byTest(wrapper, "search-match-count").text()).toBe("1 internal stream matches");
  });

  it("Show turns the saved setting off", async () => {
    setting.hideInternalStreams.value = true;
    const wrapper = mountFooter({ hiddenCount: 3, searchMatchCount: 2 });
    const show = byTest(wrapper, "show-btn");
    expect(show.text()).toBe("Show");
    expect(show.attributes("aria-label")).toBe("Show internal streams");
    await show.trigger("click");
    expect(setting.hideInternalStreams.value).toBe(false);
    expect(localStorage.getItem(KEY)).toBe("false");
    expect(byTest(wrapper, "announcement").text()).toBe("Internal streams shown");
  });

  describe("empty variant", () => {
    it("states how many streams are internal and hidden", () => {
      const wrapper = mountFooter({ variant: "empty", hiddenCount: 3 });
      const empty = byTest(wrapper, "all-internal-hidden");
      expect(empty.text()).toContain("All 3 streams are internal and hidden");
      expect(empty.find("span").classes()).toContain("text-text-secondary");
      expect(byTest(wrapper, "hide-internal-switch").exists()).toBe(false);
    });

    it("uses the singular for a lone stream", () => {
      const wrapper = mountFooter({ variant: "empty", hiddenCount: 1 });
      expect(byTest(wrapper, "all-internal-hidden").text()).toContain(
        "The only stream is internal and hidden",
      );
    });

    it("Show turns the saved setting off", async () => {
      setting.hideInternalStreams.value = true;
      const wrapper = mountFooter({ variant: "empty", hiddenCount: 3 });
      await byTest(wrapper, "empty-show-btn").trigger("click");
      expect(setting.hideInternalStreams.value).toBe(false);
    });
  });

  it("prefixes every data-test with the picker's id", () => {
    const wrapper = mountFooter({ dataTest: "logs-picker", hiddenCount: 2 });
    expect(wrapper.find('[data-test="logs-picker-footer"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="logs-picker-hide-internal-switch"]').exists()).toBe(true);
  });
});
