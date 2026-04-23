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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isStreamSelectionPersistenceEnabled,
  getPersistedStreamSelection,
  setPersistedStreamSelection,
  STREAM_SELECTION_STORAGE_KEYS,
} from "@/utils/streamSelectionPersistence";

/** Build a minimal store-like object for testing. */
function makeStore(persistEnabled: boolean, orgId = "default") {
  return {
    state: {
      zoConfig: { persist_last_selected_stream: persistEnabled },
      selectedOrganization: { identifier: orgId },
    },
  };
}

describe("streamSelectionPersistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── STREAM_SELECTION_STORAGE_KEYS ──────────────────────────────────────

  describe("STREAM_SELECTION_STORAGE_KEYS", () => {
    it("should expose base keys for logs, metrics, and traces", () => {
      expect(STREAM_SELECTION_STORAGE_KEYS.logs).toBe("o2_last_stream_logs");
      expect(STREAM_SELECTION_STORAGE_KEYS.metrics).toBe(
        "o2_last_stream_metrics",
      );
      expect(STREAM_SELECTION_STORAGE_KEYS.traces).toBe(
        "o2_last_stream_traces",
      );
    });
  });

  // ─── isStreamSelectionPersistenceEnabled ────────────────────────────────

  describe("isStreamSelectionPersistenceEnabled", () => {
    it("should return true when flag is true", () => {
      expect(isStreamSelectionPersistenceEnabled(makeStore(true))).toBe(true);
    });

    it("should return false when flag is false", () => {
      expect(isStreamSelectionPersistenceEnabled(makeStore(false))).toBe(false);
    });

    it("should return false when zoConfig is absent", () => {
      expect(
        isStreamSelectionPersistenceEnabled({ state: {} }),
      ).toBe(false);
    });

    it("should return false when store is empty", () => {
      expect(isStreamSelectionPersistenceEnabled({})).toBe(false);
    });
  });

  // ─── getPersistedStreamSelection ────────────────────────────────────────

  describe("getPersistedStreamSelection", () => {
    it("should return null when persistence is disabled, even if a value is stored", () => {
      localStorage.setItem("o2_last_stream_logs_default", "my-stream");
      expect(
        getPersistedStreamSelection(
          makeStore(false),
          STREAM_SELECTION_STORAGE_KEYS.logs,
        ),
      ).toBeNull();
    });

    it("should return null when nothing is stored and persistence is enabled", () => {
      expect(
        getPersistedStreamSelection(
          makeStore(true),
          STREAM_SELECTION_STORAGE_KEYS.logs,
        ),
      ).toBeNull();
    });

    it("should return the stored value when persistence is enabled", () => {
      localStorage.setItem("o2_last_stream_logs_default", "my-stream");
      expect(
        getPersistedStreamSelection(
          makeStore(true),
          STREAM_SELECTION_STORAGE_KEYS.logs,
        ),
      ).toBe("my-stream");
    });

    it("should scope reads to the current organization", () => {
      localStorage.setItem("o2_last_stream_logs_org-a", "stream-a");
      localStorage.setItem("o2_last_stream_logs_org-b", "stream-b");

      expect(
        getPersistedStreamSelection(
          makeStore(true, "org-a"),
          STREAM_SELECTION_STORAGE_KEYS.logs,
        ),
      ).toBe("stream-a");

      expect(
        getPersistedStreamSelection(
          makeStore(true, "org-b"),
          STREAM_SELECTION_STORAGE_KEYS.logs,
        ),
      ).toBe("stream-b");
    });

    it("should not return a stream persisted under a different organization", () => {
      localStorage.setItem("o2_last_stream_logs_org-a", "stream-a");

      expect(
        getPersistedStreamSelection(
          makeStore(true, "org-b"),
          STREAM_SELECTION_STORAGE_KEYS.logs,
        ),
      ).toBeNull();
    });

    it("should handle localStorage errors gracefully and return null", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => {
        throw new Error("SecurityError");
      });

      expect(
        getPersistedStreamSelection(
          makeStore(true),
          STREAM_SELECTION_STORAGE_KEYS.logs,
        ),
      ).toBeNull();
    });

    it("should work with traces key", () => {
      localStorage.setItem("o2_last_stream_traces_default", "trace-stream");
      expect(
        getPersistedStreamSelection(
          makeStore(true),
          STREAM_SELECTION_STORAGE_KEYS.traces,
        ),
      ).toBe("trace-stream");
    });

    it("should work with metrics key", () => {
      localStorage.setItem("o2_last_stream_metrics_default", "metrics-stream");
      expect(
        getPersistedStreamSelection(
          makeStore(true),
          STREAM_SELECTION_STORAGE_KEYS.metrics,
        ),
      ).toBe("metrics-stream");
    });
  });

  // ─── setPersistedStreamSelection ────────────────────────────────────────

  describe("setPersistedStreamSelection", () => {
    it("should not store value when persistence is disabled", () => {
      setPersistedStreamSelection(
        makeStore(false),
        STREAM_SELECTION_STORAGE_KEYS.logs,
        "my-stream",
      );
      expect(localStorage.getItem("o2_last_stream_logs_default")).toBeNull();
    });

    it("should store value when persistence is enabled", () => {
      setPersistedStreamSelection(
        makeStore(true),
        STREAM_SELECTION_STORAGE_KEYS.logs,
        "my-stream",
      );
      expect(localStorage.getItem("o2_last_stream_logs_default")).toBe(
        "my-stream",
      );
    });

    it("should remove stored value when null is passed", () => {
      localStorage.setItem("o2_last_stream_logs_default", "old-stream");
      setPersistedStreamSelection(
        makeStore(true),
        STREAM_SELECTION_STORAGE_KEYS.logs,
        null,
      );
      expect(localStorage.getItem("o2_last_stream_logs_default")).toBeNull();
    });

    it("should remove stored value when empty string is passed", () => {
      localStorage.setItem("o2_last_stream_logs_default", "old-stream");
      setPersistedStreamSelection(
        makeStore(true),
        STREAM_SELECTION_STORAGE_KEYS.logs,
        "",
      );
      expect(localStorage.getItem("o2_last_stream_logs_default")).toBeNull();
    });

    it("should not remove stored value when persistence is disabled and null is passed", () => {
      localStorage.setItem("o2_last_stream_logs_default", "my-stream");
      setPersistedStreamSelection(
        makeStore(false),
        STREAM_SELECTION_STORAGE_KEYS.logs,
        null,
      );
      // Persistence is off — utility should be a no-op, key remains untouched.
      expect(localStorage.getItem("o2_last_stream_logs_default")).toBe(
        "my-stream",
      );
    });

    it("should isolate storage per organization", () => {
      setPersistedStreamSelection(
        makeStore(true, "org-a"),
        STREAM_SELECTION_STORAGE_KEYS.logs,
        "stream-a",
      );
      setPersistedStreamSelection(
        makeStore(true, "org-b"),
        STREAM_SELECTION_STORAGE_KEYS.logs,
        "stream-b",
      );

      expect(localStorage.getItem("o2_last_stream_logs_org-a")).toBe(
        "stream-a",
      );
      expect(localStorage.getItem("o2_last_stream_logs_org-b")).toBe(
        "stream-b",
      );
    });

    it("should not cross-contaminate between organizations", () => {
      setPersistedStreamSelection(
        makeStore(true, "org-a"),
        STREAM_SELECTION_STORAGE_KEYS.logs,
        "stream-a",
      );

      // org-b was never written — reading org-b key returns null.
      expect(localStorage.getItem("o2_last_stream_logs_org-b")).toBeNull();
    });

    it("should handle localStorage setItem errors gracefully without throwing", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
        throw new Error("QuotaExceededError");
      });

      expect(() =>
        setPersistedStreamSelection(
          makeStore(true),
          STREAM_SELECTION_STORAGE_KEYS.logs,
          "my-stream",
        ),
      ).not.toThrow();
    });

    it("should handle localStorage removeItem errors gracefully without throwing", () => {
      vi.spyOn(Storage.prototype, "removeItem").mockImplementationOnce(() => {
        throw new Error("SecurityError");
      });

      expect(() =>
        setPersistedStreamSelection(
          makeStore(true),
          STREAM_SELECTION_STORAGE_KEYS.logs,
          null,
        ),
      ).not.toThrow();
    });
  });

  // ─── Multi-org switching scenario ───────────────────────────────────────

  describe("multi-organization switching", () => {
    it("should maintain independent selections across two organizations", () => {
      // User in org-a selects logs-stream-1
      setPersistedStreamSelection(
        makeStore(true, "org-a"),
        STREAM_SELECTION_STORAGE_KEYS.logs,
        "logs-stream-1",
      );

      // User switches to org-b and selects logs-stream-2
      setPersistedStreamSelection(
        makeStore(true, "org-b"),
        STREAM_SELECTION_STORAGE_KEYS.logs,
        "logs-stream-2",
      );

      // Switching back to org-a should restore org-a's selection
      expect(
        getPersistedStreamSelection(
          makeStore(true, "org-a"),
          STREAM_SELECTION_STORAGE_KEYS.logs,
        ),
      ).toBe("logs-stream-1");

      // org-b selection is preserved independently
      expect(
        getPersistedStreamSelection(
          makeStore(true, "org-b"),
          STREAM_SELECTION_STORAGE_KEYS.logs,
        ),
      ).toBe("logs-stream-2");
    });

    it("should store different stream types independently per org", () => {
      setPersistedStreamSelection(
        makeStore(true, "org-a"),
        STREAM_SELECTION_STORAGE_KEYS.logs,
        "log-stream",
      );
      setPersistedStreamSelection(
        makeStore(true, "org-a"),
        STREAM_SELECTION_STORAGE_KEYS.traces,
        "trace-stream",
      );
      setPersistedStreamSelection(
        makeStore(true, "org-a"),
        STREAM_SELECTION_STORAGE_KEYS.metrics,
        "metrics-stream",
      );

      expect(
        getPersistedStreamSelection(
          makeStore(true, "org-a"),
          STREAM_SELECTION_STORAGE_KEYS.logs,
        ),
      ).toBe("log-stream");
      expect(
        getPersistedStreamSelection(
          makeStore(true, "org-a"),
          STREAM_SELECTION_STORAGE_KEYS.traces,
        ),
      ).toBe("trace-stream");
      expect(
        getPersistedStreamSelection(
          makeStore(true, "org-a"),
          STREAM_SELECTION_STORAGE_KEYS.metrics,
        ),
      ).toBe("metrics-stream");
    });
  });
});
