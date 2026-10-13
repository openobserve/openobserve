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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { createStore } from "vuex";
import config from "@/aws-exports";
import common from "@/services/common";
import downtimes from "@/services/downtimes";
import { queryClient } from "@/composables/query/queryClient";
import { useDefaultDowntimeFolder } from "./useDefaultDowntimeFolder";
import { useDowntimeLookup } from "./useDowntimeLookup";
import { useQuickMute } from "./useQuickMute";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "false", isCloud: "false" } }));
vi.mock("@/services/common", () => ({ default: { list_Folders: vi.fn() } }));
vi.mock("@/services/downtimes", () => ({ default: { list: vi.fn() } }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const store = (downtimesEnabled: boolean) =>
  createStore({
    state: {
      selectedOrganization: { identifier: "acme" },
      zoConfig: { downtimes_enabled: downtimesEnabled },
    },
  });

// What the Alerts and Synthetics lists (Mute action) and the Incidents pages (muted chip) mount.
const mountPageComposables = (downtimesEnabled: boolean, muted: boolean) => {
  const Page = defineComponent({
    setup() {
      useQuickMute();
      useDowntimeLookup(ref(muted));
      return {};
    },
    template: "<div />",
  });
  return mount(Page, { global: { plugins: [store(downtimesEnabled)] } });
};

const build = (enterprise: boolean) => {
  (config as Record<string, string>).isEnterprise = enterprise ? "true" : "false";
};

describe("downtime reads on pages that work without downtimes", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(common.list_Folders)
      .mockReset()
      .mockResolvedValue({ data: { list: [] } } as any);
    vi.mocked(downtimes.list)
      .mockReset()
      .mockResolvedValue({ data: { items: [] } } as any);
  });

  it("an OSS build issues no downtime request", async () => {
    build(false);
    mountPageComposables(true, true);
    await flushPromises();
    expect(common.list_Folders).not.toHaveBeenCalled();
    expect(downtimes.list).not.toHaveBeenCalled();
  });

  it("an enterprise build with the feature off issues none either", async () => {
    build(true);
    mountPageComposables(false, true);
    await flushPromises();
    expect(common.list_Folders).not.toHaveBeenCalled();
    expect(downtimes.list).not.toHaveBeenCalled();
  });

  it("lists downtimes only for a muted row, and without the access toast", async () => {
    build(true);
    mountPageComposables(true, false);
    await flushPromises();
    expect(downtimes.list).not.toHaveBeenCalled();
    expect(common.list_Folders).not.toHaveBeenCalled();

    queryClient.clear();
    mountPageComposables(true, true);
    await flushPromises();
    expect(downtimes.list).toHaveBeenCalledWith("acme", expect.any(Object), {
      skipAccessToast: true,
    });
  });

  it("the create form still reads the permitted folders at once, and only with the feature on", async () => {
    const Form = defineComponent({
      setup() {
        useDefaultDowntimeFolder();
        return {};
      },
      template: "<div />",
    });
    build(false);
    mount(Form, { global: { plugins: [store(true)] } });
    await flushPromises();
    expect(common.list_Folders).not.toHaveBeenCalled();

    build(true);
    mount(Form, { global: { plugins: [store(true)] } });
    await flushPromises();
    expect(common.list_Folders).toHaveBeenCalledWith("acme", "downtimes");
  });
});
