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

import { INJECTION, expectNoInjection } from "./__fixtures__/prompts";
import { buildNoStreamPrompt } from "./noStream";

describe("buildNoStreamPrompt", () => {
  it("asks a real setup question naming the org and the stream type, never fix-my-filter (D2)", () => {
    const build = buildNoStreamPrompt({ org: "acme", streamType: "logs" });
    expect(build.text).toBe(
      "There are no logs streams in organization `acme` yet. How do I send my first logs to OpenObserve?",
    );
    expect(build.chips).toEqual([]);
    expect(build.title).toBe("Set up ingestion");
  });

  it("adds the platform only when the page knows it", () => {
    expect(
      buildNoStreamPrompt({ org: "acme", streamType: "logs", platform: "Kubernetes" }).text,
    ).toContain("I'm on Kubernetes.");
  });

  it("keeps a planted string in every input out of the text (S1)", () => {
    expectNoInjection(
      buildNoStreamPrompt({ org: INJECTION, streamType: INJECTION, platform: INJECTION }),
    );
  });
});
