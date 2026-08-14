<!--
  Copyright 2026 OpenObserve Inc.

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
  <!-- Agent-count badge shown to the RIGHT of the stream picker, mirroring how
       OAgentBadges shows env/version beside the agent picker — one consistent
       "scope chip" pattern across the AI pages. Kept OUT of the dropdown trigger
       so it never overlaps the (truncated) stream name. -->
  <OBadge variant="default-soft" size="sm" class="shrink-0" :data-test="dataTest">
    {{
      t(count === 1 ? "traces.agentCountBadgeSingular" : "traces.agentCountBadgePlural", { count })
    }}
  </OBadge>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";

defineProps<{
  /** Number of agents discovered in the selected stream. */
  count: number;
  dataTest?: string;
}>();

const { t } = useI18nTyped();
</script>
