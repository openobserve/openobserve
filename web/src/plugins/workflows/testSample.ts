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

// Builds the sample `inputs[]` payload prefilled into the Test drawer's editor.
//
// Derived from TRIGGER_META_VARS so the sample's `meta` keys stay in sync with
// the Alert-Trigger schema reference. Shape = "Option A" envelope per firing:
//   [ { meta: { ...fixed alert fields }, data: [ { ...one result row } ] } ]
// NOTE: the exact runtime shape (envelope vs flat row) is still being confirmed
// with the backend — this sample is a starting point the user edits, and will be
// pinned once the contract is final.
import { TRIGGER_META_VARS } from "./alertFields";

const SAMPLE_TS = 1700000000000000; // microsecond epoch, matches alert timestamps

// A readable placeholder per meta field, keyed by the field name (ref minus the
// "meta." prefix). Falls back to a type-based default for anything unmapped.
const NAMED_DEFAULTS: Record<string, unknown> = {
  org_name: "default",
  stream_type: "logs",
  stream_name: "default",
  alert_name: "High Error Rate",
  alert_type: "scheduled",
  alert_operator: ">=",
  alert_period: 10,
  alert_threshold: 100,
  alert_count: 137,
  alert_start_time: SAMPLE_TS,
  alert_end_time: SAMPLE_TS + 600000000,
};

const typeDefault = (v: { type: string; enumValues?: string[] }) => {
  if (v.enumValues?.length) return v.enumValues[0];
  switch (v.type) {
    case "number":
      return 0;
    case "datetime":
      return SAMPLE_TS;
    default:
      return "";
  }
};

export const buildTestSample = (): unknown[] => {
  const meta: Record<string, unknown> = {};
  for (const v of TRIGGER_META_VARS) {
    const key = v.ref.replace(/^meta\./, "");
    meta[key] = key in NAMED_DEFAULTS ? NAMED_DEFAULTS[key] : typeDefault(v);
  }
  return [
    {
      meta,
      data: [{ _timestamp: SAMPLE_TS, host: "web-01", status_code: 500 }],
    },
  ];
};

// Pretty-printed JSON string for seeding the editor.
export const buildTestSampleText = (): string =>
  JSON.stringify(buildTestSample(), null, 2);

// The FLATTENED view a Function node sees when "After Flattening" (RAF, the
// default) is on: the `meta` block becomes `meta_<field>` string columns merged
// onto each `data[]` row — matching the field names Conditions use. Derived from
// buildTestSample() so both stay in sync. Meta values are strings (the flattened
// `meta` block is a string:string map for now).
export const buildFlatTestSample = (): unknown[] => {
  const [{ meta, data }] = buildTestSample() as [
    { meta: Record<string, unknown>; data: Record<string, unknown>[] },
  ];
  const metaFlat: Record<string, string> = {};
  for (const k of Object.keys(meta)) metaFlat[`meta_${k}`] = String(meta[k]);
  return data.map((row) => ({ ...metaFlat, ...row }));
};
