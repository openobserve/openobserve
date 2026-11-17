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

import { computed, inject, provide, type ComputedRef, type InjectionKey } from "vue";

export const SLACK_READ_ONLY: InjectionKey<ComputedRef<boolean>> = Symbol("slackReadOnly");

/** The Slack page decides once whether this reader may change Slack; every section under it reads that. */
export const provideSlackReadOnly = (readOnly: ComputedRef<boolean>): void =>
  provide(SLACK_READ_ONLY, readOnly);

export const useSlackReadOnly = (): ComputedRef<boolean> =>
  inject(
    SLACK_READ_ONLY,
    computed(() => false),
    false,
  );
