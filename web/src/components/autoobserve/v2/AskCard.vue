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
  <div ref="rootEl" :data-test="`autoobserve2-request-${testId}`">
    <p class="sr-only" role="status" :data-test="`autoobserve2-request-status-${testId}`">
      {{ announcement }}
    </p>
    <div
      v-if="decisions[request.id]"
      class="bg-surface-subtle rounded-default flex items-start gap-2 py-2 ps-3 pe-1.5"
    >
      <OIcon name="check-circle" size="sm" class="text-status-success-text mt-0.5 shrink-0" />
      <span
        class="text-text-body min-w-0 flex-1 text-sm leading-snug text-pretty"
        :data-test="`autoobserve2-request-done-${testId}`"
      >
        {{ doneText }}
      </span>
      <OButton
        variant="ghost-primary"
        size="xs"
        class="-my-0.5 shrink-0"
        :data-test="`autoobserve2-request-undo-${testId}`"
        @click="onUndo"
      >
        {{ t("autoobserve2.needs.undo") }}
      </OButton>
    </div>
    <article
      v-else
      class="rounded-default relative flex flex-col gap-2 overflow-hidden border"
      :class="
        inline
          ? assistantV2
            ? 'bg-surface-base border-border-subtle px-3 py-2.5'
            : 'bg-badge-warning-soft-bg/40 border-badge-warning-ol-border/40 px-3 py-2.5'
          : 'bg-surface-base border-border-subtle py-3.5 ps-4 pe-3.5 shadow-xs'
      "
    >
      <div v-if="inline" class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <OTag
          variant="warning-soft"
          size="xs"
          :label="t('autoobserve2.needs.needsOk')"
          :data-test="`autoobserve2-request-needs-ok-${testId}`"
        />
        <h3
          class="text-text-heading text-sm leading-snug font-semibold text-pretty"
          :data-test="`autoobserve2-request-headline-${testId}`"
        >
          {{ t(copyKey("headline")) }}
        </h3>
      </div>
      <template v-else>
        <span class="absolute inset-y-0 start-0 w-1" :class="look.accent" aria-hidden="true" />
        <div class="flex items-start gap-3">
          <span
            class="bg-surface-base flex size-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br ring-1"
            :class="look.badge"
            aria-hidden="true"
          >
            <OIcon :name="look.icon" size="sm" />
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="text-text-secondary text-xs font-medium">
              {{ t(LABEL[request.kind]) }}
            </span>
            <h3
              class="text-text-heading text-sm leading-snug font-semibold text-pretty"
              :data-test="`autoobserve2-request-headline-${testId}`"
            >
              {{ t(copyKey("headline")) }}
            </h3>
          </div>
        </div>
        <p class="text-text-secondary text-sm leading-relaxed text-pretty">
          {{ t(copyKey("why")) }}
          <OButton
            v-if="assistantV2"
            variant="ghost-primary"
            size="xs"
            :aria-expanded="expanded"
            :aria-controls="`autoobserve2-request-more-${request.id}`"
            :data-test="`autoobserve2-request-more-${testId}`"
            @click="expanded = !expanded"
          >
            {{ expanded ? t("autoobserve2.needs.less") : t("autoobserve2.needs.more") }}
            <OIcon :name="expanded ? 'expand-less' : 'expand-more'" size="xs" />
          </OButton>
          <button
            v-else
            type="button"
            class="text-accent focus-visible:ring-focus-ring-accent rounded-default inline-flex items-center gap-0.5 font-medium whitespace-nowrap hover:underline focus-visible:ring-2 focus-visible:outline-none"
            :aria-expanded="expanded"
            :aria-controls="`autoobserve2-request-more-${request.id}`"
            :data-test="`autoobserve2-request-more-${testId}`"
            @click="expanded = !expanded"
          >
            {{ expanded ? t("autoobserve2.needs.less") : t("autoobserve2.needs.more") }}
            <OIcon :name="expanded ? 'expand-less' : 'expand-more'" size="xs" />
          </button>
        </p>
        <p
          v-if="expanded"
          :id="`autoobserve2-request-more-${request.id}`"
          class="text-text-body border-border-default border-s-2 ps-3 text-sm leading-relaxed text-pretty"
        >
          {{ say(t, request.body) }}
        </p>
      </template>
      <div class="flex flex-wrap items-center gap-1.5">
        <p
          class="bg-surface-base border-border-subtle rounded-default inline-flex max-w-full flex-wrap items-center gap-x-1.5 border px-2 py-0.5 text-xs leading-5"
          :data-test="`autoobserve2-request-shift-${testId}`"
        >
          <span class="text-text-secondary line-through">{{ t(entryKey("from")) }}</span>
          <OIcon name="arrow-forward" size="xs" class="text-text-muted" aria-hidden="true" />
          <span class="sr-only">{{ t("autoobserve2.needs.shiftTo") }}</span>
          <span class="text-text-heading font-semibold">{{ t(entryKey("to")) }}</span>
          <span class="text-text-secondary">· {{ t(entryKey("on")) }}</span>
        </p>
        <span class="flex flex-wrap gap-1.5">
          <OTag variant="default-soft" size="xs" :label="t(copyKey('cost'))" />
          <OTag
            variant="default-soft"
            size="xs"
            icon="undo"
            :label="t('autoobserve2.needs.canUndo')"
          />
        </span>
      </div>
      <div class="flex items-center gap-2 pt-1" :class="inline ? 'flex-wrap' : ''">
        <OButton
          variant="primary"
          size="sm"
          :class="inline ? '' : 'flex-1'"
          :data-test="`autoobserve2-request-yes-${testId}`"
          @click="onDecide('yes')"
        >
          {{ t(request.yes) }}
        </OButton>
        <OButton
          variant="ghost-muted"
          size="sm"
          class="shrink-0"
          :data-test="`autoobserve2-request-no-${testId}`"
          @click="onDecide('no')"
        >
          {{ t(request.no) }}
        </OButton>
        <AiEntryButton
          v-if="assistantV2"
          verb="ask"
          entry-kind="autoobserve_card"
          object-kind="none"
          thread="new"
          :object-key="request.id"
          :build="buildContinue"
          :label="t('assistant.oncall.continue')"
          :tooltip="t('assistant.autoobserve.continueTooltip', { product })"
          data-test="ai-entry-autoobserve-ask-ask"
        />
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref } from "vue";
import { useStore } from "vuex";
import { isAssistantV2 } from "@/composables/assistant/flags";
import { useAssistantName } from "@/composables/assistant/pure";
import { buildAutoObserveAskPrompt } from "@/utils/assistant/prompts/autoobserve";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { useDecisions, type Decision } from "./useDecisions";
import { say, type Request, type RequestKind } from "./fixtures";
import { KIND_LOOK, type ChangeKind } from "./changes";

