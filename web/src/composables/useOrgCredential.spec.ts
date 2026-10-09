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
import { defineComponent, h, ref, type Ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { queryClient } from "@/composables/query/queryClient";
import { useOrgCredential } from "./useOrgCredential";

const api = vi.hoisted(() => ({
  get_organization_passcode: vi.fn(),
  list_org_ingestion_tokens: vi.fn(),
}));
vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: api });
});

const ORG = "acme-prod";
const TOKEN_A = { name: "default", token: "org-token-a", enabled: true };
const TOKEN_B = { name: "ci", token: "org-token-b", enabled: true };
const DISABLED = { name: "old", token: "org-token-old", enabled: false };

const makeStore = () =>
  createStore({
    state: {
      selectedOrganization: { identifier: ORG },
      organizationData: {
        organizationPasscode: "",
        organizationPasscodeForbidden: false,
        orgTokens: [] as unknown[],
      },
    },
    mutations: {
      setOrganizationPasscode(state: any, v: string) {
        state.organizationData.organizationPasscode = v;
      },
      setOrganizationPasscodeUser() {},
      setOrganizationPasscodeForbidden(state: any, v: boolean) {
        state.organizationData.organizationPasscodeForbidden = v;
      },
      setOrgTokens(state: any, v: unknown[]) {
        state.organizationData.orgTokens = v;
      },
    },
    actions: Object.fromEntries(
      [
        "setOrganizationPasscode",
        "setOrganizationPasscodeUser",
        "setOrganizationPasscodeForbidden",
        "setOrgTokens",
      ].map((name) => [name, ({ commit }: any, v: unknown) => commit(name, v)]),
    ),
  });

let store: ReturnType<typeof makeStore>;
const wrappers: VueWrapper[] = [];

const later = <T>(value: T, ms: number) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
const settle = async (ms = 0) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await flushPromises();
};

const consumer = (enabled: Ref<boolean> | boolean = true) => {
  let api: ReturnType<typeof useOrgCredential> | undefined;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useOrgCredential(enabled);
        return () => h("div");
      },
    }),
    { global: { plugins: [store] } },
  );
  wrappers.push(wrapper);
  return api!;
};

const passcode = () => store.state.organizationData.organizationPasscode;

beforeEach(() => {
  store = makeStore();
  api.list_org_ingestion_tokens.mockResolvedValue({ data: { data: [TOKEN_A, TOKEN_B] } });
  api.get_organization_passcode.mockResolvedValue({
    data: { data: { passcode: "user-passcode", user: "dev@acme.io" } },
  });
});

afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount());
  queryClient.clear();
  vi.clearAllMocks();
});

describe("useOrgCredential", () => {
  it("publishes the first enabled org token even when /passcode answers last", async () => {
    api.list_org_ingestion_tokens.mockResolvedValue({ data: { data: [DISABLED, TOKEN_A] } });
    api.get_organization_passcode.mockReturnValue(
      later({ data: { data: { passcode: "user-passcode", user: "dev@acme.io" } } }, 5),
    );
    const credential = consumer();
    await settle(10);
    expect(passcode()).toBe(TOKEN_A.token);
    expect(credential.ready.value).toBe(true);
    expect(credential.pickedName.value).toBe("default");
  });

  it("publishes the user passcode only when the org has no enabled token", async () => {
    api.list_org_ingestion_tokens.mockResolvedValue({ data: { data: [DISABLED] } });
    consumer();
    await settle();
    expect(passcode()).toBe("user-passcode");
  });

  it("is not ready, and publishes nothing, until both reads settled", async () => {
    api.get_organization_passcode.mockReturnValue(new Promise(() => {}));
    const credential = consumer();
    await settle();
    expect(credential.ready.value).toBe(false);
    expect(passcode()).toBe("");
  });

  it("asks once per org for every consumer on the page", async () => {
    consumer();
    consumer();
    await settle();
    consumer();
    await settle();
    expect(api.get_organization_passcode).toHaveBeenCalledTimes(1);
    expect(api.list_org_ingestion_tokens).toHaveBeenCalledTimes(1);
  });

  it("asks nothing while disabled, and loads once enabled", async () => {
    const enabled = ref(false);
    const credential = consumer(enabled);
    await settle();
    expect(api.get_organization_passcode).not.toHaveBeenCalled();
    enabled.value = true;
    await settle();
    expect(credential.ready.value).toBe(true);
    expect(passcode()).toBe(TOKEN_A.token);
  });

  it("keeps a picked token for every consumer, over a later /passcode read", async () => {
    const page = consumer();
    await settle();
    page.pickToken("ci");
    expect(passcode()).toBe(TOKEN_B.token);

    queryClient.clear();
    const home = consumer();
    await home.load();
    await settle();
    expect(passcode()).toBe(TOKEN_B.token);
    expect(home.pickedName.value).toBe("ci");
  });

  it("withholds the credential on a /passcode 403 and never publishes a token", async () => {
    api.get_organization_passcode.mockRejectedValue({ response: { status: 403 } });
    const credential = consumer();
    await settle();
    credential.pickToken("ci");
    expect(store.state.organizationData.organizationPasscodeForbidden).toBe(true);
    expect(passcode()).toBe("");
  });

  it("falls back to the next enabled token when the picked one is disabled", async () => {
    const credential = consumer();
    await settle();
    credential.pickToken("ci");
    store.dispatch("setOrgTokens", [TOKEN_A, { ...TOKEN_B, enabled: false }]);
    await settle();
    expect(passcode()).toBe(TOKEN_A.token);
  });

  it("starts afresh for another org", async () => {
    const credential = consumer();
    await settle();
    credential.pickToken("ci");
    api.list_org_ingestion_tokens.mockResolvedValue({ data: { data: [] } });
    store.state.selectedOrganization = { identifier: "other-org" };
    await settle();
    expect(api.get_organization_passcode).toHaveBeenLastCalledWith("other-org");
    expect(passcode()).toBe("user-passcode");
    expect(credential.pickedName.value).toBe("");
  });
});
