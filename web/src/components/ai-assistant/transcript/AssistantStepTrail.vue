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
    v-if="steps.length"
    ref="root"
    class="flex min-w-0 flex-col gap-0.5"
    data-test="assistant-steps"
  >
    <OText v-if="hidden" variant="meta" as="p" class="leading-5" data-test="assistant-trail-hidden">
      {{ header }}
    </OText>
    <OButton
      v-else
      variant="ghost"
      size="sm"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="shown.length ? listId : undefined"
      :class="['max-w-full justify-start self-start', TOUCH_TARGET_CLASS]"
      data-test="assistant-trail-toggle"
      @click="toggleTrail"
    >
      <OIcon
        :name="open ? assistantGlyph.collapse : assistantGlyph.expand"
        size="sm"
        aria-hidden="true"
      />
      <OTruncatedText class="text-text-secondary min-w-0 text-xs">{{ header }}</OTruncatedText>
    </OButton>
    <ul v-if="!hidden && shown.length" :id="listId" class="flex min-w-0 flex-col gap-0.5 ps-2">
      <li v-for="step in shown" :key="step.callId" class="flex min-w-0 flex-col">
        <OButton
          variant="ghost"
          size="sm"
          :aria-expanded="isExpanded(step) ? 'true' : 'false'"
          :aria-label="stepName(step, t)"
          :class="['rounded-default w-full min-w-0 justify-start', TOUCH_TARGET_CLASS]"
          :data-test="`assistant-step-${step.callId}`"
          :data-step-header="step.callId"
          @click="toggleStep(step)"
        >
          <span
            :class="['flex shrink-0 items-center', glyphTone(step)]"
            :data-state="step.state"
            :data-test="`assistant-step-state-${step.callId}`"
            aria-hidden="true"
          >
            <template v-if="step.state === 'running'">
              <OSpinner variant="ring" size="xs" class="motion-reduce:hidden" />
              <OIcon :name="assistantGlyph.working" size="sm" class="motion-safe:hidden" />
            </template>
            <OIcon v-else :name="glyphOf(step)" size="sm" />
          </span>
          <OTruncatedText
            :class="[
              'min-w-0 flex-1 text-start text-xs',
              step.state === 'failed' ? 'text-status-error-text' : 'text-text-body',
            ]"
            >{{ stepLine(step, t) }}</OTruncatedText
          >
        </OButton>
        <div
          v-if="isExpanded(step)"
          class="flex min-w-0 flex-col gap-2 ps-7 pe-1 pt-1 pb-2"
          :data-test="`assistant-step-body-${step.callId}`"
        >
          <template v-if="step.state === 'failed'">
            <OText v-if="step.error" variant="body" as="p" class="text-xs break-words">
              {{ raw(step.error) }}
            </OText>
            <OText v-if="step.suggestion" variant="meta" as="p" class="break-words">
              {{ raw(step.suggestion) }}
            </OText>
          </template>
          <template v-if="step.query">
            <AssistantQueryText
              :text="step.query.text"
              :language="step.query.language"
              :label="stepLine(step, t)"
              :data-test="`assistant-step-query-${step.callId}`"
            />
            <OText variant="meta" as="p" class="leading-5">
              {{ windowLine(step) }}
            </OText>
          </template>
          <AssistantResultTable
            v-if="step.result?.hits?.length"
            :rows="step.result.hits.slice(0, MAX_HIT_ROWS)"
            :label="t('assistant.evidence.resultsOf', { name: stepLine(step, t) })"
            :data-test="`assistant-step-hits-${step.callId}`"
          />
          <div
            v-if="step.kind === 'cli' && step.result?.stdout"
            class="flex min-w-0 flex-col gap-1"
          >
            <OCodeBlock
              :code="step.result.stdout"
              lang="plaintext"
              chrome="terminal"
              :highlight="false"
              :copyable="false"
              :scroll-label="stepLine(step, t)"
              :data-test="`assistant-step-output-${step.callId}`"
            />
            <OTag
              v-if="step.result.truncated"
              variant="default-soft"
              size="sm"
              :label="t('assistant.steps.outputTruncated')"
              class="self-start"
            />
          </div>
          <div v-if="step.query" class="flex flex-wrap items-center gap-2">
            <OButton
              v-if="openable"
              variant="secondary"
              size="sm"
              as="a"
              :href="hrefOf(step)"
              :target="opensElsewhere ? '_blank' : undefined"
              :rel="opensElsewhere ? 'noopener noreferrer' : undefined"
              :icon-right="opensElsewhere ? assistantGlyph.newTab : undefined"
              :class="TOUCH_TARGET_CLASS"
              :data-test="`assistant-step-open-${step.callId}`"
              @click="openStep(step, $event)"
            >
              {{
                t("assistant.query.open", { explorer: explorerLabel(explorerOf(step.query), t) })
              }}
            </OButton>
            <OButton
              variant="ghost"
              size="sm"
              :icon-left="assistantGlyph.copy"
              :class="TOUCH_TARGET_CLASS"
              :data-test="`assistant-step-copy-${step.callId}`"
              @click="copyStep(step)"
            >
              {{ t("assistant.query.copy") }}
            </OButton>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import AssistantQueryText from "@/components/ai-assistant/evidence/AssistantQueryText.vue";
