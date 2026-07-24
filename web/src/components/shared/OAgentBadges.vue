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
<!--
  OAgentBadges — the ONE way an agent's environment + version are shown across
  every AI screen. Rendered as ODimensionChip key|value chips (the same
  self-describing, colour-by-key chip the incident list uses for its dimensions),
  so `env` and `version` read clearly even to someone who doesn't know the
  values, and their colour is consistent with dimensions elsewhere in the app.
  Renders nothing when both are absent, so callers can drop it in unconditionally.
-->
<template>
  <span
    v-if="hasAny"
    class="inline-flex items-center gap-1 align-middle"
    :data-test="dataTest"
  >
    <ODimensionChip
      v-if="env"
      dim-key="env"
      :value="env"
      :tooltip="true"
      :data-test="`${dataTest}-env`"
    />
    <ODimensionChip
      v-if="version"
      dim-key="version"
      :value="version"
      :tooltip="true"
      :data-test="`${dataTest}-version`"
    />
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";

const props = withDefaults(
  defineProps<{
    env?: string | null;
    version?: string | null;
    dataTest?: string;
  }>(),
  {
    env: null,
    version: null,
    dataTest: "agent-badges",
  },
);

const hasAny = computed(() => Boolean(props.env) || Boolean(props.version));
</script>
