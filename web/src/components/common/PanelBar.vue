<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!--
  The title strip at the top of a chart panel — THE one definition of that band.
  Used by dashboard panels (PanelContainer), metrics-explorer cards (MetricCard)
  and the SLO charts (burndown / preview / time-slice).

  This existed as five hand-copied class strings before, and they had already
  drifted: when the header tint (--color-panel-bar-bg) was introduced, the two
  dashboard bars picked it up and the three SLO bars silently did not, because
  nothing connected them. Hence a component rather than a shared constant — a
  copied string has no way to fail loudly when someone forgets one.

  The bottom border is `panel-bar-border`, NOT the app's `border-default`: at
  this fill those two are the same colour in light mode, so a `border-default`
  divider would vanish into the header. The fill and its divider are a pair —
  see the token comment before changing either.

  Box + typography only. The bar owns its height, padding, bottom border, tint
  and title type; consumers own their own children and pass layout through
  `class` (`w-full`, `justify-between`, `gap-*`, `rounded-t-default` …), since
  what sits in the bar differs a lot: a drag handle and a hover-revealed control
  row on dashboards, a metric-type badge on cards, a plain label and a hint on
  SLO panels.

  The title type is set HERE on the bar rather than on an inner element so a bar
  whose only content is a bare label (SloPreviewChart) needs no wrapper. Children
  that are not the title override it themselves — that is why the SLO hint and
  tally carry `font-normal`.
-->
<template>
  <div
    class="border-panel-bar-border bg-panel-bar-bg text-compact text-text-heading flex min-h-7 items-center border-b px-2 py-1 font-medium tracking-[0.02em]"
  >
    <slot />
  </div>
</template>
