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
import { classifyPreflightFailure, classifyRestoreFailure } from "./replayFailure";

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
   * `incognito crxApplication is already started` comes from playwright-crx when a
   * previous incognito session still holds the slot — nothing to do with the
   * "Allow in incognito" permission. It contains the word "incognito", so the
   * generic substring test claimed it and rendered the chrome://extensions
   * walkthrough: the author was told to switch on a setting that was already on,
   * and Retry threw the same error every time. The specific case must win.
   */
  it("should NOT send the author to chrome://extensions when the slot is held", () => {
    expect(classifyPreflightFailure("incognito crxApplication is already started")).toBe(
      "in-progress",
    );
    expect(classifyPreflightFailure("crxApplication is already started")).toBe("in-progress");
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

/**
 * A restore ends for three reasons, and only one of them is anybody's fault.
 *
 * The recorder window is the author's only way out of a restore they no longer
 * want, so closing it is a CANCEL — reporting it as "step 9 failed" blames the
 * journey for something the author did deliberately.
 */
describe("classifyRestoreFailure", () => {
  it("should trust a reason the extension named itself", () => {
    // Layer B: the extension knows whether the window went away, so its own word
    // beats anything inferred from an exception.
    expect(classifyRestoreFailure({ reason: "window-closed" })).toBe("window-closed");
    expect(classifyRestoreFailure({ reason: "cancelled" })).toBe("cancelled");
    expect(classifyRestoreFailure({ reason: "step-failed" })).toBe("step-failed");
  });

  it("should read a closed window from the error class on an older extension", () => {
    expect(
      classifyRestoreFailure({
        error: "crxRecorder.runActions: Target page, context or browser has been closed",
        structuredError: { message: "…", name: "TargetClosedError" },
      }),
    ).toBe("window-closed");
  });

  /**
   * The bundler can rename classes, so `name` is not something to depend on
   * alone. Matching the message text is the method this file already sanctions —
   * the extension owns both ends of the string.
   */
  it("should read a closed window from the message when the class name is mangled", () => {
    expect(
      classifyRestoreFailure({
        error: "crxRecorder.runActions: Target page, context or browser has been closed",
      }),
    ).toBe("window-closed");
  });

  it("should keep a genuine step failure a step failure", () => {
    expect(
      classifyRestoreFailure({
        error: "locator.click: Timeout 30000ms exceeded",
        structuredError: { message: "…", name: "TimeoutError" },
      }),
    ).toBe("step-failed");
  });

  /**
   * "Target closed" with no window involved — a page the journey itself closed —
   * must not read as the author walking away.
   */
  it("should not mistake an unrelated failure for a closed window", () => {
    expect(classifyRestoreFailure({ error: "Internal error: page not found" })).toBe("step-failed");
    expect(classifyRestoreFailure({})).toBe("step-failed");
  });
});
