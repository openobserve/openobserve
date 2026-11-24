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
import { createStore } from "vuex";
import i18n from "@/locales";
import config from "@/aws-exports";
import { queryClient } from "@/composables/query/queryClient";

vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { create: vi.fn().mockResolvedValue({ data: {} }), update: vi.fn() },
  });
});
vi.mock("@/services/secrets", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, default: { status: vi.fn(), get: vi.fn(), picker: vi.fn() } };
});

import CreateDestinationForm from "./CreateDestinationForm.vue";
import destinationService from "@/services/alert_destination";
import secrets from "@/services/secrets";

const mountForm = () =>
  mount(CreateDestinationForm, {
    global: {
      plugins: [
        createStore({ state: { theme: "light", selectedOrganization: { identifier: "acme" } } }),
        i18n,
      ],
      stubs: {
        SecretPicker: {
          name: "SecretPicker",
          props: ["consumerType", "consumerId"],
          emits: ["pick"],
          template: "<span />",
        },
      },
    },
  });

describe("CreateDestinationForm with secrets", () => {
  let w: any;
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    config.isEnterprise = "true";
    vi.mocked(secrets.status).mockResolvedValue({
      data: { mode: "single_cluster", region: "", store_ready: true, fga: "on" },
    } as any);
    vi.mocked(secrets.get).mockResolvedValue({ data: { policy_rev: "rev-9" } } as any);
  });
  afterEach(() => {
    w?.unmount();
    config.isEnterprise = "false";
  });

  it("offers the picker on header values and sends the first-use pin with the save", async () => {
    w = mountForm();
    w.vm.form.setFieldValue("destination_type", "custom");
    w.vm.step = 2;
    await flushPromises();
    const picker = w.findComponent({ name: "SecretPicker" });
    expect(picker.props("consumerType")).toBe("pipeline_destination");

    w.vm.form.setFieldValue("name", "snow-export");
    w.vm.form.setFieldValue("url", "https://acme.service-now.com/api");
    w.vm.form.setFieldValue("method", "post");
    w.vm.form.setFieldValue("headers", [{ key: "Authorization", value: "Basic " }]);
    await flushPromises();
    picker.vm.$emit("pick", {
      id: "s1",
      name: "SNOW_CHANGES_BASIC",
      kind: "secret",
      pin_mode: "none",
      private_locations: "off",
      allowed_here: true,
      rights: { manage: true, manage_access: true },
    });
    await flushPromises();
    expect(w.find("[data-test='secret-bind-box-SNOW_CHANGES_BASIC']").exists()).toBe(true);

    await w.vm.createDestination();
    await flushPromises();
    const call = vi.mocked(destinationService.create).mock.calls[0][0] as any;
    expect(call.data.headers.Authorization).toBe("Basic {{secrets.SNOW_CHANGES_BASIC}}");
    expect(call.data.secret_binds).toEqual([
      {
        secret_id: "s1",
        allow_this_consumer: false,
        pin: ["acme.service-now.com"],
        expected_policy_rev: "rev-9",
      },
    ]);
  });

  it("keeps the header picker beside the input in a nonwrapping row", async () => {
    w = mountForm();
    w.vm.form.setFieldValue("destination_type", "custom");
    w.vm.step = 2;
    await flushPromises();

    const picker = w.findComponent({ name: "SecretPicker" });
    const cell = picker.element.parentElement;
    expect(cell?.classList.contains("flex")).toBe(true);
    expect(cell?.classList.contains("flex-nowrap")).toBe(true);
    const field = cell?.querySelector("[data-test$='-value-input']");
    expect(field?.classList.contains("min-w-0")).toBe(true);
    expect(field?.parentElement).toBe(cell);
  });
});
