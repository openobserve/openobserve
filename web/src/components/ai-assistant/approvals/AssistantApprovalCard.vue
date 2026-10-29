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
  <div ref="root" class="flex min-w-0 flex-col gap-2">
    <AssistantPlanBlock
      v-if="planned"
      ref="plan"
      v-model:selected="selected"
      :card="card"
      :editable="card.editable"
      :disabled="sending"
      :org="org"
    />
    <section
      role="group"
      :aria-labelledby="headingId"
      :aria-describedby="describedBy"
      :aria-busy="sending ? 'true' : undefined"
      class="rounded-surface bg-surface-base border-border-default flex min-w-0 flex-col gap-2 border p-3"
      :data-kind="card.kind"
      data-test="assistant-approval-card"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <OTag
          variant="default-soft"
          size="xs"
          :label="t('assistant.approval.needsOk')"
          data-test="assistant-approval-needs-ok"
        />
        <h3
          :id="headingId"
          class="text-text-heading min-w-0 text-sm leading-5 font-semibold break-words"
          data-test="assistant-approval-heading"
        >
          {{ heading }}
        </h3>
        <!-- Kept out of the heading's accessible name, which a screen reader would re-read every second -->
        <OText
          v-if="remainingMs !== null && !sending"
          variant="meta"
          as="span"
          aria-hidden="true"
          class="tabular-nums"
          data-test="assistant-approval-countdown"
        >
          {{ t("assistant.approval.expiresIn", { time: clockText }) }}
        </OText>
      </div>
      <OText v-if="card.askedIn === 'other_tab'" variant="meta" as="p">
        {{ t("assistant.approval.askedElsewhere") }}
      </OText>
      <OText
        v-if="metaLine"
        :id="metaId"
        variant="meta"
        as="p"
        class="break-words"
        data-test="assistant-approval-meta"
      >
        {{ metaLine }}
      </OText>

      <p
        v-if="card.question"
        :id="questionId"
        class="text-text-body text-sm break-words whitespace-pre-wrap"
        data-test="assistant-approval-question"
      >
        {{ card.question }}
      </p>
      <div v-if="card.command" class="flex min-w-0 flex-col gap-1">
        <OText variant="label" as="p">{{ t("assistant.approval.command") }}</OText>
        <code
          :id="commandId"
          class="rounded-default bg-surface-subtle text-text-body block p-2 font-mono text-xs break-all whitespace-pre-wrap"
          data-test="assistant-approval-command"
          >{{ card.command }}</code
        >
      </div>

      <div v-if="targets.length && !planned" :id="targetsId" data-test="assistant-approval-targets">
        <ul class="flex min-w-0 flex-col gap-0.5">
          <li
            v-for="target in firstTargets"
            :key="target.key"
            class="flex min-w-0 items-center gap-2"
          >
            <OText as="span" class="min-w-0 flex-1 break-all">{{ target.label }}</OText>
            <OButton
              v-if="target.href"
              variant="ghost-primary"
              size="xs"
              as="a"
              :href="target.href"
              target="_blank"
              rel="noopener noreferrer"
              :icon-right="assistantGlyph.newTab"
              :aria-label="t('assistant.approval.result.open', { name: target.label })"
              :class="['shrink-0', TOUCH_TARGET_CLASS]"
              :data-test="`assistant-approval-target-${target.key}`"
            >
              {{ t("assistant.approval.open") }}
            </OButton>
          </li>
        </ul>
        <OCollapsible
          v-if="moreTargets.length"
          :label="t('assistant.approval.moreTargets', { count: moreTargets.length })"
          :trigger-class="TOUCH_TARGET_CLASS"
          data-test="assistant-approval-more-targets"
        >
          <ul class="flex min-w-0 flex-col gap-0.5">
            <li v-for="target in moreTargets" :key="target.key" class="min-w-0 break-all">
              <OText as="span">{{ target.label }}</OText>
            </li>
          </ul>
        </OCollapsible>
      </div>

      <div
        v-if="diff"
        :id="diffId"
        class="flex min-w-0 flex-col gap-1"
        data-test="assistant-approval-diff"
      >
        <OText variant="label" as="p">
          {{
            card.kind === "create"
              ? t("assistant.approval.newValues")
              : t("assistant.approval.change")
          }}
        </OText>
        <dl class="grid min-w-0 grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-0.5">
          <template v-for="row in diff" :key="row.field">
            <dt class="text-text-secondary text-xs break-all">{{ row.field }}</dt>
            <dd class="text-text-body text-xs break-all">{{ row.value }}</dd>
          </template>
        </dl>
      </div>

      <div v-if="impact.length" :id="impactId" class="flex min-w-0 flex-col gap-1">
        <OText variant="label" as="p">{{ t("assistant.approval.effect") }}</OText>
        <ul
          class="text-text-body flex min-w-0 list-disc flex-col gap-0.5 ps-5 text-sm"
          data-test="assistant-approval-impact"
        >
          <li v-for="(line, index) in impact" :key="index" class="break-words">{{ line }}</li>
        </ul>
      </div>

      <p
        v-if="remainingMs !== null && !sending"
        :id="expiryId"
        aria-live="off"
        class="sr-only"
        data-test="assistant-approval-expiry"
      >
        {{ t("assistant.approval.expiresIn", { time: clockText }) }}
      </p>

      <OSelect
        v-if="scopeOptions.length"
        v-model="scope"
        :options="scopeOptions"
        :label="t('assistant.approval.scope.label')"
        :disabled="sending"
        size="sm"
        data-test="assistant-approval-scope"
      />

      <!-- The buttons stay while the decision is on its way, so focus stays where it was -->
      <div class="flex min-w-0 flex-col gap-2">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <OButton
            v-if="mdUp"
            ref="denyButton"
            variant="secondary"
            size="sm"
            :disabled="sending"
            focusable-unavailable
            :class="TOUCH_TARGET_CLASS"
            data-test="assistant-approval-deny"
            @click="(event: MouseEvent) => act(event, () => deny('deny'))"
          >
            {{ t("assistant.approval.deny") }}
          </OButton>
          <OButton
            variant="ghost"
            size="sm"
            :disabled="sending"
            focusable-unavailable
            :aria-describedby="replyId"
            :class="TOUCH_TARGET_CLASS"
            data-test="assistant-approval-reply"
            @click="(event: MouseEvent) => act(event, () => emit('reply'))"
          >
            {{ t("assistant.approval.reply") }}
          </OButton>
          <OButton
            v-if="planned && card.editable"
            variant="ghost"
            size="sm"
            :disabled="sending"
            focusable-unavailable
            :class="TOUCH_TARGET_CLASS"
            data-test="assistant-approval-edit"
            @click="(event: MouseEvent) => act(event, edit)"
          >
            {{ t("assistant.approval.edit") }}
          </OButton>
          <OButton
            v-if="editor"
            variant="ghost"
            size="sm"
            :disabled="sending"
            focusable-unavailable
            :class="TOUCH_TARGET_CLASS"
            data-test="assistant-approval-edit-in-editor"
            @click="(event: MouseEvent) => act(event, editInEditor)"
          >
            {{ t("assistant.approval.editInEditor", { editor: editorLabel }) }}
          </OButton>
          <OButton
            v-if="moreTime"
            variant="ghost"
            size="sm"
            :disabled="sending"
            focusable-unavailable
            :class="TOUCH_TARGET_CLASS"
            data-test="assistant-approval-extend"
            @click="(event: MouseEvent) => act(event, () => emit('extend'))"
          >
            {{ t("assistant.approval.moreTime") }}
          </OButton>
          <OButton
            v-if="mdUp"
            :variant="card.destructive ? 'destructive' : 'primary'"
            size="sm"
            :disabled="sending || nothingSelected"
            focusable-unavailable
            :class="TOUCH_TARGET_CLASS"
            data-test="assistant-approval-approve"
            @click="(event: MouseEvent) => act(event, approve)"
          >
            {{ approveLabel }}
            <template v-if="nothingSelected && !sending" #unavailable-reason>
              {{ t("assistant.approval.nothingSelected") }}
            </template>
          </OButton>
        </div>
        <div v-if="!mdUp" class="flex min-w-0 gap-2">
          <OButton
            ref="denyButton"
            variant="secondary"
            size="sm"
            :disabled="sending"
            focusable-unavailable
            class="min-h-11 flex-1"
            data-test="assistant-approval-deny"
            @click="(event: MouseEvent) => act(event, () => deny('deny'))"
          >
            {{ t("assistant.approval.deny") }}
          </OButton>
          <OButton
            :variant="card.destructive ? 'destructive' : 'primary'"
            size="sm"
            :disabled="sending || nothingSelected"
            focusable-unavailable
            class="min-h-11 flex-1"
            data-test="assistant-approval-approve"
            @click="(event: MouseEvent) => act(event, approve)"
          >
            {{ approveLabel }}
            <template v-if="nothingSelected && !sending" #unavailable-reason>
              {{ t("assistant.approval.nothingSelected") }}
            </template>
          </OButton>
        </div>
        <OText :id="replyId" variant="meta" as="p" data-test="assistant-approval-reply-consequence">
          {{ t("assistant.approval.replyConsequence") }}
        </OText>
        <div
          v-if="sending"
          class="text-text-secondary flex items-center gap-2 text-sm"
          data-test="assistant-approval-sending"
        >
          <OSpinner size="xs" />
          <span>{{ t("assistant.approval.result.sending") }}</span>
        </div>
        <template v-else>
          <OText
            v-if="nothingSelected"
            variant="meta"
            as="p"
            data-test="assistant-approval-nothing"
          >
            {{ t("assistant.approval.nothingSelected") }}
          </OText>
          <OText v-if="narrowedNote" variant="meta" as="p" data-test="assistant-approval-narrowed">
            {{ narrowedNote }}
          </OText>
          <OText v-if="mdUp" variant="meta" as="p">{{ t("assistant.approval.escapeHint") }}</OText>
        </template>
      </div>

      <OCollapsible
        v-if="card.args"
        :label="t('assistant.approval.details')"
        :trigger-class="TOUCH_TARGET_CLASS"
        data-test="assistant-approval-details"
      >
        <div class="flex min-w-0 flex-col gap-2">
          <OText variant="label" as="p">
            {{ t("assistant.approval.arguments") }} · {{ card.tool }}
          </OText>
          <OCodeBlock
            :code="argsText"
            lang="json"
            contrast="aa"
            :scroll-label="t('assistant.approval.arguments')"
            :copy-message="t('assistant.evidence.copied')"
            :copy-button-class="TOUCH_TARGET_CLASS"
            data-test="assistant-approval-args"
          />
        </div>
      </OCollapsible>
    </section>
  </div>
