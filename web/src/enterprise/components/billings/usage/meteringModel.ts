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

/**
 * What `price_details` carries: the cycle being billed now, then closed cycles
 * newest first, and the timestamp metering data starts at.
 */
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

/** Every cycle the API returned, newest first, so an index is "cycles back". */
export function cyclesNewestFirst(response: MeteringResponse | null): MeteringDetails[] {
  if (!response) return [];
  const past = [...response.past].sort((a, b) => b.cycle_start - a.cycle_start);
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
    rateUnitKey: "billing.usageV2.unitGb",
    events: [],
    billedAsKey: "billing.usageV2.billedRetention",
  },
  {
    key: "ai",
    labelKey: "billing.aiCredits",
    rateUnitKey: "billing.usageV2.unitCredit",
    events: ["AiCredits", "NewIncident"],
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

const USD_PRECISE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const CYCLE_DATE = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** `precise` shows four decimals, for a range so short that two decimals would read $0.00. */
export function formatCost(amount: number | null | undefined, precise = false): I18nText {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return raw("—");
  return raw((precise ? USD_PRECISE : USD).format(Number(amount)));
}

/** A `unit_divisor` of 1024 means `metered_amount` is megabytes. A 1 means it is a count. */
export function formatVolume(meter: PricingDetails | null | undefined): I18nText {
  const amount = meter?.metered_amount;
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return raw("—");
  return raw(
    Number(meter?.unit_divisor) === 1
      ? addCommasToNumber(Math.round(amount))
      : formatSizeFromMB(amount),
  );
}

export function formatRate(
  meter: PricingDetails | null | undefined,
  def: MeterDef,
  t: TranslateFn,
): I18nText {
  const base = Number(meter?.base_cost);
  if (!Number.isFinite(base)) return raw("—");
  return t("billing.usageV2.ratePerUnit", {
    rate: USD_RATE.format(base),
    unit: t(def.rateUnitKey),
  });
}

export function formatCycle(details: MeteringDetails, t: TranslateFn): I18nText {
  return t("billing.usageV2.cycleRange", {
    start: CYCLE_DATE.format(new Date(details.cycle_start * 1000)),
    end: CYCLE_DATE.format(new Date(details.cycle_end * 1000)),
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
      volume: formatVolume(meter),
      rate: formatRate(meter, def, t),
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
  searchMinutes: number;
  pipelineCount: number;
  retentionDays: number;
  aiCredits: number;
  /** Converts a pipeline count into processed megabytes. */
  avgStreamMb: number;
  /** Converts search minutes into scanned megabytes. */
  scanRateMbPerMin: number;
}

export interface EstimateLine {
  key: MeterKey;
  /** Megabytes for a volume meter, credits for AI. */
  quantity: number;
  unit: "mb" | "credit";
  cost: number;
}

export interface Estimate {
  lines: EstimateLine[];
  total: number;
}

const MB_PER_GB = 1024;

const SECONDS_PER_DAY = 86400;

/**
 * Cost per stored megabyte per day, derived from this org's own billed
 * retention. `base_cost` is not usable here: that meter's unit is not a plain
 * megabyte, so a guessed conversion would invent a number.
 */
export function retentionDailyRate(details: MeteringDetails | null | undefined): number {
  const meter = details?.retention;
  const cycleDays = ((details?.cycle_end ?? 0) - (details?.cycle_start ?? 0)) / SECONDS_PER_DAY;
  const amount = Number(meter?.metered_amount) || 0;
  if (!meter || amount <= 0 || cycleDays <= 0) return 0;
  return (Number(meter.metered_cost) || 0) / (amount * cycleDays);
}

/** What a month of the given usage would cost at list price, one line per meter. */
export function estimateCost(
  details: MeteringDetails | null | undefined,
  input: EstimateInputs,
): Estimate {
  if (!details) return { lines: [], total: 0 };
  const num = (value: number) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const ingestMb = num(input.ingestGb) * MB_PER_GB;
  const scannedMb = num(input.searchCount) * num(input.searchMinutes) * num(input.scanRateMbPerMin);
  const pipelineMb = num(input.pipelineCount) * num(input.avgStreamMb);
  const credits = num(input.aiCredits);
  const lines: EstimateLine[] = [
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
  ].map((line) => ({ ...line, cost: Number.isFinite(line.cost) ? line.cost : 0 }));
  return { lines, total: lines.reduce((sum, line) => sum + line.cost, 0) };
}

/**
 * One org's meters inside a super org's bill: volumes from the `usage` stream, priced at
 * the bill's own rates and discounts, since Stripe itemises the bill for the super org only.
 * Retention writes no usage events, so it cannot be split by org and is left out.
 */
export function scopedMeterRows(
  details: MeteringDetails | null | undefined,
  volumeByEvent: Record<string, number>,
  t: TranslateFn,
): MeterRow[] {
  if (!details) return [];
  return METERS.filter((def) => def.events.length).map((def) => {
    const meter = details[def.key];
    const amount = def.events.reduce((sum, event) => sum + (volumeByEvent[event] ?? 0), 0);
    const percent = Math.min(Math.max(Number(meter?.percent_discount) || 0, 0), 100);
    const gross = amount * unitRate(meter);
    const discount = (gross * percent) / 100;
    return {
      key: def.key,
      label: t(def.labelKey),
      volume: formatVolume(meter ? { ...meter, metered_amount: amount } : null),
      rate: formatRate(meter, def, t),
      cost: gross - discount,
      gross,
      discount,
      missing: false,
      discountPercent: percent,
      drillable: amount > 0,
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

/**
 * The orgs a super org pays for, itself first, from `GET /billing_group/members`.
 * Empty for any other org, which is how the page knows it is not a super org.
 */
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
