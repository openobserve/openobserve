// Copyright 2026 OpenObserve Inc.
import type { BrowserCheck, BrowserCheckFrequency, BrowserCheckSchedule } from '@/types/synthetics'
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

  const isHours = s.intervalUnit === 'hours'
  const intervalValue = isHours ? (s.intervalValue ?? 1) : (s.intervalValue ?? 5)

  const freq: BrowserCheckFrequency = {
    type: isHours ? 'hours' : 'minutes',
    interval: intervalValue,
    cron: '',
  }

  if (s.startType === 'later' && s.startDate && s.startTime) {
    freq.start_time = new Date(`${s.startDate}T${s.startTime}`).getTime()
  }

  return freq
}

export function buildCreateBrowserTestPayload(check: BrowserCheck): Record<string, unknown> {
  const {
    journey, schedule, rum, auth, variables, secrets, headers, cookies, notifications,
    url, folder, browserDevices, retries, waitBeforeRetrySecs, cooldownSecs, alertIfFails,
    tz_offset,
    ...rest
  } = check

  return {
    ...rest,                          // name, description, enabled, tags, locations
    type: 'browser',
    target: url,                      // url → target
    folder_id: folder,                // folder → folder_id
    tz_offset: tz_offset ?? 0,

    collect_rum_data: rum.collect,
    session_replay: rum.sessionReplay,

    retries: retries ?? 0,
    wait_before_retry_secs: waitBeforeRetrySecs ?? 5,
    alert_if_fails: alertIfFails ?? 1,
    cooldown_secs: cooldownSecs ?? 0,

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

function mapFrequencyToSchedule(freq: any): BrowserCheck['schedule'] {
  if (!freq) return { type: 'interval', intervalValue: 5, intervalUnit: 'minutes' }

  if (freq.type === 'cron') {
    return {
      type: 'cron',
      cron: freq.cron,
      timezone: freq.timezone,
    }
  }

  const isHours = freq.type === 'hours'
  const intervalValue = freq.interval ?? 5

  return {
    type: 'interval',
    intervalValue,
    intervalUnit: isHours ? 'hours' : 'minutes',
    ...(freq.start_time && {
      startType: 'later' as const,
      startDate: new Date(freq.start_time).toISOString().split('T')[0],
      startTime: new Date(freq.start_time).toTimeString().slice(0, 5),
    }),
  }
}

export function mapResponseToBrowserCheck(data: Record<string, unknown>): BrowserCheck {
  const {
    config, frequency,
    collect_rum_data, session_replay,
    destinations,
    retries, wait_before_retry_secs, alert_if_fails, cooldown_secs,
    target, folder_id,
    variables,
    ...rest
  } = data as any

  return {
    ...rest,
    url: target,
    folder: folder_id,

    rum: {
      collect: collect_rum_data ?? true,
      sessionReplay: session_replay ?? false,
    },

    schedule: mapFrequencyToSchedule(frequency),

    notifications: {
      destinations: destinations ?? [],
    },

    retries: retries ?? 0,
    waitBeforeRetrySecs: wait_before_retry_secs ?? 5,
    alertIfFails: alert_if_fails ?? 1,
    cooldownSecs: cooldown_secs ?? 0,

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
