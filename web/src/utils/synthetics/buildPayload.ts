// Copyright 2026 OpenObserve Inc.
import type { BrowserCheck, BrowserCheckFrequency, BrowserCheckSchedule } from '@/types/synthetics'
import { journeyToWireSteps, mapWireSteps } from './mapRecordedStep'

// ── Outbound: BrowserCheck → API payload ─────────────────────────────────────

function buildFrequency(s: BrowserCheckSchedule): BrowserCheckFrequency {
  const freq: BrowserCheckFrequency = {
    type: s.type,
    ...(s.retries !== undefined && { retries: s.retries }),
    ...(s.retryDelayMs !== undefined && { retry_delay_ms: s.retryDelayMs }),
  }

  if (s.type === 'interval') {
    const mins =
      s.intervalUnit === 'hours'
        ? (s.intervalValue ?? 1) * 60
        : (s.intervalValue ?? 5)
    freq.interval = mins
  } else {
    freq.cron = s.cron
    freq.timezone = s.timezone
  }

  if (s.startType === 'later' && s.startDate && s.startTime) {
    freq.start_time = new Date(`${s.startDate}T${s.startTime}`).getTime()
  }

  return freq
}

export function buildCreateBrowserTestPayload(check: BrowserCheck): Record<string, unknown> {
  const { journey, schedule, rum, auth, variables, secrets, headers, cookies, notifications, ...rest } = check

  return {
    ...rest, // name, description, enabled, folder, tags, url, locations — pass through

    rum: { collect: rum.collect, session_replay: rum.sessionReplay },

    frequency: buildFrequency(schedule),

    notifications: {
      destinations: notifications.destinations,
      silence_minutes: notifications.silenceMinutes,
      ...(notifications.failureThreshold !== undefined && {
        failure_threshold: notifications.failureThreshold,
      }),
    },

    config: {
      steps: journeyToWireSteps(journey),
      browser_devices: [{ browser: 'chromium', device: 'laptop_large' }],
      timeout_ms: 30000,
      capture: { screenshot: 'on_fail', trace: 'on_fail' },
      ...(auth?.basicAuth && {
        auth: {
          basic_auth: {
            enabled: auth.basicAuth.enabled,
            username: auth.basicAuth.username,
            password_secret_ref: auth.basicAuth.passwordSecretRef,
          },
        },
      }),
      ...(variables?.length && { variables: variables.map(({ id: _id, ...v }) => v) }),
      ...(secrets?.length && { secrets: secrets.map(({ id: _id, ...s }) => s) }),
      ...(headers?.length && { headers: headers.map(({ id: _id, ...h }) => h) }),
      ...(cookies?.length && { cookies: cookies.map(({ id: _id, ...c }) => c) }),
    },
  }
}

// ── Inbound: API response → BrowserCheck ─────────────────────────────────────

function mapFrequencyToSchedule(freq: any): BrowserCheck['schedule'] {
  if (!freq) return { type: 'interval', intervalValue: 5, intervalUnit: 'minutes' }

  if (freq.type === 'cron') {
    return {
      type: 'cron',
      cron: freq.cron,
      timezone: freq.timezone,
      retries: freq.retries,
      retryDelayMs: freq.retry_delay_ms,
    }
  }

  const totalMins = freq.interval ?? 5
  const intervalUnit = totalMins % 60 === 0 && totalMins >= 60 ? 'hours' : 'minutes'
  const intervalValue = intervalUnit === 'hours' ? totalMins / 60 : totalMins

  return {
    type: 'interval',
    intervalValue,
    intervalUnit,
    retries: freq.retries,
    retryDelayMs: freq.retry_delay_ms,
    ...(freq.start_time && {
      startType: 'later' as const,
      startDate: new Date(freq.start_time).toISOString().split('T')[0],
      startTime: new Date(freq.start_time).toTimeString().slice(0, 5),
    }),
  }
}

export function mapResponseToBrowserCheck(data: Record<string, unknown>): BrowserCheck {
  const { config, frequency, rum, notifications, ...rest } = data as any

  return {
    ...rest,

    rum: {
      collect: rum?.collect ?? true,
      sessionReplay: rum?.session_replay ?? false,
    },

    schedule: mapFrequencyToSchedule(frequency),

    notifications: {
      destinations: notifications?.destinations ?? [],
      silenceMinutes: notifications?.silence_minutes ?? 60,
      failureThreshold: notifications?.failure_threshold,
    },

    journey: mapWireSteps(config?.steps ?? []),

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
    ...(config?.variables && { variables: config.variables }),
    ...(config?.secrets && { secrets: config.secrets }),
    ...(config?.headers && { headers: config.headers }),
    ...(config?.cookies && { cookies: config.cookies }),
  } as BrowserCheck
}