</template>

<script lang="ts">
function valueText(value: unknown): string {
  if (value === undefined) return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { useRouter } from "vue-router";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  registerAssistantFocusTarget,
  assistantKeydownAt,
  registerEscapeRung,
  useAssistantIdleFocus,
  type ApprovalDecision,
  type ApprovalScope,
} from "@/composables/assistant";
import {
  approvalClock,
  approvalDiff,
  approvalEditor,
  approvalEntity,
  approvalHeading,
  approvalName,
  approvalNoun,
  approvalObjectId,
  approvalTargetHref,
  approvalVerb,
  approvalVerbText,
  canAlwaysAllow,
  isApprovalChange,
} from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import AssistantPlanBlock from "./AssistantPlanBlock.vue";
import type { ApprovalCardDecision, ApprovalCardView } from "./approvals.types";

/** The first targets listed; the rest sit behind "and N more". */
const FIRST_TARGETS = 5;

/** An id the name could not be resolved for is shown this short (D3-n). */
const SHORT_ID_CHARS = 8;

/** A card this long gets one spoken warning at a minute left (WCAG 2.2.1). */
const LONG_CARD_MS = 120_000;

const WARN_AT_MS = 60_000;

/** Past this many items the impact says it is a large batch, without blocking it. */
const LARGE_BATCH = 20;

