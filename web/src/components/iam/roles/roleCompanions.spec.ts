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
import i18n from "@/locales";
import {
  companionAddKeys,
  findCompanionGaps,
  type CompanionGap,
} from "@/components/iam/roles/roleCompanions";

const ORG = "default";
const ALL = `_all_${ORG}`;
const MODULES = new Set(["afolder", "dfolder", "destination", "template", "stream"]);

const gapsFor = (keys: string[], modules: Set<string> = MODULES) =>
  findCompanionGaps(new Set(keys), modules, ORG);

const summary = (gaps: CompanionGap[]) =>
  gaps.map((gap) => `${gap.module}: ${gap.actions.join(", ")}`);

describe("roleCompanions - rules", () => {
  it.each(["AllowAll", "AllowPost", "AllowPut"])(
    "flags Streams and Destinations List and Get when Alert Folders has %s",
    (action) => {
      expect(summary(gapsFor([`afolder:${ALL}:${action}`]))).toEqual([
        "stream: AllowList, AllowGet",
        "destination: AllowList, AllowGet",
      ]);
    },
  );

  it.each(["AllowList", "AllowGet", "AllowDelete"])(
    "does not flag for Alert Folders %s",
    (action) => {
      expect(gapsFor([`afolder:${ALL}:${action}`])).toEqual([]);
    },
  );

  it.each(["AllowAll", "AllowPost", "AllowPut"])(
    "flags Templates List and Get when Destinations has %s",
    (action) => {
      expect(summary(gapsFor([`destination:${ALL}:${action}`]))).toEqual([
        "template: AllowList, AllowGet",
      ]);
    },
  );

  it.each(["AllowAll", "AllowList", "AllowGet", "AllowPost", "AllowPut", "AllowDelete"])(
    "flags Streams List and Get for %s on Dashboard Folders",
    (action) => {
      expect(summary(gapsFor([`dfolder:${ALL}:${action}`]))).toEqual([
        "stream: AllowList, AllowGet",
      ]);
    },
  );

  it("merges two rules that need Streams into one entry and names each module that needs it", () => {
    const gaps = gapsFor([`afolder:${ALL}:AllowPut`, `dfolder:${ALL}:AllowGet`]);
    const streams = gaps.find((gap) => gap.module === "stream");
    expect(gaps.filter((gap) => gap.module === "stream")).toHaveLength(1);
    expect(streams?.actions).toEqual(["AllowList", "AllowGet"]);
    expect(streams?.neededBy).toEqual([
      { module: "afolder", reasonKey: "iam.editRole.companionReasonAlertStreams" },
      { module: "dfolder", reasonKey: "iam.editRole.companionReasonDashboardStreams" },
    ]);
  });

  it("gives reason keys that resolve in en-US", () => {
    const gaps = gapsFor([
      `afolder:${ALL}:AllowAll`,
      `destination:${ALL}:AllowAll`,
      `dfolder:${ALL}:AllowAll`,
    ]);
    gaps
      .flatMap((gap) => gap.neededBy)
      .forEach(({ reasonKey }) => expect(i18n.global.te(reasonKey, "en-us")).toBe(true));
  });
});

describe("roleCompanions - triggers", () => {
  it("fires on Create on one alert folder", () => {
    expect(summary(gapsFor(["afolder:f1:AllowPost"]))).toEqual([
      "stream: AllowList, AllowGet",
      "destination: AllowList, AllowGet",
    ]);
  });

  it("fires on a saved alert whose folder list never loaded", () => {
    expect(gapsFor(["alert:f1/a9:AllowPut"]).map((gap) => gap.module)).toEqual([
      "stream",
      "destination",
    ]);
  });

  it("fires on a single dashboard grant", () => {
    expect(gapsFor(["dashboard:f1/d1:AllowGet"]).map((gap) => gap.module)).toEqual(["stream"]);
  });

  it("does not fire when the trigger module is not in this org", () => {
    expect(gapsFor([`dfolder:${ALL}:AllowAll`], new Set(["stream"]))).toEqual([]);
  });

  it("returns nothing for an empty role", () => {
    expect(gapsFor([])).toEqual([]);
  });
});

