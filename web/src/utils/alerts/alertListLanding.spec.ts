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
import { ksuidSeconds } from "@/utils/alerts/recentRuns";
import { ALERT_LIST_SAVED_NEW, savedAlertId } from "./alertListLanding";

// Real ids minted about 9 minutes apart; OLDER sorts first as text.
const OLDER = "3MKPx6XksK0xbavrKQVc9UxFRnW";
const NEWER = "3MKR3DbEjnUmZLdcsCAhUnKsql9";
const now = (ksuidSeconds(NEWER) ?? 0) + 5;

describe("savedAlertId", () => {
  it.each<[string, string[], string, number, string | undefined]>([
    ["an edit whose row is gone lands nowhere", [NEWER], "alert-7", now, undefined],
    [
      "a new alert is the newest minted id",
      [OLDER, "slo-1", NEWER],
      ALERT_LIST_SAVED_NEW,
      now,
      NEWER,
    ],
    [
      "a newest id minted long ago is not the save",
      [OLDER, NEWER],
      ALERT_LIST_SAVED_NEW,
      now + 3600,
      undefined,
    ],
    ["no minted ids, nothing to land on", ["alert-1"], ALERT_LIST_SAVED_NEW, now, undefined],
  ])("%s", (_name, ids, saved, nowSec, expected) => {
    expect(savedAlertId(ids, saved, nowSec)).toBe(expected);
  });
});
