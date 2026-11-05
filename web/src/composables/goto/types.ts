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

import type { ComputedRef, InjectionKey } from "vue";
import type { RouteLocationRaw } from "vue-router";

import type { I18nText } from "@/types/i18n";

/** One Go to result row; `exact` rows are the only ones highlighted on open. */
export interface GoToMatch {
  id: string;
  kind: "page" | "alert_folder" | "alert" | "dashboard_folder" | "dashboard" | "ask" | "more";
  label: I18nText;
  secondary?: I18nText;
  route?: RouteLocationRaw;
  exact: boolean;
}

/** A page the menu shows, so Go to inherits the menu's permission and config filtering. */
export interface GoToPage {
  id: string;
  label: I18nText;
  group?: I18nText;
  route: RouteLocationRaw;
}

/** Provided by MainLayout from the menu it renders; injected by the Overview and the palette. */
export const GO_TO_PAGES: InjectionKey<ComputedRef<GoToPage[]>> = Symbol("goToPages");
