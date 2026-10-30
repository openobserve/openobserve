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

import { inject, provide, type InjectionKey } from "vue";

/** Data attributes an overlay's teleported content carries, so a scope's tokens follow it out of its subtree. */
export type OverlayScopeAttrs = Readonly<Record<`data-${string}`, string>>;

const OVERLAY_SCOPE: InjectionKey<OverlayScopeAttrs> = Symbol("overlayScope");

const NONE: OverlayScopeAttrs = Object.freeze({});

/** Every overlay below the caller, nested ones included, renders its content with these attributes. */
export function provideOverlayScope(attrs: OverlayScopeAttrs): void {
  provide(OVERLAY_SCOPE, { ...inject(OVERLAY_SCOPE, NONE), ...attrs });
}

/** The attributes an overlay binds on its portalled content root. */
export function useOverlayScope(): OverlayScopeAttrs {
  return inject(OVERLAY_SCOPE, NONE);
}
