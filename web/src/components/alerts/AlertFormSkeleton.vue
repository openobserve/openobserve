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

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { ALERT_SECTIONS } from "./alertFormSections";

defineProps<{
  /** The wait has passed the loader delay, so the static bars show; the outline paints at once. */
  bars: boolean;
}>();

const emit = defineEmits<{ cancel: [] }>();

const { t } = useI18nTyped();
const ROWS = 4;
</script>

<!-- The edit form's outline while its alert loads: same columns, an open step 2, nothing that reads as a saved value. -->
<template>
  <OPageLayout
    bleed
    :class="bars ? '' : '[&_[data-skeleton-bar]]:invisible'"
    data-test="add-alert-skeleton"
    aria-busy="true"
  >
    <template #header>
      <OPageHeader
        class="border-border-default shrink-0 border-b"
        :back="{ label: t('alerts.header'), onClick: () => emit('cancel') }"
      >
        <template #title>
          <OSkeleton data-skeleton-bar animation="none" class="h-5 w-48" aria-hidden="true" />
        </template>
        <template #subtitle>
          <OSkeleton data-skeleton-bar animation="none" class="mt-1 h-3 w-32" aria-hidden="true" />
        </template>
      </OPageHeader>
    </template>

    <span class="sr-only" role="status">{{ t("components.skeleton.loading") }}</span>
    <div class="flex min-h-0 flex-1 max-lg:flex-col" aria-hidden="true">
      <aside
        class="border-border-default flex w-53 shrink-0 flex-col gap-3 border-e px-2 py-3 max-lg:w-auto max-lg:flex-row max-lg:border-e-0 max-lg:border-b max-lg:px-3 max-lg:py-2"
      >
        <OSkeleton data-skeleton-bar animation="none" class="h-8.5 max-lg:hidden" />
        <div
          v-for="section in ALERT_SECTIONS"
          :key="section.id"
          class="flex items-start gap-3 px-2 py-2.5 max-lg:p-0"
        >
          <OSkeleton data-skeleton-bar type="circle" animation="none" class="w-6 shrink-0" />
          <div class="flex flex-1 flex-col gap-1.5 max-lg:hidden">
            <OSkeleton data-skeleton-bar animation="none" class="h-3.5 w-28" />
            <OSkeleton data-skeleton-bar animation="none" class="h-3 w-20" />
          </div>
        </div>
      </aside>

      <div class="flex min-w-0 shrink grow basis-5xl flex-col max-lg:flex-none lg:max-w-5xl">
        <div class="border-border-default flex min-h-8.25 justify-end border-b px-4 py-2">
          <OSkeleton data-skeleton-bar animation="none" class="h-4 w-36" />
        </div>
        <section class="flex flex-col px-4 py-2 max-lg:px-3">
          <OSkeleton data-skeleton-bar animation="none" class="mx-1 mb-3 h-4 w-72 max-w-full" />
          <div
            class="bg-surface-overlay border-border-default rounded-surface flex flex-col border"
          >
            <div
              class="bg-surface-subtle border-border-default rounded-t-surface flex flex-col gap-1.5 border-b px-4 py-2.5"
            >
              <OSkeleton data-skeleton-bar animation="none" class="h-3 w-20" />
              <OSkeleton data-skeleton-bar animation="none" class="h-3.5 w-56" />
              <OSkeleton data-skeleton-bar animation="none" class="h-3 w-96 max-w-full" />
            </div>
            <div
              v-for="row in ROWS"
              :key="row"
              class="border-border-default flex gap-6 px-4 py-3 not-first:border-t max-md:flex-col max-md:gap-2"
            >
              <div class="flex w-[22.5%] shrink-0 flex-col gap-1.5 pt-2 max-md:w-full">
                <OSkeleton data-skeleton-bar animation="none" class="h-3.5 w-28" />
                <OSkeleton data-skeleton-bar animation="none" class="h-3 w-36 max-w-full" />
              </div>
              <OSkeleton data-skeleton-bar animation="none" class="h-8.5 max-w-120 flex-1" />
            </div>
          </div>
        </section>
      </div>

      <aside
        class="border-border-default flex w-83 shrink-0 flex-col border-s p-3 max-lg:hidden lg:grow"
      >
        <div class="border-border-default rounded-surface flex flex-col overflow-hidden border">
          <div class="border-border-default border-b px-3 py-2.5">
            <OSkeleton data-skeleton-bar animation="none" class="h-3.5 w-16" />
          </div>
          <div class="h-60 p-3">
            <OSkeleton data-skeleton-bar animation="none" class="h-full" />
          </div>
        </div>
      </aside>
    </div>

    <div
      class="border-border-default flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2.5"
    >
      <OButton
        variant="outline"
        size="sm-action"
        data-test="add-alert-skeleton-cancel"
        @click="emit('cancel')"
        >{{ t("alerts.cancel") }}</OButton
      >
      <OButton
        variant="primary"
        size="sm-action"
        class="min-w-28"
        disabled
        data-test="add-alert-skeleton-save"
        >{{ t("alerts.editMode.saveChanges") }}</OButton
      >
    </div>
  </OPageLayout>
</template>
