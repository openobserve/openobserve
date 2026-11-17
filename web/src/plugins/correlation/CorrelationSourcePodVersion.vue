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

<template>
  <span class="flex items-center gap-1" data-test="svcver-source-pod-version"
    ><ODimensionChip
      dim-key="k8s-pod"
      :key-label="dimensionLabel('k8s-pod', t)"
      :value="pod"
      :value-tooltip="false" /><ServiceScopeChip facet="version" :value="version" /><OTooltip
      :content="t('serviceVersions.correlation.podRunsVersion', { pod, version })"
      side="top"
  /></span>
</template>
<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import ServiceScopeChip from "@/components/shared/ServiceScopeChip.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { dimensionLabel } from "@/utils/dimensionLabels";

defineProps<{ pod: string; version: string }>();
const { t } = useI18nTyped();
</script>
