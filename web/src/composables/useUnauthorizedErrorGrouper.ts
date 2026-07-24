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

import { toast, toastRecords, updateToast } from "@/lib/feedback/Toast/useToast";
import type { ToastDetail } from "@/lib/feedback/Toast/OToast.types";
import { copyToClipboard } from "@/utils/clipboard";

// ── Friendly name overrides ──────────────────────────────────────────────────

const FRIENDLY_NAMES: Record<string, string> = {
  dashboards: "Dashboards",
  alerts: "Alerts",
  streams: "Streams",
  functions: "Functions",
  savedviews: "Saved Views",
  users: "Users",
  roles: "Roles",
  organizations: "Organizations",
  pipelines: "Pipelines",
  destinations: "Destinations",
  templates: "Templates",
  reports: "Reports",
  "llm/models": "LLM Model Pricing",
  "llm/models/built-in": "LLM Model Pricing",
  "llm/models/refresh-built-in": "LLM Model Pricing",
};

// ── URL → {label, urlPath} extraction ───────────────────────────────────────

function extractResourceInfo(rawUrl: string): ToastDetail {
  let label = "Resource";
  let urlPath = rawUrl;

  try {
    const parsed = new URL(rawUrl);
    urlPath = parsed.pathname;

    const segments = parsed.pathname.split("/").filter(Boolean);
    // segments[0] is always "api"
    let idx = 1;

    // Skip optional version prefix (v1, v2, …)
    if (/^v\d+$/.test(segments[idx] ?? "")) idx++;

    const candidate = segments[idx];

    if (candidate?.startsWith("_")) {
      // Special namespace (_meta, etc.) — no org segment
      const remaining = segments.slice(idx + 1);
      if (remaining.length > 0) {
        label = capitalize(remaining[remaining.length - 1]);
      }
    } else if (candidate) {
      // Skip org identifier
      idx++;
      const resourcePath = segments.slice(idx);
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const isId = (s: string) => s.includes("@") || /^\d+$/.test(s) || uuidRe.test(s);
      const resourceNames = resourcePath.filter((s) => !isId(s));

      if (resourceNames.length > 0) {
        const joined = resourceNames.join("/");
        const friendly =
          FRIENDLY_NAMES[joined] ?? FRIENDLY_NAMES[resourceNames[resourceNames.length - 1]];
        label = friendly ?? capitalize(resourceNames[resourceNames.length - 1]);
      }
    }
  } catch {
    // ignore URL parse errors — fall back to defaults
  }

  return { label, url: urlPath };
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildTitle(): string {
  return "Access Required";
}

function buildMessage(): string {
  return "Some sections couldn't load because you don't have the required permissions. Contact your administrator if you believe you should have access.";
}

// ── Module-level singleton state ─────────────────────────────────────────────

let activeToastId: string | null = null;
let accumulatedErrors: ToastDetail[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function onToastDismissed(): void {
  activeToastId = null;
  accumulatedErrors = [];
}

function copyDetails(): void {
  const text = accumulatedErrors.map((e) => `${e.label}: ${e.url}`).join("\n");
  // silent: true — feedback is shown on the button itself via successLabel,
  // not as a separate toast notification.
  copyToClipboard(text, { silent: true });
}

function flushGroupedToast(): void {
  const details = [...accumulatedErrors];
  const title = buildTitle();
  const message = buildMessage();

  // If a toast is still visible, update it in-place instead of stacking
  if (activeToastId !== null) {
    const record = toastRecords.find((r) => r.id === activeToastId && r.open);
    if (record) {
      updateToast(activeToastId, { title, message, details, titleCount: details.length });
      return;
    }
    // Toast was dismissed before the debounce fired
    activeToastId = null;
  }

  // Show a fresh grouped notification.
  // No explicit timeout — the default error timeout (30 s) applies.
  toast({
    variant: "error",
    title,
    message,
    titleCount: details.length,
    details,
    action: { label: "Copy details", handler: copyDetails, successLabel: "Copied!" },
    onDismiss: onToastDismissed,
  });

  // Capture the record ID of the toast we just pushed
  activeToastId = toastRecords[toastRecords.length - 1]?.id ?? null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Add a single 403 failure to the grouped notification.
 * Concurrent calls within 300 ms are batched into one toast; subsequent calls
 * update the existing notification if it is still visible.
 */
export function addUnauthorizedError(responseUrl: string): void {
  const detail = extractResourceInfo(responseUrl);

  // Avoid showing the same resource twice in one group
  const alreadyListed = accumulatedErrors.some((e) => e.url === detail.url);
  if (!alreadyListed) {
    accumulatedErrors.push(detail);
  }

  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    flushGroupedToast();
  }, 300);
}

/**
 * Clear the accumulated error list and forget the active toast ID.
 * Call this on navigation so a new page gets a fresh notification.
 */
export function resetUnauthorizedErrors(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  accumulatedErrors = [];
  activeToastId = null;
}
