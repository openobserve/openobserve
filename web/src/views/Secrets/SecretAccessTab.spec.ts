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
import SecretAccessTab from "./SecretAccessTab.vue";
import secrets, { type SecretDetail } from "@/services/secrets";
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { toast } from "@/lib/feedback/Toast/useToast";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

vi.mock("@/services/secrets", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, default: { getGrants: vi.fn(), putGrants: vi.fn() } };
});
vi.mock("@/services/iam", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, getRoles: vi.fn(async () => ({ data: ["sre", "secops", "ops"] })) };
});

const detail = {
  id: "s1",
  name: "PD_KEY",
  kind: "secret",
  rights: { see: true, use: true, manage: true, manage_access: true },
} as SecretDetail;

const OTableStub = {
  props: ["data"],
  template: `<div><div v-for="r in data" :key="r.role" :data-test="'row-' + r.role">
    <slot name="cell-role" :row="r" />
    <slot name="cell-see" :row="r" /><slot name="cell-use" :row="r" />
    <slot name="cell-manage" :row="r" /><slot name="cell-manage_access" :row="r" />
    <slot name="cell-remove" :row="r" /></div></div>`,
};

const mountTab = async (fgaOff = false, d: SecretDetail = detail) => {
  const w = mount(SecretAccessTab, {
    props: { detail: d, fgaOff },
    global: { plugins: [i18n, store, router], provide: { store }, stubs: { OTable: OTableStub } },
  });
  await flushPromises();
  return w;
};

