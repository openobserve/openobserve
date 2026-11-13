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
import {
  confirmedStatus,
  confirmedStatuses,
  splitConfirms,
  type ExecutionSlot,
} from "./confirmJobs";
import type { ExecutionStatus } from "./rollUpStatus";

const exec = (location: string, status: ExecutionSlot["status"], timestamp: number) => ({
  location,
  browser: "",
  device: "",
  environment: "",
  scheduledTs: 0,
  timestamp,
  status,
});

describe("splitConfirms", () => {
  it("should treat a second execution in a slot as a confirm job of the failure", () => {
    const a = exec("us-east", "fail", 1);
    const b = exec("us-west", "pass", 2);
    const confirm = exec("us-west", "pass", 3);
    const { primary, confirms } = splitConfirms([confirm, a, b]);
    expect(primary).toEqual([a, b]);
    expect(confirms).toEqual([{ of: a, confirm }]);
  });

  it("should pair a single-location confirm job with its own location", () => {
    const a = exec("us-east", "fail", 1);
    const confirm = exec("us-east", "fail", 2);
    expect(splitConfirms([a, confirm]).confirms).toEqual([{ of: a, confirm }]);
  });

  it("should pair a browser confirm job with the failure on the same device", () => {
    const dev = (location: string, device: string, status: ExecutionSlot["status"], t: number) => ({
      ...exec(location, status, t),
      device,
    });
    const failed = dev("a", "Mobile", "fail", 1);
    const others = [
      dev("a", "Desktop", "pass", 1),
      dev("b", "Desktop", "pass", 2),
      dev("b", "Mobile", "pass", 2),
    ];
    const desk = dev("b", "Desktop", "pass", 3);
    const mob = dev("b", "Mobile", "pass", 4);
    const { confirms } = splitConfirms([failed, ...others, desk, mob]);
    expect(confirms).toEqual([
      { of: null, confirm: desk },
      { of: failed, confirm: mob },
    ]);
  });

  it("should tell a confirm job by its later scheduled time, not by when it finished", () => {
    // The confirm job from b passes before b's own job ends.
    const a = { ...exec("a", "fail", 1), scheduledTs: 100 };
    const confirm = { ...exec("b", "pass", 2), scheduledTs: 150 };
    const b = { ...exec("b", "error", 3), scheduledTs: 100 };
    const { primary, confirms } = splitConfirms([a, confirm, b]);
    expect(primary).toEqual([a, b]);
    expect(confirms).toEqual([{ of: a, confirm }]);
  });

  it("should pair each confirm job with the failure in its own location", () => {
    const at = (location: string, status: ExecutionSlot["status"], ts: number) => ({
      ...exec(location, status, ts),
      scheduledTs: ts < 10 ? 1 : ts,
    });
    const east = at("us-east", "fail", 1);
    const west = at("us-west", "fail", 2);
    // West's confirm job is scheduled first; it still re-tests west, not east.
    const westConfirm = at("us-west", "pass", 10);
    const eastConfirm = at("us-east", "fail", 11);
    const { confirms } = splitConfirms([east, west, eastConfirm, westConfirm]);
    expect(confirms).toEqual([
      { of: west, confirm: westConfirm },
      { of: east, confirm: eastConfirm },
    ]);
  });

  it("should find no confirm job in a run that tests each slot once", () => {
    const runs = [exec("a", "fail", 1), exec("b", "pass", 2)];
    expect(splitConfirms(runs)).toEqual({ primary: runs, confirms: [] });
  });
});

describe("confirmedStatus", () => {
  it("should count a failure only when its confirm job fails too", () => {
    expect(confirmedStatus("fail", "pass")).toBe("warning");
    expect(confirmedStatus("fail", "warning")).toBe("warning");
    expect(confirmedStatus("fail", "fail")).toBe("fail");
    // A confirm job that timed out keeps the original vote.
    expect(confirmedStatus("fail", "error")).toBe("fail");
    expect(confirmedStatus("fail")).toBe("fail");
    expect(confirmedStatus("pass", "fail")).toBe("pass");
  });
});

describe("confirmedStatuses", () => {
  const slot = (device: string, status: ExecutionStatus, scheduledTs: number) => ({
    location: "aws-us-east-1",
    browser: "chromium",
    device,
    environment: "",
    scheduledTs,
    timestamp: scheduledTs,
    status,
  });

  it("should keep the failure when another device of the confirm job failed", () => {
    const { primary, confirms } = splitConfirms([
      slot("Desktop", "fail", 100),
      slot("Mobile", "pass", 100),
      slot("Desktop", "pass", 200),
      slot("Mobile", "fail", 200),
    ]);
    expect(confirmedStatuses(primary, confirms)).toEqual(["fail", "pass"]);
  });

  it("should turn a failure into a warning when the whole confirm job passed", () => {
    const { primary, confirms } = splitConfirms([
      slot("Desktop", "fail", 100),
      slot("Mobile", "pass", 100),
      slot("Desktop", "pass", 200),
      slot("Mobile", "pass", 200),
    ]);
    expect(confirmedStatuses(primary, confirms)).toEqual(["warning", "pass"]);
  });
});
