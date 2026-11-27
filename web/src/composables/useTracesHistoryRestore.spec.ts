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
import { useTracesHistoryRestore } from "./useTracesHistoryRestore";

const Stub = { template: "<div />" };

const makeRouter = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/traces", name: "traces", component: Stub },
      { path: "/home", name: "home", component: Stub },
    ],
  });
  await router.push({ name: "traces", query: { stream: "app", query: "A" } });
  return router;
};

let stop: (() => void) | undefined;

afterEach(() => stop?.());

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("useTracesHistoryRestore", () => {
  it("restores when Back and Forward move between two Traces searches", async () => {
    const router = await makeRouter();
    const onRestore = vi.fn();
    stop = useTracesHistoryRestore(router, onRestore);
    await router.push({ name: "traces", query: { stream: "app", query: "B" } });
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
    stop = useTracesHistoryRestore(router, onRestore);
    await router.push({ name: "traces", query: { stream: "app", query: "B" } });
    await settle();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("does not restore when Back changes only the open trace or the columns", async () => {
    const router = await makeRouter();
    const onRestore = vi.fn();
    stop = useTracesHistoryRestore(router, onRestore);
    await router.push({ name: "traces", query: { stream: "app", query: "A", trace_id: "t1" } });
    await router.push({ name: "traces", query: { stream: "app", query: "A", columns: "x" } });
    router.back();
    await settle();
    router.back();
    await settle();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("restores when Back changes the scope, Group by, SQL mode or time range", async () => {
    const router = await makeRouter();
    const onRestore = vi.fn();
    stop = useTracesHistoryRestore(router, onRestore);
    const steps = [
      { scope: "root" },
      { group_by: "service_name" },
      { sql_mode: "true" },
      { period: "1h" },
    ];
    for (const extra of steps) {
      await router.push({ name: "traces", query: { stream: "app", query: "A", ...extra } });
      router.back();
      await settle();
    }
    expect(onRestore).toHaveBeenCalledTimes(steps.length);
  });

  it("leaves a Back to another page to that page", async () => {
    const router = await makeRouter();
    const onRestore = vi.fn();
    stop = useTracesHistoryRestore(router, onRestore);
    await router.push({ name: "home" });
    router.back();
    await settle();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("stops listening once stopped", async () => {
    const router = await makeRouter();
    const onRestore = vi.fn();
    useTracesHistoryRestore(router, onRestore)();
    await router.push({ name: "traces", query: { stream: "app", query: "B" } });
    router.back();
    await settle();
    expect(onRestore).not.toHaveBeenCalled();
  });
});
