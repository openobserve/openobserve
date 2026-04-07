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

import { describe, expect, it, vi, beforeEach } from "vitest";

// ---- Worker mock setup ----
class MockWorker {
  static instances: MockWorker[] = [];

  url: string;
  options: any;
  postMessageData: any;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((err: ErrorEvent) => void) | null = null;
  terminate = vi.fn();

  constructor(url: string, options?: any) {
    this.url = url;
    this.options = options;
    MockWorker.instances.push(this);
  }

  postMessage(data: any) {
    this.postMessageData = data;
  }

  // Helper: simulate the worker posting a message back
  simulateMessage(data: any) {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent);
    }
  }

  // Helper: simulate the worker emitting an error
  simulateError(err: any) {
    if (this.onerror) {
      this.onerror(err as ErrorEvent);
    }
  }
}

// Stub global Worker and URL.createObjectURL before importing the composable
vi.stubGlobal("Worker", MockWorker);
vi.stubGlobal("URL", {
  createObjectURL: vi.fn(() => "blob:mock-url"),
});

import { useWorker } from "./useWorker";

describe("useWorker", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.clearAllMocks();
  });

  it("returns an object with runWorker function", () => {
    const composable = useWorker();
    expect(composable).toHaveProperty("runWorker");
    expect(typeof composable.runWorker).toBe("function");
  });

  it("runWorker returns a Promise", () => {
    const { runWorker } = useWorker();
    const fn = (x: number) => x * 2;
    const result = runWorker(5, fn);
    expect(result).toBeInstanceOf(Promise);
    // Resolve to avoid unhandled promise warnings
    const worker = MockWorker.instances[0];
    worker.simulateMessage(10);
    return result;
  });

  it("Worker is created with a blob URL", async () => {
    const { runWorker } = useWorker();
    const fn = (x: number) => x;
    const promise = runWorker(42, fn);

    const worker = MockWorker.instances[0];
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(worker.url).toBe("blob:mock-url");

    worker.simulateMessage(42);
    await promise;
  });

  it("Worker is created with module type option", async () => {
    const { runWorker } = useWorker();
    const fn = (x: number) => x;
    const promise = runWorker(1, fn);

    const worker = MockWorker.instances[0];
    expect(worker.options).toEqual({ type: "module" });

    worker.simulateMessage(1);
    await promise;
  });

  it("Worker receives data via postMessage", async () => {
    const { runWorker } = useWorker();
    const inputData = { key: "value" };
    const fn = (d: any) => d;
    const promise = runWorker(inputData, fn);

    const worker = MockWorker.instances[0];
    expect(worker.postMessageData).toEqual(inputData);

    worker.simulateMessage(inputData);
    await promise;
  });

  it("resolves with the data emitted by the worker", async () => {
    const { runWorker } = useWorker();
    const fn = (x: number) => x * 3;
    const promise = runWorker(4, fn);

    const worker = MockWorker.instances[0];
    worker.simulateMessage(12);

    const result = await promise;
    expect(result).toBe(12);
  });

  it("worker is terminated after successful message", async () => {
    const { runWorker } = useWorker();
    const fn = (x: number) => x;
    const promise = runWorker(7, fn);

    const worker = MockWorker.instances[0];
    worker.simulateMessage(7);
    await promise;

    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects with the error emitted by the worker", async () => {
    const { runWorker } = useWorker();
    const fn = (x: number) => x;
    const promise = runWorker(1, fn);

    const worker = MockWorker.instances[0];
    const mockError = new Error("worker failure");
    worker.simulateError(mockError);

    await expect(promise).rejects.toThrow("worker failure");
  });

  it("worker is terminated after error", async () => {
    const { runWorker } = useWorker();
    const fn = (x: number) => x;
    const promise = runWorker(1, fn);

    const worker = MockWorker.instances[0];
    const mockError = new Error("oops");
    worker.simulateError(mockError);

    await expect(promise).rejects.toThrow();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("each runWorker call creates a distinct Worker instance", async () => {
    const { runWorker } = useWorker();
    const fn = (x: number) => x;

    const p1 = runWorker(1, fn);
    MockWorker.instances[0].simulateMessage(1);
    await p1;

    const p2 = runWorker(2, fn);
    MockWorker.instances[1].simulateMessage(2);
    await p2;

    expect(MockWorker.instances).toHaveLength(2);
    expect(MockWorker.instances[0]).not.toBe(MockWorker.instances[1]);
  });

  it("worker blob contains the stringified worker function", async () => {
    const { runWorker } = useWorker();
    const fn = (x: number) => x * 10;
    const blobSpy = vi.spyOn(global, "Blob" as any);

    const promise = runWorker(3, fn);
    const worker = MockWorker.instances[0];
    worker.simulateMessage(30);
    await promise;

    if (blobSpy.mock.calls.length > 0) {
      const blobContent: string = blobSpy.mock.calls[0][0][0];
      expect(blobContent).toContain(fn.toString());
    }
    blobSpy.mockRestore();
  });

  it("resolves with complex objects returned by the worker", async () => {
    const { runWorker } = useWorker();
    const fn = (d: any) => ({ ...d, processed: true });
    const promise = runWorker({ id: 1 }, fn);

    const responseData = { id: 1, processed: true };
    MockWorker.instances[0].simulateMessage(responseData);

    const result = await promise;
    expect(result).toEqual(responseData);
  });
});
