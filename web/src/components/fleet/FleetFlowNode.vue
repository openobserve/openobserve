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
  <div
    class="flex w-36 cursor-pointer flex-col items-center gap-1.5"
    :data-test="`fleet-flow-node-${id}`"
  >
    <OTag
      v-if="data.badge"
      variant="default-soft"
      size="xs"
      :label="data.badge"
      class="max-w-full"
    />
    <div
      class="rounded-surface relative grid place-items-center border transition-colors"
      :class="[
        data.compact ? 'h-12 w-12' : 'h-16 w-16',
        data.add
          ? 'border-border-strong text-text-secondary bg-surface-base border-dashed'
          : data.selected
            ? 'border-accent bg-surface-base text-accent ring-accent/30 ring-2'
            : data.ring && data.ring !== 'healthy' && data.ring !== 'restricted'
              ? ['bg-surface-base text-text-heading', SEVERITY_RING[data.ring]]
              : 'border-border-default bg-surface-base text-text-heading hover:border-border-strong',
      ]"
      :data-test="`fleet-flow-node-${id}-box`"
    >
      <OIcon :name="data.icon" :size="data.compact ? 'sm' : 'md'" />
      <span
        v-if="data.issueSeverity && data.issueSeverity !== 'healthy'"
        class="ring-surface-base text-2xs text-text-inverse absolute -end-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 font-semibold ring-2"
        :class="SEVERITY_DOT[data.issueSeverity]"
        :data-test="`fleet-flow-node-${id}-issues`"
        ><template v-if="(data.issueCount ?? 0) > 1">{{ data.issueCount }}</template></span
      >
      <OTag
        v-if="data.count !== undefined"
        variant="primary"
        size="xs"
        :label="raw(String(data.count))"
        class="absolute -end-2 -top-2"
      />
      <Handle
        v-if="data.inbound"
        type="target"
        :position="Position.Left"
        :connectable="false"
        class="opacity-0"
      />
      <Handle
        v-if="data.outbound"
        type="source"
        :position="Position.Right"
        :connectable="false"
        class="opacity-0"
      />
    </div>
    <div class="flex max-w-full flex-col items-center">
      <span
        class="max-w-full truncate text-xs font-medium"
        :class="data.selected ? 'text-accent' : 'text-text-heading'"
        >{{ data.label }}<OTooltip :content="data.label"
      /></span>
      <span v-if="data.sublabel" class="text-text-secondary text-2xs max-w-full truncate">{{
        data.sublabel
      }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw } from "@/types/i18n";
import type { FleetFlowNodeData } from "./flowTypes";
import { SEVERITY_DOT, SEVERITY_RING } from "./flowIssues";

defineProps<{ id: string; data: FleetFlowNodeData }>();
</script>
