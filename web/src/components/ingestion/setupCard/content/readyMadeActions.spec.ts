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
import { gt } from "@/types/i18n";
import { getDataSourceCard } from "../registry";
import { READY_MADE_SOURCE_BY_SETUP_SLUG } from "@/composables/readyMade/catalog";

const SUBS = { url: "https://o2.example.com", org: "acme", token: "c2VjcmV0" };
const verifyAction = (slug: string) =>
  getDataSourceCard(slug, SUBS, gt)!.steps.find((step) => step.detectionAnchor)?.action;

describe("ready-made step action on the setup cards", () => {
  it("wires the MongoDB, SQL Server and Oracle cards", () => {
    expect(Object.keys(READY_MADE_SOURCE_BY_SETUP_SLUG)).toEqual(
      expect.arrayContaining(["mongoDB", "sqlServer", "oracle"]),
    );
  });

  it.each(Object.keys(READY_MADE_SOURCE_BY_SETUP_SLUG))(
    "%s shows the open button on its verify step once Test connects",
    (slug) => {
      const action = verifyAction(slug);
      expect(action).toMatchObject({
        id: "open-ready-made-dashboard",
        icon: "dashboard",
        showOnDetect: true,
      });
    },
  );

  it("labels each button with the dashboard it opens", () => {
    expect(verifyAction("postgres")?.label).toBe(
      gt("ingestion.setupCard.readyMadeOpenOne", { name: "PostgreSQL" }),
    );
    expect(verifyAction("mariaDB")?.label).toBe(
      gt("ingestion.setupCard.readyMadeOpenOne", { name: "MySQL" }),
    );
    expect(verifyAction("mongoDB")?.label).toBe(
      gt("ingestion.setupCard.readyMadeOpenOne", { name: "MongoDB" }),
    );
    expect(verifyAction("sqlServer")?.label).toBe(
      gt("ingestion.setupCard.readyMadeOpenOne", { name: "SQL Server" }),
    );
    expect(verifyAction("oracle")?.label).toBe(
      gt("ingestion.setupCard.readyMadeOpenOne", { name: "Oracle" }),
    );
    expect(verifyAction("kubernetes")?.label).toBe(
      gt("ingestion.setupCard.readyMadeOpenKubernetes"),
    );
  });

  it("leaves the NVIDIA card's own action and cards without a ready-made dashboard alone", () => {
    expect(verifyAction("nvidiaDcgm")?.id).toBe("open-setup-dashboard");
    expect(verifyAction("cassandra")).toBeUndefined();
  });
});
