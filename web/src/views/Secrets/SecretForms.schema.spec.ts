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
import {
  buildCreateRequest,
  buildPointer,
  createDefaults,
  makeCreateSchema,
  makeSecretValueSchema,
  valueDefaults,
} from "./SecretForms.schema";

const t = ((k: string) => k) as any;
const external = {
  source: "external" as const,
  backend_id: "b1",
  locator: "o2/prod/pd",
  version: "stage" as const,
  version_ref: "AWSCURRENT",
  json_key: "token",
};

describe("external source (T39)", () => {
  it("builds the server's Pointer from the external fields", () => {
    expect(buildPointer({ ...valueDefaults(), ...external })).toEqual({
      backend_id: "b1",
      locator: "o2/prod/pd",
      version_selector: { stage: "AWSCURRENT" },
      json_key: "token",
    });
    expect(
      buildPointer({ ...valueDefaults(), ...external, version: "latest", json_key: " " }),
    ).toEqual({ backend_id: "b1", locator: "o2/prod/pd", version_selector: "latest" });
  });

  it("creates a secret with a source and no value", () => {
    const v = { ...createDefaults("secret"), ...external, name: "PD_KEY" };
    expect(makeCreateSchema(t, "secret").safeParse(v).success).toBe(true);
    const body = buildCreateRequest("secret", v, false);
    expect(body.value).toBeUndefined();
    expect(body.source?.locator).toBe("o2/prod/pd");
  });

  it("needs a backend, a locator and a stage or id for an external value", () => {
    const res = makeSecretValueSchema(t).safeParse({
      ...valueDefaults(),
      source: "external",
      version: "id",
    });
    const paths = res.success ? [] : res.error.issues.map((i) => i.path[0]);
    expect(paths).toEqual(["backend_id", "locator", "version_ref"]);
  });

  it("still needs a value for a local write", () => {
    expect(makeSecretValueSchema(t).safeParse(valueDefaults()).success).toBe(false);
  });
});
