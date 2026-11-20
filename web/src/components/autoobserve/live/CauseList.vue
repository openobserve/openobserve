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
  <!-- Collapsed, the block keeps one fixed height, so late content fills slots and only the reader's expand moves what is below. -->
  <div
    class="flex min-w-0 flex-col gap-3 [&>*]:shrink-0"
    :class="open ? '' : [step ? BLOCK_HEIGHT.step : BLOCK_HEIGHT.bare, 'overflow-hidden']"
    data-test="autoobserve-cause-list"
  >
    <div
      v-for="impact in impacts"
      :key="impact.line.id"
      class="rounded-default flex min-w-0 flex-col justify-center gap-1 border-s-4 px-3"
      :class="[IMPACT_FRAME[impact.copy.tone], open ? 'py-2' : 'h-25']"
      :data-tone="impact.copy.tone"
      data-test="autoobserve-cause-list-impact"
    >
      <div class="flex h-6 min-w-0 items-center gap-x-3">
        <OIcon name="shield" size="sm" :class="IMPACT_INK[impact.copy.tone]" aria-hidden="true" />
        <span class="text-xs font-medium" :class="IMPACT_INK[impact.copy.tone]">{{
          t("autoobserve.context.impact.title")
        }}</span>
        <OButton
          v-if="impact.copy.link && impact.open"
          variant="accent-ghost"
          size="sm"
          class="ms-auto shrink-0"
          data-test="autoobserve-cause-list-impact-open"
          @click="go(impact.open)"
        >
          {{ impact.copy.link.label }}
        </OButton>
      </div>
      <div class="flex min-w-0 flex-col" :class="open ? '' : 'h-10'">
        <OTruncatedText
          as="p"
          :lines="impact.copy.redacted ? 1 : 2"
          class="text-text-heading text-sm"
        >
          {{ impact.copy.text }}
        </OTruncatedText>
        <OTruncatedText v-if="impact.copy.redacted" as="p" class="text-text-secondary text-xs">
          {{ impact.copy.redacted }}
        </OTruncatedText>
      </div>
    </div>

    <slot />

    <section
      class="flex min-w-0 flex-col gap-1.5"
      :aria-busy="loading"
      data-test="autoobserve-cause-list-block"
    >
      <div class="flex h-6 min-w-0 items-center gap-x-3">
        <span class="text-text-heading shrink-0 text-xs font-medium">{{
          t("autoobserve.context.title")
        }}</span>
        <template v-if="copy">
          <OInlineNotice
            v-if="copy.failed"
            tone="err"
            class="min-w-0"
            :message="copy.failed"
            data-test="autoobserve-cause-list-failed"
          />
          <OInlineNotice
            v-if="copy.gap"
            tone="warn"
            class="min-w-0"
            :message="copy.gap"
            data-test="autoobserve-cause-list-gap"
          />
        </template>
      </div>

      <ul
        class="divide-border-subtle flex min-w-0 flex-col divide-y"
        :class="open ? '' : ROWS_HEIGHT[slots]"
        :aria-label="loading ? t('autoobserve.context.loading') : undefined"
      >
        <template v-if="loading">
          <li
            v-for="n in CAUSE_SLOTS"
            :key="n"
            class="grid h-14 grid-cols-[2.5rem_4.5rem_minmax(0,1fr)] items-center gap-x-2"
          >
            <span />
            <OSkeleton class="h-5 w-14" />
            <span class="flex flex-col gap-1.5">
              <OSkeleton class="h-3.5 w-4/5" />
              <OSkeleton class="h-3 w-2/5" />
            </span>
          </li>
        </template>
        <li v-else-if="copy?.empty" class="flex h-14 items-center">
          <OTruncatedText
            as="p"
            :lines="2"
            class="text-text-body text-sm"
            data-test="autoobserve-cause-list-empty"
          >
            {{ copy.empty }}
          </OTruncatedText>
        </li>
        <li
          v-for="row in rows"
          :key="row.id"
          class="grid h-14 min-w-0 grid-cols-[2.5rem_4.5rem_minmax(0,1fr)_auto] items-center gap-x-2"
          :data-used="row.used"
          data-test="autoobserve-cause-list-row"
        >
          <span class="text-accent text-xs font-medium">
            <template v-if="row.used">{{ t("autoobserve.context.used") }}</template>
          </span>
          <OTag
            tone="outline"
            size="sm"
            class="justify-self-start"
            :label="gradeLabel(t, row.grade)"
          />
          <OTruncatedText as="p" :lines="2" class="text-text-body text-sm break-words">
            {{ raw(row.sentence) }}
          </OTruncatedText>
          <OButton
            v-if="row.record.open"
            variant="accent-ghost"
            size="sm"
            data-test="autoobserve-cause-list-open"
            @click="go(row.record.open)"
          >
            {{ causeLinkLabel(t, row.record.kind) }}
          </OButton>
          <span v-else />
        </li>
      </ul>

      <div
        class="flex min-w-0 items-center gap-x-3"
        :class="open ? 'min-h-6 flex-wrap gap-y-1' : 'h-6'"
      >
        <template v-if="copy">
          <OButton
            v-if="copy.fold"
            variant="accent-ghost"
            size="sm"
            class="shrink-0"
            :icon-end="open ? 'expand-less' : 'expand-more'"
            :aria-expanded="open"
            data-test="autoobserve-cause-list-fold"
            @click="open = !open"
          >
            {{ open ? copy.fold.less : copy.fold.more }}
          </OButton>
          <OTruncatedText
            v-if="copy.unlisted && (open || !copy.fold)"
            class="text-text-secondary text-xs"
            data-test="autoobserve-cause-list-unlisted"
          >
            {{ copy.unlisted }}
          </OTruncatedText>
          <span
            v-if="copy.hidden"
            class="text-text-secondary flex min-w-0 items-center gap-1.5 text-xs"
            data-test="autoobserve-cause-list-hidden"
          >
            <OIcon name="lock" size="xs" aria-hidden="true" />
            <OTruncatedText>{{ copy.hidden }}</OTruncatedText>
          </span>
        </template>
      </div>

      <span v-if="loading" class="flex h-8 flex-col justify-center gap-1.5">
        <OSkeleton class="h-3 w-full" />
        <OSkeleton class="h-3 w-2/5" />
      </span>
      <div v-else class="h-8">
        <OTruncatedText
          v-if="copy?.footer"
          as="p"
          :lines="2"
          class="text-text-secondary text-xs"
          data-test="autoobserve-cause-list-footer"
        >
          {{ copy.footer }}
        </OTruncatedText>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { AutoObserveDeepLink, AutoObserveIssueContext } from "@/services/autoobserve";
