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
        :loading="removing"
        data-test="sample-data-cleanup-remove"
        @click="confirmRemove = true"
      >
        {{ t("sampleData.homeBanner.cleanup.remove") }}
      </OButton>
    </template>
  </OBanner>

  <OBanner v-else-if="mode === 'explore'" dense inline-actions data-test="sample-data-home-banner">
    <template #icon>
      <OIcon name="science" size="sm" class="text-ingest-accent-purple" />
    </template>
    {{ t("sampleData.homeBanner.message") }}
    <template #actions>
      <OButton
        variant="ghost"
        size="sm-action"
        data-test="sample-data-home-banner-manage"
        @click="manage"
      >
        {{ t("sampleData.homeBanner.manage") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        icon-left="flag"
        data-test="sample-data-home-banner-tour"
        @click="startTour"
      >
        {{ t("sampleData.welcome.ready.startTour") }}
      </OButton>
      <OButton
        variant="ghost"
        size="icon-sm"
        :aria-label="t('common.close')"
        data-test="sample-data-home-banner-dismiss"
        @click="session.dismissBanner(org)"
      >
        <OIcon name="close" size="sm" />
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
import { useRouter } from "vue-router";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useSampleDataSession } from "@/composables/sampleData/useSampleDataSession";
import { useSampleDataPresence } from "@/composables/sampleData/useSampleDataPresence";
import { SAMPLE_TOUR_STEPS, resolveTourTarget } from "@/utils/sampleData/tour";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const session = useSampleDataSession();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const presence = useSampleDataPresence(org);
const removing = ref(false);
const confirmRemove = ref(false);

const mode = computed<"cleanup" | "explore" | null>(() => {
  if (!presence.hasSample.value || session.welcomeOpen.value) return null;
  if (presence.hasRealData.value) return session.cleanupDismissed(org.value) ? null : "cleanup";
  if (session.tour.value?.org === org.value) return null;
  if (session.tourDone(org.value) || session.bannerDismissed(org.value)) return null;
  return "explore";
});

const startTour = () => {
  session.startTour(org.value);
  resolveTourTarget(org.value, SAMPLE_TOUR_STEPS[0].id)
    .then((to) => router.push(to))
    .catch(() => {});
};

const manage = () =>
  router.push({ name: "sampleData", query: { org_identifier: org.value } }).catch(() => {});

const removeAll = async () => {
  confirmRemove.value = false;
  removing.value = true;
  try {
    await session.remove(org.value);
    toast({ variant: "success", message: t("sampleData.toast.removed") });
  } catch (e: any) {
    toast({
      variant: "error",
      message: raw(e?.response?.data?.message) || t("sampleData.toast.removeFailed"),
    });
  } finally {
    removing.value = false;
  }
};
</script>
