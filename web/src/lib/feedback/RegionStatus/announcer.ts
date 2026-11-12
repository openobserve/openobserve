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

// Text is set after this gap so a region created on first use exists before it changes, and a repeat is read again.
const ANNOUNCE_GAP_MS = 50;

let politeRegion: HTMLElement | null = null;
let alertHost: HTMLElement | null = null;
let politeTimer: ReturnType<typeof setTimeout> | undefined;
// Each announcement gets a token; only the token that owns the region may change it, so equal texts never cross.
let politeOwner = 0;
let lastToken = 0;

function ensureRegion(
  existing: HTMLElement | null,
  dataTest: string,
  polite: boolean,
): HTMLElement {
  if (existing?.isConnected) return existing;
  const el = document.createElement("div");
  el.className = "sr-only";
  el.setAttribute("data-test", dataTest);
  if (polite) {
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
  }
  document.body.appendChild(el);
  return el;
}

/** Speaks `text` through the app's one polite live region; the returned function withdraws it only while it still owns the region. */
export function announcePolite(text: string): () => void {
  const region = (politeRegion = ensureRegion(politeRegion, "region-announcer", true));
  const token = ++lastToken;
  politeOwner = token;
  clearTimeout(politeTimer);
  region.textContent = "";
  politeTimer = setTimeout(() => {
    if (politeOwner === token) region.textContent = text;
  }, ANNOUNCE_GAP_MS);
  return () => {
    if (politeOwner !== token) return;
    clearTimeout(politeTimer);
    region.textContent = "";
    politeOwner = 0;
  };
}

/** Speaks a failure as `role="alert"`; the returned function withdraws it if it is still showing. */
export function announceAlert(text: string): () => void {
  const host = (alertHost = ensureRegion(alertHost, "region-announcer-alert", false));
  const alert = document.createElement("div");
  alert.setAttribute("role", "alert");
  alert.textContent = text;
  host.replaceChildren(alert);
  return () => alert.remove();
}

/** Empties both regions, e.g. when the page that spoke is left. */
export function clearAnnouncements(): void {
  clearTimeout(politeTimer);
  politeOwner = 0;
  if (politeRegion) politeRegion.textContent = "";
  alertHost?.replaceChildren();
}
