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
    class="flex min-w-0 gap-1"
    :class="row.cluster ? 'flex-col items-start' : 'items-center'"
    :data-test="`query-profile-node-${row.id}`"
  >
    <OTruncatedText
      class="max-w-full"
      :class="row.active ? 'text-accent font-semibold' : 'text-text-body'"
      >{{ row.name }}</OTruncatedText
    >
    <div
      class="flex max-w-full min-w-0 flex-wrap items-center gap-1"
      :class="row.cluster ? '' : 'contents'"
    >
      <OTruncatedText
        v-if="row.cluster"
        class="text-text-secondary text-2xs"
        :data-test="`query-profile-node-cluster-${row.id}`"
        >{{ clusterText }}</OTruncatedText
      >
      <OBadge v-else-if="roleText" size="xs" shape="rounded" variant="default-soft">{{
        roleText
      }}</OBadge>
      <OBadge v-if="row.straggler" size="xs" shape="rounded" variant="error-soft">{{
        t("search.queryProfile.straggler")
      }}</OBadge>
      <OBadge v-if="row.skipped" size="xs" shape="rounded" variant="default-outline">{{
        t("search.queryProfile.skipped")
      }}</OBadge>
      <OBadge v-if="row.error" size="xs" shape="rounded" variant="error-outline">
        {{ t("search.queryProfile.error") }}
        <OTooltip :content="raw(row.error)" />
      </OBadge>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { NodeNameRow } from "./profileStyles";
import { roleLabel } from "./profileText";

const props = defineProps<{ row: NodeNameRow }>();

const { t } = useI18nTyped();

const roleText = computed(() => roleLabel(t, props.row.role));

const clusterText = computed(() =>
  roleText.value
    ? t("search.queryProfile.nodeOnCluster", { cluster: props.row.cluster, role: roleText.value })
    : raw(props.row.cluster),
);
</script>
