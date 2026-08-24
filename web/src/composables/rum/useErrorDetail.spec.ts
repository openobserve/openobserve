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
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";

vi.mock("@/services/search", () => ({
  default: { search: vi.fn() },
}));

// The payload's encoding decides whether the SQL is base64-wrapped, so the
// tests need to flip it.
const { payloadEncoding } = vi.hoisted(() => ({ payloadEncoding: { value: "" } }));

vi.mock("@/composables/useQuery", () => ({
  default: () => ({
    getTimeInterval: () => ({ interval: "1 hour" }),
    buildQueryPayload: () => ({ query: {}, encoding: payloadEncoding.value }),
  }),
}));

import searchService from "@/services/search";
import useErrorDetail from "@/composables/rum/useErrorDetail";
import { b64DecodeUnicode } from "@/utils/zincutils";

const HOUR_US = 3_600_000_000;
const WINDOW_START = Date.UTC(2026, 0, 10, 0, 0, 0) * 1000;
const WINDOW_END = WINDOW_START + 3 * HOUR_US;

const FULL_SCHEMA = {
  error_type: true,
  error_message: true,
  error_handling: true,
  session_id: true,
  usr_id: true,
  user_agent_user_agent_family: true,
  user_agent_os_family: true,
  version: true,
  view_url: true,
};

const SIGNATURE = {
  error_type: "TypeError",
  error_message: "boom",
  error_handling: "unhandled",
};

const store = createStore({
  state: {
    selectedOrganization: { identifier: "test-org" },
    zoConfig: { timestamp_column: "_timestamp" },
  },
});

/** `useStore()` requires an active component instance, so the composable is
 *  exercised through a throwaway host rather than called bare. */
const setup = () => {
  let api!: ReturnType<typeof useErrorDetail>;
  const host = defineComponent({
    setup() {
      api = useErrorDetail(((key: string) => key) as any);
      return () => null;
    },
  });
  mount(host, { global: { plugins: [store] } });
  return api;
};

const fetchParams = (overrides: Record<string, unknown> = {}) => ({
  signature: SIGNATURE,
  schema: { ...FULL_SCHEMA },
  startTime: WINDOW_START,
  endTime: WINDOW_END,
  ...overrides,
});

/** Resolve each search in call order with the given hit arrays. */
const respondInOrder = (...responses: any[][]) => {
  let call = 0;
  vi.mocked(searchService.search).mockImplementation(
    () => Promise.resolve({ data: { hits: responses[call++] ?? [] } }) as any,
  );
};

const impactHit = {
  events: 10,
  first_seen: WINDOW_START,
  last_seen: WINDOW_END,
  sessions_affected: 4,
  users_affected: 3,
};

