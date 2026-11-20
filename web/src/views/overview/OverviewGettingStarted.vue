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
  <section class="flex flex-col gap-2" data-test="overview-getting-started">
    <div class="flex min-h-8 items-center">
      <OText variant="card-title" as="h2">{{ t("common.getStarted") }}</OText>
    </div>
    <p class="text-text-secondary text-compact">{{ text }}</p>
    <div class="flex flex-wrap items-center gap-2 pt-1">
      <OButton
        variant="primary"
        :to="{ name: 'ingestion', query: { org_identifier: org } }"
        data-test="overview-getting-started-add-data"
      >
        {{ t("overview.start.addData") }}
      </OButton>
      <OButton v-if="!logsLocked" :to="logsRoute" data-test="overview-getting-started-explore-logs">
        {{ t("overview.emptyActionLogs") }}
      </OButton>
      <OButton
        v-if="!alertsLocked"
        :to="{ name: 'addAlert', query: { org_identifier: org } }"
        data-test="overview-getting-started-create-alert"
      >
        {{ t("overview.start.createAlert") }}
      </OButton>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped } from "@/types/i18n";
import { rangeRoute, recordRange } from "@/composables/firstEvent/confirmQuery";
import type { FreshnessRow } from "./overviewFreshness";

const props = defineProps<{
  rows: FreshnessRow[];
  logsLocked?: boolean;
  alertsLocked?: boolean;
}>();

const { t } = useI18nTyped();
const store = useStore();

const org = computed(() => store.state.selectedOrganization?.identifier ?? "");

const text = computed(() => t("overview.start.text"));

// Explore logs lands on the newest log records, so a quiet org opens on data instead of an empty range
const logsRoute = computed(() => {
  const logs = props.rows.find((r) => r.type === "logs");
  if (!logs?.stream) return { name: "logs", query: { org_identifier: org.value } };
  const window = logs.lastSeenUs ? recordRange(logs.lastSeenUs) : undefined;
  return rangeRoute(org.value, "logs", logs.stream, window);
});
</script>
