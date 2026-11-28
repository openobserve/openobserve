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
  <div
    v-if="mode === 'loading'"
    class="flex min-w-0 flex-col gap-2"
    aria-busy="true"
    data-test="assistant-pack-offer-loading"
  >
    <OText variant="meta">{{ t("starterPacks.offer.checking") }}</OText>
    <ul v-if="variant === 'compact'" :class="[LIST_CLASS, 'divide-border-subtle divide-y']">
      <li v-for="row in DIGEST_MAX_PACKS" :key="row" :class="ROW_CLASS">
        <OSkeleton type="rect" class="size-8 shrink-0" />
        <span class="flex min-w-0 flex-1 flex-col gap-1.5">
          <OSkeleton type="text" class="h-3 w-24" />
          <OSkeleton type="text" class="h-2.5 w-36" />
        </span>
        <OSkeleton type="rect" class="h-7 w-22 shrink-0" />
      </li>
    </ul>
    <ul v-else class="grid min-w-0 grid-cols-3 gap-2 max-md:grid-cols-1">
      <li v-for="card in DIGEST_MAX_PACKS" :key="card" class="flex min-w-0">
        <OSkeleton type="rect" class="rounded-surface h-24 w-full" />
      </li>
    </ul>
  </div>

  <section
    v-else-if="mode !== 'none' && variant === 'compact'"
    :aria-labelledby="headingId"
    :class="LIST_CLASS"
    data-test="assistant-pack-offer"
    :data-mode="mode"
  >
    <div class="flex min-w-0 items-center gap-2 px-3 pt-2.5 pb-1.5">
      <OIcon name="package-2" size="sm" class="text-accent shrink-0" />
      <h3 :id="headingId" class="text-text-heading min-w-0 flex-1 text-sm font-semibold">
        {{ t("starterPacks.offer.title") }}
      </h3>
      <span class="text-text-secondary shrink-0 text-xs">{{ fitLine }}</span>
    </div>
    <ul v-if="mode === 'starter'" class="divide-border-subtle divide-y">
      <li
        v-for="item in matched"
        :key="item.pack.id"
        :class="ROW_CLASS"
        :data-test="`assistant-pack-offer-row-${item.pack.id}`"
      >
        <StarterPackLogo :pack="item.pack" />
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <OTruncatedText class="text-text-heading min-w-0 text-sm font-medium">{{
            item.title
          }}</OTruncatedText>
          <OTruncatedText
            class="text-text-secondary min-w-0 text-xs"
            :data-test="`assistant-pack-offer-note-${item.pack.id}`"
            >{{ countsOf(item) }}</OTruncatedText
          >
        </span>
        <StarterPackAskAdmin
          v-if="refused(item)"
          :org="org"
          :data-test="`assistant-pack-offer-ask-admin-${item.pack.id}`"
        />
        <OButton
          v-else
          variant="outline"
          size="sm"
          class="shrink-0"
          :aria-label="t('starterPacks.home.reviewSetUpLabel', { title: item.title })"
          :data-test="`assistant-pack-offer-review-${item.pack.id}`"
          @click="item.openDetails()"
        >
          {{ t("starterPacks.home.reviewSetUp") }}
        </OButton>
      </li>
    </ul>
    <div v-else :class="[ROW_CLASS, 'pb-2.5']">
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-text-heading text-sm font-medium">{{ titles }}</span>
        <span class="text-text-secondary text-xs">{{ totalLine }}</span>
      </span>
      <StarterPackAskAdmin :org="org" data-test="assistant-pack-offer-ask-admin" />
    </div>
  </section>

  <section
    v-else-if="mode !== 'none'"
    :aria-labelledby="headingId"
    class="flex min-w-0 flex-col gap-2"
    data-test="assistant-home-pack-offer"
    :data-mode="mode"
  >
    <div class="flex min-h-7 min-w-0 items-center gap-2 ps-0.5">
      <h3 :id="headingId" class="text-text-secondary min-w-0 flex-1 text-xs font-medium">
        {{ t("starterPacks.offer.title") }}
      </h3>
      <OButton
        v-if="mode === 'starter' && digest"
        variant="ghost-muted"
        size="chip"
        icon-left="package-2"
        class="shrink-0"
        data-test="assistant-home-pack-offer-ask"
        @click="askWhichFit(digest)"
      >
        {{ t("starterPacks.offer.askWhichFit") }}
      </OButton>
    </div>
    <ul v-if="mode === 'starter'" class="grid min-w-0 grid-cols-3 gap-2 max-md:grid-cols-1">
      <li v-for="item in matched" :key="item.pack.id" class="flex min-w-0">
        <div
          v-if="refused(item)"
          :class="[CARD_BASE_CLASS, 'cursor-default']"
          :data-test="`assistant-home-pack-${item.pack.id}`"
        >
          <span class="flex min-w-0 items-center gap-2">
            <StarterPackLogo :pack="item.pack" />
            <OTruncatedText class="text-text-heading min-w-0 flex-1 text-sm">{{
              item.title
            }}</OTruncatedText>
          </span>
          <span class="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span class="text-xs leading-4">{{ countsOf(item) }}</span>
            <StarterPackAskAdmin
              :org="org"
              :data-test="`assistant-pack-offer-ask-admin-${item.pack.id}`"
            />
          </span>
        </div>
        <button
          v-else
          type="button"
          :class="CARD_CLASS"
          :aria-label="t('starterPacks.home.reviewSetUpLabel', { title: item.title })"
          :data-test="`assistant-home-pack-${item.pack.id}`"
          @click="item.openDetails()"
        >
          <span class="flex min-w-0 items-center gap-2">
            <StarterPackLogo :pack="item.pack" />
            <OTruncatedText class="text-text-heading min-w-0 flex-1 text-sm">{{
              item.title
            }}</OTruncatedText>
            <OIcon name="arrow-forward" size="sm" class="shrink-0" />
          </span>
          <span class="text-xs leading-4">{{ countsOf(item) }}</span>
        </button>
      </li>
    </ul>
    <div
      v-else
      class="rounded-surface border-border-default bg-surface-base flex min-w-0 items-center gap-3 border p-3 max-md:flex-col max-md:items-start"
    >
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-text-heading text-sm font-medium">{{
          t("starterPacks.offer.packsFit", { packs: titles }, matched.length)
        }}</span>
        <span class="text-text-secondary text-xs">{{ totalLine }}</span>
      </span>
      <StarterPackAskAdmin :org="org" data-test="assistant-pack-offer-ask-admin" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, useId, watch } from "vue";

