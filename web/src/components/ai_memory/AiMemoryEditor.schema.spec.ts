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
import { aiMemoryDefaults, makeAiMemorySchema } from "./AiMemoryEditor.schema";

const schema = makeAiMemorySchema((k) => k);

describe("AiMemoryEditor schema", () => {
  it("accepts a toolset memory that has no per-user limit", () => {
    const values = aiMemoryDefaults({
      content: "notes",
      rev: 0,
      max_bytes: 4096,
      user_max_bytes: 0,
    } as any);
    expect(values.user_max_kib).toBe("");
    expect(schema.safeParse(values).success).toBe(true);
  });

  it("rejects a zero size limit typed by the user", () => {
    const values = { ...aiMemoryDefaults(), max_kib: "0" };
    expect(schema.safeParse(values).success).toBe(false);
  });
});
