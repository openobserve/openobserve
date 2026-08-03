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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { nextTick, ref } from "vue";
import {
  EVIDENCE_ERROR_MESSAGE,
  evidenceErrorCanRetry,
  evidenceErrorNeedsReload,
  useSyntheticEvidence,
} from "./useSyntheticEvidence";
import syntheticsService from "@/services/synthetics";

// Only the URL-shape predicate is used here; the composable deliberately does
// its own raw fetch rather than going through this service's axios wrapper.
vi.mock("@/services/synthetics", () => ({
  default: { isProxyArtifactUrl: vi.fn(() => false) },
}));

const NDJSON = [
  '{"ts":100,"kind":"response","method":"GET","url":"https://app.dev/a","status":200,"initiated_ts":90,"duration_ms":10,"first_party":true,"step_id":"s1"}',
  '{"ts":200,"kind":"console","level":"error","text":"boom","step_id":"s1"}',
  '{"ts":300,"kind":"response","method":"GET","url":"https://app.dev/b","status":503,"initiated_ts":290,"first_party":true,"step_id":"s2"}',
  '{"ts":400,"kind":"console","level":"log","text":"unattributed line"}',
].join("\n");

const STEP_DEFS = ref(
  new Map([
    ["s1", { name: "Go to login", selector: null }],
    ["s2", { name: "Click Sign In", selector: null }],
  ]),
);

function setup(key: string | null = "bundle.ndjson", truncated = false) {
  const evidenceKey = ref(key);
  const recordTruncated = ref(truncated);
  const api = useSyntheticEvidence(
    evidenceKey,
    (k: string) => `/artifact?key=${k}`,
    STEP_DEFS,
    recordTruncated,
  );
  return { evidenceKey, recordTruncated, ...api };
}

