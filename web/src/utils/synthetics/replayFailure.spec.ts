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
import { classifyPreflightFailure } from "./replayFailure";

describe("classifyPreflightFailure", () => {
  it("should recognise the extension's own incognito message", () => {
    // Verbatim from the extension (background.ts).
    expect(
      classifyPreflightFailure(
        'Recording needs incognito access. Open chrome://extensions, find "OpenObserve Synthetics ' +
          'Recorder", and turn on "Allow in incognito" — recordings always run in a separate ' +
          "incognito window.",
      ),
    ).toBe("incognito");
    expect(classifyPreflightFailure("Failed to create incognito recording window")).toBe(
      "incognito",
    );
  });

  it("should recognise a replay that is already running", () => {
    expect(classifyPreflightFailure("A replay is already in progress")).toBe("in-progress");
  });

  /**
   * The reported bug: adding a step by hand and hitting Replay reported
   * "Can't open the Incognito window".
   *
   * A target-less step aborts the run before step 1, which produced a
   * `{ success: false }` with zero step results — the same SHAPE as a blocked
   * incognito window. The old code keyed on that shape alone, so an unrelated
   * failure was reported as a Chrome permissions problem and sent the author to
   * chrome://extensions. Anything not positively identified must now fall
   * through to `preflight`, which shows what actually happened.
   */
  it("should NOT claim incognito for unrelated failures", () => {
    expect(classifyPreflightFailure('Unexpected token "" while parsing css selector ""')).toBe(
      "preflight",
    );
    expect(classifyPreflightFailure("Internal error: page not found")).toBe("preflight");
    expect(classifyPreflightFailure("Target closed")).toBe("preflight");
  });

  it("should fall through to preflight when the extension sent no message", () => {
    expect(classifyPreflightFailure(undefined)).toBe("preflight");
    expect(classifyPreflightFailure(null)).toBe("preflight");
    expect(classifyPreflightFailure("")).toBe("preflight");
  });

  it("should match case-insensitively", () => {
    expect(classifyPreflightFailure("INCOGNITO access denied")).toBe("incognito");
    expect(classifyPreflightFailure("A Replay Is Already In Progress")).toBe("in-progress");
  });
});
