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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import SecretStoreStatusPage from "./SecretStoreStatusPage.vue";
import secrets from "@/services/secrets";
import users from "@/services/users";
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

vi.mock("@/services/secrets", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, default: { metaStatus: vi.fn() } };
});

vi.mock("@/services/users", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, default: { ...actual.default, orgUsers: vi.fn() } };
});

// Native login leaves `currentuser.role` empty, so the role comes from the org's user list.
const asRole = (role: string) =>
  vi.mocked(users.orgUsers).mockResolvedValue({
    data: { data: [{ email: "example@gmail.com", role }] },
  } as any);

const mountPage = async () => {
  const w = mount(SecretStoreStatusPage, {
    global: {
      plugins: [i18n, store, router],
      provide: { store },
      stubs: {
        ORefreshButton: true,
        OTable: {
          props: ["data"],
          template: `<div><div v-for="r in data" :key="r.node" :data-test="'node-' + r.node">{{ r.node }} {{ r.level }}</div></div>`,
        },
      },
    },
  });
  await flushPromises();
  return w;
};

describe("SecretStoreStatusPage (A8r)", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    store.state.currentuser.role = "";
  });

  it("shows nothing but a root-only note to a non-root user", async () => {
    asRole("admin");
    const w = await mountPage();
    expect(w.find("[data-test='secret-store-status-root-only']").exists()).toBe(true);
    expect(secrets.metaStatus).not.toHaveBeenCalled();
  });

  it("shows the gate, node levels and the behind-node warning to root", async () => {
    asRole("root");
    vi.mocked(secrets.metaStatus).mockResolvedValue({
      data: {
        gate: "writable",
        nodes: [
          { node: "o2-querier-0", level: 1, refs_enabled: true, fga_mode: "on" },
          { node: "o2-alertmanager-0", level: 0, refs_enabled: false, fga_mode: "on" },
        ],
        unprefixed_cipher_rows: 214,
        aesenc_system_rows: 2,
        wrap_floor: "o2w2",
      },
    } as any);
    const w = await mountPage();
    expect(w.find("[data-test='secret-store-status-gate']").text()).toBe("Writable");
    expect(w.find("[data-test='node-o2-alertmanager-0']").exists()).toBe(true);
    expect(w.find("[data-test='secret-store-status-behind']").text()).toContain("1 node is older");
    expect(w.find("[data-test='secret-store-status-facts']").text()).toContain("214");
  });
});