/** A key pressed this close before the card mounted may land its keyup on the card; that one activation is ignored. */
const CARRIED_KEY_MS = 1_000;

const props = withDefaults(
  defineProps<{
    card: ApprovalCardView;
    org?: string;
    /** The decision is on its way: the buttons stay, unavailable, beside "Sending your decision…". */
    sending?: boolean;
    /** The server lets the card ask for more time. */
    extendable?: boolean;
    /** The org's display name; shown only when the user can switch between orgs. */
    orgName?: string;
    multiOrg?: boolean;
  }>(),
  { org: "", sending: false, extendable: false, orgName: "", multiOrg: false },
);

const emit = defineEmits<{
  (e: "decide", value: ApprovalCardDecision): void;
  (e: "reply"): void;
  (e: "extend"): void;
  /** One line for the turn region: the card says it is waiting, and where it is. */
  (e: "announce", text: I18nText): void;
}>();

const { t } = useI18nTyped();
const router = useRouter();
const { mdUp } = useBreakpoint();
const idle = useAssistantIdleFocus();
const uid = useId();
const headingId = `assistant-approval-heading-${uid}`;
const questionId = `assistant-approval-question-${uid}`;
const commandId = `assistant-approval-command-${uid}`;
const targetsId = `assistant-approval-targets-${uid}`;
const impactId = `assistant-approval-impact-${uid}`;
const expiryId = `assistant-approval-expiry-${uid}`;
const metaId = `assistant-approval-meta-${uid}`;
const diffId = `assistant-approval-diff-${uid}`;
const replyId = `assistant-approval-reply-consequence-${uid}`;

