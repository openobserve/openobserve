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

describe("access denial grouping", () => {
  it("names a single denial in the title and one sentence", () => {
    const message = accessDeniedMessage([deny("alerts")], t);
    expect(message.title).toBe("You can't view alerts");
    expect(message.resourceCount).toBe(1);
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
    expect(message.title).toBe("You can't view 10 parts of this page");
    expect(message.resourceCount).toBe(10);
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
