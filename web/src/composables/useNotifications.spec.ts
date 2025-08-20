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

import { describe, expect, it, beforeEach, vi } from "vitest";
import useNotifications from "@/composables/useNotifications";

// Mock Quasar's useQuasar composable
const mockNotify = vi.fn();

vi.mock("quasar", () => ({
  useQuasar: () => ({
    notify: mockNotify,
  }),
}));

// Mock window.location.reload
const mockReload = vi.fn();
Object.defineProperty(window, 'location', {
  value: {
    reload: mockReload,
  },
  writable: true,
});

describe("useNotifications composable", () => {
  let notifications: ReturnType<typeof useNotifications>;

  beforeEach(() => {
    vi.clearAllMocks();
    notifications = useNotifications();
  });

  describe("showErrorNotification", () => {
    it("should call quasar notify with correct error configuration", () => {
      const message = "Test error message";
      
      notifications.showErrorNotification(message);

      expect(mockNotify).toHaveBeenCalledWith({
        type: "negative",
        message: message,
        timeout: 5000,
        actions: [
          {
            icon: "close",
            color: "white",
            round: true,
            handler: expect.any(Function),
          },
        ],
      });
    });

    it("should merge custom options with default configuration", () => {
      const message = "Test error message";
      const customOptions = {
        timeout: 10000,
        position: "top-right",
      };

      notifications.showErrorNotification(message, customOptions);

      expect(mockNotify).toHaveBeenCalledWith({
        type: "negative",
        message: message,
        timeout: 10000, // Should use custom timeout
        position: "top-right", // Should include custom option
        actions: [
          {
            icon: "close",
            color: "white",
            round: true,
            handler: expect.any(Function),
          },
        ],
      });
    });

    it("should handle empty custom options", () => {
      const message = "Test error message";
      
      notifications.showErrorNotification(message, {});

      expect(mockNotify).toHaveBeenCalledWith({
        type: "negative",
        message: message,
        timeout: 5000,
        actions: [
          {
            icon: "close",
            color: "white",
            round: true,
            handler: expect.any(Function),
          },
        ],
      });
    });

    it("should handle undefined custom options", () => {
      const message = "Test error message";
      
      notifications.showErrorNotification(message, undefined);

      expect(mockNotify).toHaveBeenCalledWith({
        type: "negative",
        message: message,
        timeout: 5000,
        actions: [
          {
            icon: "close",
            color: "white",
            round: true,
            handler: expect.any(Function),
          },
        ],
      });
    });

    it("should return the result from quasar notify", () => {
      const mockResult = { dismiss: vi.fn() };
      mockNotify.mockReturnValue(mockResult);

      const message = "Test error message";
      const result = notifications.showErrorNotification(message);

      expect(result).toBe(mockResult);
    });
  });

  describe("showConfictErrorNotificationWithRefreshBtn", () => {
    it("should call quasar notify with refresh button configuration", () => {
      const message = "Conflict error occurred";
      
      notifications.showConfictErrorNotificationWithRefreshBtn(message);

      expect(mockNotify).toHaveBeenCalledWith({
        type: "negative",
        message: message,
        multiLine: false,
        timeout: 0, // No timeout for conflict errors
        actions: [
          {
            label: "Refresh",
            color: "white",
            style: "font-weight: bold",
            padding: "4px",
            handler: expect.any(Function),
          },
          {
            icon: "close",
            padding: "4px",
            style: "font-weight: bold",
            color: "white",
            handler: expect.any(Function),
          },
        ],
      });
    });

    it("should call window.location.reload when refresh button is clicked", () => {
      const message = "Conflict error occurred";
      
      notifications.showConfictErrorNotificationWithRefreshBtn(message);

      // Get the handler function from the refresh button (first action)
      const callArgs = mockNotify.mock.calls[0][0];
      const refreshHandler = callArgs.actions[0].handler;

      // Execute the handler
      refreshHandler();

      expect(mockReload).toHaveBeenCalled();
    });

    it("should merge custom options correctly", () => {
      const message = "Conflict error occurred";
      const customOptions = {
        position: "bottom",
        classes: "custom-notification",
      };

      notifications.showConfictErrorNotificationWithRefreshBtn(message, customOptions);

      expect(mockNotify).toHaveBeenCalledWith({
        type: "negative",
        message: message,
        multiLine: false,
        timeout: 0,
        position: "bottom", // Custom option
        classes: "custom-notification", // Custom option
        actions: [
          {
            label: "Refresh",
            color: "white",
            style: "font-weight: bold",
            padding: "4px",
            handler: expect.any(Function),
          },
          {
            icon: "close",
            padding: "4px",
            style: "font-weight: bold",
            color: "white",
            handler: expect.any(Function),
          },
        ],
      });
    });
  });

  describe("showAliasErrorForVisualization", () => {
    it("should call quasar notify with alias error configuration", () => {
      const message = "Alias error in visualization";
      
      notifications.showAliasErrorForVisualization(message);

      expect(mockNotify).toHaveBeenCalledWith({
        type: "negative",
        message: message,
        multiLine: false,
        timeout: 0, // No timeout for alias errors
        actions: [
          {
            icon: "close",
            padding: "4px",
            style: "font-weight: bold",
            color: "white",
            handler: expect.any(Function),
          },
        ],
      });
    });

    it("should merge custom options with default configuration", () => {
      const message = "Alias error in visualization";
      const customOptions = {
        html: true,
        caption: "Error Details",
      };

      notifications.showAliasErrorForVisualization(message, customOptions);

      expect(mockNotify).toHaveBeenCalledWith({
        type: "negative",
        message: message,
        multiLine: false,
        timeout: 0,
        html: true, // Custom option
        caption: "Error Details", // Custom option
        actions: [
          {
            icon: "close",
            padding: "4px",
            style: "font-weight: bold",
            color: "white",
            handler: expect.any(Function),
          },
        ],
      });
    });
  });

  describe("showPositiveNotification", () => {
    it("should call quasar notify with positive configuration", () => {
      const message = "Operation completed successfully";
      
      notifications.showPositiveNotification(message);

      expect(mockNotify).toHaveBeenCalledWith({
        type: "positive",
        message: message,
        timeout: 5000,
        actions: [
          {
            icon: "close",
            color: "white",
            round: true,
            handler: expect.any(Function),
          },
        ],
      });
    });

    it("should merge custom options with default configuration", () => {
      const message = "Operation completed successfully";
      const customOptions = {
        timeout: 3000,
        position: "top",
      };

      notifications.showPositiveNotification(message, customOptions);

      expect(mockNotify).toHaveBeenCalledWith({
        type: "positive",
        message: message,
        timeout: 3000, // Custom timeout
        position: "top", // Custom position
        actions: [
          {
            icon: "close",
            color: "white",
            round: true,
            handler: expect.any(Function),
          },
        ],
      });
    });

    it("should return the result from quasar notify", () => {
      const mockResult = { dismiss: vi.fn() };
      mockNotify.mockReturnValue(mockResult);

      const message = "Success message";
      const result = notifications.showPositiveNotification(message);

      expect(result).toBe(mockResult);
    });
  });

  describe("showInfoNotification", () => {
    it("should call quasar notify with info configuration", () => {
      const message = "Information message";
      
      notifications.showInfoNotification(message);

      expect(mockNotify).toHaveBeenCalledWith({
        type: "info",
        message: message,
        timeout: 5000,
        actions: [
          {
            icon: "close",
            color: "white",
            round: true,
            handler: expect.any(Function),
          },
        ],
      });
    });

    it("should merge custom options with default configuration", () => {
      const message = "Information message";
      const customOptions = {
        timeout: 8000,
        icon: "info_outline",
      };

      notifications.showInfoNotification(message, customOptions);

      expect(mockNotify).toHaveBeenCalledWith({
        type: "info",
        message: message,
        timeout: 8000, // Custom timeout
        icon: "info_outline", // Custom icon
        actions: [
          {
            icon: "close",
            color: "white",
            round: true,
            handler: expect.any(Function),
          },
        ],
      });
    });

    it("should return the result from quasar notify", () => {
      const mockResult = { dismiss: vi.fn() };
      mockNotify.mockReturnValue(mockResult);

      const message = "Info message";
      const result = notifications.showInfoNotification(message);

      expect(result).toBe(mockResult);
    });
  });

  describe("composable structure", () => {
    it("should return all expected notification methods", () => {
      const composable = useNotifications();

      expect(composable.showErrorNotification).toBeTypeOf("function");
      expect(composable.showPositiveNotification).toBeTypeOf("function");
      expect(composable.showInfoNotification).toBeTypeOf("function");
      expect(composable.showConfictErrorNotificationWithRefreshBtn).toBeTypeOf("function");
      expect(composable.showAliasErrorForVisualization).toBeTypeOf("function");
    });

    it("should create independent instances", () => {
      const notifications1 = useNotifications();
      const notifications2 = useNotifications();

      // Both should be different instances but have the same methods
      expect(notifications1).not.toBe(notifications2);
      expect(typeof notifications1.showErrorNotification).toBe("function");
      expect(typeof notifications2.showErrorNotification).toBe("function");
    });
  });

  describe("edge cases", () => {
    it("should handle long messages gracefully", () => {
      const longMessage = "A".repeat(1000);
      
      notifications.showErrorNotification(longMessage);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: longMessage,
        })
      );
    });

    it("should handle special characters in messages", () => {
      const messageWithSpecialChars = "Error: <script>alert('test')</script> & other symbols 🚨";
      
      notifications.showInfoNotification(messageWithSpecialChars);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: messageWithSpecialChars,
        })
      );
    });

    it("should handle null message gracefully", () => {
      const nullMessage = null as any;
      
      notifications.showErrorNotification(nullMessage);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: nullMessage,
        })
      );
    });

    it("should handle undefined message gracefully", () => {
      const undefinedMessage = undefined as any;
      
      notifications.showPositiveNotification(undefinedMessage);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: undefinedMessage,
        })
      );
    });
  });

  describe("action handlers", () => {
    it("should have proper close button handlers for all notification types", () => {
      const message = "Test message";

      // Test each notification type
      notifications.showErrorNotification(message);
      notifications.showPositiveNotification(message);
      notifications.showInfoNotification(message);
      notifications.showAliasErrorForVisualization(message);

      // Each call should have actions with handlers
      expect(mockNotify).toHaveBeenCalledTimes(4);
      
      mockNotify.mock.calls.forEach(([config]) => {
        expect(config.actions).toHaveLength(config.type === "negative" && config.timeout === 0 && config.actions.length === 2 ? 2 : 1);
        config.actions.forEach((action: any) => {
          expect(action.handler).toBeTypeOf("function");
        });
      });
    });
  });
});