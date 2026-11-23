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
import { computed, ref, watch } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import {
  packRowInput,
  packRowShown,
  packRowState,
  packSetUpCount,
  retrySetUp,
  setUpWithDefaults,
  type PackRowState,
} from "@/composables/starterPacks/packChatRow";
import { DIGEST_MAX_PACKS } from "@/composables/starterPacks/packDigest";
import { packById } from "@/composables/starterPacks/usePackCatalog";
import { useHomePacks, type HomePack } from "@/composables/starterPacks/useHomePacks";
import { usePackGate } from "@/composables/starterPacks/usePackGate";
import type { StarterPack } from "@/composables/starterPacks/types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";
import StarterPackInlineConfirm from "./StarterPackInlineConfirm.vue";

const props = defineProps<{ org: string; packIds: string[] }>();

const { t } = useI18nTyped();
const gate = usePackGate(props.org);
const packs = props.packIds
  .map((id) => packById(id))
  .filter((pack): pack is StarterPack => !!pack)
  .slice(0, DIGEST_MAX_PACKS);
// Only the digest's packs, so the org's saved match copy, which covers every pack, is left alone.
const home = useHomePacks(props.org, packs, () => gate.visible.value, { save: false });
const confirming = ref<string | null>(null);

interface ChatRow {
  item: HomePack;
  state: PackRowState;
  count: number | null;
}

const rows = computed<ChatRow[]>(() =>
  home.items
    .filter((item) => packRowShown(item.view.value, item.flow.running.value, home.offerable.value))
    .map((item) => ({
      item,
      state: packRowState(packRowInput(item, home.askAdmin.value)),
      count: packSetUpCount(item.flow),
    })),
);
// As in the header list, the badge goes once any pack is set up, and never sits on an Ask an admin row.
const bestId = computed(() =>
  rows.value.some(({ state }) => state.kind !== "idle" && state.kind !== "forbidden")
    ? null
    : rows.value.find(({ state }) => state.kind === "idle")?.item.pack.id,
);

// Undo can drop the row for a moment while the org summary refreshes, and the confirm's done is lost with it.
watch(
  () => rows.value.find(({ item }) => item.pack.id === confirming.value)?.state.kind,
  (kind) => {
    if (kind !== "ready") confirming.value = null;
  },
);

const countsLine = ({ flow }: HomePack): I18nText => {
  const parts: I18nText[] = [];
  const dashboards = flow.dashboardCount.value ?? 0;
  const alerts = flow.alertCount.value ?? 0;
  const views = flow.viewCount.value ?? 0;
  if (dashboards)
    parts.push(t("starterPacks.popup.tileDashboards", { count: dashboards }, dashboards));
  if (alerts) parts.push(t("starterPacks.popup.tileAlerts", { count: alerts }, alerts));
  if (views) parts.push(t("starterPacks.popup.tileSavedViews", { count: views }, views));
  return raw(parts.join(" · "));
};

const progressLine = ({ flow }: HomePack): I18nText => {
  const total = flow.toCreate.value.length;
  return total
    ? t("starterPacks.progress.summary", { made: flow.made.value.length, total })
    : t("starterPacks.stepper.settingUp");
};

const busyLine = ({ flow }: HomePack): I18nText =>
  flow.busyBy.value
    ? t("starterPacks.busyBy", { who: raw(flow.busyBy.value) })
    : t("starterPacks.busySomeone");

const startedByLine = (by: string): I18nText =>
  by ? t("starterPacks.startedBy", { who: raw(by) }) : t("starterPacks.startedBySomeone");

const setUpLabel = (count: number | null): I18nText =>
  count === null
    ? t("starterPacks.drawer.setUp")
    : t("starterPacks.drawer.setUpCount", { count }, count);
</script>

