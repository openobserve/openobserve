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

<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { firingAlertsQuery } from "@/services/alerts.queries";
import { joinListMore } from "@/utils/alerts/alertCopy";
import {
  lookAlikeAlerts,
  type LookAlikeAlert,
  type LookAlikeCondition,
} from "@/utils/alerts/lookAlike";
import type { AlreadySetUp } from "@/utils/alerts/librarySuggest.types";

const props = defineProps<{
  streamType?: string;
  streamName?: string;
  queryCondition?: LookAlikeCondition | null;
}>();
const emit = defineEmits<{ (e: "open", alert: AlreadySetUp): void }>();

const { t } = useI18nTyped();
const orgId = useOrgId();

const listQuery = useQuery(() =>
  Object.assign(firingAlertsQuery(orgId.value), {
    enabled: !!orgId.value && !!props.streamName,
  }),
);

const matches = computed(() =>
  lookAlikeAlerts(
    {
      stream_type: props.streamType,
      stream_name: props.streamName,
      condition: props.queryCondition,
    },
    (listQuery.data.value?.list ?? []) as LookAlikeAlert[],
  ),
);

const text = computed(() =>
  t(
    "alerts.lookAlike.line",
    {
      names: joinListMore(
        matches.value.map((m) => m.name ?? ""),
        t,
        1,
      ),
      stream: raw(props.streamName ?? ""),
    },
    matches.value.length,
  ),
);

const open = () => {
  const first = matches.value[0];
  if (first?.alert_id)
    emit("open", { alert_id: first.alert_id, name: first.name ?? "", matched_by: "query" });
};
</script>

<template>
  <p
    v-if="matches.length"
    class="text-text-secondary m-0 flex min-w-0 items-center gap-1.5 text-xs"
    data-test="add-alert-look-alike"
  >
    <OIcon name="content-copy" size="xs" class="shrink-0" />
    <OTruncatedText class="min-w-0">{{ text }}</OTruncatedText>
    <OButton
      variant="link"
      size="xs"
      class="shrink-0"
      data-test="add-alert-look-alike-open"
      @click="open"
      >{{ t("alerts.librarySuggest.open") }}</OButton
    >
  </p>
</template>
