// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, vi, beforeEach } from "vitest";

// All vi.mock calls must be hoisted before any imports

const mockDispatch = vi.fn();
const mockStore = {
  state: {
    selectedOrganization: { identifier: "test-org" },
  },
  dispatch: mockDispatch,
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

vi.mock("quasar", () => ({
  useQuasar: vi.fn(() => ({})),
}));

vi.mock("@/services/jstransform", () => ({
  default: {
    list: vi.fn(),
  },
}));

import useFunctions from "./useFunctions";
import TransformService from "@/services/jstransform";

describe("useFunctions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("composable structure", () => {
    it("returns an object with getAllFunctions", () => {
      const result = useFunctions();
      expect(result).toHaveProperty("getAllFunctions");
      expect(typeof result.getAllFunctions).toBe("function");
    });

    it("multiple calls return independent instances", () => {
      const c1 = useFunctions();
      const c2 = useFunctions();
      expect(c1).not.toBe(c2);
      expect(c1.getAllFunctions).not.toBe(c2.getAllFunctions);
    });
  });

  describe("getAllFunctions", () => {
    it("calls TransformService.list with correct arguments", async () => {
      const mockList = [{ name: "fn1" }, { name: "fn2" }];
      vi.mocked(TransformService.list).mockResolvedValueOnce({
        data: { list: mockList },
      } as any);

      const { getAllFunctions } = useFunctions();
      await getAllFunctions();

      expect(TransformService.list).toHaveBeenCalledOnce();
      expect(TransformService.list).toHaveBeenCalledWith(
        1,
        100000,
        "name",
        false,
        "",
        "test-org"
      );
    });

    it("dispatches setFunctions with the list from the response", async () => {
      const mockList = [{ name: "fn1" }, { name: "fn2" }];
      vi.mocked(TransformService.list).mockResolvedValueOnce({
        data: { list: mockList },
      } as any);

      const { getAllFunctions } = useFunctions();
      await getAllFunctions();

      expect(mockDispatch).toHaveBeenCalledOnce();
      expect(mockDispatch).toHaveBeenCalledWith("setFunctions", mockList);
    });

    it("returns undefined on success (no explicit return value)", async () => {
      vi.mocked(TransformService.list).mockResolvedValueOnce({
        data: { list: [] },
      } as any);

      const { getAllFunctions } = useFunctions();
      const result = await getAllFunctions();

      expect(result).toBeUndefined();
    });

    it("dispatches setFunctions with an empty list when response list is empty", async () => {
      vi.mocked(TransformService.list).mockResolvedValueOnce({
        data: { list: [] },
      } as any);

      const { getAllFunctions } = useFunctions();
      await getAllFunctions();

      expect(mockDispatch).toHaveBeenCalledWith("setFunctions", []);
    });

    it("throws an Error when TransformService.list rejects", async () => {
      vi.mocked(TransformService.list).mockRejectedValueOnce(
        new Error("Service unavailable")
      );

      const { getAllFunctions } = useFunctions();
      await expect(getAllFunctions()).rejects.toThrow("Service unavailable");
    });

    it("propagates the error message correctly on rejection", async () => {
      const errorMessage = "Network timeout";
      vi.mocked(TransformService.list).mockRejectedValueOnce(
        new Error(errorMessage)
      );

      const { getAllFunctions } = useFunctions();
      await expect(getAllFunctions()).rejects.toThrow(errorMessage);
    });

    it("does not dispatch setFunctions when the service call fails", async () => {
      vi.mocked(TransformService.list).mockRejectedValueOnce(
        new Error("fail")
      );

      const { getAllFunctions } = useFunctions();
      try {
        await getAllFunctions();
      } catch {
        // expected
      }

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("uses the organization identifier from the store state", async () => {
      // Temporarily update the mock store's org identifier
      const originalId = mockStore.state.selectedOrganization.identifier;
      mockStore.state.selectedOrganization.identifier = "another-org";

      vi.mocked(TransformService.list).mockResolvedValueOnce({
        data: { list: [] },
      } as any);

      const { getAllFunctions } = useFunctions();
      await getAllFunctions();

      expect(TransformService.list).toHaveBeenCalledWith(
        1,
        100000,
        "name",
        false,
        "",
        "another-org"
      );

      // Restore
      mockStore.state.selectedOrganization.identifier = originalId;
    });

    it("getAllFunctions is an async function", () => {
      const { getAllFunctions } = useFunctions();
      vi.mocked(TransformService.list).mockResolvedValueOnce({
        data: { list: [] },
      } as any);
      const returnValue = getAllFunctions();
      expect(returnValue).toBeInstanceOf(Promise);
      return returnValue;
    });

    it("wraps inner catch errors and re-throws as Error instances", async () => {
      // The source uses a double try/catch; both convert to `new Error(e.message)`
      vi.mocked(TransformService.list).mockRejectedValueOnce({
        message: "Custom error object",
      });

      const { getAllFunctions } = useFunctions();
      await expect(getAllFunctions()).rejects.toThrow("Custom error object");
    });
  });
});
