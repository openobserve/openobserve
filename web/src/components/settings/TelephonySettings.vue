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
  <OPageLayout
    :title="t('telephony.title')"
    :subtitle="t('telephony.subtitle')"
    icon="call"
    title-data-test="telephony-settings-title"
    scroll
  >
    <div class="flex flex-col gap-4 py-3">
      <OBanner
        v-if="readOnly && state !== 'forbidden'"
        variant="info"
        data-test="telephony-settings-read-only"
      >
        {{ t("telephony.readOnly") }}
      </OBanner>

      <div v-if="state === 'loading'" class="flex justify-center py-10">
        <OSpinner size="md" data-test="telephony-settings-loading" />
      </div>

      <OText v-else-if="state === 'forbidden'" data-test="telephony-settings-forbidden">
        {{ t("telephony.readOnly") }}
      </OText>

      <OBanner v-else-if="state === 'failed'" variant="error" data-test="telephony-settings-failed">
        {{ loadFailedText }}
      </OBanner>

      <div v-else-if="state === 'empty'" data-test="telephony-settings-hero">
        <OEmptyState
          size="hero"
          preset="no-phone-provider"
          :hide-action="readOnly"
          @action="(id) => id === 'connect' && openDialog('connect')"
        />
      </div>

      <OCard
        v-else-if="state === 'deployment' && view"
        class="rounded-surface bg-surface-base max-w-160"
        data-test="telephony-settings-deployment"
      >
        <OCardSection role="header">
          <span class="flex flex-wrap items-center gap-2">
            <OText variant="card-title">
              {{ t("telephony.deploymentTitle", { provider: PROVIDER }) }}
            </OText>
            <OTag variant="success-soft" size="sm">{{ t("telephony.active") }}</OTag>
          </span>
        </OCardSection>
        <OCardSection role="body" class="flex flex-col gap-3">
          <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt class="text-text-secondary">{{ t("telephony.fromNumber") }}</dt>
            <dd class="text-text-body">{{ raw(view.deployment_from_number) }}</dd>
            <TelephonyPress4Row :available="view.press4_available" />
          </dl>
          <span class="flex flex-wrap items-center gap-1">
            <OText variant="meta">{{ t("telephony.deploymentNote") }}</OText>
            <OButton
              variant="ghost-primary"
              size="xs"
              :disabled="readOnly"
              data-test="telephony-settings-use-own"
              @click="openDialog('connect')"
            >
              {{ t("telephony.useOwn", { provider: PROVIDER }) }}
            </OButton>
          </span>
        </OCardSection>
      </OCard>

      <OCard
        v-else-if="state === 'connected' && view?.org"
        class="rounded-surface bg-surface-base max-w-160"
        data-test="telephony-settings-connected"
      >
        <OCardSection role="header">
          <span class="flex flex-1 flex-wrap items-center gap-2">
            <OText variant="card-title">{{ PROVIDER }}</OText>
            <OTag variant="success-soft" size="sm">{{ t("telephony.connected") }}</OTag>
          </span>
          <span class="flex items-center gap-2">
            <OButton
              variant="outline"
              size="sm-action"
              :disabled="readOnly"
              data-test="telephony-settings-update"
              @click="openDialog('update')"
            >
              {{ t("telephony.update") }}
            </OButton>
            <OButton
              variant="outline-destructive"
              size="sm-action"
              :disabled="readOnly"
              data-test="telephony-settings-disconnect"
              @click="confirmingDisconnect = true"
            >
              {{ t("telephony.disconnect") }}
            </OButton>
          </span>
        </OCardSection>
        <OCardSection role="body">
          <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt class="text-text-secondary">{{ t("telephony.account") }}</dt>
            <dd class="text-text-body">{{ raw(shortSid(view.org.account_sid)) }}</dd>
            <dt class="text-text-secondary">{{ t("telephony.fromNumber") }}</dt>
            <dd class="text-text-body">{{ raw(view.org.from_number) }}</dd>
            <TelephonyPress4Row :available="view.press4_available" />
          </dl>
        </OCardSection>
      </OCard>
    </div>

    <TelephonyAccountDialog
      v-if="dialogMode"
      :open="!!dialogMode"
      :mode="dialogMode"
      :account="view?.org ?? null"
      @update:open="(open) => !open && (dialogMode = null)"
      @denied="readOnly = true"
    />

    <ConfirmDialog
      v-model="confirmingDisconnect"
      :title="t('telephony.disconnectTitle', { provider: PROVIDER })"
      :message="
        view?.deployment_account_present
          ? t('telephony.disconnectToDeployment')
          : t('telephony.disconnectToEmail')
      "
      :ok-label="t('telephony.disconnect')"
      @update:ok="disconnect"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useMutation, useQuery } from "@tanstack/vue-query";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { deleteTelephonyMutation, telephonyQuery } from "@/services/oncall.queries";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import TelephonyAccountDialog from "./TelephonyAccountDialog.vue";
import type { TelephonyDialogMode } from "./TelephonyAccountDialog.schema";
import TelephonyPress4Row from "./TelephonyPress4Row.vue";
import {
  PROVIDER,
  isForbidden,
  shortSid,
  telephonyPageState,
  telephonyRefusalOf,
  telephonyRefusalText,
} from "./telephony";

const { t } = useI18nTyped();
const store = useStore();
const orgId = computed<string>(() => store.state.selectedOrganization.identifier);

const read = useQuery(() => telephonyQuery(orgId.value));
const view = computed(() => read.data.value ?? null);
const state = computed(() => telephonyPageState(view.value, read.error.value));
const remove = useMutation(() => deleteTelephonyMutation(orgId.value));

// Page-local: a Settings write denial says nothing about on-call configuration, which `useOnCallPermissions` latches.
const readOnly = ref(false);
const dialogMode = ref<TelephonyDialogMode | null>(null);
const confirmingDisconnect = ref(false);

watch(orgId, () => {
  readOnly.value = false;
});

const loadFailedText = computed<I18nText>(() => {
  const body = telephonyRefusalOf(read.error.value);
  return body ? telephonyRefusalText(t, body.reason) : t("telephony.loadFailed");
});

function openDialog(mode: TelephonyDialogMode) {
  dialogMode.value = mode;
}

async function disconnect() {
  try {
    await remove.mutateAsync();
  } catch (err) {
    if (isForbidden(err)) {
      readOnly.value = true;
      return;
    }
    const message = (err as { response?: { data?: { message?: string } } })?.response?.data
      ?.message;
    toast({ variant: "error", message: raw(message) || t("telephony.disconnectFailed") });
  }
}
</script>