describe("SecretAccessTab", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    vi.mocked(secrets.putGrants).mockReset();
  });

  it("shows the FGA-off state and never reads grants when status says fga off", async () => {
    const w = await mountTab(true);
    expect(w.find("[data-test='secret-access-fga-off']").exists()).toBe(true);
    expect(w.find("[data-test='secret-access-save']").exists()).toBe(false);
    expect(secrets.getGrants).not.toHaveBeenCalled();
  });

  it("shows the FGA-off state on 409 fga_disabled", async () => {
    vi.mocked(secrets.getGrants).mockRejectedValue({
      response: { status: 409, data: { code: "fga_disabled", message: "" } },
    });
    const w = await mountTab();
    expect(w.find("[data-test='secret-access-fga-off']").exists()).toBe(true);
    expect(w.find("[data-test='secret-access-table']").exists()).toBe(false);
  });

  it("lists roles with a fixed admin row and saves an edited grant", async () => {
    vi.mocked(secrets.getGrants).mockResolvedValue({
      data: { see: ["sre"], use: ["sre"], manage: [], manage_access: [], grants_rev: "rev-get" },
    } as any);
    vi.mocked(secrets.putGrants).mockResolvedValue({
      data: {
        see: ["sre"],
        use: ["sre"],
        manage: ["sre"],
        manage_access: [],
        grants_rev: "rev-put",
      },
    } as Awaited<ReturnType<typeof secrets.putGrants>>);
    const w: any = await mountTab();
    expect(w.find("[data-test='row-admin']").text()).toContain("Org admins · always");
    expect(w.find("[data-test='secret-access-sre-remove']").exists()).toBe(true);
    expect(w.find("[data-test='secret-access-admin-remove']").exists()).toBe(false);
    w.vm.$.setupState.setRight("sre", "manage", true);
    await flushPromises();
    await w.find("[data-test='secret-access-save']").trigger("click");
    await flushPromises();
    expect(secrets.putGrants).toHaveBeenCalledWith("default", "s1", {
      see: ["sre"],
      use: ["sre"],
      manage: ["sre"],
      manage_access: [],
      expected_grants_rev: "rev-get",
    });
  });

  it("sends the GET grants revision, then the PUT revision on the next save", async () => {
    const initial = {
      see: ["sre"],
      use: ["sre"],
      manage: [],
      manage_access: [],
      grants_rev: "rev-get",
    };
    vi.mocked(secrets.getGrants).mockResolvedValue({
      data: initial,
    } as Awaited<ReturnType<typeof secrets.getGrants>>);
    vi.mocked(secrets.putGrants)
      .mockResolvedValueOnce({
        data: { ...initial, manage: ["sre"], grants_rev: "rev-put-1" },
      } as Awaited<ReturnType<typeof secrets.putGrants>>)
      .mockResolvedValueOnce({
        data: { ...initial, manage: ["sre"], manage_access: ["sre"], grants_rev: "rev-put-2" },
      } as Awaited<ReturnType<typeof secrets.putGrants>>);
    const w = await mountTab();
    await w.find("[data-test='secret-access-sre-manage'] button").trigger("click");
    await w.find("[data-test='secret-access-save']").trigger("click");
    await flushPromises();
    expect(secrets.putGrants).toHaveBeenNthCalledWith(1, "default", "s1", {
      see: ["sre"],
      use: ["sre"],
      manage: ["sre"],
      manage_access: [],
      expected_grants_rev: "rev-get",
    });
    await w.find("[data-test='secret-access-sre-manage_access'] button").trigger("click");
    await w.find("[data-test='secret-access-save']").trigger("click");
    await flushPromises();
    expect(secrets.putGrants).toHaveBeenNthCalledWith(2, "default", "s1", {
      see: ["sre"],
      use: ["sre"],
      manage: ["sre"],
      manage_access: ["sre"],
      expected_grants_rev: "rev-put-1",
    });
    w.unmount();
  });

  it("shows the existing conflict message for 409 policy_changed", async () => {
    vi.mocked(secrets.getGrants).mockResolvedValue({
      data: { see: ["sre"], use: [], manage: [], manage_access: [], grants_rev: "rev-get" },
    } as Awaited<ReturnType<typeof secrets.getGrants>>);
    vi.mocked(secrets.putGrants).mockRejectedValue({
      response: { status: 409, data: { code: "policy_changed", message: "policy_changed" } },
    });
    const w = await mountTab();
    await w.find("[data-test='secret-access-sre-use'] button").trigger("click");
    await w.find("[data-test='secret-access-save']").trigger("click");
    await flushPromises();
    expect(toast).toHaveBeenCalledWith({
      variant: "error",
      message: "Someone else changed this policy. Reopen it and try again.",
    });
    w.unmount();
  });

  it("shows grant_edit_too_large from the server", async () => {
    vi.mocked(secrets.getGrants).mockResolvedValue({
      data: { see: ["sre"], use: [], manage: [], manage_access: [], grants_rev: "rev-get" },
    } as any);
    vi.mocked(secrets.putGrants).mockRejectedValue({
      response: { status: 400, data: { code: "grant_edit_too_large", message: "" } },
    });
    const w: any = await mountTab();
    w.vm.$.setupState.setRight("sre", "use", true);
    await flushPromises();
    await w.find("[data-test='secret-access-save']").trigger("click");
    await flushPromises();
    expect(w.find("[data-test='secret-access-too-large']").text()).toContain(
      "Save at most 100 role changes",
    );
  });

  it("refuses more than 100 tuple changes before sending", async () => {
    vi.mocked(secrets.getGrants).mockResolvedValue({
      data: { see: [], use: [], manage: [], manage_access: [], grants_rev: "rev-get" },
    } as any);
    const w: any = await mountTab();
    w.vm.$.setupState.rows = Array.from({ length: 26 }, (_, i) => ({
      role: `r${i}`,
      see: true,
      use: true,
      manage: true,
      manage_access: true,
    }));
    await flushPromises();
    expect(w.find("[data-test='secret-access-too-large']").exists()).toBe(true);
    await w.find("[data-test='secret-access-save']").trigger("click");
    await flushPromises();
    expect(secrets.putGrants).not.toHaveBeenCalled();
  });
});

describe("SecretAccessTab rights", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("is read-only without manage access", async () => {
    vi.mocked(secrets.getGrants).mockResolvedValue({
      data: { see: ["sre"], use: ["sre"], manage: [], manage_access: [], grants_rev: "rev-get" },
    } as any);
    const w = await mountTab(false, {
      ...detail,
      rights: { see: true, use: true, manage: true, manage_access: false },
    });
    expect(w.find("[data-test='row-sre']").exists()).toBe(true);
    expect(w.find("[data-test='secret-access-save']").exists()).toBe(false);
    expect(w.find("[data-test='secret-access-sre-remove']").exists()).toBe(false);
    expect(w.find("[data-test='secret-access-add-role']").exists()).toBe(false);
  });
});
