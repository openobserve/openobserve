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
  <section
    v-if="steps.length"
    ref="root"
    role="group"
    :aria-label="lineText"
    class="flex min-w-0 flex-col gap-1"
    data-test="assistant-queries-group"
  >
    <div class="text-text-secondary flex min-w-0 flex-wrap items-center gap-x-1 text-xs leading-5">
      <OText v-if="hidden" variant="meta" as="p" data-test="assistant-trail-hidden">
        {{ lineText }}
      </OText>
      <OButton
        v-else
        variant="ghost"
        size="chip"
        :aria-expanded="open ? 'true' : 'false'"
        :class="['text-text-secondary -ms-1', TOUCH_TARGET_CLASS]"
        data-test="assistant-queries-line"
        @click="open = !open"
      >
        {{ lineText }}
        <OIcon
          :name="open ? assistantGlyph.collapse : assistantGlyph.expand"
          size="xs"
          class="text-text-secondary"
          aria-hidden="true"
        />
      </OButton>
      <template v-if="widerOffer">
        <span aria-hidden="true">·</span>
        <OButton
          variant="ghost-primary"
          size="chip"
          :disabled="!!blocked"
          :focusable-unavailable="!!blocked"
          :class="TOUCH_TARGET_CLASS"
          data-test="assistant-rerun-wider"
          @click="rerunWider"
        >
          {{ t("assistant.footer.tryWider", { duration: widerDuration }) }}
          <template v-if="blocked" #unavailable-reason>{{ blocked }}</template>
        </OButton>
      </template>
    </div>
    <div
      v-if="unavailable > 0"
      class="text-text-secondary flex min-w-0 flex-wrap items-center gap-x-1 text-xs leading-5"
      data-test="assistant-queries-no-access"
    >
      <span>{{ noAccessLine }}</span>
      <template v-if="!readonly">
        <span aria-hidden="true">·</span>
        <AssistantAskAdminPopover kind="access" :org="turn?.org ?? ''">
          <template #trigger>
            <OButton
              variant="ghost-primary"
              size="chip"
              :class="TOUCH_TARGET_CLASS"
              data-test="assistant-queries-ask-admin"
            >
              {{ t("assistant.evidence.askAdmin") }}
            </OButton>
          </template>
        </AssistantAskAdminPopover>
      </template>
    </div>
    <ul v-if="open && !hidden" class="flex min-w-0 flex-col" data-test="assistant-queries-rows">
      <li v-for="row in rows" :key="row.step.callId" class="min-w-0">
        <OCollapsible
          :model-value="expanded.includes(row.step.callId)"
          :trigger-class="ROW_CLASS"
          :data-test="`assistant-queries-row-${row.step.callId}`"
          @update:model-value="(value: boolean) => toggle(row.step.callId, value)"
        >
          <template #trigger="{ open: rowOpen }">
            <span
              class="flex min-w-0 flex-1 items-center gap-2 text-xs"
              :data-step-header="row.step.callId"
            >
              <span class="text-text-link w-3 shrink-0 text-start font-medium">
                {{ row.step.n }}
              </span>
              <OTruncatedText
                :class="[
                  'min-w-0 text-start',
                  row.mono ? 'font-mono' : '',
                  row.step.state === 'failed' ? 'text-status-error-text' : 'text-text-body',
                ]"
                >{{ row.text }}</OTruncatedText
              >
              <OCode v-if="row.table" class="shrink-0">{{ row.table }}</OCode>
              <span
                v-if="row.count"
                class="text-text-secondary shrink-0"
                :data-test="`assistant-queries-count-${row.step.callId}`"
              >
                {{ row.count }}
              </span>
              <span class="flex-1" />
              <OIcon
                :name="rowOpen ? assistantGlyph.collapse : assistantGlyph.expand"
                size="xs"
                class="text-text-secondary shrink-0"
                aria-hidden="true"
              />
            </span>
          </template>
          <div
            class="flex min-w-0 flex-col gap-1 ps-5 pt-1 pb-2"
            :data-test="`assistant-queries-body-${row.step.callId}`"
          >
            <OText v-if="row.step.error" variant="meta" as="p" class="break-words">
              {{ raw(row.step.error) }}
            </OText>
            <OText v-if="row.step.suggestion" variant="meta" as="p" class="break-words">
              {{ raw(row.step.suggestion) }}
            </OText>
            <AssistantQueryText
              v-if="row.step.query"
              :text="row.step.query.text"
              :language="row.step.query.language"
              :label="row.text"
              :data-test="`assistant-queries-sql-${row.step.callId}`"
            />
            <div
              v-if="row.step.query"
              class="text-text-secondary flex min-w-0 flex-wrap items-center gap-x-2 text-xs"
            >
              <OButton
                v-if="canOpen(row.step)"
                variant="ghost-primary"
                size="chip"
                as="a"
                :href="hrefOf(row.step)"
                target="_blank"
                rel="noopener noreferrer"
                :icon-left="assistantGlyph.newTab"
                :class="TOUCH_TARGET_CLASS"
                :data-test="`assistant-queries-open-${row.step.callId}`"
                @click="trackOpen"
              >
                {{ t("assistant.query.open", { explorer: explorerName(row.step) }) }}
              </OButton>
              <span v-if="row.step.range">{{ rangeText(row.step.range) }}</span>
            </div>
          </div>
        </OCollapsible>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, inject, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import { widerPeriodText } from "@/composables/assistant";
