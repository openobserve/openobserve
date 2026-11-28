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
  <div class="flex flex-col gap-3" data-test="secret-usage-tab">
    <OBanner
      v-if="detail.pin_mode === 'any'"
      variant="error"
      icon="public"
      :content="
        t('secrets.usage.anyHostBanner', {
          reason: detail.pin_override_reason ?? t('secrets.none'),
        })
      "
      data-test="secret-usage-any-host"
    />
    <OBanner
      v-if="detail.private_locations === 'on'"
      variant="warning"
      icon="location-on"
      :content="
        t('secrets.usage.privateLocationsBanner', {
          reason: detail.private_locations_reason ?? t('secrets.none'),
        })
      "
      data-test="secret-usage-private-locations"
    />

    <div v-if="usage.isPending.value" class="text-text-secondary text-sm">
      {{ t("common.loading") }}
    </div>
    <OEmptyState
      v-else-if="usage.isError.value"
      preset="load-error"
      size="inline"
      data-test="secret-usage-error"
      @action="usage.refetch()"
    />
    <OEmptyState
      v-else-if="!entries.length"
      size="inline"
      icon="link"
      :title="t('secrets.usage.emptyTitle')"
      :description="t('secrets.usage.emptyDesc')"
      data-test="secret-usage-empty"
    />
    <div
      v-else
      class="border-border-default divide-border-default rounded-surface flex flex-col divide-y border"
    >
      <div
        v-for="(entry, i) in entries"
        :key="i"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
        :data-test="`secret-usage-row-${i}`"
      >
        <span class="flex min-w-0 flex-1 items-center gap-2">
          <OIcon
            :name="CONSUMER_ICONS[entry.path[0]?.consumer_type] ?? 'link'"
            size="sm"
            class="text-text-secondary shrink-0"
          />
          <span class="text-text-body min-w-0 text-sm">
            {{ entry.path.map((hop) => hop.consumer_name).join(" › ") }}
          </span>
          <span
            v-if="entry.path[0]"
            class="text-text-secondary shrink-0 text-xs"
            :data-test="`secret-usage-row-${i}-type`"
            >{{ consumerTypeLabel(t, entry.path[0].consumer_type) }}</span
          >
        </span>
        <span class="text-text-secondary font-mono text-xs">{{ entry.field }}</span>
        <OTag
          size="xs"
          shape="rounded"
          :variant="isHealthy(entry.status) ? 'success-soft' : 'error-soft'"
          icon=""
          :label="isHealthy(entry.status) ? t('secrets.usage.ok') : statusLabel(entry.status)"
          :title="isHealthy(entry.status) ? undefined : raw(entry.status)"
          :data-test="`secret-usage-row-${i}-status`"
        />
        <span
          v-if="entry.token_name && entry.token_name !== detail.name"
          class="text-text-secondary basis-full text-xs"
        >
          {{ t("secrets.usage.spelledAs", { old: entry.token_name, name: detail.name }) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { ConsumerType, SecretDetail } from "@/services/secrets";
import { secretUsageQuery } from "@/services/secrets.queries";
import { secretCodeText } from "./secretErrors";
import { consumerTypeLabel } from "./secretBadges";

const props = defineProps<{ detail: SecretDetail }>();
const { t } = useI18nTyped();
const orgId = useOrgId();

const usage = useQuery(() =>
  Object.assign(secretUsageQuery(orgId.value, props.detail.id), { enabled: !!orgId.value }),
);
const entries = computed(() => usage.data.value ?? []);

const CONSUMER_ICONS: Record<ConsumerType, IconName> = {
  alert_destination: "send",
  pipeline_destination: "alt-route",
  synthetics_check: "radar",
  ai_toolset: "smart-toy",
};

// The usage route reports a live reference as `bound`; older servers said `ok`.
const isHealthy = (status: string) => status === "bound" || status === "ok";

const statusLabel = (status: string): I18nText => secretCodeText(t, status) ?? raw(status);
</script>
