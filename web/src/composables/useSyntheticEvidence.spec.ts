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
import { useSyntheticEvidence } from "./useSyntheticEvidence";

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
});
