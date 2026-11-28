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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import CheckHttpConfig from "./types/CheckHttpConfig.vue";
import CheckCapture from "./CheckCapture.vue";
import SecretSaveRefusal from "@/views/Secrets/SecretSaveRefusal.vue";
import { isKept, slotKey } from "@/utils/synthetics/writeOnly";

const META = { updated_at: Date.now() * 1000, updated_by: "marco@acme.io" };

const httpCheck = (over: Record<string, unknown> = {}) =>
  ({
    name: "checkout-api",
    url: "https://api.acme.io",
    writeOnly: { [slotKey.header("X-Session-Token")]: META },
    http: {
      method: "GET",
      headers: [
        { name: "X-Session-Token", value: "" },
        { name: "Accept", value: "application/json" },
      ],
      body: "",
      follow_redirects: true,
      timeout_ms: 10000,
      assertions: [],
    },
    ...over,
  }) as any;

const mountHttp = (check = httpCheck()) =>
  mount(CheckHttpConfig, {
    props: { check },
    global: { plugins: [i18n, store], stubs: { FilterBuilder: true } },
  });

describe("check editor write-only rows (U5)", () => {
  it("shows a kept header as Set by who, with Replace and no value", () => {
    const w = mountHttp();
    const kept = w.find("[data-test='synthetics-check-http-header-value-0-kept']");
    expect(kept.text()).toMatch(/^Set · updated .+ by marco@acme\.io/);
    expect(kept.text()).toContain("Replace");
    expect(w.find("[data-test='synthetics-check-http-header-value-1-kept']").exists()).toBe(false);
  });

  it("drops the keep and asks for a value when Secure is turned off", async () => {
    const w = mountHttp();
    const sw = w
      .findAllComponents({ name: "OSwitch" })
      .find((c) => (c.attributes("data-test") ?? "").includes("header-secure-0"))!;
    sw.vm.$emit("update:modelValue", false);
    const next = w.emitted("update:check")!.at(-1)![0] as any;
    expect(next.http.headers[0]).toMatchObject({ secure: false, value: "" });
    expect(isKept(next, slotKey.header("X-Session-Token"))).toBe(false);
  });

  it("keeps the value when Replace is cancelled", async () => {
    const w = mountHttp(httpCheck({ replacedSlots: [slotKey.header("X-Session-Token")] }));
    await w.find("[data-test='synthetics-check-http-header-value-0-cancel']").trigger("click");
    const next = w.emitted("update:check")!.at(-1)![0] as any;
    expect(isKept(next, slotKey.header("X-Session-Token"))).toBe(true);
  });

  it("shows the capture-off note only for checks with write-only values (U5b)", () => {
    const base = { capture: { screenshot: "on-fail" }, variables: [] } as any;
    const on = mount(CheckCapture, {
      props: { check: { ...base, writeOnly: { "auth.password": META } } },
      global: { plugins: [i18n] },
    });
    expect(on.find("[data-test='synthetics-check-capture-off-note']").text()).toContain(
      "Screenshots and traces are off",
    );
    const off = mount(CheckCapture, { props: { check: base }, global: { plugins: [i18n] } });
    expect(off.find("[data-test='synthetics-check-capture-off-note']").exists()).toBe(false);
  });

  it("explains a private-location refusal by name (U5l)", () => {
    const w = mount(SecretSaveRefusal, {
      props: { refusal: { code: "secret_private_location_refused", secret: "DEPLOY_TOKEN" } },
      global: { plugins: [i18n] },
    });
    expect(w.text()).toContain("Not saved: DEPLOY_TOKEN. It can't go to private locations");
    expect(w.find("[data-test='secret-save-refusal-code']").text()).toBe(
      "secret_private_location_refused",
    );
  });

  it("asks for typed values again when the receiver changed", () => {
    const w = mount(SecretSaveRefusal, {
      props: { refusal: { code: "slot_value_required_on_host_change" } },
      global: { plugins: [i18n] },
    });
    expect(w.text()).toContain("Type them again");
  });
});
