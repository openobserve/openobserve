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
  "View dependencies" trigger: a small graph icon (added ALONGSIDE a row's
  existing actions — never replacing them) that opens a compact popover anchored
  to it, showing that row's dependency chain (DependencyChainGraph). On-demand and
  subtle — no page, no drawer, no row expansion. Used from the Templates,
  Notification Destinations and Alerts list action columns.
-->
<template>
  <OPopover v-model:open="open" side="bottom" align="end" :side-offset="4" content-class="p-0">
    <template #trigger>
      <OButton
        variant="ghost"
        size="icon-sm"
        :data-test="`view-dependencies-${focus.name}`"
        @click.stop
      >
        <OIcon name="graph-1" size="sm" />
        <OTooltip side="top" :content="t('alert_dependencies.viewDependencies')" />
      </OButton>
    </template>

    <div class="h-[26rem] w-100 max-w-[92vw]" data-test="view-dependencies-popover">
      <DependencyChainGraph
        v-if="open"
        :focus="focus"
        @deleted="emit('deleted')"
        @close="open = false"
      />
    </div>
  </OPopover>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import DependencyChainGraph from "./DependencyChainGraph.vue";
import type { DepFocus } from "@/composables/alerts/useDependencyGraph";

defineProps<{ focus: DepFocus }>();
const emit = defineEmits<{ (e: "deleted"): void }>();

const { t } = useI18nTyped();
const open = ref(false);
</script>
