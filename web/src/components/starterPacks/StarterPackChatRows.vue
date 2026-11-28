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
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import {
  packItemCounts,
  packRowInput,
  packRowShown,
  packRowState,
  packSetUpCount,
  retrySetUp,
  setUpWithDefaults,
  type PackRowState,
} from "@/composables/starterPacks/packChatRow";
import { packBusyText, packCountsLine } from "@/composables/starterPacks/packCardText";
import { DIGEST_MAX_PACKS } from "@/composables/starterPacks/packDigest";
import { packById } from "@/composables/starterPacks/usePackCatalog";
import { useHomePacks, type HomePack } from "@/composables/starterPacks/useHomePacks";
import { usePackGate } from "@/composables/starterPacks/usePackGate";
import type { StarterPack } from "@/composables/starterPacks/types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import StarterPackAskAdmin from "./StarterPackAskAdmin.vue";
import StarterPackLogo from "./StarterPackLogo.vue";

const props = defineProps<{ org: string; packIds: string[] }>();

const { t } = useI18nTyped();
const gate = usePackGate(props.org);
const packs = props.packIds
  .map((id) => packById(id))
  .filter((pack): pack is StarterPack => !!pack)
  .slice(0, DIGEST_MAX_PACKS);
// Only the digest's packs, so the org's saved match copy, which covers every pack, is left alone.
const home = useHomePacks(props.org, packs, () => gate.visible.value, { save: false });

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
const countsLine = (item: HomePack): I18nText => packCountsLine(t, packItemCounts(item));
// The heading invites a set up, so it shows only while some row still offers one.
const anyIdle = computed(() => rows.value.some(({ state }) => state.kind === "idle"));

const progressLine = ({ flow }: HomePack): I18nText => {
  const total = flow.toCreate.value.length;
  return total
    ? t("starterPacks.progress.summary", { made: flow.made.value.length, total })
    : t("starterPacks.stepper.settingUp");
};

const busyLine = ({ flow }: HomePack): I18nText => {
  const who = flow.busyBy.value ?? "";
  return packBusyText(t, who, flow.isMe(who));
};

const runningLine = ({ flow }: HomePack): I18nText => {
  const who = flow.runningBy.value ?? "";
  return packBusyText(t, who, flow.isMe(who));
};

const startedByLine = (by: string): I18nText =>
  by ? t("starterPacks.startedBy", { who: raw(by) }) : t("starterPacks.startedBySomeone");

const setUpLabel = (count: number | null): I18nText =>
  count === null
    ? t("starterPacks.drawer.setUp")
    : t("starterPacks.drawer.setUpCount", { count }, count);
</script>

<template>
  <div
    v-if="rows.length"
    class="mt-2 flex min-w-0 flex-col gap-2"
    data-test="starter-pack-chat-rows"
  >
    <OText v-if="anyIdle" variant="meta">{{ t("starterPacks.offer.readyWhenYouAre") }}</OText>
    <ul
      class="rounded-surface border-border-default bg-surface-base divide-border-subtle min-w-0 divide-y overflow-hidden border"
    >
      <li
        v-for="{ item, state, count } in rows"
        :key="item.pack.id"
        class="flex min-h-14 min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2"
        :data-state="state.kind"
        :data-test="`starter-pack-chat-row-${item.pack.id}`"
      >
        <StarterPackLogo :pack="item.pack" />
        <!-- The title keeps room to read; the buttons drop below it when the panel is narrow -->
        <div class="flex min-w-32 flex-1 basis-32 flex-col gap-0.5">
          <OTruncatedText class="text-text-heading min-w-0 text-sm font-semibold">{{
            item.title
          }}</OTruncatedText>
          <span
            class="text-text-secondary flex min-w-0 items-start gap-1.5 text-xs leading-4"
            :data-test="`starter-pack-chat-note-${item.pack.id}`"
          >
            <template v-if="state.kind === 'settingUp'">
              <OSpinner size="xs" class="shrink-0" />
              <span>{{ progressLine(item) }}</span>
            </template>
            <template v-else-if="state.kind === 'elsewhere'">
              <OIcon name="schedule" size="sm" class="shrink-0" />
              <span>{{ runningLine(item) }}</span>
            </template>
            <template v-else-if="state.kind === 'ready'">
              <OIcon name="check-circle" size="sm" class="text-status-success-text shrink-0" />
              <span>{{ t("starterPacks.ready.title", { title: item.title }) }}</span>
            </template>
            <span v-else-if="state.kind === 'failed' && item.flow.interruptedBy.value !== null">{{
              startedByLine(item.flow.interruptedBy.value)
            }}</span>
            <span v-else-if="state.kind === 'failed'">{{
              t("starterPacks.progress.interrupted", {
                made: item.flow.made.value.length,
                total: item.flow.toCreate.value.length,
              })
            }}</span>
            <template v-else-if="state.kind === 'idle' && item.flow.busyBy.value !== null">
              <OIcon name="schedule" size="sm" class="shrink-0" />
              <span>{{ busyLine(item) }}</span>
            </template>
            <span v-else-if="state.installFailed" class="text-status-error-text">{{
              t("starterPacks.progress.installError")
            }}</span>
            <span v-else>{{ countsLine(item) }}</span>
          </span>
        </div>
        <div class="ms-auto flex shrink-0 items-center gap-2">
          <template v-if="state.kind === 'idle' && item.flow.busyBy.value === null">
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
              :loading="item.flow.running.value"
              :data-test="`starter-pack-chat-set-up-${item.pack.id}`"
              @click="setUpWithDefaults(item.flow)"
            >
              {{ setUpLabel(count) }}
            </OButton>
          </template>
          <OButton
            v-else-if="state.kind === 'ready' && item.flow.dashboardItem.value?.id"
            variant="outline"
            size="sm-action"
            :data-test="`starter-pack-chat-open-${item.pack.id}`"
            @click="item.flow.land()"
          >
            {{ t("starterPacks.drawer.openDashboard") }}
          </OButton>
          <OButton
            v-else-if="state.kind === 'failed'"
            variant="primary"
            size="sm-action"
            :icon-left="state.retryCount ? 'refresh' : undefined"
            :loading="item.flow.running.value"
            :data-test="`starter-pack-chat-retry-${item.pack.id}`"
            @click="retrySetUp(item.flow)"
          >
            {{
              state.retryCount
                ? t("starterPacks.progress.retry", { count: state.retryCount }, state.retryCount)
                : t("starterPacks.progress.finish")
            }}
          </OButton>
          <StarterPackAskAdmin
            v-else-if="state.kind === 'forbidden'"
            :org="org"
            size="sm-action"
            :data-test="`starter-pack-chat-ask-admin-${item.pack.id}`"
          />
        </div>
      </li>
    </ul>
  </div>
</template>
