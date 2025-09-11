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

// Mock all external dependencies before any imports
vi.mock("@/services/action_scripts", () => ({
  default: {
    list: vi.fn(),
  },
}));

vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "false",
    isCloud: "false",
  },
}));

const mockStore = {
  state: {
    selectedOrganization: { identifier: "test-org" },
    zoConfig: { actions_enabled: true },
  },
  dispatch: vi.fn(),
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

vi.mock("quasar", () => ({
  useQuasar: vi.fn(),
}));

import useActions from "./useActions";
import actionService from "@/services/action_scripts";

describe("useActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isActionsEnabled", () => {
    it("should return false when neither enterprise nor cloud is enabled", () => {
      vi.doMock("@/aws-exports", () => ({
        default: {
          isEnterprise: "false",
          isCloud: "false",
        },
      }));

      const { isActionsEnabled } = useActions();
      expect(isActionsEnabled.value).toBe(false);
    });

    it("should return true when enterprise is enabled and actions are enabled in config", async () => {
      // Reset the mock to return true for enterprise
      vi.mocked(await vi.importMock("@/aws-exports")).default = {
        isEnterprise: "true",
        isCloud: "false",
      };
      
      // Reset store to enable actions
      mockStore.state.zoConfig.actions_enabled = true;

      const { isActionsEnabled } = useActions();
      expect(isActionsEnabled.value).toBe(true);
    });

    it("should return true when cloud is enabled and actions are enabled in config", async () => {
      // Reset the mock to return true for cloud
      vi.mocked(await vi.importMock("@/aws-exports")).default = {
        isEnterprise: "false",
        isCloud: "true",
      };
      
      // Reset store to enable actions
      mockStore.state.zoConfig.actions_enabled = true;

      const { isActionsEnabled } = useActions();
      expect(isActionsEnabled.value).toBe(true);
    });

    it("should return false when enterprise is enabled but actions are disabled in config", async () => {
      vi.doMock("@/aws-exports", () => ({
        default: {
          isEnterprise: "true",
          isCloud: "false",
        },
      }));

      mockStore.state.zoConfig.actions_enabled = false;

      const { isActionsEnabled } = (await import("./useActions")).default();
      expect(isActionsEnabled.value).toBe(false);
    });
  });

  describe("getAllActions", () => {
    it("should return empty array when actions are not enabled", async () => {
      const { getAllActions } = useActions();
      const result = await getAllActions();
      expect(result).toEqual([]);
      expect(actionService.list).not.toHaveBeenCalled();
    });

    it("should handle service call errors", async () => {
      const errorMessage = "Service error";
      
      // Reset and enable actions for this test
      mockStore.state.zoConfig.actions_enabled = true;
      vi.doMock("@/aws-exports", () => ({
        default: {
          isEnterprise: "true",
          isCloud: "false",
        },
      }));
      
      vi.mocked(actionService.list).mockRejectedValueOnce(new Error(errorMessage));

      const { getAllActions } = useActions();

      await expect(getAllActions()).rejects.toThrow(errorMessage);
    });

  });

  describe("composable structure", () => {
    it("should return expected methods and computed properties", () => {
      const composable = useActions();

      expect(composable.getAllActions).toBeTypeOf("function");
      expect(composable.isActionsEnabled).toHaveProperty("value");
    });

    it("should create independent instances", () => {
      const actions1 = useActions();
      const actions2 = useActions();

      expect(actions1).not.toBe(actions2);
      expect(typeof actions1.getAllActions).toBe("function");
      expect(typeof actions2.getAllActions).toBe("function");
    });
  });
});