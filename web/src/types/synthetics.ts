// Copyright 2026 OpenObserve Inc.

export type SelectorType = 'CSS' | 'XPath' | 'Text' | 'TestID' | 'Role'

export type StepAction =
  | 'navigate'
  | 'click'
  | 'type'
  | 'select'
  | 'press'
  | 'hover'
  | 'scroll'
  | 'wait'
  | 'assert'
  | 'screenshot'

export interface BrowserStep {
  id: string
  action: StepAction
  name?: string
  selector?: string
  selectorType?: SelectorType
  value?: string
  timeout?: number // ms, default 30000
}

export interface BrowserCheckSchedule {
  type: 'interval' | 'cron'
  intervalValue?: number
  intervalUnit?: 'minutes' | 'hours'
  cron?: string
  timezone?: string
  retries?: number // 0–5
}

export interface BrowserCheck {
  id: string
  name: string
  url: string
  description?: string
  enabled: boolean
  folder?: string
  tags: string[]
  journey: BrowserStep[]
  schedule: BrowserCheckSchedule
  locations: string[]
  notifications: { destinations: string[]; silenceMinutes: number }
  rum: { collect: boolean; sessionReplay: boolean }
  auth?: {
    basicAuth?: {
      enabled: boolean
      username: string
      passwordSecretRef: string
    }
  }
  variables?: { name: string; value: string }[]
  secrets?: { name: string; value: string }[]
  headers?: { key: string; value: string }[]
  cookies?: { name: string; value: string; domain: string }[]
}
