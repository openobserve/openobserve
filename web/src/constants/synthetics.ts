// Copyright 2026 OpenObserve Inc.

import type { StepAction, SelectorType } from "@/types/synthetics";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

// ── Action labels (capitalized) ──────────────────────────────────────────
export const ACTION_LABELS: Record<StepAction, string> = {
  navigate: "Navigate",
  click: "Click",
  type: "Type",
  select: "Select",
  press: "Press",
  hover: "Hover",
  scroll: "Scroll",
  wait: "Wait",
  assert: "Assert",
  screenshot: "Screenshot",
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
export const actionOptions = (Object.keys(ACTION_LABELS) as StepAction[]).map(
  (a) => ({
    label: ACTION_LABELS[a],
    value: a,
  }),
);

// ── Selector type options ────────────────────────────────────────────────
export const SELECTOR_TYPE_OPTIONS: readonly {
  label: string;
  value: SelectorType;
}[] = [
  { label: "CSS", value: "CSS" },
  { label: "XPath", value: "XPath" },
  { label: "Text", value: "Text" },
  { label: "TestID", value: "TestID" },
  { label: "Role", value: "Role" },
];

// ── Value field labels (action-specific) ─────────────────────────────────
export const VALUE_LABELS: Record<string, string> = {
  navigate: "URL",
  type: "Text to type",
  select: "Option",
  press: "Key",
  scroll: "To (px or selector)",
  wait: "Duration (ms)",
  assert: "Expected",
};

// ── Value field widths ───────────────────────────────────────────────────
export const VALUE_WIDTH_MAP: Record<string, string> = {
  wait: "w-50!",
};

// ── Value field tooltips ─────────────────────────────────────────────────
export const VALUE_TOOLTIP_MAP: Record<string, string> = {
  press:
    'Press a keyboard key by its key name, e.g. "Enter", "Tab", "Escape", "ArrowDown".',
  assert:
    'Assertion expression, e.g. "text=Hello" or "visible" to check element visibility.',
};
