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
import type { SecretPickerItem } from "@/services/secrets";
import { missingManage } from "./assistantToolsetSecrets";

const SECRET: SecretPickerItem = {
  id: "secret_1",
  name: "PD_KEY",
  kind: "secret",
  pin_mode: "hosts",
  private_locations: "off",
  allowed_here: true,
  rights: { see: true, use: true, manage: true, manage_access: true },
};

describe("missingManage", () => {
  it.each([
    { values: [undefined, "Bearer literal", "{{vars.REGION}}"], usable: [], missing: [] },
    { values: ["{{secrets.PD_KEY}}"], usable: [SECRET], missing: [] },
    { values: ["{{secrets.PD_KEY}}", "{{secrets.PD_KEY}}"], usable: [], missing: ["PD_KEY"] },
    {
      values: ["{{secrets.PD_KEY}}"],
      usable: [{ ...SECRET, rights: { ...SECRET.rights, manage: false } }],
      missing: ["PD_KEY"],
    },
    {
      values: ["{{secrets.PD_KEY}}"],
      usable: [{ ...SECRET, kind: "variable" as const }],
      missing: ["PD_KEY"],
    },
  ])("returns $missing for $values", ({ values, usable, missing }) => {
    expect(missingManage(values, usable)).toEqual(missing);
  });
});
