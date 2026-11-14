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

import { defineComponent, h, type PropType } from "vue";
import { TooltipProvider, injectTooltipProviderContext } from "reka-ui";

type SharedTooltipProvider = NonNullable<ReturnType<typeof injectTooltipProviderContext>>;

const openTooltips = new WeakMap<SharedTooltipProvider, number>();
const linkedTo = new WeakMap<SharedTooltipProvider, SharedTooltipProvider | null>();

const sharedProp = {
  shared: { type: Object as PropType<SharedTooltipProvider | null>, default: null },
};

const ProviderLink = defineComponent({
  name: "TooltipProviderLink",
  props: sharedProp,
  setup(props, { slots }) {
    const own = injectTooltipProviderContext();
    const shared = props.shared;
    linkedTo.set(own, shared);
    // Pointer transit stays per tooltip, as without the shared provider, so one bubble's grace area never swallows another trigger's first hover.
    if (shared) own.isOpenDelayed = shared.isOpenDelayed;
    return () => slots.default?.();
  },
});

/** A tooltip's own provider whose skip-delay flag is the shared one's, so only the skip window is shared. */
export const LinkedTooltipProvider = defineComponent({
  name: "LinkedTooltipProvider",
  props: sharedProp,
  setup(props, { slots }) {
    return () =>
      h(TooltipProvider, null, {
        default: () => h(ProviderLink, { shared: props.shared }, slots),
      });
  },
});

/** The app-level provider a tooltip shares its skip window with, seen through any tooltip it is nested in. */
export function sharedTooltipProvider(
  injected: SharedTooltipProvider | null,
): SharedTooltipProvider | null {
  if (!injected) return null;
  return linkedTo.has(injected) ? (linkedTo.get(injected) ?? null) : injected;
}

/** Counts one tooltip opening (+1) or closing (-1) under the shared provider; the skip window starts once none stays open. */
export function countOpenTooltip(provider: SharedTooltipProvider, change: 1 | -1): void {
  const before = openTooltips.get(provider) ?? 0;
  const open = Math.max(0, before + change);
  openTooltips.set(provider, open);
  if (change > 0) provider.onOpen();
  else if (before > 0 && open === 0) provider.onClose();
}
