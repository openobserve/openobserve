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
  <ODialog
    :open="open"
    size="md"
    :title="token ? t('fleet.enrollment.revokeTitle', { name: raw(token.name) }) : undefined"
    :primary-button-label="t('fleet.enrollment.revoke')"
    primary-button-variant="destructive"
    :primary-button-disabled="!token || typed !== token.name"
    :primary-button-loading="loading"
    :secondary-button-label="t('common.cancel')"
    initial-focus="secondary"
    data-test="fleet-revoke-token-dialog"
    @update:open="(v: boolean) => emit('update:open', v)"
    @click:secondary="emit('update:open', false)"
    @click:primary="token && typed === token.name && emit('confirm', token)"
  >
    <div v-if="token" class="flex flex-col gap-4">
      <OText variant="body">{{ t("fleet.enrollment.revokeMessage") }}</OText>
      <div class="flex flex-col gap-2" data-test="fleet-revoke-token-dialog-affected">
        <OText variant="label">{{
          t("fleet.enrollment.revokeAffected", { count: affected.length }, affected.length)
        }}</OText>
        <ul
          v-if="affected.length"
          class="rounded-default border-border-default flex max-h-48 flex-col overflow-y-auto border"
        >
          <li
            v-for="c in affected"
            :key="c.id"
            class="border-border-default flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0"
          >
            <OTag type="serviceStatus" :value="c.status" size="xs" />
            <OTruncatedText class="flex-1">{{ c.name }}</OTruncatedText>
            <OText variant="meta">{{ c.fleetName }}</OText>
          </li>
        </ul>
      </div>
      <OInput
        v-model="typed"
        size="sm"
        autocomplete="off"
        :label="t('confirmDialog.typeToConfirm', { text: raw(token.name) })"
        :placeholder="raw(token.name)"
        data-test="fleet-revoke-token-dialog-type"
      />
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { CollectorRow, TokenRow } from "./useFleetApi";

const props = defineProps<{
  open: boolean;
  token: TokenRow | null;
  /** Collectors whose last presented token is this one; revoking cuts them off. */
  affected: CollectorRow[];
  loading?: boolean;
}>();
const emit = defineEmits<{ "update:open": [open: boolean]; confirm: [token: TokenRow] }>();

const { t } = useI18nTyped();
const typed = ref("");

watch(
  () => [props.open, props.token?.id],
  () => (typed.value = ""),
);
</script>
