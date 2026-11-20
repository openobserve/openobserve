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
  <OInlineNotice
    v-if="status === 'forbidden'"
    tone="warn"
    :message="t(`rum.analytics.events.${subject}Forbidden`)"
    :data-test="`${dataTest}-events-forbidden`"
  />
  <OInlineNotice
    v-else-if="status === 'failed'"
    tone="warn"
    :message="t(`rum.analytics.events.${subject}Unavailable`)"
    :data-test="`${dataTest}-events-unavailable`"
  >
    <template #actions>
      <OButton variant="ghost" :data-test="`${dataTest}-events-retry-btn`" @click="emit('retry')">{{
        t("common.retry")
      }}</OButton>
    </template>
  </OInlineNotice>
</template>

<script setup lang="ts">
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";
import type { NamedEventsStatus } from "@/composables/rum/useNamedEvents";

defineOptions({ name: "NamedEventsNotice" });

withDefaults(
  defineProps<{ status: NamedEventsStatus; dataTest: string; subject?: "steps" | "series" }>(),
  { subject: "steps" },
);
const emit = defineEmits<{ retry: [] }>();
const { t } = useI18nTyped();
</script>
