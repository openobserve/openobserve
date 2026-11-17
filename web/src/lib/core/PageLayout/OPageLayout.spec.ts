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

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h, KeepAlive, nextTick, ref } from "vue";
import OPageLayout from "./OPageLayout.vue";
import { provideFeatureLock } from "@/composables/useFeatureLock";
import { PAGE_ENTRANCE_KEY } from "./pageEntrance";

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));

const i18n = createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false });

const SLIDE = "motion-safe:slide-in-from-bottom-1";

const mountLayout = (entering?: () => boolean) =>
  mount(OPageLayout, {
    props: { title: "Page" },
    slots: { default: '<div data-test="page-body-content" />' },
    global: { plugins: [i18n], provide: entering ? { [PAGE_ENTRANCE_KEY]: entering } : {} },
  });
const bodyOf = (root: { find: (s: string) => { element: Element } }) =>
  root.find('[data-test="page-body-content"]').element.parentElement!;

describe("OPageLayout entrance", () => {
  it("slides the body in while the header stays still", () => {
    const wrapper = mountLayout();
    const body = wrapper.find('[data-test="page-body-content"]').element.parentElement!;

    expect(body.className).toContain("motion-safe:slide-in-from-bottom-1");
    expect(wrapper.find("header, [data-test*='header']").classes()).not.toContain(
      "motion-safe:slide-in-from-bottom-1",
    );
  });

  it("shows the license message without the slide while the page is locked", () => {
    const wrapper = mount(
      defineComponent({
        setup() {
          provideFeatureLock(ref("workflows"));
          return () => h(OPageLayout, { title: "Page" }, { default: () => h("div") });
        },
      }),
      { global: { plugins: [i18n] } },
    );

    expect(wrapper.find('[data-test="page-layout-license-locked"]').exists()).toBe(true);
    expect(wrapper.html()).not.toContain("slide-in-from-bottom-1");
  });

  it("slides in on a fresh navigation and not on a Back/Forward restore", () => {
    expect(bodyOf(mountLayout(() => true)).className).toContain(SLIDE);
    expect(bodyOf(mountLayout(() => false)).className).not.toContain(SLIDE);
  });

  it("slides in on a kept view's first visit, not on its keep-alive return", async () => {
    let entering = true;
    const shown = ref(true);
    const Page = defineComponent({
      name: "KeptPage",
      render: () =>
        h(OPageLayout, { title: "Page" }, () => h("div", { "data-test": "page-body-content" })),
    });
    const wrapper = mount(
      defineComponent({ render: () => h(KeepAlive, null, [shown.value ? h(Page) : h("div")]) }),
      { global: { plugins: [i18n], provide: { [PAGE_ENTRANCE_KEY]: () => entering } } },
    );
    expect(bodyOf(wrapper).className).toContain(SLIDE);

    shown.value = false;
    await nextTick();
    entering = false;
    shown.value = true;
    await nextTick();
    await nextTick();
    expect(bodyOf(wrapper).className).not.toContain(SLIDE);
    wrapper.unmount();
  });
});
