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

import { scrubAuthParams } from "./scrubAuthParams";

describe("scrubAuthParams", () => {
  it("redacts the SSO callback tokens in the hash and keeps the other markers", () => {
    expect(
      scrubAuthParams(
        "https://cloud.openobserve.ai/web/cb#id_token=eyJhbGci.abc.def&access_token=ya29.x-y&new_user_login=true&pending_invites=true",
      ),
    ).toBe(
      "https://cloud.openobserve.ai/web/cb#id_token=redacted&access_token=redacted&new_user_login=true&pending_invites=true",
    );
  });

  it("redacts query parameters too, including a refresh token and an auth code", () => {
    expect(scrubAuthParams("/web/cb?code=4%2F0AX4&state=xyz&refresh_token=1//0g")).toBe(
      "/web/cb?code=redacted&state=xyz&refresh_token=redacted",
    );
  });

  it("leaves ordinary URLs and empty values alone", () => {
    const url = "/web/logs?org_identifier=default&stream=default#/panel";
    expect(scrubAuthParams(url)).toBe(url);
    expect(scrubAuthParams("")).toBe("");
    expect(scrubAuthParams(undefined)).toBeUndefined();
  });

  it("does not touch parameters that merely contain the token names", () => {
    const url = "/web/tokens?id_token_name=prod&use_code=true";
    expect(scrubAuthParams(url)).toBe(url);
  });
});
