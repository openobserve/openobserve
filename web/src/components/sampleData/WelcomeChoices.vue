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
  <div class="flex flex-col gap-4" data-test="onboarding-get-started">
    <div class="grid grid-cols-1 gap-3 min-[51.25rem]:grid-cols-2">
      <div
        class="border-border-default bg-surface-base rounded-surface flex flex-col gap-3 border p-4"
        data-test="onboarding-get-started-connect-card"
      >
        <div class="flex items-center gap-2">
          <strong class="text-text-heading text-base">{{
            t("login.getStarted.connect.title")
          }}</strong>
          <OBadge variant="primary-soft" size="sm">{{
            t("ingestion.firstSource.recommended")
          }}</OBadge>
        </div>
        <ul class="m-0 flex flex-1 list-none flex-col gap-1.5 p-0">
          <li
            v-for="point in connectPoints"
            :key="point"
            class="text-text-body flex items-start gap-2 text-sm"
          >
            <OIcon name="check" size="sm" class="text-status-success-text mt-0.5 shrink-0" />
            {{ point }}
          </li>
        </ul>
        <div
          class="grid h-[10.25rem] grid-cols-3 content-between gap-2"
          data-test="onboarding-get-started-chips"
        >
          <OTooltip
            v-for="option in chipOptions"
            :key="option.id"
            :content="option.lockedReason"
            :disabled="!option.lockedReason"
          >
            <span class="flex min-w-0">
              <button
                type="button"
                class="border-border-default bg-surface-base text-text-body hover:border-accent rounded-default flex h-10 w-full min-w-0 cursor-pointer items-center gap-2 border px-2 text-left text-xs font-medium transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                :title="option.lockedReason ? undefined : t(option.labelKey)"
                :disabled="!!option.lockedReason"
                :data-test="`onboarding-get-started-source-${option.id}`"
                @click="emit('pick', option.id)"
              >
                <span
                  class="bg-surface-subtle rounded-default flex size-6 shrink-0 items-center justify-center"
                >
                  <OIcon v-if="option.lockedReason" name="lock" size="xs" class="lock-chip" />
                  <img
                    v-else-if="option.logo"
                    :src="getImageURL(option.logo)"
                    alt=""
                    class="size-4"
                    :class="{ 'dark:invert': option.logoInvertDark }"
                  />
                  <OIcon v-else-if="option.icon" :name="option.icon" size="xs" />
                </span>
                <span class="line-clamp-2 leading-tight">{{
                  t(`login.getStarted.chips.${option.id}`)
                }}</span>
              </button>
            </span>
          </OTooltip>
        </div>
        <OButton
          variant="primary"
          icon-right="arrow-forward"
          size="cta"
          class="w-full"
          data-test="onboarding-get-started-choose-btn"
          @click="emit('browse')"
        >
          {{ t("login.getStarted.connect.cta") }}
        </OButton>
      </div>

      <div
        class="border-border-default bg-surface-base rounded-surface flex flex-col gap-3 border p-4"
        data-test="onboarding-get-started-sample-card"
      >
        <strong class="text-text-heading text-base">{{
          t("login.getStarted.sample.title")
        }}</strong>
        <ul class="m-0 flex flex-1 list-none flex-col gap-1.5 p-0">
          <li
            v-for="point in samplePoints"
            :key="point"
            class="text-text-body flex items-start gap-2 text-sm"
          >
            <OIcon name="check" size="sm" class="text-status-success-text mt-0.5 shrink-0" />
            {{ point }}
          </li>
        </ul>
        <SampleLivePreview class="h-[10.25rem]" data-test="onboarding-get-started-sample-preview" />
        <OButton
          variant="outline"
          size="cta"
          class="w-full"
          :disabled="sampleBusy"
          data-test="onboarding-get-started-sample-btn"
          @click="emit('sample')"
        >
          {{ t("login.getStarted.sample.cta") }}
        </OButton>
      </div>
    </div>

    <div class="mt-auto flex items-center justify-end gap-2">
      <OButton
        variant="outline"
        size="sm-action"
        data-test="onboarding-get-started-skip-btn"
        @click="emit('skip')"
      >
        {{ t("login.getStarted.skipForNow") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useLicenseLocks } from "@/composables/useFeatureLock";
import { FIRST_SOURCE_OPTIONS, type FirstSourceId } from "@/components/login/firstSourceOptions";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";
import SampleLivePreview from "./SampleLivePreview.vue";
import { useSampleDataSession } from "@/composables/sampleData/useSampleDataSession";

const emit = defineEmits<{ pick: [id: FirstSourceId]; sample: []; skip: []; browse: [] }>();

// HTTP Logs is a test path, not a first source; the other nine fill the 3 by 3 grid
const HIDDEN_CHIPS: readonly FirstSourceId[] = ["sample", "unsure", "http"];

const { t } = useI18nTyped();

const { isLocked, lockedReason } = useLicenseLocks();

const session = useSampleDataSession();
// one load runs at a time, and a removal blocks a new one, so a pick then would be dropped
const sampleBusy = computed(() => session.status.value === "loading" || session.removing.value);

// a source whose guide the license locks stays visible but cannot be picked
const chipOptions = computed(() =>
  FIRST_SOURCE_OPTIONS.filter((option) => !HIDDEN_CHIPS.includes(option.id)).map((option) => ({
    ...option,
    lockedReason:
      option.feature && isLocked(option.feature) ? lockedReason(option.feature) : undefined,
  })),
);

const connectPoints = computed<I18nText[]>(() => [
  t("login.getStarted.connect.point1"),
  t("login.getStarted.connect.point2"),
  t("login.getStarted.connect.point3"),
]);
// no counts here: a trial user reads a number as their plan's limit
const samplePoints = computed<I18nText[]>(() => [
  t("login.getStarted.sample.point1"),
  t("login.getStarted.sample.point2"),
  t("login.getStarted.sample.point3"),
]);
</script>
