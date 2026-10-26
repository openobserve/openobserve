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

import type { InjectionKey } from "vue";
import type { FirstEventResult, FirstEventState } from "./useFirstEventWatch";

/** What every first-event status under a host page tells it; the host mirrors the page's own check. */
export interface FirstEventReporter {
  /** Called when a status mounts; the returned function when it unmounts. */
  attach: () => () => void;
  state: (state: FirstEventState) => void;
  detected: (result: FirstEventResult) => void;
}

/** Provided by onboarding around a guide page it shows in place. */
export const FIRST_EVENT_REPORTER: InjectionKey<FirstEventReporter> = Symbol("firstEventReporter");
