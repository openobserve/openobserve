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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isFrame, parseFrame } from "./frames";

const WEB_COPY = join(__dirname, "findings.schema.json");

// o2-ai is checked out next to this repo, or wherever `O2AI_DIR` points.
const O2AI_COPY = join(
  process.env.O2AI_DIR ?? join(__dirname, "..", "..", "..", "..", "..", "o2-ai"),
  "schemas",
  "findings.schema.json",
);

const schema = JSON.parse(readFileSync(WEB_COPY, "utf8")) as {
  required: string[];
  properties: Record<string, { enum?: string[]; items?: { properties?: Record<string, any> } }>;
};

const fixture = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "frames", "findings.json"), "utf8"),
) as { frame: Record<string, any> };

describe("findings schema", () => {
  it.skipIf(!existsSync(O2AI_COPY))("is a byte copy of the o2-ai schema", () => {
    expect(readFileSync(WEB_COPY).equals(readFileSync(O2AI_COPY))).toBe(true);
  });

  it("describes the findings fixture the client parses", () => {
    const frame = fixture.frame;
    expect(Object.keys(frame).every((key) => key in schema.properties)).toBe(true);
    expect(schema.required.every((key) => key in frame)).toBe(true);
    expect(schema.properties.confidence.enum).toContain(frame.confidence);
    const kinds = schema.properties.evidence.items?.properties?.kind.enum as string[];
    expect(frame.evidence.every((item: { kind: string }) => kinds.includes(item.kind))).toBe(true);
    expect(isFrame(parseFrame(JSON.stringify(frame)), "findings")).toBe(true);
  });

  it("accepts every confidence the schema allows", () => {
    for (const confidence of schema.properties.confidence.enum ?? []) {
      const frame = parseFrame(JSON.stringify({ ...fixture.frame, confidence }));
      expect(isFrame(frame, "findings")).toBe(true);
    }
  });
});
