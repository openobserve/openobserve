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

import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";
import { raw } from "@/types/i18n";
import { addCommasToNumber, formatSizeFromMB } from "@/utils/formatters";

export interface PricingDetails {
  base_cost: number;
  unit_divisor: number;
  metered_amount: number;
  metered_cost: number;
  percent_discount?: number | null;
  discounted_amount?: number | null;
}

export interface MissingDetail {
  kind: string;
  error: string;
}

export interface MeteringDetails {
  total_cost: number;
  total_discounted_amount?: number | null;
  cycle_start: number;
  cycle_end: number;
  ingestion: PricingDetails;
  query: PricingDetails;
  retention: PricingDetails;
  pipeline: PricingDetails;
  remote_pipeline: PricingDetails;
  ai: PricingDetails;
  synthetics_browser: PricingDetails;
  synthetics_protocol: PricingDetails;
  missing_details: MissingDetail[];
}

export interface MeteringResponse {
  upcoming: MeteringDetails;
  past: MeteringDetails[];
  oldest_ts?: number | null;
}

/** Accepts the flat pre-cycles body too, so an older backend still renders. */
export function parseMeteringResponse(body: unknown): MeteringResponse | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Partial<MeteringResponse> & Partial<MeteringDetails>;
  if (value.upcoming) {
    return {
      upcoming: value.upcoming,
      past: Array.isArray(value.past) ? value.past : [],
      oldest_ts: value.oldest_ts ?? null,
    };
  }
  if (typeof value.cycle_start !== "number") return null;
  return { upcoming: body as MeteringDetails, past: [], oldest_ts: value.cycle_start };
}

export function cyclesNewestFirst(response: MeteringResponse | null): MeteringDetails[] {
  if (!response) return [];
  const past = response.past
    .filter((cycle) => cycle.cycle_end > cycle.cycle_start)
    .sort((a, b) => b.cycle_start - a.cycle_start);
  return [response.upcoming, ...past];
}

export type MeterKey =
  | "ingestion"
  | "query"
  | "retention"
  | "pipeline"
  | "remote_pipeline"
  | "ai"
  | "synthetics_browser"
  | "synthetics_protocol";

export interface MeterDef {
  key: MeterKey;
  labelKey: I18nKey;
  /** The rate's denominator, e.g. "$0.06 per GB". */
  rateUnitKey: I18nKey;
  /** `event` values in the org's `usage` stream. Empty when the meter emits none. */
  events: string[];
  /** What the meter counts, in words, e.g. "Data scanned by searches". */
  billedAsKey: I18nKey;
}

/** One row of a bill table or strip: a meter, or a member org of a super org. */
export interface BillRow {
  key: string;
  label: I18nText;
  volume: I18nText;
  rate: I18nText;
  /** Billed cost after this meter's discount; every share on the page is of the billed total. */
  cost: number;
  /** Cost before discount, straight from `metered_cost`. */
  gross: number;
  discount: number;
  /** The backend reported this meter under `missing_details`, so its cost is unknown. */
  missing: boolean;
  discountPercent: number;
  /** The breakdown opens: the meter has one, and something was metered this cycle. */
  drillable: boolean;
  /** The meter has a breakdown at all; with `drillable` false it is only empty this cycle. */
  hasBreakdown: boolean;
  /** Replaces the "volume at rate" line under the label, for rows that are not meters. */
  subline?: I18nText;
}

export interface MeterRow extends BillRow {
  key: MeterKey;
}

export interface CycleProgress {
  day: number;
  totalDays: number;
  elapsed: number;
}

