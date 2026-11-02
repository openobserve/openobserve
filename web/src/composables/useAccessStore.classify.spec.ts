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
import { createI18n } from "vue-i18n";
import en from "@/locales/languages/en-US.json";
import type { TranslateFn } from "@/types/i18n";
import {
  accessDeniedMessage,
  accessPermission,
  accessDetails,
  accessReason,
  bindAccess,
  currentAccessRouteKey,
  extractResourceInfo,
  noteAccessSuccess,
  recordForbidden,
  resetAccess,
  useAccessBoundary,
} from "@/composables/useAccessStore";

const t = createI18n({ legacy: false, locale: "en", messages: { en } }).global
  .t as unknown as TranslateFn;
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
      {
        path: "/dashboards/view",
        name: "viewDashboard",
        component: Blank,
        meta: { accessScopeQuery: ["dashboard"] },
      },
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

const ID = "2nY8xTq3sJk9LmN0pQrStUvWxYz";
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
    forbidden("GET", "/api/acme/roles/developer/users");
    expect(access.pageDenied.value).toBe(false);
    expect(access.sectionEntries.value.map((e) => [e.resource.key, e.permission])).toEqual([
      ["roles", "list"],
    ]);
  });

  it("reports a denied write on a resource with no friendly name", async () => {
    await boot("/settings");
    forbidden("POST", "/api/acme/short");
    expect(access.sectionEntries.value.map((e) => [e.permission, e.requests])).toEqual([
      ["create", ["POST /api/acme/short"]],
    ]);
  });

  it("reports a denied read on a resource with no friendly name, and clears it on success", async () => {
    await boot("/settings");
    forbidden("GET", "/api/acme/domain_management");
    expect(
      access.sectionEntries.value.map((e) => [e.resource.key, e.permission, e.requests]),
    ).toEqual([["_unnamed/domain_management", "list", ["GET /api/acme/domain_management"]]]);
    const message = accessDeniedMessage(access.sectionEntries.value, t);
    expect(message.title).toBe("You can't view this resource");
    expect(message.groups).toEqual([]);
    expect(message.askAdmin).toBe(true);
    noteAccessSuccess({
      method: "get",
      url: "/api/acme/domain_management",
      routeKey: currentAccessRouteKey(),
    });
    expect(access.sectionEntries.value).toHaveLength(0);
  });

  it("keeps app-shell reads and reads a view's own lock names out of the section notice", async () => {
    await boot("/settings");
    for (const url of [
      "/api/acme/summary",
      "/api/acme/settings/v2/org/home",
      "/api/acme/announcements/config",
      "/api/acme/ai/chats",
      "/api/v2/acme/downtimes/2nY8xTq3sJk9LmN0pQrStUvWxYz",
      "/api/acme/fleet/configs/edge",
      "/api/acme/dashboards/2nY8xTq3sJk9LmN0pQrStUvWxYz/public_links",
    ])
      forbidden("GET", url);
    expect(access.sectionEntries.value).toEqual([]);
  });

  it("reports a refused write on an app-shell path, but not a refused read of it", async () => {
    await boot("/settings");
    forbidden("GET", "/api/acme/announcements/config");
    forbidden("GET", "/api/acme/settings");
    expect(access.sectionEntries.value).toEqual([]);
    forbidden("PUT", "/api/acme/announcements/config");
    forbidden("POST", "/api/acme/settings");
    forbidden("PUT", "/api/acme/settings/v2/org/home");
    expect(access.sectionEntries.value.flatMap((e) => e.requests).sort()).toEqual([
      "POST /api/acme/settings",
      "PUT /api/acme/announcements/config",
      "PUT /api/acme/settings/v2/org/home",
    ]);
  });

  it("keeps one dashboard's denial off another dashboard, and brings it back on return", async () => {
    await boot("/dashboards/view?dashboard=A");
    forbidden("GET", "/api/acme/dashboards/A");
    expect(access.sectionEntries.value).toHaveLength(1);
    const lateFromA = currentAccessRouteKey();
    await router.push("/dashboards/view?dashboard=B");
    expect(access.sectionEntries.value).toEqual([]);
    forbidden("GET", "/api/acme/dashboards/A", lateFromA);
    expect(access.sectionEntries.value).toEqual([]);
    await router.push("/dashboards/view?dashboard=A&tab=second");
    expect(access.sectionEntries.value.flatMap((e) => e.requests)).toEqual([
      "GET /api/acme/dashboards/A",
    ]);
    const stored = JSON.parse(sessionStorage.getItem("o2.access.memory.acme") ?? "{}");
    expect(Object.keys(stored.sections)).toEqual(["viewDashboard?dashboard=A"]);
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

  it("leaves a route unnamed when the server checks no role resource for it", () => {
    for (const url of [
      "/api/acme/domain_management",
      "/api/acme/password_complexity",
      `/api/acme/short/${ID}`,
      "/api/acme/prometheus/api/v1/format_query",
      "/api/acme/gen_ai/agents",
      "/api/acme/service_streams/_analytics",
      "/api/acme/service_streams/config/identity",
      "/api/usertoken",
      "/api/users/verifyuser/reviewer@example.com",
      "/api/attachements/key",
      "/api/invites",
    ])
      expect(extractResourceInfo(url), url).toBeNull();
  });

  it.each([
    ["GET", "/api/acme/synthetics/variables"],
    ["GET", "/api/acme/synthetics/environments"],
    ["GET", "/api/acme/synthetics/environments/global/variables"],
    ["GET", "/api/acme/oncall/contacts/reviewer@example.com"],
    ["PUT", "/api/acme/oncall/contacts/reviewer@example.com"],
    ["DELETE", "/api/acme/oncall/contacts/reviewer@example.com"],
    ["POST", "/api/acme/oncall/contacts/reviewer@example.com/verify"],
    ["POST", "/api/acme/oncall/contacts/reviewer@example.com/verify/confirm"],
    ["POST", `/api/acme/org_cleanup_tasks/${ID}/retry`],
    // The server checks a raw PATCH, which no role permission grants.
    ["PATCH", `/api/v2/acme/folders/alerts/${ID}/move`],
  ])("leaves %s %s unnamed, as the server bypasses its role check", (method, url) => {
    expect(extractResourceInfo(url, method)).toBeNull();
  });

  it.each([
    ["GET", "/api/acme/synthetics/variables", "You can't view this resource"],
    ["GET", "/api/acme/oncall/contacts/reviewer@example.com", "You can't view this resource"],
    ["PUT", "/api/acme/oncall/contacts/reviewer@example.com", "You can't edit this resource"],
    ["POST", `/api/acme/org_cleanup_tasks/${ID}/retry`, "You can't create this resource"],
    ["PATCH", `/api/v2/acme/folders/alerts/${ID}/move`, "You can't edit this resource"],
    ["POST", "/api/acme/_search_stream?type=logs", "You can't view this resource"],
  ])("names no permission for %s %s, which no role grant lifts", async (method, url, title) => {
    await boot("/settings");
    forbidden(method, url);
    const entries = access.sectionEntries.value;
    const message = accessDeniedMessage(entries, t);
    expect(message.title).toBe(title);
    expect(message.groups).toEqual([]);
    expect(message.askAdmin).toBe(true);
    expect(message.count).toBe(1);
    expect(accessDetails(entries)).toContain(`${method} ${new URL(url, "http://x").pathname}`);
  });

  it("keeps an unnamed write on an unknown path asking for its permission", async () => {
    await boot("/settings");
    forbidden("POST", "/api/acme/short");
    const message = accessDeniedMessage(access.sectionEntries.value, t);
    expect(message.askAdmin).toBe(false);
    expect(accessReason(message.groups[0], t)).toBe(
      "Your role is missing the Create permission on this resource.",
    );
  });

  it("asks for Update, not Create, on a POST that toggles existing items", () => {
    expect(accessPermission("POST", "/api/acme/alerts/bulk/enable")).toBe("update");
    expect(accessPermission("POST", "/api/acme/pipelines/bulk/disable")).toBe("update");
    expect(accessPermission("POST", "/api/acme/alerts")).toBe("create");
  });

  it("keeps the list lock when only a sub-read of the same resource succeeds", async () => {
    await boot("/roles");
    forbidden("GET", "/api/acme/roles");
    noteAccessSuccess({
      method: "get",
      url: "/api/acme/users/roles/all",
      routeKey: currentAccessRouteKey(),
    });
    expect(access.pageDenied.value).toBe(true);
  });

  // Each row mirrors the server's route permission table, so the message names what an admin must grant.
  it.each([
    ["GET", "/api/v2/acme/alerts", "alert_folders", "list", "List", "Alert folders"],
    ["POST", "/api/v2/acme/alerts", "alert_folders", "create", "Create", "Alert folders"],
    ["GET", "/api/acme/dashboards", "folders", "list", "List", "Dashboard folders"],
    ["POST", "/api/acme/dashboards", "folders", "create", "Create", "Dashboard folders"],
    ["POST", `/api/v2/acme/alerts/${ID}/ack`, "alerts", "get", "Get", "Alerts"],
    ["POST", `/api/v2/acme/alerts/${ID}/unack`, "alerts", "get", "Get", "Alerts"],
    ["POST", `/api/v2/acme/alerts/${ID}/mute`, "alerts", "get", "Get", "Alerts"],
    ["POST", `/api/v2/acme/alerts/${ID}/mute/${ID}/extend`, "alerts", "get", "Get", "Alerts"],
    ["POST", `/api/acme/pipelines/${ID}/backfill`, "pipelines", "update", "Update", "Pipelines"],
    ["GET", "/api/acme/pipelines/backfill", "pipelines", "list", "List", "Pipelines"],
    ["GET", "/api/v2/acme/alerts/incidents", "incidents", "list", "List", "Incidents"],
    ["GET", "/api/v2/acme/alerts/incidents/stats", "incidents", "list", "List", "Incidents"],
    ["GET", `/api/v2/acme/alerts/incidents/${ID}`, "incidents", "get", "Get", "Incidents"],
    ["GET", "/api/acme/users/roles/all", "users", "get", "Get", "Users"],
    ["GET", "/api/acme/users/reviewer@example.com/roles", "users", "get", "Get", "Users"],
    ["GET", "/api/acme/roles/developer/users", "roles", "list", "List", "Roles"],
    ["GET", "/api/acme/fleet/pipelines", "fleet_management", "get", "Get", "Fleet management"],
    ["GET", "/api/acme/streams/users/schema", "streams", "get", "Get", "Streams"],
    ["GET", "/api/acme/alerts/_values", "streams", "get", "Get", "Streams"],
    ["GET", "/api/acme/alerts/_around", "streams", "get", "Get", "Streams"],
    ["GET", "/api/acme/alerts/templates/oncall", "templates", "get", "Get", "Templates"],
    ["GET", "/api/acme/alerts/destinations", "destinations", "list", "List", "Destinations"],
    [
      "POST",
      `/api/acme/dashboards/${ID}/annotations`,
      "dashboards",
      "update",
      "Update",
      "Dashboards",
    ],
    [
      "DELETE",
      `/api/acme/dashboards/${ID}/annotations`,
      "dashboards",
      "update",
      "Update",
      "Dashboards",
    ],
    [
      "DELETE",
      `/api/acme/dashboards/${ID}/annotations/panels/${ID}`,
      "dashboards",
      "update",
      "Update",
      "Dashboards",
    ],
    ["POST", `/api/v2/acme/alerts/${ID}/export`, "alerts", "get", "Get", "Alerts"],
    ["POST", "/api/acme/llm/models", "llm/models", "update", "Update", "LLM model pricing"],
    [
      "POST",
      "/api/acme/llm/models/refresh-built-in",
      "llm/models",
      "update",
      "Update",
      "LLM model pricing",
    ],
    ["POST", "/api/acme/re_patterns/test", "re_patterns", "get", "Get", "Regex patterns"],
    ["POST", "/api/acme/settings", "settings", "update", "Update", "Settings"],
    ["POST", "/api/acme/settings/v2", "settings", "update", "Update", "Settings"],
    ["DELETE", "/api/acme/settings/logo", "settings", "update", "Update", "Settings"],
    ["POST", "/api/acme/settings/v2/user/u1", "settings", "get", "Get", "Settings"],
    ["DELETE", "/api/acme/settings/v2/user/u1/favs", "settings", "get", "Get", "Settings"],
    ["DELETE", "/api/acme/settings/v2/user/u1", "settings", "update", "Update", "Settings"],
    ["POST", "/api/acme/settings/v2/user/u1/favs", "settings", "update", "Update", "Settings"],
    [
      "POST",
      "/api/acme/alerts/deduplication/semantic-groups",
      "settings",
      "update",
      "Update",
      "Settings",
    ],
    [
      "PUT",
      "/api/acme/alerts/deduplication/semantic-groups",
      "settings",
      "update",
      "Update",
      "Settings",
    ],
    [
      "POST",
      "/api/acme/alerts/deduplication/semantic-groups/preview-diff",
      "settings",
      "update",
      "Update",
      "Settings",
    ],
    [
      "POST",
      `/api/v2/acme/alerts/${ID}/clone`,
      "alert_folders",
      "create",
      "Create",
      "Alert folders",
    ],
    ["POST", "/api/acme/streams", "streams", "update", "Update", "Streams"],
    ...["pause", "refresh", "resume"].map((action) => [
      "POST",
      `/api/acme/dashboards/${ID}/public_links/${ID}/${action}`,
      "public_dashboards",
      "update",
      "Update",
      "Public dashboards",
    ]),
    ["GET", "/api/acme/storage", "settings", "get", "Get", "Settings"],
    ["POST", "/api/v2/acme/folders/dashboards", "folders", "create", "Create", "Dashboard folders"],
    [
      "PUT",
      `/api/v2/acme/folders/dashboards/${ID}`,
      "folders",
      "update",
      "Update",
      "Dashboard folders",
    ],
    [
      "DELETE",
      `/api/v2/acme/folders/dashboards/${ID}`,
      "folders",
      "delete",
      "Delete",
      "Dashboard folders",
    ],
    ["POST", "/api/v2/acme/folders/alerts", "alert_folders", "create", "Create", "Alert folders"],
    [
      "PUT",
      `/api/v2/acme/folders/alerts/${ID}`,
      "alert_folders",
      "update",
      "Update",
      "Alert folders",
    ],
    [
      "DELETE",
      `/api/v2/acme/folders/alerts/${ID}`,
      "alert_folders",
      "delete",
      "Delete",
      "Alert folders",
    ],
    ["GET", "/api/v2/acme/reports", "report_folders", "list", "List", "Report folders"],
    ["POST", "/api/v2/acme/reports", "report_folders", "create", "Create", "Report folders"],
    [
      "DELETE",
      `/api/v2/acme/folders/reports/${ID}`,
      "report_folders",
      "delete",
      "Delete",
      "Report folders",
    ],
    ["GET", "/api/acme/users/reviewer@example.com/groups", "users", "get", "Get", "Users"],
    ["GET", "/api/acme/pipelines/streams", "pipelines", "list", "List", "Pipelines"],
    [
      "PATCH",
      `/api/v2/acme/alerts/incidents/${ID}/update`,
      "incidents",
      "update",
      "Update",
      "Incidents",
    ],
    [
      "POST",
      `/api/v2/acme/alerts/incidents/${ID}/events/comment`,
      "incidents",
      "create",
      "Create",
      "Incidents",
    ],
    [
      "POST",
      `/api/v2/acme/alerts/incidents/${ID}/rca`,
      "incidents",
      "create",
      "Create",
      "Incidents",
    ],
    [
      "DELETE",
      `/api/v2/acme/alerts/incidents/${ID}/rca`,
      "incidents",
      "update",
      "Update",
      "Incidents",
    ],
    [
      "POST",
      "/api/acme/fleet/configs",
      "fleet_configs",
      "create",
      "Create",
      "Fleet configurations",
    ],
    ["PUT", `/api/v2/acme/downtimes/${ID}`, "downtimes", "update", "Update", "Downtimes"],
    ["POST", `/api/v2/acme/downtimes/${ID}/cancel`, "downtimes", "update", "Update", "Downtimes"],
    ["POST", "/api/v2/acme/downtimes", "downtime_folders", "create", "Create", "Downtime folders"],
    [
      "GET",
      "/api/acme/db_monitoring/instances",
      "db_monitoring",
      "get",
      "Get",
      "Database monitoring",
    ],
    [
      "GET",
      "/api/acme/db_monitoring/query/history",
      "db_monitoring",
      "get",
      "Get",
      "Database monitoring",
    ],
    ["GET", "/api/acme/status_pages", "status_pages", "list", "List", "Status pages"],
    ["GET", `/api/acme/status_pages/${ID}/notices`, "status_pages", "get", "Get", "Status pages"],
    ["GET", "/api/acme/oncall/teams", "oncall", "list", "List", "On-Call"],
    ["GET", `/api/acme/oncall/teams/${ID}/members`, "oncall", "list", "List", "On-Call"],
    ["GET", `/api/acme/oncall/teams/${ID}/load`, "oncall", "get", "Get", "On-Call"],
    ["GET", "/api/acme/oncall/schedule-presets", "oncall", "get", "Get", "On-Call"],
    ["GET", "/api/acme/oncall/ownership", "oncall", "list", "List", "On-Call"],
    ["GET", "/api/acme/oncall/routing/config", "oncall", "get", "Get", "On-Call"],
    ["POST", "/api/acme/oncall/routing/preview", "oncall", "get", "Get", "On-Call"],
    ["GET", "/api/acme/oncall/responses", "oncall_responses", "list", "List", "On-Call responses"],
    ["GET", "/api/acme/oncall/my/teams", "oncall_responses", "list", "List", "On-Call responses"],
    [
      "POST",
      `/api/acme/oncall/responses/${ID}/acknowledge`,
      "oncall_responses",
      "create",
      "Create",
      "On-Call responses",
    ],
    ["GET", "/api/acme/synthetics", "synthetic_folder", "list", "List", "Synthetic folders"],
    [
      "GET",
      "/api/acme/synthetics/locations",
      "synthetic_folder",
      "list",
      "List",
      "Synthetic folders",
    ],
    [
      "GET",
      "/api/acme/synthetics/agent-tokens",
      "synthetic_folder",
      "update",
      "Update",
      "Synthetic folders",
    ],
    [
      "POST",
      "/api/acme/synthetics/variables",
      "synthetic_environment",
      "update",
      "Update",
      "Synthetic environments",
    ],
    [
      "GET",
      "/api/acme/synthetics/environments/prod/variables",
      "synthetic_environment",
      "get",
      "Get",
      "Synthetic environments",
    ],
    [
      "POST",
      "/api/acme/synthetics/environments/prod/duplicate",
      "synthetic_environment",
      "get",
      "Get",
      "Synthetic environments",
    ],
    ["GET", `/api/acme/synthetics/${ID}/runs`, "synthetics", "get", "Get", "Synthetic checks"],
    [
      "POST",
      `/api/acme/synthetics/${ID}/run`,
      "synthetics",
      "create",
      "Create",
      "Synthetic checks",
    ],
    ["GET", "/api/acme/anomaly_detection", "alert_folders", "list", "List", "Alert folders"],
    [
      "GET",
      "/api/acme/anomaly_detection/history",
      "alert_folders",
      "list",
      "List",
      "Alert folders",
    ],
    ["GET", `/api/acme/anomaly_detection/${ID}`, "alerts", "get", "Get", "Alerts"],
    ["POST", `/api/acme/anomaly_detection/${ID}/train`, "alerts", "create", "Create", "Alerts"],
    ["GET", "/api/acme/slos", "alert_folders", "list", "List", "Alert folders"],
    ["GET", `/api/acme/slos/${ID}`, "alerts", "get", "Get", "Alerts"],
    ["PUT", `/api/acme/slos/${ID}/enable`, "alerts", "update", "Update", "Alerts"],
    ["GET", "/api/acme/alerts/slo-eligible", "alert_folders", "list", "List", "Alert folders"],
    ["GET", "/api/acme/billing_group/members", "billing_group", "get", "Get", "Billing group"],
    ["GET", "/api/acme/billings/invoices", "organizations", "get", "Get", "Organizations"],
    ["GET", `/api/acme/org_cleanup_tasks/${ID}`, "organizations", "list", "List", "Organizations"],
    ["GET", "/api/acme/quota/ai/paid_overage", "ai", "get", "Get", "AI"],
    ["GET", "/api/acme/invites", "users", "list", "List", "Users"],
    ["DELETE", `/api/acme/invites/${ID}`, "users", "delete", "Delete", "Users"],
    ["GET", "/api/acme/eval_jobs", "eval_jobs", "list", "List", "Online eval jobs"],
    [
      "POST",
      `/api/acme/eval_jobs/${ID}/pause`,
      "eval_jobs",
      "update",
      "Update",
      "Online eval jobs",
    ],
    ["GET", "/api/acme/providers", "providers", "list", "List", "LLM providers"],
    ["POST", "/api/acme/providers/test", "providers", "create", "Create", "LLM providers"],
    ["GET", "/api/acme/rumtoken", "rumtoken", "list", "List", "RUM tokens"],
    ["PUT", "/api/acme/rumtoken", "rumtoken", "update", "Update", "RUM tokens"],
    ["GET", "/api/acme/score_configs", "score_configs", "list", "List", "Score configs"],
    [
      "GET",
      `/api/acme/score_configs/${ID}/versions`,
      "score_configs",
      "get",
      "Get",
      "Score configs",
    ],
    ["GET", "/api/acme/score_configs/quality", "traces", "get", "Get", "Traces"],
    ["GET", `/api/acme/score_configs/${ID}/quality`, "traces", "get", "Get", "Traces"],
    ["GET", "/api/acme/scorers", "scorers", "list", "List", "Scorers"],
    ["GET", `/api/acme/scorers/${ID}/versions`, "scorers", "get", "Get", "Scorers"],
    ["POST", "/api/acme/scorers/llm_judge/output_schema", "scorers", "create", "Create", "Scorers"],
    ["GET", "/api/acme/service_streams", "service_streams", "list", "List", "Service streams"],
    ["GET", "/api/acme/service_streams/_grouped", "settings", "get", "Get", "Settings"],
    ["GET", "/api/acme/tasks", "remote_tasks", "list", "List", "Remote tasks"],
    ["GET", `/api/acme/tasks/${ID}/stats`, "remote_tasks", "get", "Get", "Remote tasks"],
    [
      "POST",
      `/api/acme/tasks/${ID}/signing/rotate`,
      "remote_tasks",
      "update",
      "Update",
      "Remote tasks",
    ],
    ["POST", `/api/acme/tasks/${ID}/test_run`, "remote_tasks", "update", "Update", "Remote tasks"],
    ["POST", "/api/acme/tasks/test", "remote_tasks", "create", "Create", "Remote tasks"],
    ["GET", "/api/acme/workflows", "workflow_folder", "list", "List", "Workflow folders"],
    ["GET", `/api/acme/workflows/${ID}/history`, "workflows", "get", "Get", "Workflows"],
    ["POST", `/api/acme/workflows/${ID}/trigger`, "workflows", "create", "Create", "Workflows"],
    [
      "GET",
      "/api/v2/acme/folders/workflows",
      "workflow_folder",
      "list",
      "List",
      "Workflow folders",
    ],
    ["GET", "/api/v2/acme/folders/prompts", "prompt_folders", "list", "List", "Prompt folders"],
    [
      "PUT",
      `/api/v2/acme/folders/custom/${ID}`,
      "folders",
      "update",
      "Update",
      "Dashboard folders",
    ],
    [
      "GET",
      "/api/v2/acme/incidents/integrations",
      "incident_integrations",
      "list",
      "List",
      "Incident integrations",
    ],
    [
      "GET",
      `/api/v2/acme/incidents/integrations/${ID}/senders`,
      "incident_integrations",
      "get",
      "Get",
      "Incident integrations",
    ],
    [
      "POST",
      `/api/v2/acme/incidents/integrations/${ID}/rotate`,
      "incident_integrations",
      "update",
      "Update",
      "Incident integrations",
    ],
    ["GET", "/api/acme/search_jobs", "search_jobs", "list", "List", "Search jobs"],
    [
      "POST",
      `/api/acme/search_jobs/${ID}/cancel`,
      "search_jobs",
      "create",
      "Create",
      "Search jobs",
    ],
    [
      "GET",
      "/api/acme/enrichment_tables/status",
      "enrichment_tables",
      "list",
      "List",
      "Enrichment tables",
    ],
    [
      "POST",
      "/api/acme/enrichment_tables/geo/url",
      "enrichment_tables",
      "create",
      "Create",
      "Enrichment tables",
    ],
    // The server checks `streams/{name}` and `enrichment_tables/{name}/url` before any stream route.
    ["POST", "/api/acme/streams/traces?type=logs", "streams", "create", "Create", "Streams"],
    ["POST", "/api/acme/streams/profiles?type=logs", "streams", "create", "Create", "Streams"],
    ["POST", "/api/acme/streams/_values?type=logs", "streams", "create", "Create", "Streams"],
    ["POST", "/api/acme/streams/_around?type=logs", "streams", "create", "Create", "Streams"],
    [
      "POST",
      "/api/acme/enrichment_tables/traces/url",
      "enrichment_tables",
      "create",
      "Create",
      "Enrichment tables",
    ],
    [
      "POST",
      "/api/acme/enrichment_tables/profiles/url",
      "enrichment_tables",
      "create",
      "Create",
      "Enrichment tables",
    ],
    ["GET", "/api/acme/metrics/cpu_usage/usage", "metrics", "get", "Get", "Metrics"],
    ["GET", "/api/acme/traces/service_graph/topology/current", "traces", "get", "Get", "Traces"],
    ["POST", "/api/acme/traces/agent_signals/compare", "traces", "get", "Get", "Traces"],
    ["POST", `/api/v2/acme/alerts/${ID}/mute/${ID}/cancel`, "alerts", "get", "Get", "Alerts"],
    ["POST", "/api/acme/sourcemaps/stacktrace", "sourcemaps", "list", "List", "Source maps"],
    ["POST", "/api/acme/annotations", "score_configs", "list", "List", "Score configs"],
    ["POST", "/api/acme/prompts/match", "prompt_folders", "list", "List", "Prompt folders"],
  ])("%s %s needs %s %s", async (method, url, key, permission, permissionText, resourceText) => {
    await boot("/settings");
    forbidden(method, url);
    const entries = access.sectionEntries.value;
    expect(entries.map((e) => [e.resource.key, e.permission])).toEqual([[key, permission]]);
    expect(accessReason(accessDeniedMessage(entries, t).groups[0], t)).toBe(
      `Your role is missing the ${permissionText} permission on ${resourceText}.`,
    );
  });

  // Each row is resolved the way the server walks its route table: an area's rows ahead of the stream routes win, rows after them lose.
  it.each([
    ["GET", "/api/acme/functions/_values", "functions", "get"],
    ["PUT", "/api/acme/functions/_values", "functions", "update"],
    ["DELETE", "/api/acme/functions/_values", "functions", "delete"],
    ["POST", "/api/acme/functions/_around", "streams", "get"],
    ["GET", "/api/acme/eval_jobs/_around", "eval_jobs", "get"],
    ["GET", "/api/acme/settings/_values", "settings", "get"],
    ["POST", "/api/acme/settings/_around", "settings", "update"],
    ["GET", "/api/acme/db_monitoring/_values", "streams", "get"],
    ["GET", "/api/acme/db_monitoring/query/history", "db_monitoring", "get"],
    ["GET", "/api/acme/db_monitoring/not_an_endpoint", undefined, "list"],
    ["GET", "/api/acme/synthetics/_values", "streams", "get"],
    ["PUT", "/api/acme/status_pages/_around", "status_pages", "update"],
    ["GET", "/api/acme/slos/traces/latest", "streams", "get"],
  ])("checks %s %s as %s %s, in the server's route order", (method, url, key, permission) => {
    expect(extractResourceInfo(url, method)?.key).toBe(key);
    expect(accessPermission(method, url)).toBe(permission);
  });
});

