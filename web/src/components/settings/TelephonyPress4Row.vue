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
  <div class="contents" data-test="telephony-settings-press4">
    <dt class="text-text-secondary">{{ t("telephony.press4") }}</dt>
    <dd class="flex flex-wrap items-center gap-2">
      <OTag v-if="available" variant="success-soft" size="sm">
        {{ t("telephony.press4Available") }}
      </OTag>
      <template v-else>
        <OTag variant="default-soft" size="sm">{{ t("telephony.press4NotAvailable") }}</OTag>
        <OText variant="meta">{{ t("telephony.press4NotAvailableHint") }}</OText>
      </template>
    </dd>
  </div>
</template>

<script setup lang="ts">
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped } from "@/types/i18n";

// Read-only: the callback URL that enables press 4 is operator configuration.
defineProps<{ available: boolean }>();

const { t } = useI18nTyped();
</script>
