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

import { provide, type Component, type InjectionKey } from "vue";

/** The app's no-access state for a forbidden table; it receives the table's `forbiddenResource` as `resource`. */
export const TABLE_FORBIDDEN_STATE_KEY: InjectionKey<Component> = Symbol("tableForbiddenState");

/** Renders `component` in place of the generic no-access state in every table below. */
export function provideTableForbiddenState(component: Component): void {
  provide(TABLE_FORBIDDEN_STATE_KEY, component);
}