import {
  BLOCK_HEIGHT,
  CAUSE_SLOTS,
  IMPACT_SLOTS,
  causeBlockCopy,
  causeLinkLabel,
  gradeLabel,
  type ContextTone,
} from "./causeCopy";
import { deepLinkRoute } from "./liveAdapter";
import { useLiveZone } from "./liveModel";

const props = withDefaults(
  defineProps<{
    // Null while the item is still loading or the first ask is not stored yet.
    context: AutoObserveIssueContext | null;
    // The issue is over, so the impact reads as past and neutral.
    recovered: boolean;
    // Decides whether the served next ask is still ahead or already due.
    nowMs: number;
    // Whether the block holds a Next step box, which its fixed height includes.
    step?: boolean;
  }>(),
  { step: true },
);

const { t } = useI18nTyped();
const router = useRouter();
const org = useOrgId();
const zone = useLiveZone();

const ROWS_HEIGHT: Record<number, string> = { 0: "h-0", 1: "h-14", 2: "h-28", 3: "h-42" };

const IMPACT_FRAME: Record<ContextTone, string> = {
  error: "bg-status-error-bg border-s-status-error-text",
  warning: "bg-status-warning-bg border-s-status-warning-text",
  neutral: "bg-surface-subtle border-s-border-subtle",
};

const IMPACT_INK: Record<ContextTone, string> = {
  error: "text-status-error-text",
  warning: "text-status-warning-text",
  neutral: "text-text-secondary",
};

const open = ref(false);

const loading = computed(() => !props.context || props.context.asked_at === null);

const copy = computed(() =>
  loading.value || !props.context
    ? null
    : causeBlockCopy(t, zone.value, props.context, props.nowMs, props.recovered),
);

const slots = computed(() =>
  copy.value ? CAUSE_SLOTS - IMPACT_SLOTS * copy.value.impactsShown : CAUSE_SLOTS,
);

const rows = computed(() =>
  copy.value ? [...copy.value.rows.shown, ...(open.value ? copy.value.rows.folded : [])] : [],
);

const impacts = computed(() => {
  const all = copy.value?.impacts ?? [];
  return (open.value ? all : all.slice(0, copy.value?.impactsShown ?? 0)).map((i) => ({
    ...i,
    open: i.copy.link ? i.line.record.items[i.copy.link.item].open : null,
  }));
});

const go = (link: AutoObserveDeepLink) => void router.push(deepLinkRoute(link, org.value));
</script>
