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

import { beforeEach, describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/vue-query";
import { alertKeys } from "./alerts.querykeys";
import { AlertReadUnsettledError, fenceAlertWrite, fetchAlertRead } from "./alerts.readFence";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

// Each call takes the next answer, so a test decides which read answers late and with what.
const answers = (...replies: Promise<unknown>[]) => {
  let calls = 0;
  const queryFn = () => replies[Math.min(calls++, replies.length - 1)];
  return { queryFn, calls: () => calls };
};

describe("alert read fence", () => {
  let client: QueryClient;
  // The fence is module state, so each test gets its own org and a write left running cannot block the next.
  let ORG = "";
  let detail: readonly unknown[] = [];
  let test = 0;
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    test += 1;
    ORG = `fence-org-${test}`;
    detail = alertKeys.detail(ORG, "al-1");
  });

  it("a read sent before a write and answered after it reads again", async () => {
    const late = deferred<{ v: number }>();
    const { queryFn, calls } = answers(late.promise, Promise.resolve({ v: 2 }));
    const read = fetchAlertRead(client, ORG, { queryKey: detail, queryFn });
    await fenceAlertWrite(client, ORG, async () => "written");
    late.resolve({ v: 1 });
    await expect(read).resolves.toEqual({ v: 2 });
    expect(calls()).toBe(2);
    expect(client.getQueryData(detail)).toEqual({ v: 2 });
  });

  it("a cached copy older than the write is not handed back when the late read is cancelled", async () => {
    client.setQueryData(detail, { v: 0 });
    await client.invalidateQueries({ queryKey: detail, refetchType: "none" });
    const late = deferred<{ v: number }>();
    const { queryFn } = answers(late.promise, Promise.resolve({ v: 2 }));
    const read = fetchAlertRead(client, ORG, { queryKey: detail, queryFn });
    await fenceAlertWrite(client, ORG, async () => "written");
    late.resolve({ v: 1 });
    await expect(read).resolves.toEqual({ v: 2 });
  });

  it("a read asked for while a write runs waits for it", async () => {
    const write = deferred<string>();
    const fenced = fenceAlertWrite(client, ORG, () => write.promise);
    const { queryFn, calls } = answers(Promise.resolve({ v: 2 }));
    const read = fetchAlertRead(client, ORG, { queryKey: detail, queryFn });
    await Promise.resolve();
    expect(calls()).toBe(0);
    write.resolve("written");
    await expect(fenced).resolves.toBe("written");
    await expect(read).resolves.toEqual({ v: 2 });
    expect(calls()).toBe(1);
  });

  it("a failed write still fences the reads and passes its error on", async () => {
    const late = deferred<{ v: number }>();
    const { queryFn } = answers(late.promise, Promise.resolve({ v: 2 }));
    const read = fetchAlertRead(client, ORG, { queryKey: detail, queryFn });
    await expect(
      fenceAlertWrite(client, ORG, async () => {
        throw new Error("409");
      }),
    ).rejects.toThrow("409");
    late.resolve({ v: 1 });
    await expect(read).resolves.toEqual({ v: 2 });
  });

  it("a read waiting on one write does not read while a write started after it is still pending", async () => {
    let server = 0;
    const a = deferred<void>();
    const b = deferred<void>();
    let calls = 0;
    const queryFn = async () => {
      calls += 1;
      return { v: server };
    };
    const writeA = fenceAlertWrite(client, ORG, async () => {
      await a.promise;
      server = 1;
    });
    const read = fetchAlertRead(client, ORG, { queryKey: detail, queryFn });
    const writeB = fenceAlertWrite(client, ORG, async () => {
      await b.promise;
      server = 2;
    });
    a.resolve();
    await writeA;
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(calls).toBe(0);
    b.resolve();
    await writeB;
    await expect(read).resolves.toEqual({ v: 2 });
  });

  it("a read crossed by a write on every attempt fails instead of handing back the older cached copy", async () => {
    client.setQueryData(detail, { v: 0 });
    await client.invalidateQueries({ queryKey: detail, refetchType: "none" });
    let server = 0;
    // Every attempt is crossed by a new write, so each answer is cancelled back to the cached { v: 0 }.
    const queryFn = () => {
      const n = server + 1;
      void fenceAlertWrite(client, ORG, async () => {
        server = n;
      });
      return new Promise<{ v: number }>((resolve) => setTimeout(() => resolve({ v: server }), 0));
    };
    await expect(fetchAlertRead(client, ORG, { queryKey: detail, queryFn })).rejects.toBeInstanceOf(
      AlertReadUnsettledError,
    );
    expect(server).toBeGreaterThan(0);
  });

  it("a write in another org leaves this org's reads alone", async () => {
    const late = deferred<{ v: number }>();
    const { queryFn, calls } = answers(late.promise);
    const read = fetchAlertRead(client, ORG, { queryKey: detail, queryFn });
    await fenceAlertWrite(client, "other-org", async () => "written");
    late.resolve({ v: 1 });
    await expect(read).resolves.toEqual({ v: 1 });
    expect(calls()).toBe(1);
  });

  it("a read that fails with no write in between fails as before", async () => {
    const { queryFn } = answers(Promise.reject(new Error("500")));
    await expect(fetchAlertRead(client, ORG, { queryKey: detail, queryFn })).rejects.toThrow("500");
  });
});
