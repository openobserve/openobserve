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

import type { InjectionKey, Ref } from "vue";

/** Lets the first page header inside an OPageLayout host the phone sidebar trigger. */
export interface PageLayoutSidebarContext {
  owner: Ref<symbol | null>;
  open: () => void;
}

export const PAGE_LAYOUT_SIDEBAR_KEY: InjectionKey<PageLayoutSidebarContext> =
  Symbol("pageLayoutSidebar");