const root = ref<HTMLElement | null>(null);
const denyButton = ref<{ $el: HTMLElement } | null>(null);
const plan = ref<{ $el: HTMLElement } | null>(null);
const now = ref(Date.now());
const scope = ref<ApprovalScope>("once");
const selected = ref<string[]>(props.card.targets.map((target) => target.id ?? target.name));
// Activations carried over from a key pressed before the card existed never decide it.
const mountedAt = ref(Number.POSITIVE_INFINITY);
let keydownAt = Number.NEGATIVE_INFINITY;
let carriedKey = false;
let warned = false;
let unmounted = false;
const initialMs = typeof props.card.expiresAt === "number" ? props.card.expiresAt - Date.now() : 0;
let timer: ReturnType<typeof setInterval> | null = null;
const offs: (() => void)[] = [];

const total = computed(() => props.card.total ?? props.card.targets.length);
const planned = computed(
  () => props.card.kind === "delete" && total.value > 1 && props.card.targets.length > 0,
);
const count = computed(() =>
  planned.value && props.card.editable ? selected.value.length : total.value,
);
const heading = computed(() => approvalHeading(t, props.card, count.value));
const nothingSelected = computed(() => planned.value && count.value === 0);

const remainingMs = computed(() =>
  typeof props.card.expiresAt === "number" ? Math.max(0, props.card.expiresAt - now.value) : null,
);
const clockText = computed(() => raw(approvalClock(remainingMs.value ?? 0)));
// From mount, so the reader never has to race the countdown for it (PO A11, A23).
const moreTime = computed(
  () => props.extendable && remainingMs.value !== null && remainingMs.value > 0,
);

