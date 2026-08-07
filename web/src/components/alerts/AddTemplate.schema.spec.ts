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
import { makeAddTemplateSchema } from "./AddTemplate.schema";
import {
  emptyContentSpec,
  serializeContentSpec,
  type ContentSpec,
} from "./template-content/contentSpec";

const t = (key: string) => key;
const schema = makeAddTemplateSchema(t);

const baseForm = (body: string) => ({
  name: "my-template",
  type: "http" as const,
  kind: "content" as const,
  title: "",
  body,
});

describe("AddTemplate.schema — content-mode empty-spec rejection (Task 17 D8)", () => {
  it("rejects a spec with an empty title AND empty body", () => {
    const spec = emptyContentSpec();
    const result = schema.safeParse(baseForm(serializeContentSpec(spec)));
    expect(result.success).toBe(false);
  });

  it("accepts a spec with a non-empty title only", () => {
    const spec: ContentSpec = { ...emptyContentSpec(), title: "{alert_name}" };
    const result = schema.safeParse(baseForm(serializeContentSpec(spec)));
    expect(result.success).toBe(true);
  });

  it("accepts a spec with a non-empty body only", () => {
    const spec: ContentSpec = { ...emptyContentSpec(), body: "Something happened" };
    const result = schema.safeParse(baseForm(serializeContentSpec(spec)));
    expect(result.success).toBe(true);
  });

  it("rejects whitespace-only title and body", () => {
    const spec: ContentSpec = { ...emptyContentSpec(), title: "   ", body: "\n\t" };
    const result = schema.safeParse(baseForm(serializeContentSpec(spec)));
    expect(result.success).toBe(false);
  });

  it("does not apply the content-mode check to custom mode", () => {
    // Custom mode's body is a raw payload string; an empty ContentSpec JSON
    // string would never occur here, but a short non-empty string must pass
    // exactly as before (min(1) check only).
    const result = schema.safeParse({
      name: "custom-template",
      type: "http" as const,
      kind: "custom" as const,
      title: "",
      body: "x",
    });
    expect(result.success).toBe(true);
  });
});
