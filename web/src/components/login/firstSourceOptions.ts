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
  | "sample"
  | "unsure";

export interface FirstSourceOption {
  id: FirstSourceId;
  labelKey: I18nKey;
  /** Guide route name; absent for sample data, which loads in the welcome dialog, and for "Not sure yet". */
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

/** The Get started choices in the approved order, each with its guide route. */
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
    id: "sample",
    labelKey: "sampleData.entry.onboardingSource",
    icon: "science",
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

/** The option with this id, or undefined for an unknown id. */
export function firstSourceOption(id: string | null | undefined): FirstSourceOption | undefined {
  return FIRST_SOURCE_OPTIONS.find((option) => option.id === id);
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
