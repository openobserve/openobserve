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

import { describe, expect, it } from "vitest";
import { createI18n } from "vue-i18n";
import en from "@/locales/languages/en-US.json";
import type { TranslateFn } from "@/types/i18n";
import {
  accessDeniedMessage,
  accessDetails,
  accessListParts,
  accessReason,
  groupDenials,
  viewDenial,
  type AccessPermission,
} from "@/composables/useAccessStore";

const t = createI18n({ legacy: false, locale: "en", messages: { en } }).global
  .t as unknown as TranslateFn;

const deny = (key: string, permission: AccessPermission = "list") =>
  viewDenial(key, permission, [`GET /api/default/${key}`]);
const unnamed = (area: string) => ({
  resource: {
    key: `_unnamed/${area}`,
    labelKey: "accessBoundary.resourcesInline.unnamed" as const,
    path: `/api/acme/${area}`,
  },
  permission: "create" as const,
  requests: [`POST /api/acme/${area}`],
});

describe("access denial grouping", () => {
  it("names a single denial in the title and one sentence", () => {
    const message = accessDeniedMessage([deny("alerts")], t);
    expect(message.title).toBe("You can't view alerts");
    expect(message.count).toBe(1);
    expect(message.groups).toHaveLength(1);
    expect(accessReason(message.groups[0], t)).toBe(
      "Your role is missing the List permission on Alerts.",
    );
  });

  it("joins two resources with the same permission into one sentence", () => {
    const message = accessDeniedMessage([deny("destinations"), deny("templates")], t);
    expect(message.title).toBe("You can't view 2 parts of this page");
    expect(message.groups).toHaveLength(1);
    expect(accessReason(message.groups[0], t)).toBe(
      "Your role is missing the List permission on Destinations and Templates.",
    );
  });

  it("groups ten mixed denials by permission in role-editor order, each resource once", () => {
    const listed = [
      "dashboards",
      "streams",
      "functions",
      "savedviews",
      "users",
      "roles",
      "pipelines",
      "destinations",
    ];
    const denials = [
      deny("alerts", "delete"),
      ...listed.map((key) => deny(key)),
      deny("reports", "delete"),
      deny("roles"),
    ];
    const message = accessDeniedMessage(denials, t);
    expect(message.title).toBe("10 actions on this page are blocked");
    expect(message.count).toBe(10);
    expect(message.groups.map((g) => [g.label, g.resources.length])).toEqual([
      ["List", 8],
      ["Delete", 2],
    ]);
    expect(
      groupDenials(denials)[0].denials.find((d) => d.resource.key === "roles")?.requests,
    ).toEqual(["GET /api/default/roles"]);
    const lines = accessDetails(denials)
      .split("\n")
      .filter((l) => l.startsWith("denied"));
    expect(lines).toEqual([
      `denied list: ${listed.join(", ")} (${listed.map((k) => `GET /api/default/${k}`).join(", ")})`,
      "denied delete: alerts, reports (GET /api/default/alerts, GET /api/default/reports)",
    ]);
  });

  it("does not title a refused delete as a view when the entries mix verbs", () => {
    expect(accessDeniedMessage([deny("alerts", "delete"), deny("templates")], t).title).toBe(
      "2 actions on this page are blocked",
    );
    expect(accessDeniedMessage([deny("alerts"), deny("alerts", "delete")], t).title).toBe(
      "2 actions on this page are blocked",
    );
  });

  it("names every resource in a title that shares one write verb, folding after four", () => {
    expect(
      accessDeniedMessage([deny("alerts", "delete"), deny("reports", "delete")], t).title,
    ).toBe("You can't delete alerts and reports");
    const many = ["alerts", "reports", "roles", "groups", "users", "functions"].map((k) =>
      deny(k, "delete"),
    );
    expect(accessDeniedMessage(many, t).title).toBe(
      "You can't delete alerts, reports, roles, groups, and 2 more",
    );
  });

  it("prints request lines, never an internal key, for resources with no friendly name", () => {
    const unnamed = {
      resource: {
        key: "_unnamed",
        labelKey: "accessBoundary.resourcesInline.unnamed" as const,
        path: "/api/acme/tasks",
      },
      permission: "create" as const,
      requests: ["POST /api/acme/tasks"],
    };
    const lines = accessDetails([unnamed, deny("alerts", "create")])
      .split("\n")
      .filter((l) => l.startsWith("denied"));
    expect(lines).toEqual([
      "denied create: alerts (POST /api/acme/tasks, GET /api/default/alerts)",
    ]);
    expect(accessDetails([unnamed])).toContain("denied create: POST /api/acme/tasks");
    expect(accessDetails([unnamed])).not.toContain("_unnamed");
  });

  it("counts the same unit in the title and the chip's badge", () => {
    const listAndDelete = accessDeniedMessage([deny("alerts"), deny("alerts", "delete")], t);
    expect(listAndDelete.count).toBe(2);
    expect(listAndDelete.title).toBe("2 actions on this page are blocked");
    const views = accessDeniedMessage(
      [deny("alerts"), deny("alerts", "get"), deny("templates")],
      t,
    );
    expect(views.count).toBe(3);
    expect(views.title).toBe("You can't view 3 parts of this page");
    const oneResource = accessDeniedMessage([deny("alerts"), deny("alerts", "get")], t);
    expect(oneResource.count).toBe(2);
    expect(oneResource.title).toBe("You can't view alerts");
  });

  it.each([
    [0, "", ""],
    [1, "You can't create this resource", "this resource"],
    [2, "You can't create 2 resources", "2 resources"],
    [3, "You can't create 3 resources", "3 resources"],
    [12, "You can't create 12 resources", "12 resources"],
  ])("words %i refused unnamed writes once, counted", (n, title, resources) => {
    const denials = Array.from({ length: n }, (_, i) => unnamed(`area${i}`));
    const message = accessDeniedMessage(denials, t);
    expect(message.count).toBe(n);
    if (n === 0) {
      expect(message.groups).toEqual([]);
      return;
    }
    expect(message.title).toBe(title);
    expect(accessReason(message.groups[0], t)).toBe(
      `Your role is missing the Create permission on ${resources}.`,
    );
  });

  it("names the named resources and counts the unnamed ones in one sentence", () => {
    const message = accessDeniedMessage(
      [deny("alerts", "create"), unnamed("a"), unnamed("b"), deny("reports", "create")],
      t,
    );
    expect(message.count).toBe(4);
    expect(message.title).toBe("You can't create alerts, reports, and 2 resources");
    expect(accessReason(message.groups[0], t)).toBe(
      "Your role is missing the Create permission on Alerts, Reports, and 2 resources.",
    );
  });

  it("names the permission for the grantable denials and asks for an administrator for the rest", () => {
    const bypassed = { ...unnamed("synthetics"), permission: "list" as const };
    bypassed.resource = { ...bypassed.resource, grantable: false };
    const message = accessDeniedMessage([deny("alerts"), bypassed], t);
    expect(message.title).toBe("You can't view 2 parts of this page");
    expect(message.count).toBe(2);
    expect(message.askAdmin).toBe(true);
    expect(message.groups.map((g) => accessReason(g, t))).toEqual([
      "Your role is missing the List permission on Alerts.",
    ]);
    expect(accessDetails([deny("alerts"), bypassed])).toContain("POST /api/acme/synthetics");
  });

  it("folds a list longer than four into an expandable 'N more' part", () => {
    const resources = accessDeniedMessage(
      ["dashboards", "streams", "functions", "users", "roles", "pipelines"].map((k) => deny(k)),
      t,
    ).groups[0].resources;
    const folded = accessListParts(resources, false, t);
    expect(folded.map((p) => p.text).join("")).toBe(
      "Dashboards, Streams, Functions, Users, and 2 more",
    );
    expect(folded.filter((p) => p.more).map((p) => p.text)).toEqual(["2 more"]);
    const open = accessListParts(resources, true, t);
    expect(open.some((p) => p.more)).toBe(false);
    expect(open.map((p) => p.text).join("")).toBe(
      "Dashboards, Streams, Functions, Users, Roles, and Pipelines",
    );
  });
});
