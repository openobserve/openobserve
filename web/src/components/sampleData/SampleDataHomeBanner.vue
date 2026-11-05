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
  <OBanner
    v-if="mode === 'cleanup'"
    variant="info"
    dense
    inline-actions
    data-test="sample-data-cleanup-banner"
  >
    {{ t("sampleData.homeBanner.cleanup.message") }}
    <template #actions>
      <OButton
        variant="ghost"
        size="sm-action"
        data-test="sample-data-cleanup-keep"
        @click="session.dismissCleanup(org)"
      >
        {{ t("sampleData.homeBanner.cleanup.keep") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        :loading="session.removing.value"
        data-test="sample-data-cleanup-remove"
        @click="confirmRemove = true"
      >
        {{ t("sampleData.homeBanner.cleanup.remove") }}
      </OButton>
    </template>
  </OBanner>

  <ConfirmDialog
    v-model="confirmRemove"
    :title="t('sampleData.removeConfirm.title')"
    :message="t('sampleData.removeConfirm.message')"
    :ok-label="t('sampleData.remove')"
    ok-variant="destructive"
    data-test="sample-data-cleanup-dialog"
    @update:ok="removeAll"
    @update:cancel="confirmRemove = false"
  />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  SampleLoadRunningError,
  useSampleDataSession,
} from "@/composables/sampleData/useSampleDataSession";
import { useSampleDataPresence } from "@/composables/sampleData/useSampleDataPresence";

const { t } = useI18nTyped();
const store = useStore();
const session = useSampleDataSession();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const presence = useSampleDataPresence(org);
const confirmRemove = ref(false);

const mode = computed<"cleanup" | null>(() => {
  if (!presence.hasSample.value || session.welcomeOpen.value || !presence.hasRealData.value) {
    return null;
  }
  return session.cleanupDismissed(org.value) ? null : "cleanup";
});

const removeAll = async () => {
  confirmRemove.value = false;
  try {
    await session.remove(org.value);
    toast({ variant: "success", message: t("sampleData.toast.removed") });
  } catch (e: any) {
    toast({
      variant: "error",
      message:
        e instanceof SampleLoadRunningError
          ? t("sampleData.toast.removeWhileLoading")
          : raw(e?.response?.data?.message) || t("sampleData.toast.removeFailed"),
    });
  }
};
</script>
