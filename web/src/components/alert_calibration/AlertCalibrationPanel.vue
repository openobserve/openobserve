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
  <OCard :data-test="dataTest">
    <div class="flex min-w-0 flex-col gap-3">
      <div class="flex min-w-0 flex-col gap-0.5">
        <OText variant="body-strong" as="h2">{{ title }}</OText>
        <OText v-if="caption" variant="meta" as="p">{{ caption }}</OText>
      </div>
      <slot />
      <OCollapsible :label="t('alertCalibration.dashboard.panelQuery')" icon="code">
        <OCode block copyable>{{ sql }}</OCode>
      </OCollapsible>
    </div>
  </OCard>
</template>

<script setup lang="ts">
import OCard from "@/lib/core/Card/OCard.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

defineProps<{
  title: I18nText;
  caption?: I18nText;
  /** The panel's own query, so it can be reused in Logs or a dashboard. */
  sql: string;
  dataTest?: string;
}>();

const { t } = useI18nTyped();
</script>
