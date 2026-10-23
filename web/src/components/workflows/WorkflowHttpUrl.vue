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
  <div class="flex flex-col gap-1">
    <div class="flex items-center gap-2">
      <OText as="label" class="text-xs font-medium">{{ t("workflow.http.endpointUrl") }}</OText>
      <OTag
        v-if="regionHost"
        variant="primary-soft"
        size="sm"
        :label="t('workflow.http.regionTag', { name: raw(regionHost) })"
        data-test="workflow-http-region"
      />
    </div>
    <div
      data-test="workflow-http-url"
      class="border-border-default bg-surface-subtle rounded-default flex min-w-0 items-center border px-3 py-2"
    >
      <OCode copyable :tooltip="false" class="min-w-0 flex-1 break-all">{{ url }}</OCode>
    </div>
    <OBanner
      v-if="regionHost"
      variant="info"
      dense
      data-test="workflow-http-region-banner"
      :content="t('workflow.http.regionBanner', { field: raw('status_url') })"
    />
  </div>
</template>

<script setup lang="ts">
import { raw, useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";

defineProps<{
  url: string;
  /** Set in super-cluster mode: the host of the region that serves this UI. */
  regionHost: string | null;
}>();

const { t } = useI18nTyped();
</script>
