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
  <SectionCard
    :title="t('autoobserve2.suggestions.title')"
    :count="listed || hidden ? rail.total : undefined"
    :aria-busy="rail.status === 'loading'"
    data-test="autoobserve2-suggestions"
  >
    <span class="sr-only" role="status" data-test="autoobserve2-suggestions-announce">{{
      loadText
    }}</span>
    <p
      v-if="rail.status === 'loading' || skeleton || listed || hidden"
      class="text-text-secondary -mt-2 px-5 pb-3 text-sm leading-relaxed text-pretty sm:px-6"
      data-test="autoobserve2-suggestions-subtitle"
    >
      {{ t("autoobserve2.suggestions.subtitle") }}
    </p>
    <template v-if="rail.status === 'loading' || skeleton">
      <div v-if="skeleton" data-test="autoobserve2-suggestions-skeleton">
        <ul class="flex flex-col gap-2.5 px-3 pb-3 sm:px-4" aria-hidden="true">
          <li
            v-for="i in SKELETON_CARDS"
            :key="i"
            class="border-border-subtle rounded-default flex flex-col gap-2 border py-3.5 ps-4 pe-3.5"
          >
            <OSkeleton animation="none" class="h-4.5 w-20" />
            <OSkeleton animation="none" class="h-3.5 w-[90%]" />
            <OSkeleton animation="none" class="h-3 w-full" />
            <OSkeleton animation="none" class="h-3 w-[70%]" />
            <div class="flex min-h-8 items-center gap-2 pt-1">
              <OSkeleton animation="none" class="h-7 w-28" />
              <OSkeleton animation="none" class="ms-auto h-4 w-14" />
            </div>
          </li>
        </ul>
      </div>
    </template>
    <div v-else-if="notice" class="px-3 pb-3 sm:px-4">
      <LiveNoticeState
        :notice="notice"
        size="inline"
        :detail="rail.detail"
        :busy="rail.busy"
        :data-test="NOTICE_TEST[notice.failure]"
        retry-test="autoobserve2-suggestions-retry"
        @retry="rail.retry()"
      />
    </div>
    <div v-else-if="!listed" class="px-3 pb-3 sm:px-4">
      <LiveRefreshFailed
        v-if="rail.stale"
        class="mb-2.5"
        surface="suggestions"
        :stale="rail.stale"
        :busy="rail.busy"
        data-test="autoobserve2-suggestions-refresh-failed"
        @retry="rail.retry()"
      />
      <OEmptyState
        v-if="hidden"
        size="inline"
        icon="task-alt"
        :title="t('autoobserveLive.notice.suggestions.pageEmptyTitle')"
        :description="t('autoobserveLive.notice.suggestions.pageEmptyDesc')"
        data-test="autoobserve2-suggestions-page-empty"
      />
      <OEmptyState
        v-else
        size="inline"
        icon="task-alt"
        :title="t('autoobserveLive.notice.suggestions.emptyTitle')"
        :description="t('autoobserveLive.notice.suggestions.emptyDesc')"
        data-test="autoobserve2-suggestions-empty"
      />
    </div>
    <template v-else>
      <div v-if="rail.stale" class="px-3 pb-2.5 sm:px-4">
        <LiveRefreshFailed
          surface="suggestions"
          :stale="rail.stale"
          :busy="rail.busy"
          data-test="autoobserve2-suggestions-refresh-failed"
          @retry="rail.retry()"
        />
      </div>
      <ul class="flex flex-col gap-2.5 px-3 pb-3 sm:px-4">
        <li v-for="request in shown" :key="request.id">
          <InsightBlock
            :parts="request.insight"
            :pending="pendingId === request.id"
            @cta="(cta) => run(request.id, cta)"
            @secondary="(cta) => run(request.id, cta)"
            @dismiss="dismiss(request.insight)"
          />
        </li>
      </ul>
    </template>
    <AlertCalibrationDismissDialog
      v-if="dismissTarget"
      v-model:open="dismissOpen"
      :finding="dismissTarget"
    />
    <ReviewChangeDialog v-if="reviewTarget" v-model:open="reviewOpen" :target="reviewTarget" />
    <template v-if="beyond" #footer>
      <div class="flex items-center gap-2">
        <span
          v-if="more"
          class="text-text-secondary text-xs"
          data-test="autoobserve2-suggestions-more"
          >{{ more }}</span
        >
        <OButton
          variant="ghost-primary"
          size="xs"
          icon-right="arrow-forward"
          class="ms-auto"
          data-test="autoobserve2-suggestions-see-all"
          @click="emit('see-all')"
        >
          {{ seeAllText(t, locale, rail.total) }}
        </OButton>
      </div>
    </template>
  </SectionCard>
</template>

<script setup lang="ts">
import { computed, toRef } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import SectionCard from "../v2/SectionCard.vue";
import InsightBlock from "../insight/InsightBlock.vue";
import { useInsightActions } from "../insight/useInsightActions";
import ReviewChangeDialog from "../decisions/ReviewChangeDialog.vue";
import AlertCalibrationDismissDialog from "@/components/alert_calibration/AlertCalibrationDismissDialog.vue";
import LiveNoticeState from "./LiveNoticeState.vue";
import LiveRefreshFailed from "./LiveRefreshFailed.vue";
import {
  RAIL_CAP,
  liveLoadText,
  liveNotice,
  moreText,
  seeAllText,
  type LiveFailure,
} from "./liveCopy";
import { useLoadPhase, type RailSource } from "./liveModel";

const SKELETON_CARDS = 3;

const NOTICE_TEST: Record<LiveFailure, string> = {
  denied: "autoobserve2-suggestions-denied",
  off: "autoobserve2-suggestions-off",
  unavailable: "autoobserve2-suggestions-unavailable",
  failed: "autoobserve2-suggestions-error",
};

const props = defineProps<{ rail: RailSource; skeleton: boolean }>();

const emit = defineEmits<{ "see-all": [] }>();

const { t, locale } = useI18nTyped();
const { run, dismiss, pendingId, dismissTarget, dismissOpen, reviewTarget, reviewOpen } =
  useInsightActions();

const shown = computed(() => props.rail.requests.slice(0, RAIL_CAP));
const shownCount = computed(() => shown.value.reduce((sum, r) => sum + (r.covers ?? 1), 0));
const settled = computed(() => !props.skeleton && props.rail.status === "ready");
const listed = computed(() => settled.value && shown.value.length > 0);
// The server total, not this page's length, decides whether more exist: decided suggestions can empty a page.
const beyond = computed(() => settled.value && props.rail.total > shownCount.value);
const hidden = computed(() => beyond.value && !listed.value);
const notice = computed(() =>
  props.rail.status === "error" && props.rail.failure
    ? liveNotice(t, "suggestions", props.rail.failure)
    : null,
);
const more = computed(() =>
  listed.value ? moreText(t, locale.value, props.rail.total, shownCount.value) : null,
);
const loadPhase = useLoadPhase(() => props.rail.status, toRef(props, "skeleton"));
const loadText = computed(() => liveLoadText(t, "suggestions", loadPhase.value));
</script>
