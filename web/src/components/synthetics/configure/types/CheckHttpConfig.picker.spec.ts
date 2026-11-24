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
import { describe, expect, it, vi } from "vitest";
import { computed } from "vue";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import CheckHttpConfig from "./CheckHttpConfig.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { slotKey } from "@/utils/synthetics/writeOnly";

vi.mock("@/views/Secrets/useSecretConsumer", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useSecretPickerShown: () => computed(() => true) };
});

const check = {
  name: "checkout-api",
  url: "https://api.acme.io",
  replacedSlots: [slotKey.header("X-Session-Token")],
  writeOnly: {
    [slotKey.header("X-Session-Token")]: { updated_at: 1, updated_by: "marco@acme.io" },
  },
  http: {
    method: "GET",
    headers: [
      { name: "X-Session-Token", value: "", secure: true },
      { name: "Accept", value: "application/json" },
    ],
    body: "",
    follow_redirects: true,
    timeout_ms: 10000,
    assertions: [],
  },
} as any;

describe("check editor secret picker placement", () => {
  it("puts the picker beside each header value field, not under it", () => {
    const w = mount(CheckHttpConfig, {
      props: { check },
      global: {
        plugins: [i18n, store],
        stubs: { FilterBuilder: true, SecretPicker: { template: "<button />" } },
      },
    });
    for (const i of [0, 1]) {
      const picker = w.find(`[data-test='synthetics-check-http-header-${i}-secret-picker']`);
      expect(picker.exists()).toBe(true);
      const input = w
        .findAllComponents(OInput)
        .find((c) => c.attributes("data-test") === `synthetics-check-http-header-value-${i}`)!;
      expect(input.element.contains(picker.element)).toBe(false);
      expect(picker.element.parentElement).toBe(input.element.parentElement);
    }
    w.unmount();
  });
});
