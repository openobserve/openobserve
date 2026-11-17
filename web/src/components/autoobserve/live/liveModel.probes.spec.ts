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
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import config from "@/aws-exports";
import autoobserve from "@/services/autoobserve";
import { queryClient } from "@/composables/query/queryClient";

const probes = vi.hoisted(() => ({ probe: vi.fn(async () => {}), cancel: vi.fn() }));

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRoute: () => ({ query: { live: "1" } }),
}));
vi.mock("@/services/autoobserve", () => ({
  default: { coverage: vi.fn(), suggestions: vi.fn() },
}));
vi.mock("../insight/targets/scopeMatch", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  probeScopes: probes.probe,
  cancelProbes: probes.cancel,
}));

const { useLiveAutoObserve } = await import("./liveModel");

const coverage = {
  view: "strict",
  pass_at: Date.UTC(2026, 10, 2, 10, 0) * 1000,
  refreshed_at: null,
  quality: null,
  classes: [],
  rows: [],
};

const active = ref(true);
const Harness = defineComponent({
  setup() {
    useLiveAutoObserve({ active: () => active.value });
    return () => h("span");
  },
});

let enterprise: string;
let home: string;
beforeEach(() => {
  enterprise = config.isEnterprise;
  config.isEnterprise = "true";
  home = store.state.selectedOrganization.identifier;
  active.value = true;
  queryClient.clear();
  probes.probe.mockClear();
  probes.cancel.mockClear();
  vi.mocked(autoobserve.coverage).mockResolvedValue({ data: coverage } as never);
  vi.mocked(autoobserve.suggestions).mockResolvedValue({
    data: { suggestions: [], total: 0, limit: 5, offset: 0 },
  } as never);
});
afterEach(() => {
  config.isEnterprise = enterprise;
  store.state.selectedOrganization.identifier = home;
});

describe("the home page's match probes stop with the page", () => {
  it("probes once coverage loads, and cancels them on unmount or route leave", async () => {
    const wrapper = mount(Harness, { global: { plugins: [i18n, store] } });
    await flushPromises();
    expect(probes.probe).toHaveBeenCalled();
    probes.cancel.mockClear();
    wrapper.unmount();
    expect(probes.cancel).toHaveBeenCalled();
  });

  it("cancels them on an org switch", async () => {
    const wrapper = mount(Harness, { global: { plugins: [i18n, store] } });
    await flushPromises();
    probes.cancel.mockClear();
    store.state.selectedOrganization.identifier = "elsewhere-org";
    await flushPromises();
    expect(probes.cancel).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("cancels them when the page stops showing the home", async () => {
    const wrapper = mount(Harness, { global: { plugins: [i18n, store] } });
    await flushPromises();
    probes.cancel.mockClear();
    active.value = false;
    await flushPromises();
    expect(probes.cancel).toHaveBeenCalled();
    wrapper.unmount();
  });
});
