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
import SecretPicker from "./SecretPicker.vue";
import secrets, { type SecretPickerItem } from "@/services/secrets";
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

vi.mock("@/services/secrets", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, default: { picker: vi.fn(), status: vi.fn() } };
});

const item = (over: Partial<SecretPickerItem>): SecretPickerItem => ({
  id: over.name ?? "x",
  name: "X",
  kind: "secret",
  pin_mode: "hosts",
  private_locations: "off",
  allowed_here: true,
  ...over,
});

const mountOpen = async (items: SecretPickerItem[], fga: "on" | "off" = "on") => {
  vi.mocked(secrets.picker).mockResolvedValue({ data: { items } } as any);
  vi.mocked(secrets.status).mockResolvedValue({
    data: { mode: "single_cluster", region: "", store_ready: true, fga },
  } as any);
  const w: any = mount(SecretPicker, {
    props: { consumerType: "alert_destination", consumerId: "pd-checkout" },
    global: {
      plugins: [i18n, store, router],
      provide: { store },
      stubs: {
        OPopover: { template: "<div><slot name='trigger' /><slot /></div>" },
        RouterLink: { template: "<a><slot /></a>" },
      },
    },
  });
  w.vm.$.setupState.open = true;
  await flushPromises();
  return w;
};

describe("SecretPicker (U1, U1f, U7)", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("sends the typed search to the server (T40)", async () => {
    const w = await mountOpen([item({ name: "PAGERDUTY_ROUTING_KEY" })]);
    w.vm.$.setupState.search = "PAGER";
    await vi.waitFor(() =>
      expect(secrets.picker).toHaveBeenCalledWith("default", "alert_destination", "pd-checkout", {
        q: "PAGER",
      }),
    );
  });

  it("sends an unsaved check's locations so the server judges them, not the saved ones (T28)", async () => {
    vi.mocked(secrets.picker).mockResolvedValue({ data: { items: [] } } as any);
    vi.mocked(secrets.status).mockResolvedValue({ data: { fga: "on" } } as any);
    const w: any = mount(SecretPicker, {
      props: { consumerType: "synthetics_check", locations: ["us-east-1", "loc_private"] },
      global: {
        plugins: [i18n, store, router],
        provide: { store },
        stubs: {
          OPopover: { template: "<div><slot name='trigger' /><slot /></div>" },
          RouterLink: { template: "<a><slot /></a>" },
        },
      },
    });
    w.vm.$.setupState.open = true;
    await flushPromises();
    expect(secrets.picker).toHaveBeenCalledWith("default", "synthetics_check", undefined, {
      locations: "us-east-1,loc_private",
    });
  });

  it("asks for usable_by with this consumer and lists names with pin state only", async () => {
    const w = await mountOpen([
      item({ name: "PAGERDUTY_ROUTING_KEY" }),
      item({ name: "SNOW_CHANGES_BASIC", pin_mode: "none" }),
      item({ name: "SERVICENOW_INSTANCE", kind: "variable" }),
    ]);
    expect(secrets.picker).toHaveBeenCalledWith("default", "alert_destination", "pd-checkout", {});
    expect(w.find("[data-test='secret-picker-item-PAGERDUTY_ROUTING_KEY-badge']").text()).toBe(
      "Pinned",
    );
    expect(w.find("[data-test='secret-picker-item-SNOW_CHANGES_BASIC-badge']").text()).toBe(
      "Pin on first use",
    );
    expect(w.text()).toContain("Variables");
  });

  it("disables an any-host secret for a caller without manage access (V40)", async () => {
    const w = await mountOpen([
      item({ name: "SERVICENOW_BASIC", pin_mode: "any", rights: { manage: true } }),
    ]);
    const btn = w.find("[data-test='secret-picker-item-SERVICENOW_BASIC']");
    expect(btn.attributes("disabled")).toBeDefined();
    expect(w.find("[data-test='secret-picker-item-SERVICENOW_BASIC-badge']").text()).toBe(
      "Any host",
    );
    await btn.trigger("click");
    expect(w.emitted("pick")).toBeUndefined();
  });

  it("enables an any-host secret for a manage-access holder", async () => {
    const w = await mountOpen([
      item({ name: "SERVICENOW_BASIC", pin_mode: "any", rights: { manage_access: true } }),
    ]);
    const btn = w.find("[data-test='secret-picker-item-SERVICENOW_BASIC']");
    expect(btn.attributes("disabled")).toBeUndefined();
    await btn.trigger("click");
    expect(w.emitted("pick")?.[0]?.[0]).toMatchObject({ name: "SERVICENOW_BASIC" });
  });

  it("with requireManage, disables a secret the caller can't manage (T1)", async () => {
    const w = await mountOpen([
      item({ name: "OPENAI_KEY", rights: { manage: false } }),
      item({ name: "GITHUB_TOKEN", rights: { manage: true } }),
    ]);
    await w.setProps({ requireManage: true });
    const off = w.find("[data-test='secret-picker-item-OPENAI_KEY']");
    expect(off.attributes("disabled")).toBeDefined();
    expect(off.attributes("title")).toContain("Needs manage");
    expect(
      w.find("[data-test='secret-picker-item-GITHUB_TOKEN']").attributes("disabled"),
    ).toBeUndefined();
  });

  it("disables a secret not allowed for this consumer", async () => {
    const w = await mountOpen([item({ name: "SLACK_WEBHOOK_PATH", allowed_here: false })]);
    expect(
      w.find("[data-test='secret-picker-item-SLACK_WEBHOOK_PATH']").attributes("disabled"),
    ).toBeDefined();
  });

  it("is empty with the FGA-off copy when nothing is usable (U1f)", async () => {
    const w = await mountOpen([], "off");
    expect(w.find("[data-test='secret-picker-empty']").text()).toContain(
      "Only org admins can use secrets",
    );
  });

  it("enables a not-allowed secret for a manage-access holder, who can allow this destination", async () => {
    const w = await mountOpen([
      item({ name: "SLACK_WEBHOOK_PATH", allowed_here: false, rights: { manage_access: true } }),
    ]);
    expect(
      w.find("[data-test='secret-picker-item-SLACK_WEBHOOK_PATH']").attributes("disabled"),
    ).toBeUndefined();
  });

  it("marks a secret allowed on private locations in a check's picker (V41)", async () => {
    vi.mocked(secrets.picker).mockResolvedValue({
      data: {
        items: [
          item({ name: "API_TOKEN", private_locations: "on" }),
          item({ name: "DEPLOY_TOKEN" }),
        ],
      },
    } as any);
    vi.mocked(secrets.status).mockResolvedValue({ data: { fga: "on" } } as any);
    const w: any = mount(SecretPicker, {
      props: { consumerType: "synthetics_check" },
      global: {
        plugins: [i18n, store, router],
        provide: { store },
        stubs: {
          OPopover: { template: "<div><slot name='trigger' /><slot /></div>" },
          RouterLink: { template: "<a><slot /></a>" },
        },
      },
    });
    w.vm.$.setupState.open = true;
    await flushPromises();
    expect(w.find("[data-test='secret-picker-item-API_TOKEN-private-locations']").text()).toBe(
      "Private locations",
    );
    expect(w.find("[data-test='secret-picker-item-DEPLOY_TOKEN-private-locations']").exists()).toBe(
      false,
    );
  });

  it("keeps the private-locations badge out of a destination's picker", async () => {
    const w = await mountOpen([item({ name: "API_TOKEN", private_locations: "on" })]);
    expect(w.find("[data-test='secret-picker-item-API_TOKEN-private-locations']").exists()).toBe(
      false,
    );
  });
});
