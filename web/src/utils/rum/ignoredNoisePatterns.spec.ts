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

import { isIgnoredNoise } from "./ignoredNoisePatterns";

describe("isIgnoredNoise", () => {
  it("ignores the WebSocket cleanup-after-close message", () => {
    expect(isIgnoredNoise("Cleanup socket failed, socket not found null")).toBe(true);
  });

  it("ignores a cancelled full-configuration fetch", () => {
    expect(
      isIgnoredNoise("Failed to load the full configuration: CancelledError: canceled"),
    ).toBe(true);
  });

  it("ignores a cancelled organization settings fetch", () => {
    expect(isIgnoredNoise("Error in getOrganizationSettings: CancelledError: canceled")).toBe(
      true,
    );
  });

  it("ignores a cancelled config fetch on the login page", () => {
    expect(isIgnoredNoise("Error while fetching config: CancelledError: canceled")).toBe(true);
  });

  it("ignores a bare Monaco disposal cancellation", () => {
    expect(isIgnoredNoise("Canceled")).toBe(true);
  });

  it("matches against the stack when the message alone doesn't carry the signal", () => {
    expect(isIgnoredNoise("", "Error in getOrganizationSettings: CancelledError\n  at foo")).toBe(
      true,
    );
  });

  it("does not ignore an unrelated error", () => {
    expect(isIgnoredNoise("TypeError: Cannot read properties of undefined (reading 'length')")).toBe(
      false,
    );
  });

  it("does not ignore a real billing cancellation message", () => {
    // "cancelled" appearing mid-sentence in a genuine message must not be
    // swallowed — only the known noisy prefixes/exact messages are.
    expect(isIgnoredNoise("Your subscription has been cancelled")).toBe(false);
  });

  it("handles undefined message and stack", () => {
    expect(isIgnoredNoise(undefined, undefined)).toBe(false);
  });
});
