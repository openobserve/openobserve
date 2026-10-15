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
  DbmAppSourceMarker — the quiet glyph beside a figure that came from the
  application's traces rather than the database's own statistics. The Traces
  nav glyph, so it reads as "from traces"; DbmAppSourceLegend explains it.
-->
<template>
  <OIcon
    name="account-tree"
    size="xs"
    class="text-text-secondary"
    :label="t('dbm.appSource.marker')"
    :data-test="dataTest"
  >
    <OTooltip :content="t('dbm.appSource.markerHint')" />
  </OIcon>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped } from "@/types/i18n";

withDefaults(
  defineProps<{
    dataTest?: string;
  }>(),
  { dataTest: "dbm-app-source-marker" },
);

const { t } = useI18nTyped();
</script>
