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
import type { SecretPickerItem } from "@/services/secrets";
import SecretBindBox from "./SecretBindBox.vue";
import { buildSecretBinds, needsBind, refusalFrom } from "./useSecretConsumer";

const item = (over: Partial<SecretPickerItem>): SecretPickerItem => ({
  id: "s1",
  name: "SNOW_CHANGES_BASIC",
  kind: "secret",
  pin_mode: "hosts",
  private_locations: "off",
  allowed_here: true,
  rights: { manage: true, manage_access: true },
  ...over,
});
const REVS = { s1: "rev-1" };

describe("secret_binds builder (§3.6.1, V38)", () => {
  it("binds nothing for a pinned, allowed secret", () => {
    expect(needsBind(item({}))).toBe(false);
    expect(buildSecretBinds([item({})], {}, {}, REVS)).toEqual([]);
  });

  it("sends the first-use pin for a manage-access holder", () => {
    expect(
      buildSecretBinds([item({ pin_mode: "none" })], { s1: [" acme.service-now.com "] }, {}, REVS),
    ).toEqual([
      {
        secret_id: "s1",
        allow_this_consumer: false,
        pin: ["acme.service-now.com"],
        expected_policy_rev: "rev-1",
      },
    ]);
  });

  it("allows this consumer by default and keeps the pin", () => {
    expect(buildSecretBinds([item({ allowed_here: false })], {}, {}, REVS)).toEqual([
      { secret_id: "s1", allow_this_consumer: true, pin: "keep", expected_policy_rev: "rev-1" },
    ]);
  });

  it("drops an allow the user unticked, and an unpinned bind with no hosts", () => {
    expect(buildSecretBinds([item({ allowed_here: false })], {}, { s1: false }, REVS)).toEqual([]);
    expect(buildSecretBinds([item({ pin_mode: "none" })], { s1: [] }, {}, REVS)).toEqual([]);
  });

  it("sends no options without manage access; the server refusal says whom to ask", () => {
    const noAccess = item({ pin_mode: "none", allowed_here: false, rights: { manage: true } });
    expect(buildSecretBinds([noAccess], { s1: ["h"] }, {}, REVS)).toEqual([]);
  });

  it("reads a refusal body", () => {
    expect(
      refusalFrom({
        response: {
          data: { code: "secret_pin_required", secret: "X", suggested_hosts: ["h"], message: "m" },
        },
      }),
    ).toEqual({ code: "secret_pin_required", secret: "X", suggested_hosts: ["h"], message: "m" });
    expect(refusalFrom({ response: { data: { code: "something_else" } } })).toBeNull();
  });
});

describe("SecretBindBox (U2)", () => {
  const mountBox = (items: SecretPickerItem[], pins = {}, allow = {}) =>
    mount(SecretBindBox, { props: { items, pins, allow }, global: { plugins: [i18n] } });

  it("asks a manage-access holder for the pin and to allow this destination", async () => {
    const w = mountBox([item({ pin_mode: "none", allowed_here: false })], {
      s1: ["h.example.com"],
    });
    expect(w.text()).toContain("SNOW_CHANGES_BASIC needs a host pin");
    expect(w.find("[data-test='secret-bind-box-SNOW_CHANGES_BASIC-hosts']").exists()).toBe(true);
    const allow = w.find("[data-test='secret-bind-box-SNOW_CHANGES_BASIC-allow'] button");
    await allow.trigger("click");
    expect(w.emitted("update:allow")?.[0]?.[0]).toEqual({ s1: false });
  });

  it("tells a caller without manage access whom to ask, with no inputs", () => {
    const w = mountBox([item({ pin_mode: "none", rights: { manage: true } })], {
      s1: ["acme.service-now.com"],
    });
    expect(w.find("[data-test='secret-bind-box-SNOW_CHANGES_BASIC-ask']").text()).toContain(
      "Ask a manage-access holder to pin it to acme.service-now.com",
    );
    expect(w.find("[data-test='secret-bind-box-SNOW_CHANGES_BASIC-hosts']").exists()).toBe(false);
  });
});
