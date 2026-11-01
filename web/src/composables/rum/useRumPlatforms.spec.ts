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

const mockSearch = vi.fn();
const mockGetStream = vi.fn();

vi.mock("vuex", () => ({
  useStore: () => ({
    state: { selectedOrganization: { identifier: "org" }, zoConfig: {} },
  }),
}));
vi.mock("@/services/search", () => ({
  default: { search: (...a: unknown[]) => mockSearch(...a) },
}));
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStream: mockGetStream }) }));
vi.mock("@/types/i18n", () => ({ useI18nTyped: () => ({ t: (k: string) => k }) }));

import useRumPlatforms from "./useRumPlatforms";

const schemaOf = (...names: string[]) => ({ schema: names.map((name) => ({ name })) });
let n = 0;
const range = () => ({ startTime: ++n * 1000, endTime: n * 1000 + 500 });

describe("useRumPlatforms probe", () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockGetStream.mockReset();
    useRumPlatforms().resetRumPlatforms();
  });

  it("returns exactly the schema answer, even both-false, when there is no source column", async () => {
    mockGetStream.mockResolvedValue(schemaOf("service", "view_id"));

    const result = await useRumPlatforms().detectPlatforms(range());

    expect(mockSearch).not.toHaveBeenCalled();
    expect(result.hasBrowser).toBe(false);
    expect(result.hasMobile).toBe(false);
    expect(result.viaFallback).toBe(true);
  });

  it("reads the stream schema once per detection", async () => {
    mockGetStream.mockResolvedValue(schemaOf("source", "view_largest_contentful_paint"));
    mockSearch.mockRejectedValue(new Error("400"));

    await useRumPlatforms().detectPlatforms(range());

    expect(mockGetStream).toHaveBeenCalledTimes(1);
  });

  it("infers mobile from the schema when there is no source column", async () => {
    mockGetStream.mockResolvedValue(schemaOf("view_slow_frames_rate", "error_is_crash"));

    const result = await useRumPlatforms().detectPlatforms(range());

    expect(mockSearch).not.toHaveBeenCalled();
    expect(result.hasMobile).toBe(true);
    expect(result.hasBrowser).toBe(false);
  });

  it("still probes by source when the column exists, detecting mobile", async () => {
    mockGetStream.mockResolvedValue(schemaOf("source"));
    mockSearch.mockResolvedValue({ data: { hits: [{ source: "ios" }, { source: "" }] } });

    const result = await useRumPlatforms().detectPlatforms(range());

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(result.hasMobile).toBe(true);
    expect(result.hasBrowser).toBe(true);
  });

  it("falls back to the schema when the probe fails on a stream that has source", async () => {
    mockGetStream.mockResolvedValue(schemaOf("source", "view_largest_contentful_paint"));
    mockSearch.mockRejectedValue(new Error("400"));

    const result = await useRumPlatforms().detectPlatforms(range());

    expect(result.viaFallback).toBe(true);
    expect(result.hasBrowser).toBe(true);
  });

  it("probes when the schema cannot be read", async () => {
    mockGetStream.mockRejectedValue(new Error("down"));
    mockSearch.mockResolvedValue({ data: { hits: [{ source: "android" }] } });

    const result = await useRumPlatforms().detectPlatforms(range());

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(result.hasMobile).toBe(true);
  });
});
