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
import { getCurrentInstance, onBeforeUnmount } from "vue";
import analytics from "@/services/product_analytics";
import { getUUID } from "@/utils/uuid";

export type IncidentViewAction = "ack" | "resolve" | "comment" | "analyze";

/** How often the age of the shown data is sampled while the page is visible. */
export const DATA_AGE_SAMPLE_MS = 5000;

interface ViewedIncident {
  id: string;
  severity: string;
  /** Microseconds since epoch, as the API returns it. */
  created_at: number;
}

interface IncidentView {
  viewId: string;
  incidentId: string;
  severity: string;
  incidentAgeS: number;
  openedAt: number;
  dataAgeMaxS: number;
  firstAction: IncidentViewAction | null;
  firstActionMs: number | null;
}

/** One `incident_view_summary` per view: the tab going hidden ends it, coming back starts the next. */
export function useIncidentViewSummary() {
  let view: IncidentView | null = null;
  // The incident the drawer shows, kept across a hidden tab so the view can resume.
  let shown: ViewedIncident | null = null;
  let lastFetchAt = 0;
  let sampler: ReturnType<typeof setInterval> | null = null;

  const sampleDataAge = () => {
    if (!view || document.visibilityState !== "visible") return;
    const ageS = Math.round((Date.now() - lastFetchAt) / 1000);
    view.dataAgeMaxS = Math.max(view.dataAgeMaxS, ageS);
  };

  const finish = () => {
    if (!view) return;
    sampleDataAge();
    const now = Date.now();
    analytics.track("incident_view_summary", {
      view_id: view.viewId,
      incident_id: view.incidentId,
      severity: view.severity,
      incident_age_s: view.incidentAgeS,
      view_ms: now - view.openedAt,
      first_action: view.firstAction ?? "none",
      first_action_ms: view.firstActionMs,
      data_age_max_s: view.dataAgeMaxS,
    });
    view = null;
    if (sampler) clearInterval(sampler);
    sampler = null;
  };

  const open = (incident: ViewedIncident) => {
    const now = Date.now();
    view = {
      viewId: getUUID(),
      incidentId: incident.id,
      severity: incident.severity,
      incidentAgeS: Math.max(0, Math.round((now - incident.created_at / 1000) / 1000)),
      openedAt: now,
      dataAgeMaxS: 0,
      firstAction: null,
      firstActionMs: null,
    };
    sampler = setInterval(sampleDataAge, DATA_AGE_SAMPLE_MS);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") finish();
    else if (shown && !view) open(shown);
  };

  // A reload of the same incident only refreshes the data clock; another incident is a new view.
  const start = (incident: ViewedIncident) => {
    lastFetchAt = Date.now();
    if (shown?.id === incident.id && view) return;
    finish();
    if (!shown) document.addEventListener("visibilitychange", onVisibilityChange);
    shown = incident;
    open(incident);
  };

  const recordAction = (action: IncidentViewAction) => {
    if (!view || view.firstAction) return;
    view.firstAction = action;
    view.firstActionMs = Date.now() - view.openedAt;
  };

  // Close or route leave: the drawer no longer shows the incident, so nothing resumes.
  const end = () => {
    finish();
    shown = null;
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };

  if (getCurrentInstance()) onBeforeUnmount(end);

  return { start, recordAction, end };
}
