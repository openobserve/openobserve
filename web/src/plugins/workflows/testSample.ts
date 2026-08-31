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
// the Alert-Trigger schema reference. Shape matches a real alert firing (verified
// against live payload):
//   [ { meta: { ...fixed alert fields }, data: [ { ...rows } ] } ]
// The `meta` block is a MIXED map: text fields are strings, but the numeric alert
// fields (period, threshold, count) and the microsecond-epoch timestamps
// (start/end time) arrive as real numbers — the backend now types them, so the
// sample must too. `data[]` rows keep their native column types.
import { TRIGGER_META_VARS } from "./alertFields";
import { raw } from "@/types/i18n";

const SAMPLE_TS = 1700000000000000; // microsecond epoch, matches alert timestamps

// A readable placeholder per meta field, keyed by the field name (ref minus the
// "meta." prefix). Numeric fields are numbers, text fields are strings — matching
// the real payload's types. Falls back to "" for anything unmapped.
const NAMED_DEFAULTS: Record<string, string | number> = {
  org_id: "default",
  stream_type: "logs",
  stream_name: "default",
  alert_name: raw("High Error Rate"),
  alert_type: "scheduled",
  alert_operator: ">=",
  alert_period: 10,
  alert_threshold: 100,
  alert_count: 137,
  alert_start_time: SAMPLE_TS,
  alert_end_time: SAMPLE_TS + 600000000,
};

const typeDefault = (v: { enumValues?: string[] }) => (v.enumValues?.length ? v.enumValues[0] : "");

export const buildTestSample = (): unknown[] => {
  const meta: Record<string, string | number> = {};
  for (const v of TRIGGER_META_VARS) {
    const key = v.ref.replace(/^meta\./, "");
    meta[key] = key in NAMED_DEFAULTS ? NAMED_DEFAULTS[key] : typeDefault(v);
  }
  // Two illustrative result rows — real columns come from the alert's query.
  const row = (ts: number) => ({
    _timestamp: ts,
    job: "test",
    level: "info",
    log: "test message for openobserve",
  });
  return [{ meta, data: [row(SAMPLE_TS), row(SAMPLE_TS - 200000)] }];
};

// Pretty-printed JSON string for seeding the editor.
export const buildTestSampleText = (): string => JSON.stringify(buildTestSample(), null, 2);

// The FLATTENED view a Function node sees when "After Flattening" (RAF, the
// default) is on: the `meta` block becomes `meta_<field>` columns merged onto
// each `data[]` row — matching the field names Conditions use. Derived from
// buildTestSample() so both stay in sync, preserving each field's native type
// (numeric alert fields stay numbers, text fields stay strings).
export const buildFlatTestSample = (): unknown[] => {
  const [{ meta, data }] = buildTestSample() as [
    { meta: Record<string, unknown>; data: Record<string, unknown>[] },
  ];
  const metaFlat: Record<string, unknown> = {};
  for (const k of Object.keys(meta)) metaFlat[`meta_${k}`] = meta[k];
  return data.map((row) => ({ ...metaFlat, ...row }));
};
