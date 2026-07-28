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
  VersionCompareBanner — the "honesty" guardrail banner for version compare.
  Renders one of two mutually-exclusive warnings (or nothing when the compare
  is clean):
    1. small-sample — !enoughSample. Takes precedence over the overlap warning
       when both trip, since a too-small sample makes any read unreliable
       regardless of timing overlap.
    2. overlap — disjoint ("ran at different times") or partial ("partially
       concurrent"). Concurrent overlap renders nothing (the comparison is
       trustworthy on timing).
  Renders empty when enoughSample is true AND overlap is "concurrent".
-->
<template>
  <OBanner v-if="!enoughSample" variant="warning" data-test="version-compare-banner-small-sample">
    {{ t("aiObservability.versionCompare.banner.smallSample", { nA, nB }) }}
  </OBanner>
  <OBanner
    v-else-if="overlap === 'disjoint'"
    variant="warning"
    data-test="version-compare-banner-overlap-disjoint"
  >
    {{ t("aiObservability.versionCompare.banner.disjoint") }}
  </OBanner>
  <OBanner
    v-else-if="overlap === 'partial'"
    variant="warning"
    data-test="version-compare-banner-overlap-partial"
  >
    {{ t("aiObservability.versionCompare.banner.partial") }}
  </OBanner>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import type { OverlapState } from "@/plugins/traces/versionCompare/windows";

defineProps<{
  overlap: OverlapState;
  enoughSample: boolean;
  nA: number;
  nB: number;
  deltaHours: number;
}>();

const { t } = useI18n();
</script>