import {
  joinTitles,
  packDigestChip,
  packQuestion,
  starterWelcomeMode,
} from "@/components/ai-assistant/welcome/starterWelcome";
import type { ContextChip } from "@/composables/assistant";
import { packCountsLine } from "@/composables/starterPacks/packCardText";
import { packItemCounts } from "@/composables/starterPacks/packChatRow";
import { buildPackDigest, DIGEST_MAX_PACKS } from "@/composables/starterPacks/packDigest";
import { useHomePacks, type HomePack } from "@/composables/starterPacks/useHomePacks";
import { usePackGate } from "@/composables/starterPacks/usePackGate";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

import StarterPackAskAdmin from "./StarterPackAskAdmin.vue";
import StarterPackLogo from "./StarterPackLogo.vue";

const LIST_CLASS =
  "rounded-surface border-border-default bg-surface-base min-w-0 overflow-hidden border";
const ROW_CLASS = "flex min-h-12 min-w-0 items-center gap-2.5 px-3 py-2";
// The recent-chat cards' look, so the packs read as part of the same start page.
const CARD_BASE_CLASS =
  "rounded-surface border-border-default bg-surface-base text-text-secondary flex min-h-24 w-full min-w-0 flex-col gap-2 border p-3 text-start";
const CARD_CLASS = [
  CARD_BASE_CLASS,
  "cursor-pointer hover:bg-surface-subtle focus-visible:ring-focus-ring-accent transition-colors focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none",
].join(" ");

const props = defineProps<{ org: string; variant: "compact" | "roomy" }>();
const emit = defineEmits<{
  /** The matched packs as text while they are offered, else `null`. */
  digest: [text: string | null];
  /** Roomy only: "Ask which fit best" hands the question and the digest chip to the box. */
  ask: [prompt: string, chip: ContextChip];
}>();

const { t } = useI18nTyped();
const headingId = `starter-pack-offer-${useId()}`;
const gate = usePackGate(props.org);
const home = useHomePacks(props.org, undefined, () => gate.visible.value);

// Live from the org's answers, so a set up that gives the org resources ends the offer.
const mode = computed(() =>
  starterWelcomeMode({
    visible: gate.visible.value,
    showSection: home.showSection.value,
    loading: home.loading.value,
    askAdmin: home.askAdmin.value && !home.noAccess.value,
  }),
);
const matched = computed(() => home.offered.value.slice(0, DIGEST_MAX_PACKS));
// A pack this user may not set up gets Ask an admin, and the assistant is never told to recommend it.
const refused = (item: HomePack): boolean => item.view.value === "forbidden";
const digest = computed(() => {
  const offerable = matched.value.filter((item) => !refused(item));
  return mode.value === "starter" && offerable.length ? buildPackDigest(offerable) : null;
});

const countsOf = (item: HomePack): I18nText => packCountsLine(t, packItemCounts(item));
const titles = computed(() => joinTitles(matched.value.map(({ title }) => String(title))));
const fitLine = computed(() =>
  t("starterPacks.offer.fitCount", { count: matched.value.length }, matched.value.length),
);
const totalLine = computed(() => {
  const total = matched.value.reduce((sum, item) => {
    const { dashboards, alerts, views } = packItemCounts(item);
    return sum + dashboards + alerts + views;
  }, 0);
  return t("starterPacks.offer.totalItems", { count: total }, total);
});

function askWhichFit(text: string): void {
  emit("ask", packQuestion(), packDigestChip(text, t));
}

// Re-sent as previews add counts, so the composer chip always carries the latest digest.
watch(digest, (text) => emit("digest", text), { immediate: true });
onBeforeUnmount(() => emit("digest", null));
</script>