/** Display order. Both charts iterate this, so a meter keeps one palette slot across tabs. */
export const METERS: MeterDef[] = [
  {
    key: "ingestion",
    labelKey: "billing.ingestion",
    rateUnitKey: "billing.usageV2.unitGb",
    events: ["Ingestion"],
    billedAsKey: "billing.usageV2.billedIngestion",
  },
  {
    key: "query",
    labelKey: "billing.search",
    rateUnitKey: "billing.usageV2.unitGb",
    events: ["Search"],
    billedAsKey: "billing.usageV2.billedQuery",
  },
  {
    key: "pipeline",
    labelKey: "billing.pipelines",
    rateUnitKey: "billing.usageV2.unitGb",
    events: ["Pipeline"],
    billedAsKey: "billing.usageV2.billedPipeline",
  },
  {
    key: "remote_pipeline",
    labelKey: "billing.remotePipelines",
    rateUnitKey: "billing.usageV2.unitGb",
    events: ["RemotePipeline"],
    billedAsKey: "billing.usageV2.billedRemotePipeline",
  },
  {
    key: "retention",
    labelKey: "billing.dataRetention",
    // Metered in MB-hours; Stripe divides by 1024, so the price is per GB-hour.
    rateUnitKey: "billing.usageV2.unitGbHour",
    events: [],
    billedAsKey: "billing.usageV2.billedRetention",
  },
  {
    key: "ai",
    labelKey: "billing.aiCredits",
    rateUnitKey: "billing.usageV2.unitCredit",
    // NewIncident is a size-1 activity record beside the incident's AiCredits; the backend never bills it.
    events: ["AiCredits"],
    billedAsKey: "billing.usageV2.billedAi",
  },
  {
    key: "synthetics_browser",
    labelKey: "billing.usageV2.syntheticsBrowser",
    rateUnitKey: "billing.usageV2.unitRun",
    events: ["SyntheticsBrowserSteps"],
    billedAsKey: "billing.usageV2.billedSynthetics",
  },
  {
    key: "synthetics_protocol",
    labelKey: "billing.usageV2.syntheticsProtocol",
    rateUnitKey: "billing.usageV2.unitRun",
    events: ["SyntheticsProtocolSteps"],
    billedAsKey: "billing.usageV2.billedSynthetics",
  },
];

const DAY_MS = 86_400_000;

const MIN_PROJECTION_DAYS = 3;

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

/** Rates run to four decimals because synthetics costs a fraction of a cent per run. */
const USD_RATE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** Under a cent a rate keeps three significant digits, so a real price never reads $0.00. */
const USD_TINY_RATE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumSignificantDigits: 3,
});

const USD_PRECISE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const GB_HOURS = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const CYCLE_DATE = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const DAY_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** "Oct 12" for a moment in Unix seconds, read in UTC. */
export const formatDay = (seconds: number): string => DAY_DATE.format(new Date(seconds * 1000));

/** "Oct 12, 2026" for a moment in Unix seconds, read in UTC. */
export const formatFullDay = (seconds: number): string =>
  CYCLE_DATE.format(new Date(seconds * 1000));

/** `precise` shows four decimals, for a range so short that two decimals would read $0.00. */
export function formatCost(amount: number | null | undefined, precise = false): I18nText {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return raw("—");
  return raw((precise ? USD_PRECISE : USD).format(Number(amount)));
}

/** A `unit_divisor` of 1024 means `metered_amount` is megabytes, MB-hours for retention. A 1 means it is a count. */
export function formatVolume(
  meter: PricingDetails | null | undefined,
  key?: MeterKey | null,
): I18nText {
  const amount = meter?.metered_amount;
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return raw("—");
  if (Number(meter?.unit_divisor) === 1) return raw(addCommasToNumber(Math.round(amount)));
  if (key === "retention") return raw(formatGbHours(amount));
  return raw(formatSizeFromMB(amount));
}

/** Always GB-hours, the unit retention is priced in, so the amount reads against its rate. */
export function formatGbHours(mbHours: number): string {
  return `${GB_HOURS.format(mbHours / 1024)} GB-hours`;
}

export function formatRate(
  meter: PricingDetails | null | undefined,
  def: MeterDef,
  t: TranslateFn,
): I18nText {
  const base = Number(meter?.base_cost);
  if (!Number.isFinite(base)) return raw("—");
  return t("billing.usageV2.ratePerUnit", {
    rate: (base > 0 && base < 0.01 ? USD_TINY_RATE : USD_RATE).format(base),
    unit: t(def.rateUnitKey),
  });
}

export function formatCycle(details: MeteringDetails, t: TranslateFn): I18nText {
  return t("billing.usageV2.cycleRange", {
    start: formatFullDay(details.cycle_start),
    end: formatFullDay(details.cycle_end),
  });
}

