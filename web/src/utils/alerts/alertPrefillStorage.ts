// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Transport for a prefill handed from a source surface to the alert form.
 *
 * sessionStorage rather than the URL, deliberately: a logs query plus a VRL
 * function routinely exceeds the ~2 KB that survives browsers and proxies
 * intact, which the previous `?panelData=<encoded JSON>` scheme was already
 * flirting with. Keeping the payload out of the URL also means a shared link
 * (`?prefill=logs`) is inert — it opens a blank form instead of a corrupted one.
 *
 * Per-tab by nature, so two tabs creating alerts never collide.
 *
 * Lifecycle: written at launch, read on the add-alert route, NOT cleared on
 * read (so F5 on the form still works), cleared on save and on leaving the
 * route.
 */

import {
  ALERT_PREFILL_VERSION,
  type AlertEditHandoff,
  type AlertPrefill,
} from "@/ts/interfaces/alertPrefill";

export const ALERT_PREFILL_KEY = "o2:alertPrefill";

export const writeAlertPrefill = (prefill: AlertPrefill): void => {
  try {
    sessionStorage.setItem(ALERT_PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    // A full or unavailable sessionStorage must not break navigation — the user
    // simply lands on an empty form.
  }
};

/**
 * Returns null for anything we can't trust: absent, unparseable, or written by
 * a different contract version. Never throws — a stale blob degrades to a blank
 * form, it does not break the page.
 */
export const readAlertPrefill = (): AlertPrefill | null => {
  try {
    const raw = sessionStorage.getItem(ALERT_PREFILL_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== ALERT_PREFILL_VERSION) return null;
    // An edit handoff shares the key, and must never seed a new alert.
    if ("target" in parsed) return null;

    return parsed as AlertPrefill;
  } catch {
    return null;
  }
};

export const clearAlertPrefill = (): void => {
  try {
    sessionStorage.removeItem(ALERT_PREFILL_KEY);
  } catch {
    // Nothing to do — a leftover key is ignored on the next read anyway.
  }
};

export const writeAlertEditHandoff = (handoff: AlertEditHandoff): void => {
  try {
    sessionStorage.setItem(ALERT_PREFILL_KEY, JSON.stringify(handoff));
  } catch {
    // A full or unavailable sessionStorage opens the editor with nothing suggested.
  }
};

/** Reads a calibration handoff once and clears it, so a reload or a second visit never applies it again. */
export const takeAlertEditHandoff = (alertId: string): AlertEditHandoff | null => {
  try {
    const raw = sessionStorage.getItem(ALERT_PREFILL_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("target" in parsed)) return null;
    sessionStorage.removeItem(ALERT_PREFILL_KEY);
    const handoff = parsed as AlertEditHandoff;
    if (handoff.version !== ALERT_PREFILL_VERSION) return null;
    return handoff.target?.alertId === alertId ? handoff : null;
  } catch {
    return null;
  }
};
