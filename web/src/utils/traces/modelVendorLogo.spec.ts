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

import { describe, it, expect } from "vitest";
import { resolveModelVendorLogo } from "./modelVendorLogo";

// The glob returns real bundled URLs under Vitest; a matched vendor yields a
// non-empty string, an unmatched model yields "".
describe("resolveModelVendorLogo", () => {
  it("maps OpenAI model families to a self-contained data: logo", () => {
    for (const m of ["gpt-4o", "gpt-4o-mini", "o1-preview", "o3-mini"]) {
      const logo = resolveModelVendorLogo(m);
      expect(logo).not.toBe("");
      // Must be an inlined data: URI (not an external URL) so it stays
      // canvas-safe when embedded in the node's SVG frame.
      expect(logo.startsWith("data:")).toBe(true);
    }
  });

  it("maps Anthropic (Claude) models to a logo", () => {
    for (const m of ["claude-3-5-sonnet", "claude-sonnet-4-6", "anthropic/claude-3-5-sonnet"]) {
      expect(resolveModelVendorLogo(m)).not.toBe("");
    }
  });

  it("maps Gemini / Vertex models to a logo", () => {
    for (const m of ["gemini-1.5-pro", "gemini-2.0-flash"]) {
      expect(resolveModelVendorLogo(m)).not.toBe("");
    }
  });

  it("strips a provider prefix before matching", () => {
    // openai/… and anthropic/… should still resolve by the model family.
    expect(resolveModelVendorLogo("openai/gpt-4o")).not.toBe("");
    expect(resolveModelVendorLogo("anthropic/claude-3-5-sonnet")).not.toBe("");
  });

  it("returns empty string for an unknown model (chip-icon fallback)", () => {
    expect(resolveModelVendorLogo("some-internal-model-xyz")).toBe("");
    expect(resolveModelVendorLogo(undefined)).toBe("");
    expect(resolveModelVendorLogo("")).toBe("");
  });
});
