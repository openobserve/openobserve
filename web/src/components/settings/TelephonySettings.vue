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

      <TelephonyAccountCard
        v-else-if="state === 'deployment' && view"
        :title="t('telephony.deploymentTitle', { provider: PROVIDER })"
        :meta="t('telephony.deploymentMeta', { number: view.deployment_from_number ?? '' })"
        :press4-available="view.press4_available"
        :updatable="false"
        :read-only="readOnly"
        data-test="telephony-settings-deployment"
      >
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
      </TelephonyAccountCard>

      <TelephonyAccountCard
        v-else-if="state === 'connected' && view?.org"
        :title="PROVIDER"
        :meta="
          t('telephony.cardMeta', {
            number: view.org.from_number,
            account: shortSid(view.org.account_sid),
          })
        "
        :press4-available="view.press4_available"
        updatable
        :read-only="readOnly"
        data-test="telephony-settings-connected"
        @update="openDialog('update')"
      >
        <div class="flex flex-wrap justify-end gap-2">
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
        </div>
      </TelephonyAccountCard>
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
      :message-keypath="
        view?.deployment_account_present
          ? 'telephony.disconnectToDeployment'
          : 'telephony.disconnectToEmail'
      "
      :message-name="view?.org ? shortSid(view.org.account_sid) : ''"
      :ok-label="t('telephony.disconnect')"
      ok-variant="destructive"
      @update:ok="disconnect"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useMutation, useQuery } from "@tanstack/vue-query";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { deleteTelephonyMutation, telephonyQuery } from "@/services/oncall.queries";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import TelephonyAccountCard from "./TelephonyAccountCard.vue";
import TelephonyAccountDialog from "./TelephonyAccountDialog.vue";
import type { TelephonyDialogMode } from "./TelephonyAccountDialog.schema";
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