import {
  answerQueriesAllEmpty,
  assistantEvidenceHostKey,
  isTerminal,
  queryCount,
  stepsOf,
  turnAnnotationKey,
  turnLockKey,
  useTurnLock,
  windowsOf,
  type AssistantTurnView,
  type StepFacts,
} from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { explorerOf, explorerTarget } from "@/utils/assistant/explorerRoutes";
import { formatCount } from "@/utils/formatters";

import AssistantQueryText from "./AssistantQueryText.vue";
import { clockRangeText, explorerLabel, queryFragments, rangeText, stepLine } from "./evidenceText";
import { OPEN_STEP_EVENT } from "./revealStep";

const ROW_CLASS = "min-h-7 w-full px-0 py-0 hover:bg-surface-subtle max-md:min-h-11";

// The request flow reads the org's members, so it loads only when the line offers Ask an admin.
const AssistantAskAdminPopover = defineAsyncComponent(
  () => import("@/components/ai-assistant/gate/AssistantAskAdminPopover.vue"),
);

const props = withDefaults(
  defineProps<{
    message: ChatMessage;
    readonly?: boolean;
    turn?: AssistantTurnView | null;
    /** Citations the reader may not open; the line says why. */
    unavailable?: number;
  }>(),
  { readonly: false, turn: null, unavailable: 0 },
);

const { t } = useI18nTyped();
const router = useRouter();
const evidence = props.readonly ? null : inject(assistantEvidenceHostKey, null);
const root = ref<HTMLElement | null>(null);
const open = ref(false);
const expanded = ref<string[]>([]);

const hidden = computed(() => props.turn?.hiddenByOwner === true);
const steps = computed(() => stepsOf(props.message, props.turn?.org ?? ""));
const queries = computed(() => queryCount(steps.value));

const lineText = computed<I18nText>(() => {
  const count = steps.value.length;
  if (hidden.value) return t("assistant.steps.hiddenByOwner", { count }, count);
  if (!queries.value) return t("assistant.steps.summary", { count }, count);
  const windows = windowsOf(steps.value);
  if (!windows.length)
    return t("assistant.footer.queries", { count: queries.value }, queries.value);
  const range = clockRangeText({
    from: Math.min(...windows.map((window) => window.from)),
    to: Math.max(...windows.map((window) => window.to)),
  });
  return t("assistant.evidence.line", { count: queries.value, range }, queries.value);
});

