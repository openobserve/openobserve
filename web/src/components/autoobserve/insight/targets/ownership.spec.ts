// Copyright 2026 OpenObserve Inc.

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

import { describe, expect, it } from "vitest";
import { notifyOf, teamOf, type OwnedAlert } from "./ownership";

const alert = (folder: string, destinations: string[] = []): OwnedAlert => ({
  folder_id: `${folder}-id`,
  folder_name: folder,
  destinations,
});

describe("teamOf", () => {
  it("is the folder most of the service's alerts live in", () => {
    const team = teamOf("svc-c", [alert("pay"), alert("ops"), alert("ops"), alert("ops")]);

    expect(team).toEqual({
      name: "ops",
      folderId: "ops-id",
      folderName: "ops",
      source: "folder",
      reason: "Where svc-c's 3 alerts live.",
      alertCount: 3,
    });
  });

  it("says alert, not alerts, for one", () => {
    expect(teamOf("svc-c", [alert("ops")]).reason).toBe("Where svc-c's alert lives.");
  });

  it("breaks a tie by folder name, not by list order", () => {
    expect(teamOf("svc-c", [alert("pay"), alert("ops")]).name).toBe("ops");
    expect(teamOf("svc-c", [alert("ops"), alert("pay")]).name).toBe("ops");
  });

  it("with no alerts, has no team yet and uses the org default folder", () => {
    const team = teamOf("svc-c", []);

    expect(team).toEqual({
      name: "No team yet",
      folderId: "default",
      folderName: "default",
      source: "default",
      reason: "No owner is known for svc-c, so it uses the org default folder.",
    });
  });

  it("names the org's own default folder when the caller knows it", () => {
    const team = teamOf("svc-c", [{ folder_id: null }], { folderId: "default", name: "ops" });

    expect(team.folderName).toBe("ops");
    expect(team.source).toBe("default");
  });
});

describe("alert counts behind the picks", () => {
  it("counts the alerts in the picked folder and on the picked destination", () => {
    const alerts = [
      alert("pay", ["pay-mail"]),
      alert("ops", ["ops-webhook"]),
      alert("ops", ["ops-webhook"]),
      alert("ops"),
    ];

    expect(teamOf("svc-c", alerts).alertCount).toBe(3);
    expect(notifyOf("svc-c", alerts)).toMatchObject({ alertCount: 2 });
  });

  it("has no count for the org default folder or when nobody is notified", () => {
    expect(teamOf("svc-c", []).alertCount).toBeUndefined();
    expect(notifyOf("svc-c", [])).not.toHaveProperty("alertCount");
  });
});

describe("notifyOf", () => {
  it("is the destination most of the alerts use, with the sentence that says so", () => {
    const pick = notifyOf("svc-c", [
      alert("ops", ["ops-webhook"]),
      alert("ops", ["ops-webhook", "ops-mail"]),
      alert("ops", ["ops-webhook"]),
    ]);

    expect(pick).toEqual({
      destinations: ["ops-webhook"],
      reason: "svc-c's 3 alerts notify ops-webhook.",
      alertCount: 3,
    });
  });

  it("breaks a tie by name", () => {
    const pick = notifyOf("svc-c", [alert("ops", ["zeta"]), alert("ops", ["alpha"])]);

    expect(pick.destinations).toEqual(["alpha"]);
    expect(pick.reason).toBe("svc-c's alert notifies alpha.");
  });

  it("counts an alert listing a destination twice once", () => {
    const pick = notifyOf("svc-c", [
      alert("ops", ["a", "a"]),
      alert("ops", ["b"]),
      alert("ops", ["b"]),
    ]);

    expect(pick.destinations).toEqual(["b"]);
  });

  it("is empty with reason none when no alert notifies anyone", () => {
    expect(notifyOf("svc-c", [alert("ops"), alert("ops", [""])])).toEqual({
      destinations: [],
      reason: "none",
    });
    expect(notifyOf("svc-c", [])).toEqual({ destinations: [], reason: "none" });
  });
});
