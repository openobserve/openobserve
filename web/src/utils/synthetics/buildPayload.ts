// Copyright 2026 OpenObserve Inc.
import { DateTime } from "luxon";
import type {
  BrowserCheck,
  BrowserCheckFrequency,
  BrowserCheckSchedule,
  HttpCheckConfig,
  ProtocolCheck,
  ProtocolCheckType,
  SshCheckConfig,
  TcpCheckConfig,
  TlsCheckConfig,
} from "@/types/synthetics";
import { convertDateToTimestamp } from "@/utils/timezone";
import { journeyToWireSteps, mapWireSteps } from "./mapRecordedStep";
import { useLocalTimezone } from "../storage";

// ── Outbound: BrowserCheck → API payload ─────────────────────────────────────

function buildFrequency(s: BrowserCheckSchedule): BrowserCheckFrequency {
  if (s.type === "cron") {
    return {
      type: "cron",
      cron: s.cron ?? "",
      timezone: s.timezone,
    };
  }

  const unit = s.intervalUnit ?? "minutes";
  const intervalValue = s.intervalValue ?? (unit === "hours" ? 1 : 5);

  const freq: BrowserCheckFrequency = {
    type: unit as BrowserCheckFrequency["type"],
    interval: intervalValue,
    cron: "",
  };

  if (s.timezone) freq.timezone = s.timezone;

  return freq;
}

/**
 * Computes the top-level `start` (microseconds) + tz_offset from the schedule.
 * NOTE: for "Schedule Now" this also writes the browser timezone back onto
 * `check.schedule.timezone` (pre-existing behavior the browser flow relies on).
 */
function computeStart(check: BrowserCheck): { start: number; tz_offset: number } {
  const { schedule, tz_offset } = check;
  if (schedule.startType === "later" && schedule.startDate && schedule.startTime) {
    // Schedule Later: use the user-chosen date/time/timezone
    const [y, m, d] = schedule.startDate.split("-");
    const dateForConversion = `${d}-${m}-${y}`; // ISO → DD-MM-YYYY
    const converted = convertDateToTimestamp(
      dateForConversion,
      schedule.startTime,
      schedule.timezone ?? "UTC",
    );
    return { start: converted.timestamp, tz_offset: converted.offset };
  }
  // Schedule Now: always use browser timezone (matches CreateReport.vue)
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const browserTz = useLocalTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const converted = convertDateToTimestamp(`${dd}-${mm}-${yyyy}`, `${hh}:${min}`, browserTz);
  check.schedule.timezone = browserTz;
  return { start: converted.timestamp, tz_offset: converted.offset ?? tz_offset ?? 0 };
}

export function buildCreateBrowserTestPayload(check: BrowserCheck): Record<string, unknown> {
  const {
    journey,
    schedule,
    rum,
    capture,
    auth,
    variables,
    secrets,
    headers,
    cookies,
    notifications,
    url,
    folder,
    browserDevices,
    retries,
    waitBeforeRetrySecs,
    cooldownMins,
    alertIfFails,
    tz_offset: _tz_offset,
    ...rest
  } = check;

  const { start, tz_offset: resolvedTzOffset } = computeStart(check);

  return {
    ...rest, // name, description, enabled, tags, locations
    type: "browser",
    target: url, // url → target
    folder_id: folder, // folder → folder_id
    tz_offset: resolvedTzOffset,
    start,

    collect_rum_data: rum.collect,
    session_replay: rum.sessionReplay,

    retries: retries ?? 0,
    wait_before_retry_secs: waitBeforeRetrySecs ?? 5,
    alert_if_fails: alertIfFails ?? 1,
    cooldown_mins: cooldownMins ?? 0,

    destinations: notifications.destinations,

    variables: (variables ?? []).map(({ id: _id, name, value, secure, example }) => ({
      name,
      value,
      secure: secure ?? false,
      example: example ?? "",
    })),

    frequency: buildFrequency(schedule),

    config: {
      steps: journeyToWireSteps(journey),
      browser_devices: browserDevices ?? [{ browser: "chromium", device: "desktop" }],
      timeout_ms: 30000,
      capture: {
        screenshot: capture?.screenshot ?? "on-fail",
        trace: capture?.trace ?? "on-fail",
        video: "off",
      },
      ...(secrets?.length && { secrets: secrets.map(({ id: _id, ...s }) => s) }),
      ...(headers?.length && { headers: headers.map(({ id: _id, ...h }) => h) }),
    },

    // Cookies ride at the top level (like auth/variables) so the backend
    // encrypts their values at rest and injects them via _AUTH_COOKIES.
    ...(cookies?.length && {
      cookies: cookies.map(({ name, value, domain }) => ({ name, value, domain })),
    }),

    ...(auth && {
      auth: {
        type: auth.type,
        username: auth.username,
        password: auth.password,
      },
    }),
  };
}