/** Cost per stored unit, used to price a `usage` stream volume on the client. */
export function unitRate(meter: PricingDetails | null | undefined): number {
  const base = Number(meter?.base_cost);
  const divisor = Number(meter?.unit_divisor);
  if (!Number.isFinite(base) || !Number.isFinite(divisor) || divisor === 0) return 0;
  return base / divisor;
}

/** The `usage` stream event names this meter covers, keyed by event for a chart lookup. */
export function meterForEvent(event: string): MeterDef | undefined {
  return METERS.find((def) => def.events.includes(event));
}

function billedAs(
  meter: PricingDetails | null | undefined,
  def: MeterDef,
  t: TranslateFn,
): I18nText | undefined {
  const base = Number(meter?.base_cost);
  const divisor = Number(meter?.unit_divisor);
  const cost = Number(meter?.metered_cost);
  if (!(divisor > 1 && base > 0 && cost > 0)) return undefined;
  const billed = cost / base;
  if (billed <= ((Number(meter?.metered_amount) || 0) / divisor) * 1.01) return undefined;
  return t("billing.usageV2.volumeAtRateBilled", {
    volume: formatVolume(meter, def.key),
    rate: formatRate(meter, def, t),
    amount: raw(addCommasToNumber(Math.round(billed * 100) / 100)),
    unit: t(def.rateUnitKey),
  });
}

export function buildMeterRows(
  details: MeteringDetails | null | undefined,
  t: TranslateFn,
): MeterRow[] {
  if (!details) return [];
  const missing = new Set((details.missing_details ?? []).map((entry) => entry.kind));
  return METERS.map((def) => {
    const meter = details[def.key];
    const hasBreakdown = def.events.length > 0 || def.key === "retention";
    return {
      key: def.key,
      label: t(def.labelKey),
      volume: formatVolume(meter, def.key),
      rate: formatRate(meter, def, t),
      subline: billedAs(meter, def, t),
      cost: netCost(meter),
      gross: Number(meter?.metered_cost) || 0,
      discount: Number(meter?.discounted_amount) || 0,
      missing: missing.has(def.key),
      discountPercent: Number(meter?.percent_discount) || 0,
      // A breakdown of a meter with nothing metered would open onto an empty table.
      drillable: hasBreakdown && Number(meter?.metered_amount) > 0,
      hasBreakdown,
    };
  });
}

/** Meters that count credits or runs rather than megabytes. */
const COUNTED_METERS: MeterKey[] = ["ai", "synthetics_browser", "synthetics_protocol"];

export function volumeDetails(
  volumes: Record<string, number>,
  start: number,
  end: number,
): MeteringDetails {
  const meters = Object.fromEntries(
    METERS.map((def) => [
      def.key,
      {
        base_cost: 0,
        unit_divisor: COUNTED_METERS.includes(def.key) ? 1 : 1024,
        metered_amount: def.events.reduce((sum, event) => sum + (Number(volumes[event]) || 0), 0),
        metered_cost: 0,
      },
    ]),
  ) as Record<MeterKey, PricingDetails>;
  return { ...meters, total_cost: 0, cycle_start: start, cycle_end: end, missing_details: [] };
}

/** Used meters by cost, highest first; unused ones fold into a single line. */
export function splitByUse(rows: MeterRow[]): { used: MeterRow[]; unused: MeterRow[] } {
  const used = rows.filter((row) => row.cost > 0 || row.missing).sort((a, b) => b.cost - a.cost);
  const unused = rows.filter((row) => row.cost <= 0 && !row.missing);
  return { used, unused };
}

/** Sum of per meter cost before discounts; `total_cost` is this minus the discount. */
export function subtotalCost(details: MeteringDetails | null | undefined): number {
  if (!details) return 0;
  return METERS.reduce((sum, def) => sum + (Number(details[def.key]?.metered_cost) || 0), 0);
}

/** A meter's billed cost: `metered_cost` minus its `discounted_amount`, both server numbers. */
export function netCost(meter: PricingDetails | null | undefined): number {
  const gross = Number(meter?.metered_cost) || 0;
  const discount = Number(meter?.discounted_amount) || 0;
  return Math.max(gross - discount, 0);
}

