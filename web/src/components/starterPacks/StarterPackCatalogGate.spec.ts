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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import i18n from "@/locales";

const fake = vi.hoisted(() => ({ state: null as any, load: null as any, ids: [] as string[] }));
vi.mock("@/composables/starterPacks/usePackCatalog", () => ({
  get packCatalogState() {
    return fake.state;
  },
  loadPackCatalog: (org: string) => fake.load(org),
  packById: (id: string) => (fake.ids.includes(id) ? { id } : undefined),
}));

import StarterPackCatalogGate from "./StarterPackCatalogGate.vue";

const render = async (props: Record<string, unknown> = {}) => {
  const wrapper = mount(StarterPackCatalogGate, {
    props: { org: "default", ...props },
    slots: { default: '<div data-test="gated-content" />' },
    global: { plugins: [i18n] },
  });
  await flushPromises();
  return wrapper;
};

describe("StarterPackCatalogGate", () => {
  beforeEach(() => {
    fake.ids = ["kubernetes"];
    fake.state = ref("idle");
    fake.load = vi.fn(async () => {
      fake.state.value = "ready";
      return true;
    });
  });

  it("loads the catalog for its org and renders its content once it is ready", async () => {
    const wrapper = await render();
    expect(fake.load).toHaveBeenCalledWith("default");
    expect(wrapper.find('[data-test="gated-content"]').exists()).toBe(true);
  });

  it("renders nothing while the catalog loads", async () => {
    fake.load = vi.fn(() => {
      fake.state.value = "loading";
      return new Promise(() => {});
    });
    const wrapper = await render();
    expect(wrapper.find('[data-test="gated-content"]').exists()).toBe(false);
  });

  it("shows nothing on a failed load", async () => {
    fake.load = vi.fn(async () => {
      fake.state.value = "error";
      return false;
    });
    const wrapper = await render();
    expect(wrapper.find('[data-test="gated-content"]').exists()).toBe(false);
  });

  it("waits for an org before loading, then loads once it is set", async () => {
    const wrapper = await render({ org: undefined });
    expect(fake.load).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="gated-content"]').exists()).toBe(false);

    await wrapper.setProps({ org: "default" });
    await flushPromises();
    expect(fake.load).toHaveBeenCalledWith("default");
    expect(wrapper.find('[data-test="gated-content"]').exists()).toBe(true);
  });

  it("renders nothing when none of the packs its content needs is in the catalog", async () => {
    expect(
      (await render({ requires: "kubernetes" })).find('[data-test="gated-content"]').exists(),
    ).toBe(true);
    expect(
      (await render({ requires: ["", "kubernetes"] })).find('[data-test="gated-content"]').exists(),
    ).toBe(true);
    fake.ids = [];
    expect(
      (await render({ requires: "kubernetes" })).find('[data-test="gated-content"]').exists(),
    ).toBe(false);
  });
});
