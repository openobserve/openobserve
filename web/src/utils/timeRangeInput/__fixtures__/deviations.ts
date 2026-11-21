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

// Generated from corpus/deviations.md of the design folder; no row is added without the user's approval.

export interface Deviation {
  id: string;
  corpus: string;
  design: { state: "invalid"; reason: "zero-length" | "out-of-range" | "unreadable" };
  reason: string;
}

export const DEVIATIONS: Deviation[] = [
  {
    id: "und-097",
    corpus: "valid zero-length range [2026-11-17T09:00+01:00, 2026-11-17T09:00+01:00]",
    design: { state: "invalid", reason: "zero-length" },
    reason:
      "A range must have start < end; a zero-length range selects no data (design §4.5 step 5, T11).",
  },
  {
    id: "reg-C14-01",
    corpus: "valid instant 2255-06-05T23:47:34.740993Z",
    design: { state: "invalid", reason: "out-of-range" },
    reason: "9007199254740993 µs is above Number.MAX_SAFE_INTEGER (design T10, §4.2 step 4).",
  },
  {
    id: "reg-C14-04",
    corpus: "valid instant 2255-06-05T23:47:34.740993Z",
    design: { state: "invalid", reason: "out-of-range" },
    reason: "Same value and rule as reg-C14-01.",
  },
  {
    id: "und-023",
    corpus: "valid instant 2255-06-06T01:47:34.740993+02:00",
    design: { state: "invalid", reason: "out-of-range" },
    reason: "Same value and rule as reg-C14-01.",
  },
  {
    id: "und-045",
    corpus: "valid instant 2026-11-16T10:12:33.456+01:00",
    design: { state: "invalid", reason: "unreadable" },
    reason:
      "Pasted log lines are not read: text after a stamp must parse, and `INFO request done` does not.",
  },
  {
    id: "und-046",
    corpus: "valid instant 2026-11-16T09:12:33+01:00",
    design: { state: "invalid", reason: "unreadable" },
    reason: "Same rule as und-045: `GET /` after the CLF stamp is unread text.",
  },
  {
    id: "und-047",
    corpus: "valid instant 2026-11-16T09:12:33+01:00",
    design: { state: "invalid", reason: "unreadable" },
    reason: "Same rule as und-045: `host app:` after the syslog stamp is unread text.",
  },
];
