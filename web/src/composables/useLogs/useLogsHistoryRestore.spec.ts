//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { useLogsHistoryRestore } from "./useLogsHistoryRestore";

const Stub = { template: "<div />" };

const makeRouter = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/logs", name: "logs", component: Stub },
      { path: "/home", name: "home", component: Stub },
    ],
  });
  await router.push({ name: "logs", query: { stream: "app", query: "A" } });
  return router;
};

let stop: (() => void) | undefined;

afterEach(() => stop?.());

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("useLogsHistoryRestore", () => {
  it("restores when Back moves between two Logs searches", async () => {
    const router = await makeRouter();
    const onRestore = vi.fn();
    stop = useLogsHistoryRestore(router, onRestore);
    await router.push({ name: "logs", query: { stream: "app", query: "B" } });
    router.back();
    await settle();
    expect(onRestore).toHaveBeenCalledTimes(1);
    router.forward();
    await settle();
    expect(onRestore).toHaveBeenCalledTimes(2);
  });

  it("does not restore for a deliberate push", async () => {
    const router = await makeRouter();
    const onRestore = vi.fn();
    stop = useLogsHistoryRestore(router, onRestore);
    await router.push({ name: "logs", query: { stream: "app", query: "B" } });
    await settle();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("does not restore when Back leaves for another page", async () => {
    const router = await makeRouter();
    await router.push({ name: "home" });
    await router.push({ name: "logs", query: { stream: "app", query: "B" } });
    const onRestore = vi.fn();
    stop = useLogsHistoryRestore(router, onRestore);
    router.back();
    await settle();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("does not restore when Back only changes view state", async () => {
    const router = await makeRouter();
    const onRestore = vi.fn();
    stop = useLogsHistoryRestore(router, onRestore);
    await router.push({ name: "logs", query: { stream: "app", query: "A", page: "2" } });
    router.back();
    await settle();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("stops listening after cleanup", async () => {
    const router = await makeRouter();
    const onRestore = vi.fn();
    useLogsHistoryRestore(router, onRestore)();
    await router.push({ name: "logs", query: { stream: "app", query: "B" } });
    router.back();
    await settle();
    expect(onRestore).not.toHaveBeenCalled();
  });
});
