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

import type { BrowserCheck, BrowserStep } from "@/types/synthetics";
import { getUUIDv7 } from "@/utils/zincutils";
import { placeholdersIn } from "./extractEligibility";

export const NAME_MAX_BYTES = 256;
const NAME_SEPARATOR = " — ";

export interface ExtractedChildInput {
  parent: BrowserCheck;
  range: BrowserStep[];
  name: string;
  folder: string;
  locations: string[];
  schedule: BrowserCheck["schedule"];
}

export interface ExtractedChildSplit {
  copied: string[];
  toDefine: string[];
}

/** Plain variables travel with the child; secure ones and secrets are only named, never copied. */
export function splitVariablesForChild(
  parent: BrowserCheck,
  range: BrowserStep[],
): ExtractedChildSplit {
  const plain = new Set(
    (parent.variables ?? []).filter((v) => v.secure !== true).map((v) => v.name),
  );
  const hidden = new Set([
    ...(parent.variables ?? []).filter((v) => v.secure === true).map((v) => v.name),
    ...(parent.secrets ?? []).map((s) => s.name),
  ]);
  const names = placeholdersIn(range);
  return {
    copied: names.filter((n) => plain.has(n)),
    toDefine: names.filter((n) => hidden.has(n)),
  };
}

/** Built field by field: `buildCreateBrowserTestPayload` spreads the rest, so a parent spread would leak. */
export function buildExtractedChildCheck(input: ExtractedChildInput): BrowserCheck {
  const { parent, range, name, folder, locations, schedule } = input;
  const { copied } = splitVariablesForChild(parent, range);
  const byName = new Map((parent.variables ?? []).map((v) => [v.name, v]));
  return {
    name,
    folder,
    locations: [...locations],
    schedule: { ...schedule, startType: "now" },
    url: range[0]?.value ?? "",
    journey: range.map((s) => ({ ...s, id: getUUIDv7(true), wire: undefined })),
    enabled: false,
    retries: parent.retries,
    waitBeforeRetrySecs: parent.waitBeforeRetrySecs,
    cooldownMins: parent.cooldownMins,
    alertIfFails: parent.alertIfFails,
    notifications: { destinations: [...parent.notifications.destinations] },
    browserDevices: parent.browserDevices,
    tz_offset: parent.tz_offset,
    rum: { collect: true, sessionReplay: false },
    capture: { screenshot: "on-fail", trace: "on-fail" },
    variables: copied.map((n) => {
      const v = byName.get(n);
      return { name: n, value: v?.value ?? "", secure: false, example: v?.example };
    }),
    tags: [],
  };
}

export function seedChildName(parentName: string, firstStepName: string): string {
  const seed = parentName.trim() ? `${parentName}${NAME_SEPARATOR}${firstStepName}` : firstStepName;
  const bytes = new TextEncoder().encode(seed);
  if (bytes.length <= NAME_MAX_BYTES) return seed;
  let cut = NAME_MAX_BYTES;
  // Back up over UTF-8 continuation bytes so the cut never splits a code point.
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--;
  return new TextDecoder().decode(bytes.subarray(0, cut));
}