describe("useSyntheticEvidence", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => NDJSON,
    })) as any;
  });

  it("fetches once no matter how many consumers ask", async () => {
    // Both the step expansion and the Evidence tab call load(); the bundle runs
    // to 256 KB at the cap and must not be fetched twice.
    const { load, status } = setup();
    await Promise.all([load(), load(), load()]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(status.value).toBe("ready");
  });

  it("is a no-op once loaded", async () => {
    const { load } = setup();
    await load();
    await load();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("resolves each event's step name from the run's own snapshot", async () => {
    const { load, events } = setup();
    await load();
    expect(events.value.find((e) => e.stepId === "s1")?.stepName).toBe("Go to login");
  });

  it("leaves an unattributed event's step name null rather than guessing", async () => {
    const { load, events } = setup();
    await load();
    expect(events.value.find((e) => e.stepId === null)?.stepName).toBeNull();
  });

  it("indexes by step and counts what could not be attributed", async () => {
    const { load, eventsByStep, unattributedCount } = setup();
    await load();
    expect(eventsByStep.value.get("s1")).toHaveLength(2);
    expect(eventsByStep.value.get("s2")).toHaveLength(1);
    expect(unattributedCount.value).toBe(1);
  });

  it("resets when the attempt changes, so bundles never cross labels", async () => {
    const { load, evidenceKey, status, events } = setup();
    await load();
    expect(events.value).toHaveLength(4);
    evidenceKey.value = "attempt-2-evidence.ndjson";
    await nextTick();
    expect(status.value).toBe("idle");
    expect(events.value).toHaveLength(0);
    await load();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect((globalThis.fetch as any).mock.calls[1][0]).toContain("attempt-2-evidence.ndjson");
  });

  it("reports a failed fetch instead of rendering a quiet run", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "",
    })) as any;
    const { load, status, error, events } = setup();
    await load();
    expect(status.value).toBe("error");
    expect(error.value).toContain("403");
    expect(events.value).toEqual([]);
  });

  it("retries only when forced, since an error is otherwise settled", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "",
    })) as any;
    const { load } = setup();
    await load();
    await load();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await load(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("does nothing at all when the attempt has no bundle", async () => {
    const { load, status } = setup(null);
    await load();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(status.value).toBe("idle");
  });

  it("reports truncation from either the record or a truncation event", async () => {
    const fromRecord = setup("bundle.ndjson", true);
    await fromRecord.load();
    expect(fromRecord.truncated.value).toBe(true);

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => '{"ts":1,"kind":"truncation","step_id":"s1"}',
    })) as any;
    const fromEvent = setup("other.ndjson", false);
    await fromEvent.load();
    expect(fromEvent.truncated.value).toBe(true);
  });

  /**
   * The two URL kinds need OPPOSITE credentials and each fails closed with the
   * other's setting.
   *
   * The proxy endpoint is cookie-authed, and a cross-origin `fetch` omits
   * cookies unless asked — which is what turned a proxy-mode bundle into a bare
   * "401 Unauthorized" on every split-origin deployment (any dev setup with
   * VITE_OPENOBSERVE_ENDPOINT pointed elsewhere). Object storage sends no
   * `Access-Control-Allow-Credentials`, so asking there fails CORS instead.
   */
  describe("fetch credentials", () => {
    it("sends cookies to our own proxy endpoint", async () => {
      vi.mocked(syntheticsService.isProxyArtifactUrl).mockReturnValue(true);
      const { load } = setup();
      await load();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ credentials: "include" }),
      );
    });

    it("withholds cookies from a presigned object URL", async () => {
      vi.mocked(syntheticsService.isProxyArtifactUrl).mockReturnValue(false);
      const { load } = setup();
      await load();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ credentials: "omit" }),
      );
    });
  });

  /**
   * "401 Unauthorized" in a banner tells the reader nothing about whether the
   * RUN broke, their session died, or the evidence simply aged out. Each has a
   * different response, so the kind is classified here and the panel writes the
   * sentence.
   */
  describe("error classification", () => {
    function failWith(httpStatus: number, statusText = "") {
      globalThis.fetch = vi.fn(async () => ({
        ok: false,
        status: httpStatus,
        statusText,
        text: async () => "",
      })) as any;
    }

    it.each([
      [401, "unauthorized"],
      [403, "expired"],
      [404, "missing"],
      [410, "missing"],
      [500, "server"],
      [502, "server"],
    ])("classifies HTTP %i as %s", async (httpStatus, kind) => {
      failWith(httpStatus);
      const { load, status, errorKind } = setup();
      await load();
      expect(status.value).toBe("error");
      expect(errorKind.value).toBe(kind);
    });

    it("classifies a rejected fetch as unreachable, not as a server error", async () => {
      // No response ever existed — DNS, TLS, offline, or a refused CORS
      // preflight. Reporting that as a server error points at the wrong system.
      globalThis.fetch = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }) as any;
      const { load, status, errorKind, error } = setup();
      await load();
      expect(status.value).toBe("error");
      expect(errorKind.value).toBe("unreachable");
      expect(error.value).toContain("Failed to fetch");
    });

    it("keeps the raw status as detail alongside the kind", async () => {
      failWith(401, "Unauthorized");
      const { load, error, errorKind } = setup();
      await load();
      expect(errorKind.value).toBe("unauthorized");
      // Still readable — it is the first thing anyone debugging this asks for.
      expect(error.value).toBe("401 Unauthorized");
    });

    it("clears the kind when the attempt changes", async () => {
      failWith(500);
      const { load, evidenceKey, errorKind } = setup();
      await load();
      expect(errorKind.value).toBe("server");
      evidenceKey.value = "attempt-1-bundle.ndjson";
      await nextTick();
      expect(errorKind.value).toBeNull();
    });
  });
});

describe("evidence error affordances", () => {
  it("offers a reload where retrying the same URL cannot help", () => {
    // A dead session and an aged-out signature both survive a Retry against the
    // stale URL; only a reload re-mints one and re-authenticates the other.
    expect(evidenceErrorNeedsReload("unauthorized")).toBe(true);
    expect(evidenceErrorNeedsReload("expired")).toBe(true);
    expect(evidenceErrorNeedsReload("unreachable")).toBe(false);
    expect(evidenceErrorNeedsReload("server")).toBe(false);
  });

  it("does not offer a retry for a bundle storage says is gone", () => {
    expect(evidenceErrorCanRetry("missing")).toBe(false);
    expect(evidenceErrorCanRetry("unreachable")).toBe(true);
    expect(evidenceErrorCanRetry("server")).toBe(true);
  });

  it("has a message for every kind, so none can render blank", () => {
    for (const kind of ["unauthorized", "expired", "missing", "unreachable", "server"] as const) {
      expect(EVIDENCE_ERROR_MESSAGE[kind]).toMatch(/^synthetics\.evidence\./);
    }
  });
});