import AssistantResultTable from "@/components/ai-assistant/evidence/AssistantResultTable.vue";
import { explorerLabel, stepLine, stepName } from "@/components/ai-assistant/evidence/evidenceText";
import { OPEN_STEP_EVENT } from "@/components/ai-assistant/evidence/revealStep";
import {
  MAX_HIT_ROWS,
  assistantEvidenceHostKey,
  footerOf,
  stepsOf,
  type AssistantTurnView,
  type StepFacts,
} from "@/composables/assistant/pure";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { explorerOf, explorerTarget } from "@/utils/assistant/explorerRoutes";
import { copyToClipboard } from "@/utils/clipboard";
import { formatCount, formatElapsed, formatOrgTime } from "@/utils/formatters";

const props = withDefaults(
  defineProps<{
    block?: ContentBlock;
    blockId?: string;
    message: ChatMessage;
    readonly?: boolean;
    density?: "compact" | "roomy";
    turn?: AssistantTurnView | null;
  }>(),
  { block: undefined, blockId: "", readonly: false, density: "compact", turn: null },
);

const { t } = useI18nTyped();
const host = props.readonly ? null : inject(assistantEvidenceHostKey, null);
const router = useRouter();

// Without a live session (a shared page) the expansion is the reader's own and never stored.
const localExpanded = ref<string[]>([]);
const root = ref<HTMLElement | null>(null);

const sid = computed(() => props.turn?.sid ?? null);
const live = computed(() => props.turn?.outcome === "live");
const hidden = computed(() => props.turn?.hiddenByOwner === true);
const steps = computed(() => stepsOf(props.message, props.turn?.org ?? ""));
const trailKey = computed(() => `trail:${props.turn?.turnId ?? props.blockId}`);
const closedKey = computed(() => `${trailKey.value}:closed`);
const listId = computed(
  () => `assistant-trail-${(props.turn?.turnId ?? props.blockId).replace(/\W/g, "")}`,
);

const expanded = computed<string[]>(() => {
  const session = sid.value && host ? host.session(sid.value) : null;
  return session ? session.ui.expandedSteps : localExpanded.value;
});

// A running trail is open until the reader closes it; a finished one opens on its toggle or a claim.
const open = computed(() =>
  live.value
    ? !expanded.value.includes(closedKey.value)
    : expanded.value.includes(trailKey.value) ||
      steps.value.some((step) => expanded.value.includes(step.callId)),
);

const exceptions = computed(() =>
  steps.value.filter((step) => step.state === "failed" || step.state === "interrupted"),
);

// The exceptions stay listed when collapsed, so colour is spent on the problem only.
const shown = computed(() => (open.value ? steps.value : exceptions.value));

const openable = computed(() => props.turn?.openable !== false);
const opensElsewhere = computed(() => !sid.value || !host || host.prefersNewTab());

const duration = computed(() => {
  const footer = footerOf(props.message);
  if (footer?.durationMs !== undefined) return footer.durationMs;
  if (live.value && props.turn?.startedAt) return Date.now() - props.turn.startedAt;
  return null;
});

const header = computed<I18nText>(() => {
  const count = steps.value.length;
  if (hidden.value) return t("assistant.steps.hiddenByOwner", { count }, count);
  const failed = steps.value.filter((step) => step.state === "failed").length;
  if (live.value) return t("assistant.steps.soFar", { count }, count);
  const detail = failed
    ? t("assistant.steps.failedCount", { count: failed }, failed)
    : duration.value !== null
      ? raw(formatElapsed(duration.value))
      : null;
  return detail
    ? t("assistant.steps.summaryWith", { count, detail }, count)
    : t("assistant.steps.summary", { count }, count);
});

