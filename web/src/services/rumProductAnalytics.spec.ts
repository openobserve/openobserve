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

import { beforeEach, describe, expect, it, vi } from "vitest";

const client = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.mock("@/services/http", () => ({ default: vi.fn(() => client) }));

import api from "@/services/rumProductAnalytics";
import contract from "@/utils/rum/__fixtures__/rumPaApi.json";

const ID = contract.namedEvent.id;
const FID = contract.savedFunnel.id;
const BASE = "/api/org1/rum/analytics";
const app = { params: { app: "web/app" } };

describe("rumProductAnalytics service (AC-44, AC-67)", () => {
  beforeEach(() => {
    for (const f of Object.values(client)) f.mockReset().mockResolvedValue({ data: {} });
  });

  it("lists, reads, creates, updates and deletes named events with the app in the query", async () => {
    await api.listEvents("org1", "web/app");
    await api.getEvent("org1", "web/app", ID);
    await api.createEvent("org1", "web/app", contract.createEvent as never);
    await api.updateEvent("org1", "web/app", ID, contract.updateEvent as never);
    await api.deleteEvent("org1", "web/app", ID);
    await api.deleteEvent("org1", "web/app", ID, true);
    await api.eventUsages("org1", "web/app", ID);
    expect(client.get.mock.calls).toEqual([
      [`${BASE}/named_events`, app],
      [`${BASE}/named_events/${ID}`, app],
      [`${BASE}/named_events/${ID}/funnels`, app],
    ]);
    expect(client.post.mock.calls).toEqual([[`${BASE}/named_events`, contract.createEvent, app]]);
    expect(client.put.mock.calls).toEqual([
      [`${BASE}/named_events/${ID}`, contract.updateEvent, app],
    ]);
    expect(client.delete.mock.calls).toEqual([
      [`${BASE}/named_events/${ID}`, app],
      [`${BASE}/named_events/${ID}`, { params: { app: "web/app", force: true } }],
    ]);
  });

  it("lists, reads, creates, updates and deletes saved funnels", async () => {
    await api.listFunnels("org1", "web/app");
    await api.getFunnel("org1", "web/app", FID);
    await api.createFunnel("org1", "web/app", contract.createFunnel as never);
    await api.updateFunnel("org1", "web/app", FID, contract.updateFunnel as never);
    await api.deleteFunnel("org1", "web/app", FID);
    expect(client.get.mock.calls).toEqual([
      [`${BASE}/funnels`, app],
      [`${BASE}/funnels/${FID}`, app],
    ]);
    expect(client.post.mock.calls).toEqual([[`${BASE}/funnels`, contract.createFunnel, app]]);
    expect(client.put.mock.calls).toEqual([[`${BASE}/funnels/${FID}`, contract.updateFunnel, app]]);
    expect(client.delete.mock.calls).toEqual([[`${BASE}/funnels/${FID}`, app]]);
  });

  it("encodes the org and id path segments", async () => {
    await api.getEvent("a/b", "web", "x#1");
    expect(client.get.mock.calls[0][0]).toBe("/api/a%2Fb/rum/analytics/named_events/x%231");
  });
});
