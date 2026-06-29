// Copyright 2026 OpenObserve Inc.
import { DateTime } from 'luxon'
import type { BrowserCheck, BrowserCheckFrequency, BrowserCheckSchedule } from '@/types/synthetics'
import { convertDateToTimestamp, getTimezoneOffset } from '@/utils/timezone'
import { journeyToWireSteps, mapWireSteps } from './mapRecordedStep'

// ── Outbound: BrowserCheck → API payload ─────────────────────────────────────

function buildFrequency(s: BrowserCheckSchedule): BrowserCheckFrequency {
  if (s.type === 'cron') {
    return {
      type: 'cron',
      cron: s.cron ?? '',
      timezone: s.timezone,
    }
  }

  const unit = s.intervalUnit ?? 'minutes'
  const intervalValue = s.intervalValue ?? (unit === 'hours' ? 1 : 5)

  const freq: BrowserCheckFrequency = {
    type: unit as BrowserCheckFrequency['type'],
    interval: intervalValue,
    cron: '',
  }

  if (s.timezone) freq.timezone = s.timezone

  return freq
}

export function buildCreateBrowserTestPayload(check: BrowserCheck): Record<string, unknown> {
  const {
    journey, schedule, rum, auth, variables, secrets, headers, cookies, notifications,
    url, folder, browserDevices, retries, waitBeforeRetrySecs, cooldownMins, alertIfFails,
    tz_offset,
    ...rest
  } = check

  // Compute start (microseconds, top-level — matches reports pattern)
  let start: number | undefined
  let resolvedTzOffset = tz_offset ?? 0

  if (schedule.timezone) {
    if (schedule.startType === 'later' && schedule.startDate && schedule.startTime) {
      const [y, m, d] = schedule.startDate.split('-')
      const dateForConversion = `${d}-${m}-${y}` // ISO → DD-MM-YYYY
      const converted = convertDateToTimestamp(dateForConversion, schedule.startTime, schedule.timezone)
      start = converted.timestamp // microseconds
      resolvedTzOffset = converted.offset
    } else {
      resolvedTzOffset = getTimezoneOffset(schedule.timezone) ?? 0
    }
  } else {
    resolvedTzOffset = DateTime.now().offset
  }

  return {
    ...rest,                          // name, description, enabled, tags, locations
    type: 'browser',
    target: url,                      // url → target
    folder_id: folder,                // folder → folder_id
    tz_offset: resolvedTzOffset,
    ...(start !== undefined && { start }),

    collect_rum_data: rum.collect,
    session_replay: rum.sessionReplay,

    retries: retries ?? 0,
    wait_before_retry_secs: waitBeforeRetrySecs ?? 5,
    alert_if_fails: alertIfFails ?? 1,
    cooldown_mins: cooldownMins ?? 0,

    destinations: notifications.destinations,

    variables: (variables ?? []).map(({ id: _id, ...v }) => v),

    frequency: buildFrequency(schedule),

    config: {
      steps: journeyToWireSteps(journey),
      browser_devices: browserDevices ?? [{ browser: 'chromium', device: 'laptop_large' }],
      timeout_ms: 30000,
      capture: { screenshot: 'on_fail', trace: 'on_fail', video: 'off' },
      ...(auth?.basicAuth && {
        auth: {
          basic_auth: {
            enabled: auth.basicAuth.enabled,
            username: auth.basicAuth.username,
            password_secret_ref: auth.basicAuth.passwordSecretRef,
          },
        },
      }),
      ...(secrets?.length && { secrets: secrets.map(({ id: _id, ...s }) => s) }),
      ...(headers?.length && { headers: headers.map(({ id: _id, ...h }) => h) }),
      ...(cookies?.length && { cookies: cookies.map(({ id: _id, ...c }) => c) }),
    },
  }
}

// ── Inbound: API response → BrowserCheck ─────────────────────────────────────

function mapFrequencyToSchedule(freq: any, start?: number): BrowserCheck['schedule'] {
  if (!freq) return { type: 'interval', intervalValue: 5, intervalUnit: 'minutes' }

  if (freq.type === 'cron') {
    return {
      type: 'cron',
      cron: freq.cron,
      timezone: freq.timezone,
    }
  }

  const intervalValue = freq.interval ?? 5
  // Map API frequency type back to schedule unit (seconds → minutes for display)
  const unit = freq.type === 'seconds' ? 'minutes' : (freq.type ?? 'minutes')

  return {
    type: 'interval',
    intervalValue,
    intervalUnit: unit as BrowserCheckSchedule['intervalUnit'],
    ...(start && {
      startType: 'later' as const,
      timezone: freq.timezone,
      startDate: DateTime.fromMillis(start / 1000, { zone: freq.timezone ?? 'UTC' }).toFormat('yyyy-MM-dd'),
      startTime: DateTime.fromMillis(start / 1000, { zone: freq.timezone ?? 'UTC' }).toFormat('HH:mm'),
    }),
  }
}

export function mapResponseToBrowserCheck(data: Record<string, unknown>): BrowserCheck {
  const {
    config, frequency,
    collect_rum_data, session_replay,
    destinations,
    retries, wait_before_retry_secs, alert_if_fails, cooldown_mins,
    target, folder_id,
    variables, start,
    ...rest
  } = data as any

  return {
    ...rest,
    start: start ?? undefined,
    url: target,
    folder: folder_id,

    rum: {
      collect: collect_rum_data ?? true,
      sessionReplay: session_replay ?? false,
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

    ...(variables?.length && { variables }),
    ...(config?.auth && {
      auth: {
        basicAuth: config.auth.basic_auth
          ? {
              enabled: config.auth.basic_auth.enabled,
              username: config.auth.basic_auth.username,
              passwordSecretRef: config.auth.basic_auth.password_secret_ref,
            }
          : undefined,
      },
    }),
    ...(config?.secrets && { secrets: config.secrets }),
    ...(config?.headers && { headers: config.headers }),
    ...(config?.cookies && { cookies: config.cookies }),
  } as BrowserCheck
}