function isExpanded(step: StepFacts): boolean {
  return !hidden.value && expanded.value.includes(step.callId);
}

function toggle(key: string): void {
  if (sid.value && host) return host.toggleStep(sid.value, key);
  localExpanded.value = localExpanded.value.includes(key)
    ? localExpanded.value.filter((id) => id !== key)
    : [...localExpanded.value, key];
}

function toggleTrail(): void {
  if (live.value) return toggle(closedKey.value);
  if (!open.value) return toggle(trailKey.value);
  // Collapsing closes the trail and every step a claim opened in it.
  for (const key of [trailKey.value, ...steps.value.map((step) => step.callId)])
    if (expanded.value.includes(key)) toggle(key);
}

function toggleStep(step: StepFacts): void {
  const opening = !isExpanded(step);
  toggle(step.callId);
  if (opening) trackAssistant("ai_evidence_action", { action: "expand_step", block_kind: "trail" });
}

function windowLine(step: StepFacts): I18nText {
  if (!step.range) return t("assistant.evidence.rangeUnknown");
  const from = raw(formatOrgTime(step.range.from, { showZone: true }));
  const to = raw(formatOrgTime(step.range.to, { showZone: true }));
  const total = step.result?.total ?? step.rows;
  const shownRows = Math.min(step.result?.hits?.length ?? 0, MAX_HIT_ROWS);
  if (!total || !shownRows) return t("assistant.steps.window", { from, to });
  return t("assistant.steps.windowShowing", {
    from,
    to,
    shown: formatCount(shownRows),
    total: formatCount(total),
  });
}

function hrefOf(step: StepFacts): string | undefined {
  if (!step.query || !router) return undefined;
  return router.resolve(explorerTarget(step.query, explorerOf(step.query), String(Date.now())))
    .href;
}

// A shared page follows the link itself in a new tab; a live chat opens through the applier.
async function openStep(step: StepFacts, event: MouseEvent): Promise<void> {
  if (!step.query) return;
  trackAssistant("ai_evidence_action", { action: "open_step_logs", block_kind: "trail" });
  if (!sid.value || !host) return;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1) return;
  event.preventDefault();
  const result = await host.dispatch(sid.value, {
    kind: "open_in_explorer",
    query: step.query,
    explorer: explorerOf(step.query),
  });
  if (!result.ok && result.reason === "other_org")
    host.announce(sid.value, t("assistant.evidence.otherOrg", { org: raw(step.query.org) }));
}

async function copyStep(step: StepFacts): Promise<void> {
  if (!step.query) return;
  trackAssistant("ai_evidence_action", { action: "copy_step_query", block_kind: "trail" });
  if (!sid.value || !host) {
    await copyToClipboard(step.query.text, t, { successMessage: t("assistant.evidence.copied") });
    return;
  }
  const result = await host.dispatch(sid.value, {
    kind: "copy",
    text: step.query.text,
    what: "query",
  });
  host.announce(
    sid.value,
    result.ok ? t("assistant.evidence.copied") : t("assistant.client.copyManually"),
  );
}

function onOpenStep(event: Event): void {
  const callId = (event as CustomEvent<{ callId?: string }>).detail?.callId;
  // A live trail is expanded by the store's `open_step`; only a shared page expands here.
  if (!callId || (sid.value && host) || localExpanded.value.includes(callId)) return;
  if (steps.value.some((step) => step.callId === callId)) toggle(callId);
}

function glyphOf(step: StepFacts) {
  if (step.state === "failed") return assistantGlyph.failed;
  if (step.state === "interrupted") return assistantGlyph.interrupted;
  return assistantGlyph.done;
}

function glyphTone(step: StepFacts): string {
  if (step.state === "failed") return "text-status-error-text";
  return "text-text-secondary";
}

watch(root, (el, _old, onCleanup) => {
  const article = el?.closest("article");
  if (!article) return;
  article.addEventListener(OPEN_STEP_EVENT, onOpenStep);
  onCleanup(() => article.removeEventListener(OPEN_STEP_EVENT, onOpenStep));
});
</script>
