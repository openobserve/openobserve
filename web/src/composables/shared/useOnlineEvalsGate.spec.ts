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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { hidesOnlineEvalEntries, isOnlineEvalsOff } from "./useOnlineEvalsGate";

const edition = vi.hoisted(() => ({ isEnterprise: "true", isCloud: "false" }));
vi.mock("@/aws-exports", () => ({ default: edition }));

beforeEach(() => {
  edition.isEnterprise = "true";
  edition.isCloud = "false";
});

describe("hidesOnlineEvalEntries", () => {
  it("hides evaluation entries on enterprise/cloud unless /config reports them on", () => {
    expect(hidesOnlineEvalEntries({ version: "v1", online_evals_enabled: false })).toBe(true);
    expect(hidesOnlineEvalEntries({})).toBe(true);
    expect(hidesOnlineEvalEntries({ version: "v1", online_evals_enabled: true })).toBe(false);
    edition.isEnterprise = "false";
    edition.isCloud = "true";
    expect(hidesOnlineEvalEntries({ version: "v1", online_evals_enabled: false })).toBe(true);
  });

  it("never hides them on OSS, whose edition gate shows them locked instead", () => {
    edition.isEnterprise = "false";
    expect(hidesOnlineEvalEntries({ version: "v1", online_evals_enabled: false })).toBe(false);
  });
});

describe("isOnlineEvalsOff", () => {
  it("waits for the full /config before reporting evaluations off", () => {
    expect(isOnlineEvalsOff(undefined)).toBe(false);
    expect(isOnlineEvalsOff({})).toBe(false);
    expect(isOnlineEvalsOff({ online_evals_enabled: false })).toBe(false);
    expect(isOnlineEvalsOff({ version: "", online_evals_enabled: false })).toBe(true);
    expect(isOnlineEvalsOff({ version: "v1", online_evals_enabled: true })).toBe(false);
  });

  it("is never off on OSS", () => {
    edition.isEnterprise = "false";
    expect(isOnlineEvalsOff({ version: "v1", online_evals_enabled: false })).toBe(false);
  });
});
