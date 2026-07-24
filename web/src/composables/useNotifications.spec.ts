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

import { describe, expect, it, beforeEach, vi } from "vitest";
import useNotifications from "@/composables/useNotifications";
import { toastRecords } from "@/lib/feedback/Toast/useToast";

beforeEach(() => {
  toastRecords.splice(0, toastRecords.length);
  vi.useFakeTimers();
});

describe("useNotifications composable", () => {
  let notifications: ReturnType<typeof useNotifications>;

  beforeEach(() => {
    vi.clearAllMocks();
    notifications = useNotifications();
  });

  describe("showErrorNotification", () => {
    it("should add an error toast with default timeout 30000", () => {
      notifications.showErrorNotification("Test error message");
      expect(toastRecords).toHaveLength(1);
      expect(toastRecords[0].variant).toBe("error");
      expect(toastRecords[0].message).toBe("Test error message");
      expect(toastRecords[0].timeout).toBe(30000);
    });

    it("should respect custom timeout option", () => {
      notifications.showErrorNotification("Test error message", {
        timeout: 10000,
      });
      expect(toastRecords[0].timeout).toBe(10000);
    });

    it("should return a DismissFn", () => {
      const result = notifications.showErrorNotification("Test error message");
      expect(typeof result).toBe("function");
    });

    it("should dismiss the toast when DismissFn is called", () => {
      const dismiss = notifications.showErrorNotification("Test error message");
      expect(toastRecords[0].open).toBe(true);
      dismiss();
      expect(toastRecords[0].open).toBe(false);
    });
  });

  describe("showConfictErrorNotificationWithRefreshBtn", () => {
    it("should add an error toast with timeout 0 and a Refresh action", () => {
      notifications.showConfictErrorNotificationWithRefreshBtn("Conflict error occurred");
      expect(toastRecords).toHaveLength(1);
      expect(toastRecords[0].variant).toBe("error");
      expect(toastRecords[0].timeout).toBe(0);
      expect(toastRecords[0].action?.label).toBe("Refresh");
    });

    it("should call window.location.reload when refresh action handler is invoked", () => {
      const mockReload = vi.fn();
      Object.defineProperty(window, "location", {
        value: { reload: mockReload },
        writable: true,
      });
      notifications.showConfictErrorNotificationWithRefreshBtn("Conflict error occurred");
      toastRecords[0].action?.handler();
      expect(mockReload).toHaveBeenCalled();
    });

    it("should remain visible after default timeout (timeout: 0)", () => {
      notifications.showConfictErrorNotificationWithRefreshBtn("Conflict");
      vi.advanceTimersByTime(30000);
      expect(toastRecords[0].open).toBe(true);
    });
  });

  describe("showAliasErrorForVisualization", () => {
    it("should add an error toast with timeout 0", () => {
      notifications.showAliasErrorForVisualization("Alias error");
      expect(toastRecords[0].variant).toBe("error");
      expect(toastRecords[0].timeout).toBe(0);
    });
  });

  describe("showPositiveNotification", () => {
    it("should add a success toast with default timeout 5000", () => {
      notifications.showPositiveNotification("Saved!");
      expect(toastRecords[0].variant).toBe("success");
      expect(toastRecords[0].message).toBe("Saved!");
      expect(toastRecords[0].timeout).toBe(5000);
    });

    it("should auto-dismiss after timeout", () => {
      notifications.showPositiveNotification("Done", { timeout: 1000 });
      vi.advanceTimersByTime(1000);
      expect(toastRecords[0].open).toBe(false);
    });
  });

  describe("showInfoNotification", () => {
    it("should add an info toast with default timeout 5000", () => {
      notifications.showInfoNotification("FYI");
      expect(toastRecords[0].variant).toBe("info");
      expect(toastRecords[0].message).toBe("FYI");
      expect(toastRecords[0].timeout).toBe(5000);
    });
  });
});