const targets = computed(() =>
  props.card.targets.map((target) => ({
    key: target.id ?? target.name,
    label: raw(target.name),
    href: target.id ? approvalTargetHref(router, props.org, target) : null,
  })),
);
const firstTargets = computed(() => targets.value.slice(0, FIRST_TARGETS));
const moreTargets = computed(() => targets.value.slice(FIRST_TARGETS));

const entity = computed(() => approvalEntity(props.card));

const impact = computed(() => {
  const lines = (props.card.impact ?? []).map((line) => raw(line));
  if (planned.value && total.value > LARGE_BATCH)
    lines.push(
      t("assistant.plan.largeBatch", {
        count: total.value,
        entity: t(`assistant.entity.${entity.value}`, total.value),
      }),
    );
  return props.card.destructive && !props.card.impact?.length
    ? [...lines, t("assistant.approval.cannotUndo")]
    : lines;
});

const diff = computed(() => {
  const changed = approvalDiff(props.card);
  if (!changed) return null;
  const unknown = t("assistant.approval.currentUnknown");
  return changed.rows.map((row) => {
    const after = valueText(row.after);
    if (props.card.kind === "create") return { field: raw(row.field), value: raw(after) };
    const before = "before" in row ? valueText(row.before) : changed.oneSided ? unknown : "—";
    return { field: raw(row.field), value: raw(`${before} → ${after}`) };
  });
});

// The name could not be resolved, so the id is said once here and never in the heading (D3-n).
const nameUnknown = computed<I18nText | null>(() => {
  if (!isApprovalChange(props.card) || approvalName(props.card)) return null;
  const id = approvalObjectId(props.card);
  if (!id) return null;
  const shortId = id.length > SHORT_ID_CHARS ? `${id.slice(0, SHORT_ID_CHARS)}…` : id;
  return t("assistant.approval.nameUnknown", {
    entity: t(`assistant.entity.${approvalNoun(props.card)}`, 1),
    shortId: raw(shortId),
  });
});

const metaLine = computed<I18nText | null>(() => {
  const inOrg =
    props.multiOrg && props.orgName
      ? t("assistant.approval.inOrg", { org: raw(props.orgName) })
      : null;
  if (nameUnknown.value && inOrg)
    return t("assistant.turn.withElapsed", { status: nameUnknown.value, elapsed: inOrg });
  return nameUnknown.value ?? inOrg;
});

const editor = computed(() => (planned.value ? null : approvalEditor(props.card, props.org)));
const editorLabel = computed(() =>
  editor.value ? t(`assistant.approval.editor.${editor.value.type}`) : raw(""),
);

// A single change has nothing to scope: "always" would grant a write the reader saw once (D3-p).
const scopeOptions = computed(() =>
  canAlwaysAllow(props.card) && (!isApprovalChange(props.card) || props.card.targets.length > 1)
    ? [
        { label: t("assistant.approval.scope.once"), value: "once" },
        { label: t("assistant.approval.scope.chat"), value: "chat" },
        {
          label: t("assistant.approval.scope.tool", { tool: raw(props.card.tool) }),
          value: "tool",
        },
      ]
    : [],
);

const approveLabel = computed(() => {
  const verb = approvalVerb(props.card);
  if (!props.card.destructive)
    return verb && verb !== "delete"
      ? approvalVerbText(t, props.card)
      : t("assistant.approval.approve");
  if (props.card.kind !== "delete") return heading.value;
  const noun = t(`assistant.entity.${entity.value}`, count.value);
  return t("assistant.approval.approveDelete", { count: count.value, entity: noun });
});

const narrowedNote = computed(() =>
  planned.value && !props.card.typed && count.value > 0 && count.value < total.value
    ? t("assistant.approval.result.narrowed", { count: count.value })
    : null,
);

