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

// Two shapes for one document. `Wire*` is the JSON exactly as CI publishes it —
// snake_case, plain strings. The un-prefixed types are what the app renders,
// with authored copy branded through `raw()`. Same split the announcement
// banners use, and for the same reason: release copy is authored per release,
// so it can never go through the locale catalogue.

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { I18nText } from "@/types/i18n";

/** Which deployments a highlight is actually usable on. */
export type ReleaseEdition = "oss" | "enterprise" | "cloud";

export interface WireMedia {
  /** Asset path, resolved against the manifest origin. */
  light: string;
  dark: string;
  alt: string;
}

export interface WireHighlight {
  id: string;
  title: string;
  body: string;
  icon: string;
  editions: ReleaseEdition[];
  docs_url?: string;
  media?: WireMedia;
}

export interface WireRelease {
  version: string;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  title: string;
  summary: string;
  url: string;
  highlights: WireHighlight[];
}

export interface WireManifest {
  format_version: number;
  /** Newest published version, for the update check. */
  latest: string;
  releases: WireRelease[];
}

export interface ReleaseMedia {
  light: string;
  dark: string;
  alt: I18nText;
}

export interface ReleaseHighlight {
  id: string;
  title: I18nText;
  body: I18nText;
  /** Narrowed against the approved registry; an unknown name falls back. */
  icon: IconName;
  editions: ReleaseEdition[];
  docsUrl?: string;
  media?: ReleaseMedia;
}

export interface Release {
  version: string;
  date: string;
  title: I18nText;
  summary: I18nText;
  url: string;
  highlights: ReleaseHighlight[];
}

export interface WhatsNewManifest {
  formatVersion: number;
  latest: string;
  releases: Release[];
}

/** One page of the carousel. */
export type WhatsNewSlide =
  | { kind: "cover"; release: Release; span: Release[]; highlightCount: number }
  | { kind: "highlight"; highlight: ReleaseHighlight; version: string }
  | { kind: "outro"; release: Release };