// ── Outbound: ProtocolCheck (http/tcp/tls/ssh) → API payload ─────────────────

/** Assertion values ride as JSON — send numerics as numbers ("200" → 200). */
function coerceAssertionValue(value: string): string | number {
  const trimmed = value.trim();
  if (trimmed !== "" && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return value;
}

function buildProtocolConfig(check: ProtocolCheck): Record<string, unknown> {
  switch (check.checkType) {
    case "http": {
      const c = check.http as HttpCheckConfig;
      return {
        method: c.method,
        timeout_ms: c.timeout_ms,
        follow_redirects: c.follow_redirects,
        headers: c.headers.filter((h) => h.name.trim()).map(({ name, value }) => ({ name, value })),
        ...(c.body.trim() && { body: c.body }),
        assertions: c.assertions
          .filter((a) => a.field)
          .map((a) => ({
            field: a.field,
            operator: a.operator,
            value: coerceAssertionValue(a.value),
          })),
      };
    }
    case "tcp": {
      const c = check.tcp as TcpCheckConfig;
      return {
        port: c.port,
        timeout_ms: c.timeout_ms,
        ...(c.response_contains.trim() && { response_contains: c.response_contains }),
      };
    }
    case "tls": {
      const c = check.tls as TlsCheckConfig;
      return {
        port: c.port,
        timeout_ms: c.timeout_ms,
        min_days_until_expiry: c.min_days_until_expiry,
        verify_chain: c.verify_chain,
        verify_hostname: c.verify_hostname,
      };
    }
    case "ssh": {
      const c = check.ssh as SshCheckConfig;
      return {
        port: c.port,
        username: c.username,
        auth: { type: c.authType, secret: c.secret },
        timeout_ms: c.timeout_ms,
      };
    }
  }
}

export function buildCreateProtocolCheckPayload(check: ProtocolCheck): Record<string, unknown> {
  const { start, tz_offset } = computeStart(check);

  return {
    name: check.name,
    description: check.description ?? "",
    tags: check.tags,
    type: check.checkType,
    target: check.url,
    enabled: check.enabled,
    folder_id: check.folder,
    tz_offset,
    start,
    locations: check.locations,

    retries: check.retries ?? 0,
    wait_before_retry_secs: check.waitBeforeRetrySecs ?? 5,
    alert_if_fails: check.alertIfFails ?? 1,
    cooldown_mins: check.cooldownMins ?? 0,

    destinations: check.notifications.destinations,

    variables: (check.variables ?? []).map(({ name, value, secure, example }) => ({
      name,
      value,
      secure: secure ?? false,
      example: example ?? "",
    })),

    frequency: buildFrequency(check.schedule),
    config: buildProtocolConfig(check),

    ...(check.checkType === "http" &&
      check.auth && {
        auth: {
          type: check.auth.type,
          username: check.auth.username,
          password: check.auth.password,
        },
      }),
  };
}

// ── Per-type defaults for a fresh protocol check ─────────────────────────────

export function defaultProtocolConfig(type: ProtocolCheckType): Partial<ProtocolCheck> {
  switch (type) {
    case "http":
      return {
        http: {
          method: "GET",
          headers: [],
          body: "",
          follow_redirects: true,
          timeout_ms: 10000,
          assertions: [{ field: "status_code", operator: "eq", value: "200" }],
        },
      };
    case "tcp":
      return { tcp: { port: null, timeout_ms: 10000, response_contains: "" } };
    case "tls":
      return {
        tls: {
          port: 443,
          timeout_ms: 10000,
          min_days_until_expiry: 30,
          verify_chain: true,
          verify_hostname: true,
        },
      };
    case "ssh":
      return {
        ssh: { port: 22, username: "", authType: "password", secret: "", timeout_ms: 10000 },
      };
  }
}

// ── Inbound: API response → BrowserCheck ─────────────────────────────────────

function mapFrequencyToSchedule(freq: any, start?: number): BrowserCheck["schedule"] {
  if (!freq) return { type: "interval", intervalValue: 5, intervalUnit: "minutes" };

  if (freq.type === "cron") {
    return {
      type: "cron",
      cron: freq.cron,
      timezone: freq.timezone,
    };
  }

  const intervalValue = freq.interval ?? 5;
  // Map API frequency type back to schedule unit (seconds → minutes for display)
  const unit = freq.type === "seconds" ? "minutes" : (freq.type ?? "minutes");

  // timezone is optional on the wire (API-created checks omit it) — a bare
  // .toLowerCase() here threw and silently blanked the whole edit form.
  const timezone = (freq.timezone ?? "").toLowerCase().startsWith("browser time")
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : freq.timezone;

  // On edit, always show as "Schedule Later" with date/time from `start`
  return {
    type: "interval",
    intervalValue,
    intervalUnit: unit as BrowserCheckSchedule["intervalUnit"],
    ...(start && {
      startType: "later" as const,
      timezone: freq.timezone,
      startDate: DateTime.fromMillis(start / 1000, { zone: timezone ?? "UTC" }).toFormat(
        "yyyy-MM-dd",
      ),
      startTime: DateTime.fromMillis(start / 1000, { zone: timezone ?? "UTC" }).toFormat("HH:mm"),
    }),
  };
}

export function mapResponseToBrowserCheck(data: Record<string, unknown>): BrowserCheck {
  const {
    config,
    frequency,
    collect_rum_data,
    session_replay,
    destinations,
    retries,
    wait_before_retry_secs,
    alert_if_fails,
    cooldown_mins,
    target,
    folder_id,
    variables,
    start,
    auth: apiAuth,
    cookies: apiCookies,
    ...rest
  } = data as any;

  return {
    ...rest,
    start: start ?? undefined,
    url: target,
    folder: folder_id,

    rum: {
      collect: collect_rum_data ?? true,
      sessionReplay: session_replay ?? false,
    },

    capture: {
      screenshot: config?.capture?.screenshot ?? "on-fail",
      trace: config?.capture?.trace ?? "on-fail",
    },

    schedule: mapFrequencyToSchedule(frequency, start),

    notifications: {
      destinations: destinations ?? [],
    },

    retries: retries ?? 0,
    waitBeforeRetrySecs: wait_before_retry_secs ?? 5,
    alertIfFails: alert_if_fails ?? 1,
    cooldownMins: cooldown_mins ?? 0,

    browserDevices: config?.browser_devices,

    journey: mapWireSteps(config?.steps ?? []),

    ...(variables?.length && {
      variables: (variables as any[]).map((v) => ({
        name: v.name,
        value: v.value,
        secure: v.secure ?? false,
        example: v.example ?? "",
      })),
    }),
    ...(apiAuth && {
      auth: {
        type: (apiAuth as any).type,
        username: (apiAuth as any).username,
        password: (apiAuth as any).password,
      },
    }),
    ...(config?.secrets && { secrets: config.secrets }),
    ...(config?.headers && { headers: config.headers }),
    // Cookies are top-level on the wire (encrypted at rest server-side).
    ...(apiCookies?.length && {
      cookies: (apiCookies as any[]).map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
      })),
    }),
  } as BrowserCheck;
}

