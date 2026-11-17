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

import { gt } from "@/types/i18n";
import type { SyntheticsLocation } from "@/types/synthetics";
import {
  isAutoObserveBuild,
  type NotifyPick,
  type TeamPick,
} from "@/utils/alerts/prefill/fromAutoObserve";

export const SYNTHETIC_PREFILL_KEY = "o2:syntheticPrefill";

export const SYNTHETIC_PREFILL_VERSION = 1;

/** m6/m7 draw three public regions for a service reachable from the internet. */
export const PUBLIC_REGIONS = 3;

/** The ao-probe-match §11 contract the create page reads and R1's tag link matches on. */
export interface SyntheticPrefill {
  version: typeof SYNTHETIC_PREFILL_VERSION;
  source: "autoobserve";
  sourceLabel: string;
  name: string;
  folder: string;
  type: "http";
  url: string;
  method: "GET";
  locations: string[];
  destinations: string[];
  intervalMinutes: 5;
  tags: string[];
  /** Only the fields AutoObserve inferred, which the form marks Suggested (FINDINGS F67). */
  suggested: (keyof SyntheticPrefill)[];
  service: { name: string; cluster: string | null; namespace: string | null };
}

/** Facts behind the form's field notes; each is optional so a missing one drops its clause, never the field. */
export interface SyntheticPrefillEvidence {
  /** From the URL alone: an internal host is private, any other host public; absent without a URL. */
  reach?: "private" | "public";
  urlFrom?: "traces" | "logs";
  folderAlerts?: number;
  destinationAlerts?: number;
}

export type SyntheticPrefillInput = SyntheticPrefill & { evidence?: SyntheticPrefillEvidence };

export interface SyntheticService {
  name: string;
  cluster: string | null;
  namespace: string | null;
}

export type SyntheticPrefillService = SyntheticService;

export interface SyntheticPrefillInputs {
  locations: SyntheticsLocation[];
  address: { url: string; from?: "traces" | "logs" } | null;
  team: TeamPick;
  notify: NotifyPick;
}

const INTERNAL_HOST =
  /(^localhost$)|(\.svc(\.cluster\.local)?$)|(\.cluster\.local$)|(\.internal$)|(\.local$)|(^10\.)|(^192\.168\.)|(^172\.(1[6-9]|2\d|3[01])\.)|(^127\.)/i;

/** A host only the cluster can resolve or reach; a bare name with no dot is one too. */
export const isInternalUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname;
    return !host.includes(".") || INTERNAL_HOST.test(host);
  } catch {
    return false;
  }
};

const ready = (location: SyntheticsLocation): boolean =>
  location.enabled !== false &&
  location.status === "online" &&
  !location.live_status_unknown &&
  (!location.types?.length || location.types.includes("http"));

/** A private location runs in the cluster when its region, label or name says so ("cluster-k agents"). */
const inCluster = (location: SyntheticsLocation, cluster: string): boolean => {
  const target = cluster.toLowerCase();
  const words = [location.region, String(location.label ?? ""), location.id]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return words.some((value) => value === target || value.split(/[\s/]+/).includes(target));
};

const pickLocations = (
  service: SyntheticService,
  inputs: SyntheticPrefillInputs,
  url: string,
): string[] => {
  const usable = (inputs.locations ?? []).filter(ready);
  const cluster = service.cluster;
  const own = cluster
    ? usable.find((l) => l.kind === "private" && inCluster(l, cluster))
    : undefined;
  if (own) return [own.id];
  if (url && isInternalUrl(url)) return [];
  return usable
    .filter((l) => l.kind !== "private")
    .slice(0, PUBLIC_REGIONS)
    .map((l) => l.id);
};

const evidenceOf = (inputs: SyntheticPrefillInputs, url: string): SyntheticPrefillEvidence => {
  const evidence: SyntheticPrefillEvidence = {};
  if (url) evidence.reach = isInternalUrl(url) ? "private" : "public";
  if (url && inputs.address?.from) evidence.urlFrom = inputs.address.from;
  if (inputs.team.source === "folder" && inputs.team.alertCount)
    evidence.folderAlerts = inputs.team.alertCount;
  if ("alertCount" in inputs.notify && inputs.notify.alertCount)
    evidence.destinationAlerts = inputs.notify.alertCount;
  return evidence;
};

/** The tags R1 links a check to its service by; namespace and cluster whenever discovery has them. */
export const serviceTags = (service: SyntheticService): string[] =>
  [
    `service:${service.name}`,
    service.namespace ? `namespace:${service.namespace}` : "",
    service.cluster ? `cluster:${service.cluster}` : "",
  ].filter(Boolean);

/** A ready private location in the service's cluster, else three public regions; the URL from the address or empty. */
export const syntheticPrefillFor = (
  service: SyntheticService,
  inputs: SyntheticPrefillInputs,
): SyntheticPrefillInput | null => {
  if (!isAutoObserveBuild() || !service?.name) return null;
  const url = inputs.address?.url ?? "";
  const locations = pickLocations(service, inputs, url);
  const destinations = [...inputs.notify.destinations];
  const suggested: (keyof SyntheticPrefill)[] = ["tags"];
  if (inputs.team.source === "folder") suggested.unshift("folder");
  if (url) suggested.push("url");
  if (locations.length) suggested.push("locations");
  if (destinations.length) suggested.push("destinations");
  const evidence = evidenceOf(inputs, url);
  return {
    version: SYNTHETIC_PREFILL_VERSION,
    source: "autoobserve",
    sourceLabel: gt("alerts.prefill.sources.autoobserve.sourceLabel", { service: service.name }),
    name: gt("insight.targets.syntheticName", { service: service.name }),
    folder: inputs.team.folderId,
    type: "http",
    url,
    method: "GET",
    locations,
    destinations,
    intervalMinutes: 5,
    tags: serviceTags(service),
    suggested,
    service: { name: service.name, cluster: service.cluster, namespace: service.namespace },
    ...(Object.keys(evidence).length ? { evidence } : {}),
  };
};

export const writeSyntheticPrefill = (prefill: SyntheticPrefillInput): void => {
  try {
    sessionStorage.setItem(SYNTHETIC_PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    // A full or unavailable sessionStorage opens an empty form, which is still a working form.
  }
};

/** Read once: cleared on read so a reload or a later visit never refills the form; a stale version is ignored. */
export const takeSyntheticPrefill = (): SyntheticPrefillInput | null => {
  try {
    const raw = sessionStorage.getItem(SYNTHETIC_PREFILL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SYNTHETIC_PREFILL_KEY);
    if (!isAutoObserveBuild()) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== SYNTHETIC_PREFILL_VERSION || parsed?.source !== "autoobserve")
      return null;
    return parsed as SyntheticPrefillInput;
  } catch {
    return null;
  }
};

export const clearSyntheticPrefill = (): void => {
  try {
    sessionStorage.removeItem(SYNTHETIC_PREFILL_KEY);
  } catch {
    // A leftover key is cleared by the next read anyway.
  }
};
