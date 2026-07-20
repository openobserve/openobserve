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
import { modelVendorSlug, resolveModelVendorLogo } from "./modelVendorLogo";

// The vendor LOGO assets live under `src/assets/ai-datasource-content/generated/`
// which is GITIGNORED and fetched at build time (scripts/fetch-datasource-content
// .mjs) — so they may be absent in a fresh checkout / CI. The name→slug mapping
// (`modelVendorSlug`) is pure and always testable; the asset-dependent URL
// resolution is asserted only when the logos are actually bundled.
describe("modelVendorSlug (pure name → vendor mapping)", () => {
  it("maps OpenAI model families", () => {
    for (const m of ["gpt-4o", "gpt-4o-mini", "o1-preview", "o3-mini"]) {
      expect(modelVendorSlug(m)).toBe("openai");
    }
  });

  it("maps Anthropic (Claude) models", () => {
    for (const m of ["claude-3-5-sonnet", "claude-sonnet-4-6", "anthropic/claude-3-5-sonnet"]) {
      expect(modelVendorSlug(m)).toBe("anthropic");
    }
  });

  it("maps Gemini / Vertex models", () => {
    for (const m of ["gemini-1.5-pro", "gemini-2.0-flash", "vertex-gemini"]) {
      expect(modelVendorSlug(m)).toBe("gemini");
    }
  });

  it("strips a provider prefix before matching", () => {
    expect(modelVendorSlug("openai/gpt-4o")).toBe("openai");
    expect(modelVendorSlug("anthropic/claude-3-5-sonnet")).toBe("anthropic");
  });

  it("returns undefined for an unknown / empty model", () => {
    expect(modelVendorSlug("some-internal-model-xyz")).toBeUndefined();
    expect(modelVendorSlug(undefined)).toBeUndefined();
    expect(modelVendorSlug("")).toBeUndefined();
  });
});

describe("resolveModelVendorLogo", () => {
  // A model with no vendor rule always resolves to "" regardless of assets.
  it("returns empty string for an unknown model (chip-icon fallback)", () => {
    expect(resolveModelVendorLogo("some-internal-model-xyz")).toBe("");
    expect(resolveModelVendorLogo(undefined)).toBe("");
    expect(resolveModelVendorLogo("")).toBe("");
  });

  // When the vendor logo asset IS bundled, the result must be a self-contained
  // `data:` URI (canvas-safe inside the node's SVG frame). If the gitignored
  // assets aren't present (CI without the fetch), there is nothing to assert —
  // the contract is "" in that case, already covered above.
  it("returns a self-contained data: URI when the vendor logo is bundled", () => {
    const logo = resolveModelVendorLogo("gpt-4o");
    if (logo === "") {
      // Assets not fetched in this environment — nothing to verify.
      return;
    }
    expect(logo.startsWith("data:")).toBe(true);
  });
});
