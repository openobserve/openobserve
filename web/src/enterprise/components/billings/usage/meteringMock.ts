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

import type { MeteringDetails, MeteringResponse } from "./meteringModel";

/** Dev builds only, so a stray env flag can never put fake prices in front of a customer. */
export const USE_METERING_MOCK = import.meta.env.DEV && import.meta.env.VITE_USAGE_MOCK === "true";

const DAY_SECONDS = 86_400;

const CYCLE_DAYS = 30;

/** Day of the cycle the mock pretends it is, so the projection is past its warm-up. */
const MOCK_CYCLE_DAY = 12;

/** A real metering response, with the cycle moved so today falls inside it. */
export function mockMeteringDetails(now: number = Date.now()): MeteringDetails {
  const cycleStart = Math.floor(now / 1000 - (MOCK_CYCLE_DAY - 0.5) * DAY_SECONDS);
  return {
    total_cost: 0.69,
    total_discounted_amount: 0.08,
    cycle_start: cycleStart,
    cycle_end: cycleStart + CYCLE_DAYS * DAY_SECONDS,
    ingestion: {
      base_cost: 0.5,
      unit_divisor: 1024,
      metered_amount: 1016,
      metered_cost: 0.5,
      percent_discount: 10,
      discounted_amount: 0.06,
    },
    query: {
      base_cost: 0.01,
      unit_divisor: 1024,
      metered_amount: 6634,
      metered_cost: 0.07,
      percent_discount: 0,
      discounted_amount: 0,
    },
    retention: {
      base_cost: 1.3563368e-7,
      unit_divisor: 1024,
      metered_amount: 114235,
      metered_cost: 0,
      percent_discount: 0,
      discounted_amount: 0,
    },
    pipeline: {
      base_cost: 0.2,
      unit_divisor: 1024,
      metered_amount: 499,
      metered_cost: 0.2,
      percent_discount: 10,
      discounted_amount: 0.02,
    },
    remote_pipeline: {
      base_cost: 0.3,
      unit_divisor: 1024,
      metered_amount: 0,
      metered_cost: 0,
      percent_discount: 0,
      discounted_amount: 0,
    },
    ai: {
      base_cost: 0.5,
      unit_divisor: 1,
      metered_amount: 0,
      metered_cost: 0,
      percent_discount: 0,
      discounted_amount: 0,
    },
    synthetics_browser: {
      base_cost: 0.0002574,
      unit_divisor: 1,
      metered_amount: 0,
      metered_cost: 0,
      percent_discount: 0,
      discounted_amount: 0,
    },
    synthetics_protocol: {
      base_cost: 0.00000494,
      unit_divisor: 1,
      metered_amount: 0,
      metered_cost: 0,
      percent_discount: 0,
      discounted_amount: 0,
    },
    missing_details: [],
  };
}

/** Two closed cycles behind the current one, so the trend ranges have something to chart. */
export function mockMeteringResponse(now: number = Date.now()): MeteringResponse {
  const upcoming = mockMeteringDetails(now);
  const cycleSeconds = upcoming.cycle_end - upcoming.cycle_start;
  const past = [1, 2].map((back) => {
    const cycleStart = upcoming.cycle_start - back * cycleSeconds;
    return {
      ...mockMeteringDetails(now),
      cycle_start: cycleStart,
      cycle_end: cycleStart + cycleSeconds,
    };
  });
  return { upcoming, past, oldest_ts: past[past.length - 1].cycle_start };
}