// ── Inbound: API response → ProtocolCheck (http/tcp/tls/ssh edits) ───────────

export function mapResponseToProtocolCheck(data: Record<string, unknown>): ProtocolCheck {
  const base = mapResponseToBrowserCheck(data);
  const type = (data as any).type as ProtocolCheckType;
  const cfg = ((data as any).config ?? {}) as Record<string, any>;
  const check: ProtocolCheck = { ...base, checkType: type };

  switch (type) {
    case "http":
      check.http = {
        method: cfg.method ?? "GET",
        headers: (cfg.headers ?? []).map((h: any) => ({
          name: h.name ?? "",
          value: h.value ?? "",
        })),
        body: cfg.body ?? "",
        follow_redirects: cfg.follow_redirects ?? true,
        timeout_ms: cfg.timeout_ms ?? 10000,
        assertions: (cfg.assertions ?? []).map((a: any) => ({
          field: a.field ?? "",
          operator: a.operator ?? "eq",
          value: a.value != null ? String(a.value) : "",
        })),
      };
      break;
    case "tcp":
      check.tcp = {
        port: cfg.port ?? null,
        timeout_ms: cfg.timeout_ms ?? 10000,
        response_contains: cfg.response_contains ?? "",
      };
      break;
    case "tls":
      check.tls = {
        port: cfg.port ?? 443,
        timeout_ms: cfg.timeout_ms ?? 10000,
        min_days_until_expiry: cfg.min_days_until_expiry ?? 30,
        verify_chain: cfg.verify_chain ?? true,
        verify_hostname: cfg.verify_hostname ?? true,
      };
      break;
    case "ssh":
      check.ssh = {
        port: cfg.port ?? 22,
        username: cfg.username ?? "",
        authType: cfg.auth?.type === "private_key" ? "private_key" : "password",
        secret: cfg.auth?.secret ?? "",
        timeout_ms: cfg.timeout_ms ?? 10000,
      };
      break;
  }
  return check;
}
