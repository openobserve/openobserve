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
import { rumPaError } from "@/utils/rum/rumPaApiError";
import contract from "@/utils/rum/__fixtures__/rumPaApi.json";

describe("rumPaError (contract error bodies)", () => {
  it.each(contract.errors.map((e) => [e.body.code, e] as const))(
    "reads %s with its status and extra fields",
    (_code, e) => {
      const err = rumPaError({ response: { status: e.status, data: e.body } });
      expect(err).toEqual({
        status: e.status,
        code: e.body.code,
        ...("current" in e.body ? { current: e.body.current } : {}),
        ...("funnels" in e.body ? { funnels: e.body.funnels } : {}),
      });
    },
  );

  it("keeps the status of a body-less or middleware error and drops a bad funnels list", () => {
    expect(rumPaError({ response: { status: 403, data: "Unauthorized Access" } })).toEqual({
      status: 403,
    });
    expect(rumPaError(new Error("network"))).toEqual({});
    expect(
      rumPaError({
        response: { status: 409, data: { code: "event_in_use", funnels: [{ id: 1 }] } },
      }),
    ).toEqual({ status: 409, code: "event_in_use", funnels: [] });
  });
});
