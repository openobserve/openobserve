// Copyright 2026 OpenObserve Inc.

import type { StepAction, SelectorType, SyntheticCheckType } from "@/types/synthetics";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { raw, type I18nKey, I18nText, type TranslateFn } from "@/types/i18n";

// ── Action labels — i18n keys, resolved with t() by the consumer ─────────
export const ACTION_LABEL_KEYS: Record<StepAction, I18nKey> = {
  navigate: "synthetics.journey.actionLabels.navigate",
  click: "synthetics.journey.actionLabels.click",
  type: "synthetics.journey.actionLabels.type",
  select: "synthetics.journey.actionLabels.select",
  press: "synthetics.journey.actionLabels.press",
  hover: "synthetics.journey.actionLabels.hover",
  scroll: "synthetics.journey.actionLabels.scroll",
  wait: "synthetics.journey.actionLabels.wait",
  assert: "synthetics.journey.actionLabels.assert",
  screenshot: "synthetics.journey.actionLabels.screenshot",
};

// ── Action icons ─────────────────────────────────────────────────────────
export const ACTION_ICONS: Record<StepAction, IconName> = {
  navigate: "open-in-browser",
  click: "ads-click",
  type: "keyboard",
  select: "checklist",
  press: "keyboard",
  hover: "touch-app",
  scroll: "swap-vert",
  wait: "hourglass-empty",
  assert: "fact-check",
  screenshot: "photo-camera",
};

// ── Action groups ────────────────────────────────────────────────────────
export const SELECTOR_ACTIONS: readonly StepAction[] = [
  "click",
  "type",
  "select",
  "hover",
  "assert",
];

export const VALUE_ACTIONS: readonly StepAction[] = [
  "navigate",
  "type",
  "select",
  "press",
  "scroll",
  "wait",
  "assert",
];

// ── Action dropdown options ──────────────────────────────────────────────
// Takes t so the labels resolve in the caller's (reactive) locale — call it
// inside a computed.
export const actionOptions = (t: TranslateFn) =>
  (Object.keys(ACTION_LABEL_KEYS) as StepAction[]).map((a) => ({
    label: t(ACTION_LABEL_KEYS[a]),
    value: a,
  }));

// ── Selector type options ────────────────────────────────────────────────
export const SELECTOR_TYPE_OPTIONS: readonly {
  label: I18nText;
  value: SelectorType;
}[] = [
  { label: raw("CSS"), value: "CSS" },
  { label: raw("XPath"), value: "XPath" },
  { label: raw("Text"), value: "Text" },
  { label: raw("TestID"), value: "TestID" },
  { label: raw("Role"), value: "Role" },
];

// ── Value field labels (action-specific) ─────────────────────────────────
export const VALUE_LABEL_KEYS: Record<string, I18nKey> = {
  navigate: "synthetics.journey.valueLabels.navigate",
  type: "synthetics.journey.valueLabels.type",
  select: "synthetics.journey.valueLabels.select",
  press: "synthetics.journey.valueLabels.press",
  scroll: "synthetics.journey.valueLabels.scroll",
  wait: "synthetics.journey.valueLabels.wait",
  assert: "synthetics.journey.valueLabels.assert",
};

// ── Value field widths ───────────────────────────────────────────────────
export const VALUE_WIDTH_MAP: Record<string, string> = {
  wait: "w-50!",
};

// ── Check type picker cards ───────────────────────────────────────────────

export interface CheckTypeCard {
  type: SyntheticCheckType;
  icon: IconName;
  labelKey: I18nKey;
  descKey: I18nKey;
}

export const CHECK_TYPE_CARDS: CheckTypeCard[] = [
  {
    type: "browser",
    icon: "open-in-browser",
    labelKey: "synthetics.newCheck.browser",
    descKey: "synthetics.newCheck.browserDesc",
  },
  {
    type: "http",
    icon: "network-check",
    labelKey: "synthetics.newCheck.http",
    descKey: "synthetics.newCheck.httpDesc",
  },
  {
    type: "tcp",
    icon: "bolt",
    labelKey: "synthetics.newCheck.tcp",
    descKey: "synthetics.newCheck.tcpDesc",
  },
  {
    type: "tls",
    icon: "shield",
    labelKey: "synthetics.newCheck.tls",
    descKey: "synthetics.newCheck.tlsDesc",
  },
  {
    type: "ssh",
    icon: "keyboard",
    labelKey: "synthetics.newCheck.ssh",
    descKey: "synthetics.newCheck.sshDesc",
  },
];

// ── Value field tooltips ─────────────────────────────────────────────────
export const VALUE_TOOLTIP_MAP: Record<string, string> = {
  press: 'Press a keyboard key by its key name, e.g. "Enter", "Tab", "Escape", "ArrowDown".',
  assert: 'Assertion expression, e.g. "text=Hello" or "visible" to check element visibility.',
};