describe("access store lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.selectedOrganization.identifier = "acme";
    resetAccess();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.useRealTimers();
    resetAccess();
    document.body.innerHTML = "";
  });

  const press = (id: string) =>
    document.getElementById(id)!.dispatchEvent(new Event("pointerdown", { bubbles: true }));

  it("keeps a write denial out of storage and drops it once the user leaves the page", async () => {
    await boot("/settings");
    forbidden("DELETE", "/api/acme/functions/my_fn");
    expect(access.sectionEntries.value.map((e) => e.permission)).toEqual(["delete"]);
    expect(sessionStorage.getItem("o2.access.memory.acme")).toBeNull();
    await router.push("/users");
    await router.push("/settings");
    expect(access.sectionEntries.value).toEqual([]);
  });

  it("keeps a read denial across a revisit while the write next to it is dropped", async () => {
    await boot("/settings");
    forbidden("GET", "/api/acme/functions");
    forbidden("DELETE", "/api/acme/functions/my_fn");
    await router.push("/users");
    await router.push("/settings");
    expect(access.sectionEntries.value.map((e) => e.permission)).toEqual(["list"]);
  });

  it("caps the request lines Copy details prints and storage keeps, newest last", async () => {
    await boot("/settings");
    for (let i = 0; i < 40; i++) forbidden("GET", `/api/acme/functions/fn_${i}`);
    const printed = accessDetails(access.sectionEntries.value).match(
      /GET \/api\/acme\/functions\/fn_\d+/g,
    );
    expect(printed).toHaveLength(20);
    expect(printed?.at(-1)).toBe("GET /api/acme/functions/fn_39");
    const stored = JSON.parse(sessionStorage.getItem("o2.access.memory.acme") ?? "{}");
    expect(stored.sections.settings[0].requests).toHaveLength(20);
  });

  it("keeps a denial whose request fell off Copy details until that request succeeds", async () => {
    await boot("/settings");
    const fn = (i: number) => `/api/acme/functions/fn_${i}`;
    const ok = (url: string) =>
      noteAccessSuccess({ method: "GET", url, routeKey: currentAccessRouteKey() });
    for (let i = 0; i <= 20; i++) forbidden("GET", fn(i));
    for (let i = 1; i <= 20; i++) ok(fn(i));
    expect(access.sectionEntries.value.map((e) => e.requests)).toEqual([[`GET ${fn(0)}`]]);
    ok(fn(0));
    expect(access.sectionEntries.value).toEqual([]);
  });

  it("keeps a refused save on screen when the user cancels leaving the page", async () => {
    await boot("/settings");
    forbidden("PUT", "/api/acme/pipelines/pipeline-a");
    expect(access.sectionEntries.value).toHaveLength(1);
    router.beforeEach(() => false);
    await router.push("/users");
    expect(router.currentRoute.value.path).toBe("/settings");
    expect(access.sectionEntries.value.map((e) => e.permission)).toEqual(["update"]);
  });

  it("keeps refused writes on different unnamed areas apart and prints no internal key", async () => {
    await boot("/settings");
    forbidden("POST", "/api/acme/short");
    forbidden("POST", "/api/acme/gen_ai/agents");
    const entries = access.sectionEntries.value;
    expect(entries).toHaveLength(2);
    expect(accessDeniedMessage(entries, t).count).toBe(2);
    expect(accessDetails(entries)).not.toMatch(/_unnamed/);
  });

  it("names both refused writes of one action in the same card", async () => {
    await boot("/settings");
    document.body.innerHTML = "<button id='save'>Save</button>";
    press("save");
    forbidden("PUT", "/api/acme/roles/developer");
    forbidden("PUT", "/api/acme/groups/admins");
    const notice = access.actionNotice.value;
    expect(notice?.el.id).toBe("save");
    expect(notice?.denials.map((d) => [d.resource.key, d.permission])).toEqual([
      ["roles", "update"],
      ["groups", "update"],
    ]);
    expect(access.sectionEntries.value).toEqual([]);
  });

  it("moves an open card's denial to the section notice when another control's card replaces it", async () => {
    await boot("/settings");
    document.body.innerHTML = "<button id='a'>Delete</button><button id='b'>Delete</button>";
    press("a");
    forbidden("DELETE", "/api/acme/functions/my_fn");
    press("b");
    forbidden("DELETE", "/api/acme/roles/developer");
    expect(access.actionNotice.value?.el.id).toBe("b");
    expect(access.sectionEntries.value.map((e) => [e.resource.key, e.permission])).toEqual([
      ["functions", "delete"],
    ]);
  });

  it("records a 403 that arrives before any boundary has mounted", async () => {
    const early = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/early", name: "early", component: Blank }],
    });
    await early.push("/early");
    bindAccess(early, { state });
    recordForbidden({
      method: "GET",
      url: "/api/acme/functions",
      routeKey: currentAccessRouteKey(),
    });
    const stored = JSON.parse(sessionStorage.getItem("o2.access.memory.acme") ?? "{}");
    expect(Object.keys(stored.sections ?? {})).toEqual(["early"]);
  });

  it("records a 403 stamped before the first navigation once the router lands in the same org", async () => {
    const early = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/early", name: "early", component: Blank }],
    });
    bindAccess(early, { state });
    const stamp = currentAccessRouteKey();
    state.selectedOrganization.identifier = "beta";
    const otherOrgStamp = currentAccessRouteKey();
    state.selectedOrganization.identifier = "acme";
    await early.push("/early");
    recordForbidden({ method: "GET", url: "/api/acme/functions", routeKey: otherOrgStamp });
    expect(sessionStorage.getItem("o2.access.memory.acme")).toBeNull();
    recordForbidden({ method: "GET", url: "/api/acme/functions", routeKey: stamp });
    const stored = JSON.parse(sessionStorage.getItem("o2.access.memory.acme") ?? "{}");
    expect(Object.keys(stored.sections ?? {})).toEqual(["early"]);
  });

  it("opens the card for a refused button POST the server checks as Get, and never stores it", async () => {
    await boot("/settings");
    document.body.innerHTML = "<button id='ack'>Acknowledge</button>";
    press("ack");
    forbidden("POST", `/api/v2/acme/alerts/${ID}/ack`);
    const notice = access.actionNotice.value;
    expect(notice?.el.id).toBe("ack");
    const message = accessDeniedMessage(notice!.denials, t);
    expect(accessReason(message.groups[0], t)).toBe(
      "Your role is missing the Get permission on Alerts.",
    );
    expect(access.sectionEntries.value).toEqual([]);
    expect(sessionStorage.getItem("o2.access.memory.acme")).toBeNull();
  });

  it("keeps an unanchored refused POST for the visit only, and clears it when it succeeds", async () => {
    await boot("/settings");
    forbidden("POST", `/api/v2/acme/alerts/${ID}/ack`);
    expect(access.sectionEntries.value.map((e) => [e.resource.key, e.permission])).toEqual([
      ["alerts", "get"],
    ]);
    expect(sessionStorage.getItem("o2.access.memory.acme")).toBeNull();
    noteAccessSuccess({
      method: "post",
      url: `/api/v2/acme/alerts/${ID}/ack`,
      routeKey: currentAccessRouteKey(),
    });
    expect(access.sectionEntries.value).toEqual([]);
  });

  // The first row is the Explain request QueryPlanDialog sends.
  it.each([
    "/api/acme/_search_stream?type=logs&search_type=ui&use_cache=true",
    "/api/acme/_search_multi_stream?type=logs",
    "/api/acme/_search_partition?type=logs",
    "/api/acme/service_streams/_correlate",
    "/api/acme/web_logs/_values_stream?fields=level&type=logs",
    "/api/acme/prometheus/api/v1/query_range?use_streaming=true",
    "/api/acme/sourcemaps/stacktrace",
    "/api/acme/annotations",
    "/api/acme/prompts/match",
  ])("keeps the query POST %s a stored read after a click, never an action card", async (url) => {
    await boot("/settings");
    document.body.innerHTML = "<button id='run'>Explain</button>";
    press("run");
    forbidden("POST", url);
    expect(access.actionNotice.value).toBeNull();
    expect(access.sectionEntries.value.map((e) => e.permission)).toEqual(["list"]);
    const stored = JSON.parse(sessionStorage.getItem("o2.access.memory.acme") ?? "{}");
    expect(Object.keys(stored.sections ?? {})).toEqual(["settings"]);
  });

  it.each(["/api/acme/streams/_search_archive?type=logs", "/api/acme/_search_audit/_json"])(
    "keeps the create card for POST %s, whose name only starts like a search",
    async (url) => {
      await boot("/settings");
      document.body.innerHTML = "<button id='create'>Create</button>";
      press("create");
      forbidden("POST", url);
      expect(access.actionNotice.value?.permission).toBe("create");
      expect(accessPermission("POST", url)).toBe("create");
      expect(sessionStorage.getItem("o2.access.memory.acme")).toBeNull();
    },
  );

  it("keeps a search-style POST a stored read, even right after a click", async () => {
    await boot("/settings");
    document.body.innerHTML = "<button id='run'>Run query</button>";
    press("run");
    forbidden("POST", "/api/acme/web_logs/_values");
    expect(access.actionNotice.value).toBeNull();
    const stored = JSON.parse(sessionStorage.getItem("o2.access.memory.acme") ?? "{}");
    expect(Object.keys(stored.sections ?? {})).toEqual(["settings"]);
  });

  it.each(["series", "merge", "diff"])(
    "keeps the profile %s query a stored read after a click and across a revisit",
    async (operation) => {
      await boot("/settings");
      document.body.innerHTML = "<button id='run'>Query</button>";
      press("run");
      forbidden("POST", `/api/acme/cpu/profiles/${operation}`);
      expect(access.actionNotice.value).toBeNull();
      await router.push("/users");
      await router.push("/settings");
      expect(access.sectionEntries.value.map((e) => [e.resource.key, e.permission])).toEqual([
        ["streams", "get"],
      ]);
    },
  );

  it("keeps a denied GET the server checks as Update across a reload", async () => {
    await boot("/settings");
    forbidden("GET", "/api/acme/synthetics/agent-tokens");
    const stored = sessionStorage.getItem("o2.access.memory.acme");
    resetAccess();
    sessionStorage.setItem("o2.access.memory.acme", stored ?? "");
    expect(access.sectionEntries.value.map((e) => [e.resource.key, e.permission])).toEqual([
      ["synthetic_folder", "update"],
    ]);
  });

  it("drops a refused write an older build stored, by its request rather than its permission", async () => {
    const functions = { key: "functions", labelKey: "accessBoundary.resources.functions" };
    sessionStorage.setItem(
      "o2.access.memory.acme",
      JSON.stringify({
        pages: {},
        sections: {
          settings: [
            {
              resource: { ...functions, path: "/api/acme/functions/f" },
              permission: "get",
              requests: ["POST /api/acme/functions/f/test", "GET /api/acme/functions/f"],
            },
            {
              resource: { ...functions, path: "/api/acme/functions/f" },
              permission: "delete",
              requests: ["DELETE /api/acme/functions/f"],
            },
          ],
        },
      }),
    );
    await boot("/settings");
    expect(access.sectionEntries.value.map((e) => [e.permission, e.requests])).toEqual([
      ["get", ["GET /api/acme/functions/f"]],
    ]);
  });
});
