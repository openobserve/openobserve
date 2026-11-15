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
import { MATCHING_PAGES, SOLUTION_HOME, solutionLanding } from "./solutionLanding";

describe("solutionLanding", () => {
  it("lands Security pages on the Observability page that does the same job", () => {
    expect(solutionLanding("/security/alerts", "observability")).toBe("/alerts");
    expect(solutionLanding("/security/detections", "observability")).toBe("/alerts");
    expect(solutionLanding("/security/events", "observability")).toBe("/logs");
    expect(solutionLanding("/security/cases/42", "observability")).toBe("/incidents");
    expect(solutionLanding("/security/sources", "observability")).toBe("/ingestion");
    expect(solutionLanding("/security/overview", "observability")).toBe("/");
  });

  it("lands Observability pages on their Security match, the first pair winning", () => {
    expect(solutionLanding("/logs", "security")).toBe("/security/events");
    expect(solutionLanding("/alerts", "security")).toBe("/security/alerts");
    expect(solutionLanding("/alerts/edit/abc", "security")).toBe("/security/alerts");
    expect(solutionLanding("/incidents", "security")).toBe("/security/cases");
    expect(solutionLanding("/ingestion/custom/logs/curl", "security")).toBe("/security/sources");
    expect(solutionLanding("/", "security")).toBe("/security/overview");
  });

  it("falls back to the target solution's home when nothing matches", () => {
    expect(solutionLanding("/security/entities", "observability")).toBe(
      SOLUTION_HOME.observability,
    );
    expect(solutionLanding("/metrics", "security")).toBe(SOLUTION_HOME.security);
    // A prefix of the word alone is not the same page.
    expect(solutionLanding("/logsfoo", "security")).toBe(SOLUTION_HOME.security);
  });

  it("falls back to home when the matching page is not in this build", () => {
    const exists = (path: string) => path !== "/incidents";
    expect(solutionLanding("/security/cases", "observability", exists)).toBe("/");
  });

  it("stays put on a page both solutions share", () => {
    expect(solutionLanding("/settings/general", "security")).toBeNull();
    expect(solutionLanding("/iam/users", "observability")).toBeNull();
  });

  it("pairs every Security page with an Observability one, or none, never with itself", () => {
    for (const pair of MATCHING_PAGES) {
      expect(pair.security.startsWith("/security/")).toBe(true);
      expect(pair.observability.startsWith("/security")).toBe(false);
    }
  });
});