/** What one stored unit actually cost this cycle, discount included, falling back to list price. */
export function effectiveRate(meter: PricingDetails | null | undefined): number {
  const amount = Number(meter?.metered_amount);
  if (Number.isFinite(amount) && amount > 0 && Number(meter?.metered_cost) > 0) {
    return netCost(meter) / amount;
  }
  return unitRate(meter);
}

export function cycleProgress(details: MeteringDetails, now: number = Date.now()): CycleProgress {
  const start = details.cycle_start * 1000;
  const end = details.cycle_end * 1000;
  const length = Math.max(end - start, 1);
  const elapsed = Math.min(Math.max((now - start) / length, 0), 1);
  const totalDays = Math.max(Math.round(length / DAY_MS), 1);
  const day = Math.min(Math.max(Math.ceil((now - start) / DAY_MS), 1), totalDays);
  return { day, totalDays, elapsed };
}

/** A straight line run rate; null before a few days have passed, because early cycles swing wildly. */
export function projectCycleCost(
  details: MeteringDetails | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!details) return null;
  const { day, elapsed } = cycleProgress(details, now);
  if (day < MIN_PROJECTION_DAYS || elapsed <= 0) return null;
  return (Number(details.total_cost) || 0) / elapsed;
}

/** One month of planned usage, in the units people plan in rather than billing units. */
export interface EstimateInputs {
  ingestGb: number;
  searchCount: number;
  pipelineCount: number;
  retentionDays: number;
  aiCredits: number;
  /** Converts a pipeline count into processed megabytes. */
  avgStreamMb: number;
  /** Converts a search count into scanned megabytes. */
  scanPerSearchMb: number;
  browserChecks: number;
  browserSteps: number;
  browserRegions: number;
  browserDevices: number;
  browserIntervalSec: number;
  apiChecks: number;
  apiRegions: number;
  apiIntervalSec: number;
}

export interface EstimateLine {
  key: MeterKey;
  /** Megabytes for a volume meter, credits for AI, runs for synthetics. */
  quantity: number;
  unit: "mb" | "credit" | "run";
  cost: number;
}

export interface Estimate {
  lines: EstimateLine[];
  total: number;
}

const MB_PER_GB = 1024;

const SECONDS_PER_DAY = 86400;
const HOURS_PER_DAY = 24;

const DAYS_PER_MONTH = 30;

const finite = (value: number) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export function monthlyPace(
  amount: number | string | undefined,
  details: MeteringDetails,
  now: number = Date.now(),
): number {
  const cycleDays = (details.cycle_end - details.cycle_start) / SECONDS_PER_DAY;
  const daysPassed = Math.max(cycleProgress(details, now).elapsed * cycleDays, 1);
  return ((Number(amount) || 0) / daysPassed) * DAYS_PER_MONTH;
}

export function fitWholeCount(exact: number): { count: number; scale: number } {
  if (!(exact > 0)) return { count: 0, scale: 1 };
  const count = Math.max(1, Math.round(exact));
  return { count, scale: exact / count };
}

/** Scheduled runs in a 30 day month; a check with no interval never runs. */
export function runsPerMonth(intervalSec: number): number {
  const interval = finite(intervalSec);
  return interval > 0 ? (DAYS_PER_MONTH * SECONDS_PER_DAY) / interval : 0;
}

/** Browser checks bill per step run: every step, in every region, on every device, each time it runs. */
export function browserStepRuns(input: EstimateInputs): number {
  return (
    finite(input.browserChecks) *
    finite(input.browserSteps) *
    finite(input.browserRegions) *
    finite(input.browserDevices) *
    runsPerMonth(input.browserIntervalSec)
  );
}

/** API checks bill per run, in every region. */
export function apiCheckRuns(input: EstimateInputs): number {
  return finite(input.apiChecks) * finite(input.apiRegions) * runsPerMonth(input.apiIntervalSec);
}

