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
  <div class="flex min-h-0 flex-1 flex-col p-4" data-test="autoobserve-issue-logs">
    <OEmptyState
      size="block"
      illustration="logs"
      :title="title"
      :description="
        ended ? t('autoobserve.issueLive.logs.descEnded') : t('autoobserve.issueLive.logs.descOpen')
      "
    >
      <template #actions>
        <OButton
          variant="outline"
          icon-left="open-in-new"
          data-test="autoobserve-issue-logs-open"
          @click="router.push(route)"
        >
          {{ insightCtaLabel(t, "openInLogs") }}
        </OButton>
      </template>
    </OEmptyState>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { insightCtaLabel } from "../insight/insightCta";

const props = withDefaults(
  defineProps<{ route: RouteLocationRaw; streams: string[]; ended?: boolean }>(),
  { ended: false },
);

const { t } = useI18nTyped();
const router = useRouter();

const title = computed(() => {
  const [first = "", ...rest] = props.streams;
  return rest.length
    ? t("autoobserve.issueLive.logs.titleMany", { stream: raw(first), count: rest.length })
    : t("autoobserve.issueLive.logs.title", { stream: raw(first) });
});
</script>
