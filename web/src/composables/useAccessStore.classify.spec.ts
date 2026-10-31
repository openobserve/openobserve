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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, reactive } from "vue";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import {
  accessPermission,
  currentAccessRouteKey,
  extractResourceInfo,
  noteAccessSuccess,
  recordForbidden,
  resetAccess,
  useAccessBoundary,
} from "@/composables/useAccessStore";

const Blank = defineComponent({ render: () => h("div") });
const state = reactive({ selectedOrganization: { identifier: "acme" }, userInfo: {} });
let router: Router;
let access: ReturnType<typeof useAccessBoundary>;

async function boot(path: string) {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/users", name: "users", component: Blank, meta: { accessResource: "users" } },
      { path: "/roles", name: "roles", component: Blank, meta: { accessResource: "roles" } },
      { path: "/settings", name: "settings", component: Blank },
    ],
  });
  await router.push(path);
  const Host = defineComponent({
    setup() {
      access = useAccessBoundary();
      return () => h("div");
    },
  });
  mount(Host, { global: { plugins: [router], provide: { store: { state } } } });
}

const forbidden = (method: string, url: string, routeKey = currentAccessRouteKey()) =>
  recordForbidden({ method, url, routeKey });

describe("access store classification", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.selectedOrganization.identifier = "acme";
    resetAccess();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetAccess();
  });

  it("surfaces a denied bulk delete on a resource whose caller no longer toasts a 403", async () => {
    await boot("/settings");
    for (const url of [
      "/api/acme/cipher_keys/bulk",
      "/api/acme/groups/bulk",
      "/api/acme/service_accounts/bulk",
      "/api/acme/re_patterns/bulk",
    ])
      forbidden("DELETE", url);
    expect(access.sectionEntries.value.map((e) => e.resource.key).sort()).toEqual([
      "cipher_keys",
      "groups",
      "re_patterns",
      "service_accounts",
    ]);
  });

  it("names the collection, not the item, for a named item in the path", () => {
    expect(extractResourceInfo("/api/acme/functions/my_fn")?.key).toBe("functions");
    expect(extractResourceInfo("/api/acme/roles/developer")?.key).toBe("roles");
    expect(extractResourceInfo("/api/acme/alerts/templates/oncall")?.key).toBe("templates");
    expect(extractResourceInfo("/api/acme/alerts/destinations/pager")?.key).toBe("destinations");
    expect(accessPermission("GET", "/api/acme/functions/my_fn")).toBe("get");
    expect(accessPermission("GET", "/api/acme/functions")).toBe("list");
    expect(accessPermission("GET", "/api/acme/users/roles/all")).toBe("list");
  });

  it("ignores a late 403 from the org the user switched away from", async () => {
    await boot("/users");
    const stamp = currentAccessRouteKey();
    state.selectedOrganization.identifier = "beta";
    resetAccess();
    forbidden("GET", "/api/acme/users", stamp);
    expect(access.pageDenied.value).toBe(false);
  });

  it("clears a remembered write denial once the same write succeeds", async () => {
    await boot("/settings");
    forbidden("DELETE", "/api/acme/functions/my_fn");
    expect(access.sectionEntries.value).toHaveLength(1);
    noteAccessSuccess({
      method: "delete",
      url: "/api/acme/functions/my_fn",
      routeKey: currentAccessRouteKey(),
    });
    expect(access.sectionEntries.value).toHaveLength(0);
  });

  it("never locks a readable page for a denied write, however slow its response", async () => {
    await boot("/users");
    document.body.innerHTML = "<button id='b'>Delete</button>";
    document.getElementById("b")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    document.body.innerHTML = "";
    vi.advanceTimersByTime(5001);
    forbidden("DELETE", "/api/acme/users/bulk");
    expect(access.pageDenied.value).toBe(false);
    expect(access.sectionEntries.value.map((e) => e.permission)).toEqual(["delete"]);
  });

  it("keeps a List lock when only a Get on the same resource succeeds", async () => {
    await boot("/roles");
    forbidden("GET", "/api/acme/roles");
    expect(access.pageDenied.value).toBe(true);
    noteAccessSuccess({
      method: "get",
      url: "/api/acme/users/reviewer@example.com/roles",
      routeKey: currentAccessRouteKey(),
    });
    expect(access.pageDenied.value).toBe(true);
    noteAccessSuccess({ method: "get", url: "/api/acme/roles", routeKey: currentAccessRouteKey() });
    expect(access.pageDenied.value).toBe(false);
  });
  it("keeps a readable page when only a sub-read of its resource is denied", async () => {
    await boot("/roles");
    forbidden("GET", "/api/acme/users/roles/all");
    expect(access.pageDenied.value).toBe(false);
    expect(access.sectionEntries.value.map((e) => e.resource.key)).toEqual(["roles"]);
  });

  it("reports a denied write on a resource with no friendly name", async () => {
    await boot("/settings");
    forbidden("POST", "/api/acme/storage");
    expect(access.sectionEntries.value.map((e) => [e.permission, e.requests])).toEqual([
      ["create", ["POST /api/acme/storage"]],
    ]);
    forbidden("GET", "/api/acme/storage");
    expect(access.sectionEntries.value).toHaveLength(1);
  });

  it("keeps one object's denial when a different object of the same resource succeeds", async () => {
    await boot("/settings");
    forbidden("GET", "/api/acme/functions/secret");
    noteAccessSuccess({
      method: "get",
      url: "/api/acme/functions/readable",
      routeKey: currentAccessRouteKey(),
    });
    expect(access.sectionEntries.value).toHaveLength(1);
    noteAccessSuccess({
      method: "get",
      url: "/api/acme/functions/secret",
      routeKey: currentAccessRouteKey(),
    });
    expect(access.sectionEntries.value).toHaveLength(0);
  });
});
