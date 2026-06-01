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
  ChromeBreadcrumb — renders the global breadcrumb in the top chrome bar
  (Header.vue). It reads crumbs PUBLISHED by the active page (useAppBreadcrumb);
  when a page hasn't published for the current route, it falls back to a single
  crumb from `route.meta.title` — so EVERY page (even ones with no header room,
  like Logs/Traces) shows its heading up here.

  Borderless + sized for the 40px chrome (it reuses OCrumbTrail, which carries no
  wrapper chrome of its own). The page-level breadcrumb bar has been removed now
  that the breadcrumb lives here; row 1 of each page is free for an AppPageHeader
  (title + description + actions).
-->
<template>
  <nav
    v-if="crumbs.length"
    class="o2-chrome-breadcrumb tw:flex tw:items-center tw:gap-0.5 tw:min-w-0 tw:overflow-hidden"
    aria-label="Breadcrumb"
    data-test="chrome-breadcrumb"
  >
    <!-- Leading separator ties the trail to the logo: "OpenObserve › Module › …" -->
    <OIcon
      name="chevron-right"
      size="sm"
      class="tw:text-text-disabled tw:shrink-0"
    />
    <OCrumbTrail :crumbs="crumbs" />
  </nav>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCrumbTrail, { type Crumb } from "@/components/common/OCrumbTrail.vue";
import { useAppBreadcrumbState } from "@/composables/useAppBreadcrumb";

const route = useRoute();
const state = useAppBreadcrumbState();

const humanize = (s: string): string =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const crumbs = computed<Crumb[]>(() => {
  // `route` can be undefined when Header is mounted without a router (unit tests);
  // guard so the chrome bar degrades to empty instead of throwing.
  const name = route?.name;
  const key = String(name ?? route?.path ?? "");
  // Page-published crumbs win, but only while they belong to the live route.
  if (state.crumbs && state.routeKey === key) return state.crumbs;
  // Fallback: the route's own title, so the page still has a heading up top.
  const label =
    (route?.meta?.title as string) || humanize(String(name ?? "")) || "";
  return label ? [{ label, current: true }] : [];
});
</script>