describe("roleCompanions - met", () => {
  it("is met by the module-wide grant", () => {
    expect(
      gapsFor([`dfolder:${ALL}:AllowAll`, `stream:${ALL}:AllowList`, `stream:${ALL}:AllowGet`]),
    ).toEqual([]);
  });

  it("is met by All on the needed module", () => {
    expect(gapsFor([`dfolder:${ALL}:AllowAll`, `stream:${ALL}:AllowAll`])).toEqual([]);
  });

  it("is met by a stream type node and one stream's Get", () => {
    expect(
      gapsFor([`dfolder:${ALL}:AllowAll`, `metrics:${ALL}:AllowList`, "metrics:cpu:AllowGet"]),
    ).toEqual([]);
  });

  it("is met for Get by a single stream, leaving only List", () => {
    expect(summary(gapsFor([`dfolder:${ALL}:AllowAll`, "logs:app:AllowGet"]))).toEqual([
      "stream: AllowList",
    ]);
  });

  it("lists only through the module-wide grant, never through one item", () => {
    expect(summary(gapsFor([`destination:${ALL}:AllowPut`, "template:slack:AllowAll"]))).toEqual([
      "template: AllowList",
    ]);
    expect(
      gapsFor([
        `destination:${ALL}:AllowPut`,
        `template:${ALL}:AllowList`,
        "template:slack:AllowGet",
      ]),
    ).toEqual([]);
  });

  it("still flags Destinations Get when only Destinations List is added, as the list keeps only items they can Get", () => {
    const keys = [
      `afolder:${ALL}:AllowAll`,
      `stream:${ALL}:AllowList`,
      `stream:${ALL}:AllowGet`,
      `destination:${ALL}:AllowList`,
    ];
    expect(summary(gapsFor(keys))).toEqual(["destination: AllowGet"]);
    expect(gapsFor([...keys, `destination:${ALL}:AllowGet`])).toEqual([]);
  });

  it("lets one stream's All meet Streams Get but not Streams List", () => {
    expect(summary(gapsFor(["dfolder:f1:AllowGet", "logs:app:AllowAll"]))).toEqual([
      "stream: AllowList",
    ]);
  });

  it("does not read a stream named like the wildcard as the wildcard", () => {
    expect(summary(gapsFor([`dfolder:${ALL}:AllowGet`, "logs:_all_x:AllowAll"]))).toEqual([
      "stream: AllowList",
    ]);
  });

  it("flags only the action still missing", () => {
    expect(summary(gapsFor([`dfolder:${ALL}:AllowList`, `stream:${ALL}:AllowList`]))).toEqual([
      "stream: AllowGet",
    ]);
  });

  it("flags again once the grant that met it leaves the set", () => {
    const keys = [`dfolder:${ALL}:AllowAll`, `stream:${ALL}:AllowAll`];
    expect(gapsFor(keys)).toEqual([]);
    expect(summary(gapsFor(keys.slice(0, 1)))).toEqual(["stream: AllowList, AllowGet"]);
  });

  it("does not flag a module this org lacks", () => {
    const noTemplates = new Set(["afolder", "destination", "stream"]);
    expect(gapsFor([`destination:${ALL}:AllowAll`], noTemplates)).toEqual([]);
    expect(
      summary(gapsFor([`afolder:${ALL}:AllowAll`], new Set(["afolder", "destination"]))),
    ).toEqual(["destination: AllowList, AllowGet"]);
  });
});

describe("roleCompanions - companionAddKeys", () => {
  it("stages the module-wide grant for each missing action", () => {
    const gap: CompanionGap = {
      module: "destination",
      actions: ["AllowList", "AllowGet"],
      neededBy: [{ module: "afolder", reasonKey: "iam.editRole.companionReasonAlertDestinations" }],
    };
    expect(companionAddKeys(gap, ORG)).toEqual([
      `destination:${ALL}:AllowList`,
      `destination:${ALL}:AllowGet`,
    ]);
  });

  it("adds Streams List but never Streams Get", () => {
    const [streams] = gapsFor([`dfolder:${ALL}:AllowAll`]);
    expect(companionAddKeys(streams, ORG)).toEqual([`stream:${ALL}:AllowList`]);
  });

  it("returns nothing for a Streams gap that is Get only", () => {
    const [streams] = gapsFor([`dfolder:${ALL}:AllowAll`, `stream:${ALL}:AllowList`]);
    expect(streams.actions).toEqual(["AllowGet"]);
    expect(companionAddKeys(streams, ORG)).toEqual([]);
  });
});
