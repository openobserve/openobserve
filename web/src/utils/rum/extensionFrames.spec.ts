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

import { isExtensionOnlyError } from "./extensionFrames";

const EXT = "chrome-extension://abcdefghijklmnop";

describe("isExtensionOnlyError", () => {
  it("is true when every Chrome frame comes from an extension", () => {
    const stack = [
      "TypeError: Cannot read properties of undefined (reading 'x')",
      `    at inject (${EXT}/content.js:10:5)`,
      `    at ${EXT}/vendor.js:1:200`,
    ].join("\n");
    expect(isExtensionOnlyError(stack)).toBe(true);
  });

  it("ignores frames that carry no URL", () => {
    const stack = [
      "Error: boom",
      `    at inject (${EXT}/content.js:10:5)`,
      "    at new Promise (<anonymous>)",
    ].join("\n");
    expect(isExtensionOnlyError(stack)).toBe(true);
  });

  it("is false when at least one frame is the app's", () => {
    const stack = [
      "Error: boom",
      `    at inject (${EXT}/content.js:10:5)`,
      "    at setup (https://cloud.openobserve.ai/web/assets/index-abc.js:1:2)",
    ].join("\n");
    expect(isExtensionOnlyError(stack)).toBe(false);
  });

  it("does not read a URL in the message line as a frame", () => {
    const stack = [
      `Error: failed to load ${EXT}/x.js`,
      "    at f (https://example.com/app.js:1:1)",
    ].join("\n");
    expect(isExtensionOnlyError(stack)).toBe(false);
  });

  it("is false for a stack with no frame URL at all", () => {
    expect(isExtensionOnlyError("Error: boom\n    at <anonymous>")).toBe(false);
    expect(isExtensionOnlyError("")).toBe(false);
    expect(isExtensionOnlyError(undefined)).toBe(false);
  });

  it("reads Firefox-style frames", () => {
    expect(isExtensionOnlyError(`inject@${EXT}/content.js:1:1\n@${EXT}/x.js:2:2`)).toBe(true);
    expect(isExtensionOnlyError(`inject@${EXT}/content.js:1:1\nrun@https://a.b/app.js:2:2`)).toBe(
      false,
    );
  });
});
