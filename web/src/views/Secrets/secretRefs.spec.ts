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
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import type { SecretPickerItem } from "@/services/secrets";
import {
  formatTestOutcome,
  hasStoreRef,
  pickerDisabled,
  pinHostOf,
  refNames,
  refText,
} from "./secretRefs";

const t = i18n.global.t as unknown as TranslateFn;

describe("secret refs", () => {
  it("finds secret and variable refs", () => {
    const r = refNames(["Basic {{secrets.A}}", "{{ vars.B }}/x", null, "{{secrets.A}}"]);
    expect([...r.secrets]).toEqual(["A"]);
    expect([...r.vars]).toEqual(["B"]);
    expect(hasStoreRef(["plain", "{{API_TOKEN}}"])).toBe(false);
    expect(refText("variable", "B")).toBe("{{vars.B}}");
  });

  it("names the pin host with a non-default port only", () => {
    expect(pinHostOf("https://events.pagerduty.com/v2/enqueue")).toBe("events.pagerduty.com");
    expect(pinHostOf("https://h.example.com:8443/x")).toBe("h.example.com:8443");
    expect(pinHostOf("not a url")).toBeNull();
  });

  it("formats a status-only outcome and nothing else", () => {
    expect(formatTestOutcome(t, { ok: true, status: 200 })).toBe("Delivered (HTTP 200)");
    expect(formatTestOutcome(t, { ok: false, status: 401, class: "http_4xx" })).toBe(
      "Failed: http_4xx (401)",
    );
    expect(formatTestOutcome(t, { ok: false, class: "secret_error:secret_deleted" })).toBe(
      "Failed: secret_error:secret_deleted",
    );
  });

  // Wire shape of `SecretPickerItem` (config::meta::secret_store::api), rights included (T25).
  it("lets a manage-access holder bind an any-host secret from the picker payload", () => {
    const payload = JSON.parse(`{
      "id": "s1", "name": "PD_KEY", "kind": "secret", "pin_mode": "any",
      "pin_override_reason": "vendor rotates hosts", "private_locations": "off",
      "allowed_here": true,
      "rights": {"see": true, "use": true, "manage": true, "manage_access": true}
    }`) as SecretPickerItem;
    expect(pickerDisabled(payload)).toBe(false);
    expect(
      pickerDisabled({ ...payload, rights: { ...payload.rights, manage_access: false } }),
    ).toBe(true);
  });
});