/** Cost per stored megabyte per day: the org's own billed rate once it has retention usage, else list price. */
export function retentionDailyRate(details: MeteringDetails | null | undefined): number {
  const meter = details?.retention;
  if (!meter) return 0;
  const amount = Number(meter.metered_amount) || 0;
  const cost = Number(meter.metered_cost) || 0;
  // `metered_amount` is MB-hours, not stored MB, so cost / amount is already per MB-hour and must not be divided by the cycle's days.
  const perMbHour = amount > 0 && cost > 0 ? cost / amount : unitRate(meter);
  return perMbHour * HOURS_PER_DAY;
}

/** What a month of the given usage would cost at list price, one line per meter. */
export function estimateCost(
  details: MeteringDetails | null | undefined,
  input: EstimateInputs,
): Estimate {
  if (!details) return { lines: [], total: 0 };
  const num = (value: number) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const ingestMb = num(input.ingestGb) * MB_PER_GB;
  const scannedMb = num(input.searchCount) * num(input.scanPerSearchMb);
  const pipelineMb = num(input.pipelineCount) * num(input.avgStreamMb);
  const credits = num(input.aiCredits);
  const browserRuns = browserStepRuns(input);
  const apiRuns = apiCheckRuns(input);
  // Typed here, so each meter key stays a MeterKey rather than widening to string.
  const priced: EstimateLine[] = [
    {
      key: "ingestion",
      quantity: ingestMb,
      unit: "mb",
      cost: ingestMb * unitRate(details.ingestion),
    },
    { key: "query", quantity: scannedMb, unit: "mb", cost: scannedMb * unitRate(details.query) },
    {
      key: "pipeline",
      quantity: pipelineMb,
      unit: "mb",
      cost: pipelineMb * unitRate(details.pipeline),
    },
    {
      key: "retention",
      quantity: ingestMb,
      unit: "mb",
      cost: ingestMb * num(input.retentionDays) * retentionDailyRate(details),
    },
    { key: "ai", quantity: credits, unit: "credit", cost: credits * unitRate(details.ai) },
    {
      key: "synthetics_browser",
      quantity: browserRuns,
      unit: "run",
      cost: browserRuns * unitRate(details.synthetics_browser),
    },
    {
      key: "synthetics_protocol",
      quantity: apiRuns,
      unit: "run",
      cost: apiRuns * unitRate(details.synthetics_protocol),
    },
  ];
  const lines = priced.map((line) => ({
    ...line,
    cost: Number.isFinite(line.cost) ? line.cost : 0,
  }));
  return { lines, total: lines.reduce((sum, line) => sum + line.cost, 0) };
}

/** One org's part of one meter on a super org's bill. */
export interface MeterShare {
  /** The org's volume of this meter in the `usage` stream: megabytes, or a count. */
  volume: number;
  gross: number;
  billed: number;
}

export function scopedMeterRows(
  details: MeteringDetails | null | undefined,
  shares: Partial<Record<MeterKey, MeterShare>>,
  t: TranslateFn,
): MeterRow[] {
  if (!details) return [];
  return METERS.filter((def) => def.events.length).map((def) => {
    const meter = details[def.key];
    const share = shares[def.key] ?? { volume: 0, gross: 0, billed: 0 };
    const discount = Math.max(share.gross - share.billed, 0);
    return {
      key: def.key,
      label: t(def.labelKey),
      volume: formatVolume(meter ? { ...meter, metered_amount: share.volume } : null),
      rate: formatRate(meter, def, t),
      cost: share.billed,
      gross: share.gross,
      discount,
      missing: false,
      discountPercent: share.gross > 0 ? Math.round((discount / share.gross) * 1000) / 10 : 0,
      drillable: share.volume > 0,
      hasBreakdown: true,
    };
  });
}

/** An org on a super org's bill: the super org itself, or one of its billing group members. */
export interface BillingOrg {
  id: string;
  name: string;
  isSelf: boolean;
}

export function billingGroupOrgs(members: unknown, selfId: string): BillingOrg[] {
  const list = Array.isArray(members) ? members : [];
  if (!list.length) return [];
  const selfName = String(list[0]?.payer_org_name || selfId);
  return [
    { id: selfId, name: selfName, isSelf: true },
    ...list.map((member: any) => ({
      id: String(member?.member_org_id ?? ""),
      name: String(member?.member_org_name || member?.member_org_id || ""),
      isSelf: false,
    })),
  ].filter((org) => org.id);
}
