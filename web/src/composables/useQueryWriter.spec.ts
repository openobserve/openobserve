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

import { describe, it, expect } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { useQueryWriter } from "./useQueryWriter";

const LINK = "/status?section=status-pages&domains=A";

// A real router whose navigations wait on `gate`, so a write can be left uncommitted.
async function setup() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:rest(.*)*", component: { template: "<div />" } }],
  });
  let gate: Promise<void> | null = null;
  router.beforeEach(async () => {
    await gate;
  });
  await router.push("/start");
  await router.push(LINK);
  const route = {
    get query() {
      return router.currentRoute.value.query;
    },
  };
  return {
    router,
    writer: useQueryWriter(route, router),
    hold() {
      const held = Promise.withResolvers<void>();
      gate = held.promise;
      return held.resolve;
    },
  };
}

describe("useQueryWriter", () => {
  it("keeps the other keys, and drops a key written as undefined", async () => {
    const { router, writer } = await setup();

    await writer.write({ domains: undefined, folder: "f1" }, "replace");

    expect(router.currentRoute.value.query).toEqual({ section: "status-pages", folder: "f1" });
  });

  it("holds a key while it is in the URL or in a write that has not committed", async () => {
    const { writer, hold } = await setup();
    expect(writer.holds("domains")).toBe(true);
    const release = hold();

    const pending = writer.write({ domains: undefined }, "replace");
    expect(writer.holds("domains")).toBe(true);
    expect(writer.holds("folder")).toBe(false);
    release();
    await pending;

    expect(writer.holds("domains")).toBe(false);
  });

  it("leaves no history entry holding the link when a folder write overlaps its removal", async () => {
    const { router, writer, hold } = await setup();
    const release = hold();

    const removal = writer.write({ domains: undefined }, "replace");
    // The removal has not committed: the URL still carries the link.
    expect(router.currentRoute.value.query.domains).toBe("A");
    const folder = writer.write(
      { folder: "default" },
      writer.holds("domains") ? "replace" : "push",
    );
    release();
    await Promise.all([removal, folder]);

    expect(router.currentRoute.value.query).toEqual({ section: "status-pages", folder: "default" });
    router.back();
    await expect.poll(() => router.currentRoute.value.fullPath).toBe("/start");
  });

  it("builds a removal made after a pending folder write on top of it", async () => {
    const { router, writer, hold } = await setup();
    const release = hold();

    const folder = writer.write({ folder: "default" }, "replace");
    const removal = writer.write({ domains: undefined }, "replace");
    release();
    await Promise.all([folder, removal]);

    expect(router.currentRoute.value.query).toEqual({ section: "status-pages", folder: "default" });
    router.back();
    await expect.poll(() => router.currentRoute.value.fullPath).toBe("/start");
  });
});