describe("useErrorDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    payloadEncoding.value = "";
  });

  describe("impact", () => {
    it("exposes the issue's volume, reach and lifespan", async () => {
      respondInOrder([impactHit], [], [], []);
      const api = setup();

      await api.fetchDetail(fetchParams());

      expect(api.impact.value).toEqual({
        events: 10,
        usersAffected: 3,
        sessionsAffected: 4,
        firstSeen: WINDOW_START,
        lastSeen: WINDOW_END,
      });
    });

    it("reports a missing distinct count as null rather than zero", async () => {
      respondInOrder([{ events: 5, first_seen: 1, last_seen: 2 }], [], [], []);
      const api = setup();

      await api.fetchDetail(fetchParams());

      expect(api.impact.value?.usersAffected).toBeNull();
      expect(api.impact.value?.sessionsAffected).toBeNull();
    });

    it("clears the loading flag once impact lands", async () => {
      respondInOrder([impactHit], [], [], []);
      const api = setup();

      await api.fetchDetail(fetchParams());

      expect(api.isLoadingImpact.value).toBe(false);
      expect(api.isLoadingInsights.value).toBe(false);
    });
  });

  describe("weak signature", () => {
    it("skips every search when the error cannot be grouped", async () => {
      const api = setup();

      await api.fetchDetail(fetchParams({ signature: { error_handling: "unhandled" } }));

      expect(searchService.search).not.toHaveBeenCalled();
      expect(api.hasSignature.value).toBe(false);
      expect(api.impact.value).toBeNull();
    });
  });

  describe("occurrences and facets", () => {
    it("zero-fills the occurrence series across the window", async () => {
      respondInOrder([impactHit], [{ ts: WINDOW_START, events: 4 }], [], []);
      const api = setup();

      await api.fetchDetail(fetchParams());

      expect(api.occurrences.value.map((bucket) => bucket.events)).toEqual([4, 0, 0]);
    });

    it("pivots each group-by result into its own facet", async () => {
      respondInOrder(
        [impactHit],
        [],
        [
          { user_agent_user_agent_family: "Safari", user_agent_os_family: "Mac", events: 9 },
          { user_agent_user_agent_family: "Chrome", user_agent_os_family: "Mac", events: 1 },
        ],
        [{ version: "2.4.1", view_url: "/plans", events: 10 }],
      );
      const api = setup();

      await api.fetchDetail(fetchParams());

      expect(api.facets.value.browser).toEqual([
        { value: "Safari", events: 9, share: 0.9 },
        { value: "Chrome", events: 1, share: 0.1 },
      ]);
      expect(api.facets.value.os).toEqual([{ value: "Mac", events: 10, share: 1 }]);
      expect(api.facets.value.release).toEqual([{ value: "2.4.1", events: 10, share: 1 }]);
      expect(api.facets.value.page).toEqual([{ value: "/plans", events: 10, share: 1 }]);
    });

    it("leaves facets empty when the stream has none of their columns", async () => {
      respondInOrder([impactHit], []);
      const api = setup();

      await api.fetchDetail(
        fetchParams({ schema: { error_type: true, error_message: true, session_id: true } }),
      );

      expect(api.facets.value).toEqual({ browser: [], os: [], release: [], page: [] });
    });

    it("skips the breakdown searches when the issue has no events", async () => {
      respondInOrder([{ events: 0 }]);
      const api = setup();

      await api.fetchDetail(fetchParams());

      expect(searchService.search).toHaveBeenCalledTimes(1);
      expect(api.occurrences.value).toEqual([]);
    });
  });

  describe("failure handling", () => {
    it("leaves the panels empty when the impact search fails", async () => {
      vi.mocked(searchService.search).mockRejectedValue(new Error("boom"));
      const api = setup();

      await api.fetchDetail(fetchParams());

      expect(api.impact.value).toBeNull();
      expect(api.isLoadingImpact.value).toBe(false);
      expect(api.isLoadingInsights.value).toBe(false);
    });

    it("keeps the facets that succeeded when one group-by search fails", async () => {
      let call = 0;
      vi.mocked(searchService.search).mockImplementation(() => {
        call += 1;
        if (call === 1) return Promise.resolve({ data: { hits: [impactHit] } }) as any;
        if (call === 3) return Promise.reject(new Error("browser facet failed")) as any;
        if (call === 4) {
          return Promise.resolve({
            data: { hits: [{ version: "2.4.1", view_url: "/plans", events: 10 }] },
          }) as any;
        }
        return Promise.resolve({ data: { hits: [] } }) as any;
      });
      const api = setup();

      await api.fetchDetail(fetchParams());

      expect(api.facets.value.browser).toEqual([]);
      expect(api.facets.value.release).toEqual([{ value: "2.4.1", events: 10, share: 1 }]);
    });
  });

  describe("request payload", () => {
    it("sends plain SQL when the payload is not base64-encoded", async () => {
      respondInOrder([impactHit], [], [], []);
      const api = setup();

      await api.fetchDetail(fetchParams());

      const sent = vi.mocked(searchService.search).mock.calls[0][0] as any;
      expect(sent.query.query.sql).toContain("COUNT(*) AS events");
      expect(sent.org_identifier).toBe("test-org");
    });

    it("base64-encodes the SQL when the payload asks for it", async () => {
      payloadEncoding.value = "base64";
      respondInOrder([impactHit], [], [], []);
      const api = setup();

      await api.fetchDetail(fetchParams());

      const sent = vi.mocked(searchService.search).mock.calls[0][0] as any;
      expect(sent.query.query.sql).not.toContain("COUNT(*)");
      expect(b64DecodeUnicode(sent.query.query.sql)).toContain("COUNT(*) AS events");
    });

    it("treats a response without hits as no data", async () => {
      vi.mocked(searchService.search).mockResolvedValue({ data: {} } as any);
      const api = setup();

      await api.fetchDetail(fetchParams());

      expect(api.impact.value?.events).toBe(0);
    });
  });

  describe("superseded runs", () => {
    it("commits only the latest run's results", async () => {
      let call = 0;
      vi.mocked(searchService.search).mockImplementation(() => {
        call += 1;
        // The first run's impact search resolves LAST, after the second run
        // has already replaced it.
        if (call === 1) {
          return new Promise((resolve) =>
            queueMicrotask(() =>
              queueMicrotask(() => resolve({ data: { hits: [{ events: 999 }] } } as any)),
            ),
          ) as any;
        }
        return Promise.resolve({ data: { hits: [impactHit] } }) as any;
      });
      const api = setup();

      const stale = api.fetchDetail(fetchParams());
      await api.fetchDetail(fetchParams());
      await stale;

      expect(api.impact.value?.events).toBe(10);
    });
  });

  describe("cancellation", () => {
    it("stops reporting progress after cancelAll", async () => {
      respondInOrder([impactHit], [], [], []);
      const api = setup();

      const inFlight = api.fetchDetail(fetchParams());
      api.cancelAll();
      await inFlight;

      expect(api.isLoadingImpact.value).toBe(false);
      expect(api.isLoadingInsights.value).toBe(false);
    });
  });
});