const props = defineProps<{ request: Request; inline?: boolean }>();

const { t } = useI18nTyped();
const vuex = useStore();
const assistantV2 = isAssistantV2();
const { product } = useAssistantName();
const AiEntryButton = defineAsyncComponent(
  () => import("@/components/ai-assistant/entry/AiEntryButton.vue"),
);

const LABEL: Record<RequestKind, I18nKey> = {
  fixNow: "autoobserve2.needs.labels.fixNow",
  fromNowOn: "autoobserve2.needs.labels.fromNowOn",
  retune: "autoobserve2.needs.labels.retune",
};

// Each ask wears the look of the change it becomes on the "What I've changed" page.
const CHANGE_KIND: Record<RequestKind, ChangeKind> = {
  fixNow: "fix",
  fromNowOn: "permission",
  retune: "tuning",
};

const { decisions, phases, decide, undo } = useDecisions();

const expanded = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const announcement = ref<I18nText>(raw(""));

const look = computed(() => KIND_LOOK[CHANGE_KIND[props.request.kind]]);

// Fix-now copy is per problem, mirroring how fixtures key each request's body.
const copyKey = (part: string) =>
  (props.request.kind === "fixNow"
    ? `autoobserve2.needs.fixNow.${props.request.problem}.${part}`
    : `autoobserve2.needs.${props.request.kind}.${part}`) as I18nKey;

const entryKey = (part: string) =>
  `autoobserve2.activityPage.entries.${props.request.id}.${part}` as I18nKey;

// Fix-now requests other than search carry their problem, so each ask has a distinct test id.
const testId = computed(() =>
  props.request.problem && props.request.problem !== "search"
    ? `${props.request.kind}-${props.request.problem}`
    : props.request.kind,
);

const doneText = computed(() => {
  const { id, doneSettled, doneYes, doneNo } = props.request;
  const decision = decisions[id];
  if (!decision) return raw("");
  if (assistantV2 && decision === "yes")
    return phases[id] === "fixed"
      ? t("autoobserve2.needs.sampleComplete")
      : t("autoobserve2.needs.sampleApplied", { headline: t(copyKey("headline")) });
  if (decision === "yes" && doneSettled && phases[id] === "fixed") return say(t, doneSettled);
  return say(t, decision === "yes" ? doneYes : doneNo);
});

// The pressed button unmounts with the card, so focus moves to its counterpart instead of falling to the page.
const focusAction = async (action: "undo" | "yes") => {
  await nextTick();
  rootEl.value
    ?.querySelector<HTMLElement>(`[data-test="autoobserve2-request-${action}-${testId.value}"]`)
    ?.focus();
};

const onDecide = (decision: Decision) => {
  decide(props.request.id, decision);
  announcement.value = doneText.value;
  void focusAction("undo");
};

const onUndo = () => {
  undo(props.request.id);
  announcement.value = t("autoobserve2.needs.undone");
  void focusAction("yes");
};

function buildContinue() {
  const prompt = buildAutoObserveAskPrompt({
    org: vuex.state.selectedOrganization?.identifier ?? "",
    id: props.request.id,
    title: t(copyKey("headline")),
    body: [t(copyKey("why")), say(t, props.request.body)].join("\n\n"),
  });
  return { text: prompt.text, chips: prompt.chips, title: prompt.title };
}
</script>
