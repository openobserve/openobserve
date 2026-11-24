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

<!-- Old runners can't hold leases, so checks with secrets or saved credentials stop on them (V40 N1). -->
<template>
  <OBanner
    v-if="minRunnerVersion && oldAgents.length"
    variant="warning"
    icon="update"
    :content="
      t(
        leaseDeadlineUs === undefined
          ? 'synthetics.secretRunner.notice'
          : 'synthetics.secretRunner.noticeWithDeadline',
        {
          agents: oldAgents.map(label).join(', '),
          version: minRunnerVersion,
          deadline: leaseDeadlineUs === undefined ? '' : formatToDateOnly(leaseDeadlineUs),
        },
        oldAgents.length,
      )
    "
    data-test="synthetics-old-runner-notice"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import type { SyntheticLocationAgent } from "@/types/synthetics";
import { formatToDateOnly } from "@/utils/date";

const props = defineProps<{
  agents: SyntheticLocationAgent[];
  minRunnerVersion?: string;
  leaseDeadlineUs?: number;
}>();
const { t } = useI18nTyped();

// The server sends 0 only for an agent seen resolving credentials without a lease; absent is unknown.
const oldAgents = computed(() => props.agents.filter((a) => a.runner_contract === 0));
const label = (a: SyntheticLocationAgent) => (a.version ? `${a.name} (${a.version})` : a.name);
</script>
