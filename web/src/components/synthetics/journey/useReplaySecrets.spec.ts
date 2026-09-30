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

import { afterEach, describe, expect, it, vi } from "vitest";
import { useReplaySecrets } from "./useReplaySecrets";

describe("useReplaySecrets", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a value per environment and name", () => {
    const secrets = useReplaySecrets();
    secrets.set("qa", "PASSWORD", "qa-pass");
    secrets.set("stg", "PASSWORD", "stg-pass");
    secrets.set("qa", "TOKEN", "qa-token");

    expect(secrets.valueFor("qa", "PASSWORD")).toBe("qa-pass");
    expect(secrets.valueFor("stg", "PASSWORD")).toBe("stg-pass");
    expect(secrets.valueFor("qa", "TOKEN")).toBe("qa-token");
    expect(secrets.valueFor("stg", "TOKEN")).toBeUndefined();
  });

  it("valuesFor returns only that environment's values", () => {
    const secrets = useReplaySecrets();
    secrets.set("qa", "PASSWORD", "qa-pass");
    secrets.set("qa", "TOKEN", "qa-token");
    secrets.set("stg", "PASSWORD", "stg-pass");

    expect(secrets.valuesFor("qa")).toEqual({ PASSWORD: "qa-pass", TOKEN: "qa-token" });
    expect(secrets.valuesFor("prod")).toEqual({});
  });

  it("forget deletes one value; clear deletes all", () => {
    const secrets = useReplaySecrets();
    secrets.set("qa", "PASSWORD", "qa-pass");
    secrets.set("qa", "TOKEN", "qa-token");
    secrets.set("stg", "PASSWORD", "stg-pass");

    secrets.forget("qa", "PASSWORD");
    expect(secrets.valuesFor("qa")).toEqual({ TOKEN: "qa-token" });
    expect(secrets.valueFor("stg", "PASSWORD")).toBe("stg-pass");

    secrets.clear();
    expect(secrets.valuesFor("qa")).toEqual({});
    expect(secrets.valuesFor("stg")).toEqual({});
  });

  it("two instances do not share values", () => {
    const first = useReplaySecrets();
    first.set("qa", "PASSWORD", "qa-pass");

    const second = useReplaySecrets();

    expect(second.valueFor("qa", "PASSWORD")).toBeUndefined();
    expect(second.valuesFor("qa")).toEqual({});
  });

  it("never writes to web storage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const secrets = useReplaySecrets();

    secrets.set("qa", "PASSWORD", "qa-pass");
    secrets.forget("qa", "PASSWORD");
    secrets.set("qa", "TOKEN", "qa-token");
    secrets.clear();

    expect(setItem).not.toHaveBeenCalled();
  });
});