const describedBy = computed(
  () =>
    [
      props.card.question ? questionId : null,
      metaLine.value ? metaId : null,
      props.card.command ? commandId : null,
      targets.value.length && !planned.value ? targetsId : null,
      diff.value ? diffId : null,
      impact.value.length ? impactId : null,
      remainingMs.value !== null && !props.sending ? expiryId : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined,
);

const argsText = computed(() => JSON.stringify(props.card.args ?? {}, null, 2));

function onKeydown(): void {
  keydownAt = Date.now();
}

// A keyboard click (`detail` 0) counts only when its key went down inside this card after it mounted.
function act(event: MouseEvent, run: () => void): void {
  if (props.sending) return;
  const fresh = Date.now() - mountedAt.value < CARRIED_KEY_MS;
  if (event.detail === 0 && carriedKey && fresh && keydownAt < mountedAt.value) return;
  run();
}

function deny(reason: "deny" | "escape"): void {
  decide({ approved: false, reason });
}

function approve(): void {
  if (nothingSelected.value) return;
  decide({
    approved: true,
    scope: canAlwaysAllow(props.card) ? scope.value : "once",
    ...(planned.value && props.card.editable && { items: [...selected.value] }),
  });
}

function edit(): void {
  plan.value?.$el.querySelector<HTMLElement>("button, input")?.focus();
  emit("announce", t("assistant.plan.deselectHint"));
}

// The card resolves before the editor opens, so its countdown never runs out mid-edit.
function editInEditor(): void {
  const target = editor.value;
  if (!target) return;
  decide({ approved: false, reason: "edited" });
  void router.push(target.route).catch(() => {});
}

function decide(decision: ApprovalDecision): void {
  emit("decide", { decision, approvalId: props.card.id });
}

function focusDefault(): boolean {
  const target = denyButton.value?.$el;
  if (!target) return false;
  target.focus();
  return true;
}

function announce(moved: boolean): void {
  const title = heading.value;
  const ms = remainingMs.value;
  const line =
    ms === null
      ? t("assistant.announce.approval", { title })
      : t("assistant.announce.approvalExpires", { title, duration: duration(ms) });
  if (moved) return emit("announce", line);
  const key = idle.jumpKey();
  emit("announce", t(key, { line, keys: t(idle.spokenKeys()) }));
}

function duration(ms: number): I18nText {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 120) return t("assistant.approval.seconds", { count: seconds }, seconds);
  const minutes = Math.round(seconds / 60);
  return t("assistant.approval.minutes", { count: minutes }, minutes);
}

function tick(): void {
  now.value = Date.now();
  const ms = remainingMs.value;
  if (ms === null || warned || props.sending || initialMs <= LONG_CARD_MS || ms > WARN_AT_MS)
    return;
  warned = true;
  emit("announce", t("assistant.approval.expiresSoon"));
}

onMounted(async () => {
  mountedAt.value = Date.now();
  carriedKey = mountedAt.value - assistantKeydownAt() < CARRIED_KEY_MS;
  root.value?.addEventListener("keydown", onKeydown, true);
  if (remainingMs.value !== null) timer = setInterval(tick, 1_000);
  offs.push(
    registerAssistantFocusTarget("card", focusDefault),
    // While the decision is on its way Escape does nothing here, so it never reaches the panel's close.
    registerEscapeRung("b", (event) => {
      const target = event.target instanceof Node ? event.target : document.activeElement;
      if (!target || !root.value?.contains(target)) return false;
      if (!props.sending) deny("escape");
      return true;
    }),
  );
  await nextTick();
  if (unmounted) return;
  const moved = idle.canTakeFocus() && focusDefault();
  announce(moved);
});

onBeforeUnmount(() => {
  unmounted = true;
  root.value?.removeEventListener("keydown", onKeydown, true);
  if (timer) clearInterval(timer);
  offs.forEach((off) => off());
});

watch(
  () => props.card.id,
  () => (selected.value = props.card.targets.map((target) => target.id ?? target.name)),
);

defineExpose({ focusDefault });
</script>