<template>
  <div v-if="rows.length" class="mt-2 flex flex-col gap-2" data-test="starter-pack-chat-rows">
    <OText variant="meta">{{ t("aiAssistant.starter.readyWhenYouAre") }}</OText>
    <div
      v-for="{ item, state, count } in rows"
      :key="item.pack.id"
      class="border-border-default bg-surface-panel rounded-default flex min-h-14 items-center gap-3 border px-3 py-2"
      :data-test="`starter-pack-chat-row-${item.pack.id}`"
    >
      <StarterPackInlineConfirm
        v-if="confirming === item.pack.id"
        :flow="item.flow"
        mode="undo"
        @cancel="confirming = null"
        @done="confirming = null"
      />
      <template v-else>
        <span
          class="border-border-default bg-surface-base rounded-default flex size-9 shrink-0 items-center justify-center border"
        >
          <img
            v-if="item.pack.logo"
            :src="getImageURL(item.pack.logo)"
            class="size-6 object-contain"
            alt=""
          />
          <OIcon v-else name="package-2" size="sm" class="text-text-secondary" />
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-text-heading flex min-w-0 items-center gap-2 text-sm font-semibold">
            <OTruncatedText class="min-w-0">{{ item.title }}</OTruncatedText>
            <OBadge
              v-if="bestId === item.pack.id"
              variant="primary"
              size="sm"
              :data-test="`starter-pack-chat-best-${item.pack.id}`"
              >{{ t("starterPacks.home.bestStart") }}</OBadge
            >
          </span>
          <span
            class="text-text-secondary flex min-w-0 items-center gap-1.5 text-xs"
            :data-test="`starter-pack-chat-note-${item.pack.id}`"
          >
            <template v-if="state.kind === 'settingUp'">
              <OSpinner size="xs" class="shrink-0" />
              <span class="truncate">{{ progressLine(item) }}</span>
            </template>
            <span v-else-if="state.kind === 'ready'" class="truncate">{{
              t("starterPacks.ready.title", { title: item.title })
            }}</span>
            <span
              v-else-if="state.kind === 'failed' && item.flow.interruptedBy.value !== null"
              class="truncate"
              >{{ startedByLine(item.flow.interruptedBy.value) }}</span
            >
            <span v-else-if="state.kind === 'failed'" class="truncate">{{
              t("starterPacks.progress.interrupted", {
                made: item.flow.made.value.length,
                total: item.flow.toCreate.value.length,
              })
            }}</span>
            <template v-else-if="state.kind === 'forbidden'">
              <OIcon name="lock" size="sm" class="shrink-0" />
              <span class="truncate">{{ t("starterPacks.askAdmin") }}</span>
            </template>
            <template v-else-if="state.kind === 'idle' && item.flow.busyBy.value !== null">
              <OIcon name="schedule" size="sm" class="shrink-0" />
              <span class="truncate">{{ busyLine(item) }}</span>
            </template>
            <span v-else-if="state.installFailed" class="text-status-error-text truncate">{{
              t("starterPacks.progress.installError")
            }}</span>
            <span v-else class="truncate">{{ countsLine(item) }}</span>
          </span>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <template v-if="state.kind === 'idle'">
            <OButton
              variant="link"
              size="sm-action"
              :aria-label="t('starterPacks.home.reviewSetUpLabel', { title: item.title })"
              :data-test="`starter-pack-chat-review-${item.pack.id}`"
              @click="item.openDetails()"
            >
              {{ t("starterPacks.home.reviewSetUp") }}
            </OButton>
            <OButton
              variant="primary"
              size="sm-action"
              :data-test="`starter-pack-chat-set-up-${item.pack.id}`"
              @click="setUpWithDefaults(item.flow)"
            >
              {{ setUpLabel(count) }}
            </OButton>
          </template>
          <template v-else-if="state.kind === 'ready'">
            <OButton
              v-if="state.canUndo"
              variant="ghost"
              size="sm-action"
              :data-test="`starter-pack-chat-undo-${item.pack.id}`"
              @click="confirming = item.pack.id"
            >
              {{ t("starterPacks.landing.undo") }}
            </OButton>
            <OButton
              v-if="item.flow.dashboardItem.value?.id"
              variant="outline"
              size="sm-action"
              :data-test="`starter-pack-chat-open-${item.pack.id}`"
              @click="item.flow.land()"
            >
              {{ t("starterPacks.drawer.openDashboard") }}
            </OButton>
          </template>
          <OButton
            v-else-if="state.kind === 'failed' && item.flow.interruptedBy.value === null"
            variant="primary"
            size="sm-action"
            icon-left="refresh"
            :data-test="`starter-pack-chat-retry-${item.pack.id}`"
            @click="retrySetUp(item.flow)"
          >
            {{
              state.retryCount
                ? t("starterPacks.progress.retry", { count: state.retryCount }, state.retryCount)
                : t("starterPacks.progress.finish")
            }}
          </OButton>
        </div>
      </template>
    </div>
  </div>
</template>
