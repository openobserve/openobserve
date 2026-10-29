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

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { I18nKey } from "@/types/i18n";
import type { UserDataStreamType } from "@/utils/internalStreams";

export type FirstSourceId =
  | "kubernetes"
  | "linux"
  | "windows"
  | "webserver"
  | "otel"
  | "http"
  | "cloud"
  | "rum"
  | "llm"
  | "agent"
  | "unsure";

export interface FirstSourceOption {
  id: FirstSourceId;
  labelKey: I18nKey;
  /** Guide route name; absent for "Not sure yet", which keeps today's landing. */
  route?: string;
  /** Image path under assets/images, for getImageURL. */
  logo?: string;
  /** Inverted in dark mode because the logo is dark ink on transparent. */
  logoInvertDark?: boolean;
  /** OIcon glyph for options without a logo. */
  icon?: IconName;
  /** Signals the picked guide sends. */
  signals: UserDataStreamType[];
}

export interface FirstSourcePrefill {
  utm_content?: string;
  referrer?: string;
}

/** The 11 Get started choices in the approved order, each with its guide route. */
export const FIRST_SOURCE_OPTIONS: readonly FirstSourceOption[] = Object.freeze([
  {
    id: "kubernetes",
    labelKey: "login.getStarted.sources.kubernetes",
    route: "ingestFromKubernetes",
    logo: "images/common/kubernetes.svg",
    signals: ["logs", "metrics", "traces"],
  },
  {
    id: "linux",
    labelKey: "login.getStarted.sources.linux",
    route: "ingestFromLinux",
    logo: "images/common/linux.svg",
    signals: ["logs", "metrics"],
  },
  {
    id: "windows",
    labelKey: "login.getStarted.sources.windows",
    route: "ingestFromWindows",
    logo: "images/common/windows.svg",
    signals: ["logs", "metrics"],
  },
  {
    id: "webserver",
    labelKey: "login.getStarted.sources.webserver",
    route: "nginx",
    logo: "images/ingestion/nginx.svg",
    signals: ["logs"],
  },
  {
    id: "otel",
    labelKey: "login.getStarted.sources.otel",
    route: "otelCollector",
    logo: "images/ingestion/otlp.svg",
    signals: ["logs", "metrics", "traces"],
  },
  {
    id: "http",
    labelKey: "login.getStarted.sources.http",
    route: "curl",
    icon: "code",
    signals: ["logs"],
  },
  {
    id: "cloud",
    labelKey: "login.getStarted.sources.cloud",
    route: "AWSConfig",
    logo: "images/ingestion/aws.svg",
    logoInvertDark: true,
    signals: ["logs", "metrics"],
  },
  {
    id: "rum",
    labelKey: "login.getStarted.sources.rum",
    route: "frontendMonitoring",
    icon: "public",
    signals: ["logs"],
  },
  {
    id: "llm",
    labelKey: "login.getStarted.sources.llm",
    route: "ai-integrations",
    logo: "images/common/ai_icon.svg",
    logoInvertDark: true,
    signals: ["traces"],
  },
  {
    id: "agent",
    labelKey: "login.getStarted.sources.agent",
    route: "recommendedMcp",
    icon: "auto-awesome",
    signals: [],
  },
  {
    id: "unsure",
    labelKey: "login.getStarted.sources.unsure",
    icon: "help-outline",
    signals: [],
  },
] as FirstSourceOption[]);

export const FIRST_SOURCE_STORAGE_PREFIX = "o2.onboarding.firstSource.";
export const FIRST_SOURCE_PREFILL_KEY = "o2.onboarding.prefill";

// Docs path segments that name a guide; the deepest matching segment wins.
const DOCS_SEGMENT_SOURCES: Record<string, FirstSourceId> = {
  kubernetes: "kubernetes",
  k8s: "kubernetes",
  linux: "linux",
  windows: "windows",
  nginx: "webserver",
  apache: "webserver",
  iis: "webserver",
  opentelemetry: "otel",
  otel: "otel",
  otlp: "otel",
  curl: "http",
  aws: "cloud",
  azure: "cloud",
  gcp: "cloud",
  rum: "rum",
  llm: "llm",
  genai: "llm",
  mcp: "agent",
};

/** The option with this id, or undefined for an unknown id. */
export function firstSourceOption(id: string | null | undefined): FirstSourceOption | undefined {
  return FIRST_SOURCE_OPTIONS.find((option) => option.id === id);
}

/** Maps an openobserve.ai docs URL to the option its guide belongs to. */
export function docsReferrerSource(referrer: string | null | undefined): FirstSourceId | undefined {
  if (!referrer) return undefined;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "openobserve.ai" && !host.endsWith(".openobserve.ai")) return undefined;
  const path = url.pathname.toLowerCase();
  if (!path.startsWith("/docs")) return undefined;
  const segments = path
    .split(/[/_.-]+/)
    .filter(Boolean)
    .reverse();
  for (const segment of segments) {
    const id = DOCS_SEGMENT_SOURCES[segment];
    if (id) return id;
  }
  return undefined;
}

/** The pick to preselect: utm_content when it equals an option id, else a mapped docs referrer. */
export function prefillFirstSource(
  query: FirstSourcePrefill | null | undefined,
  referrer?: string | null,
): FirstSourceId | undefined {
  const utm = typeof query?.utm_content === "string" ? query.utm_content.trim() : "";
  const fromUtm = firstSourceOption(utm)?.id;
  if (fromUtm) return fromUtm;
  return docsReferrerSource(referrer ?? query?.referrer);
}

/** Stores the signup link's utm_content and docs referrer for the Get started dialog, never replacing a stored pair with nothing. */
export function capturePrefill(utmContent: unknown, referrer: string | null | undefined): void {
  const utm = typeof utmContent === "string" ? utmContent : "";
  const docs = docsReferrerSource(referrer) ? (referrer as string) : "";
  if (!utm && !docs) return;
  try {
    const record: FirstSourcePrefill = {};
    if (utm) record.utm_content = utm;
    if (docs) record.referrer = docs;
    window.sessionStorage.setItem(FIRST_SOURCE_PREFILL_KEY, JSON.stringify(record));
  } catch {
    // Storage can be unavailable (private mode); the dialog then opens without a pick.
  }
}

/** The stored prefill pair, or undefined when none was captured. */
export function readPrefill(): FirstSourcePrefill | undefined {
  try {
    const raw = window.sessionStorage.getItem(FIRST_SOURCE_PREFILL_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as FirstSourcePrefill) : undefined;
  } catch {
    return undefined;
  }
}

export function clearPrefill(): void {
  try {
    window.sessionStorage.removeItem(FIRST_SOURCE_PREFILL_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/** The org's stored pick, or undefined when there is none or it is not a known id. */
export function readFirstSource(org: string): FirstSourceId | undefined {
  if (!org) return undefined;
  try {
    return firstSourceOption(window.localStorage.getItem(FIRST_SOURCE_STORAGE_PREFIX + org))?.id;
  } catch {
    return undefined;
  }
}

/** The guide route of the org's stored pick, or undefined when there is none or it has no guide. */
export function firstSourcePickRoute(org: string): string | undefined {
  return firstSourceOption(readFirstSource(org))?.route;
}

export function writeFirstSource(org: string, id: FirstSourceId): void {
  if (!org) return;
  try {
    window.localStorage.setItem(FIRST_SOURCE_STORAGE_PREFIX + org, id);
  } catch {
    // The pick only pins a guide; losing it falls back to today's rail.
  }
}