const chatStream = computed(() => {
  const seen = new Map<string, number>();
  for (const step of steps.value)
    if (step.query?.stream) seen.set(step.query.stream, (seen.get(step.query.stream) ?? 0) + 1);
  return [...seen].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
});

const fragments = computed(() => {
  const sql = steps.value.filter((step) => step.query?.language === "sql");
  const parts = queryFragments(sql.map((step) => step.query!.text));
  return new Map(sql.map((step, index) => [step.callId, parts[index]]));
});

const rows = computed(() =>
  steps.value.map((step) => {
    const stream = step.query?.stream;
    return {
      step,
      mono: !!step.query,
      text: step.query
        ? raw(fragments.value.get(step.callId) ?? step.query.text)
        : stepLine(step, t),
      table: stream && stream !== chatStream.value ? raw(stream) : null,
      count:
        step.query && step.rows !== null
          ? t("assistant.steps.rows", { count: formatCount(step.rows) }, step.rows)
          : null,
    };
  }),
);

const lock = useTurnLock(() => props.turn?.sid ?? null);
const blocked = computed<I18nText | null>(() => {
  if (lock.value) return t(turnLockKey(lock.value));
  return evidence?.capability().creditMode === "exhausted"
    ? t("assistant.message.creditsUsedUp")
    : null;
});

// Only the click sends; the default range is never widened by itself (PO A26).
const widerOffer = computed(() => {
  const turn = props.turn;
  if (!evidence || props.readonly || !turn?.sid || !turn.isLast || turn.outcome !== "done")
    return false;
  const session = evidence.session(turn.sid);
  const idle = !session?.turn || session.turn.state === "idle" || isTerminal(session.turn);
  const sent = session?.annotations[turnAnnotationKey(turn.turnId, "window")];
  return !!sent?.homeDefaultWindow && idle && answerQueriesAllEmpty(props.message, turn.org);
});
const widerDuration = computed(() => widerPeriodText());

const noAccessLine = computed<I18nText>(() => {
  const n = props.unavailable;
  const stream = chatStream.value;
  return stream
    ? t("assistant.evidence.noAccess", { n, stream: raw(stream) }, n)
    : t("assistant.evidence.noAccessPlain", { n }, n);
});

function toggle(callId: string, value: boolean): void {
  expanded.value = value
    ? [...expanded.value, callId]
    : expanded.value.filter((id) => id !== callId);
}

function canOpen(step: StepFacts): boolean {
  const language = step.query?.language;
  const own = evidence?.currentOrg();
  return (
    props.turn?.openable !== false &&
    (language === "sql" || language === "promql") &&
    (!own || !step.query?.org || own === step.query.org)
  );
}

function hrefOf(step: StepFacts): string | undefined {
  if (!step.query || !router) return undefined;
  return router.resolve(explorerTarget(step.query, explorerOf(step.query), String(Date.now())))
    .href;
}

function explorerName(step: StepFacts): I18nText {
  return explorerLabel(step.query ? explorerOf(step.query) : "logs", t);
}

function trackOpen(): void {
  trackAssistant("ai_evidence_action", { action: "open_explorer", block_kind: "query" });
}

function rerunWider(): void {
  const sid = props.turn?.sid;
  if (!sid || !evidence || blocked.value || !props.turn) return;
  void evidence.dispatch(sid, { kind: "rerun_wider", turnId: props.turn.turnId });
}

// A citation opens the line so its row exists; the row itself stays closed until the reader opens it.
function onOpenStep(event: Event): void {
  const callId = (event as CustomEvent<{ callId?: string }>).detail?.callId;
  if (callId && steps.value.some((step) => step.callId === callId)) open.value = true;
}

watch(root, (el, _old, onCleanup) => {
  const article = el?.closest("article");
  if (!article) return;
  article.addEventListener(OPEN_STEP_EVENT, onOpenStep);
  onCleanup(() => article.removeEventListener(OPEN_STEP_EVENT, onOpenStep));
});
</script>
