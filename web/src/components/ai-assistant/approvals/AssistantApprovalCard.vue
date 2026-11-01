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
      :aria-label="groupName"
      :aria-describedby="metaLine ? metaId : undefined"
      :aria-busy="sending ? 'true' : undefined"
      class="border-status-warning-text flex min-w-0 flex-col gap-1.5 border-s-2 py-0.5 ps-2.5"
      :data-kind="card.kind"
      data-test="assistant-approval-card"
    >
      <div class="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <h3
          ref="headingEl"
          tabindex="-1"
          class="text-text-heading focus-visible:ring-assistant-focus-ring rounded-default min-w-0 flex-1 text-sm font-medium break-words outline-none focus-visible:ring-2"
          data-test="assistant-approval-heading"
        >
          {{ heading }}
        </h3>
        <span
          v-if="remainingMs !== null"
          role="timer"
          aria-live="off"
          :aria-label="t('assistant.approval.expiresIn', { time: clockText })"
          :class="[
            'text-status-warning-text text-xs whitespace-nowrap tabular-nums',
            expiringSoon && 'font-medium',
          ]"
          data-test="assistant-approval-countdown"
        >
          {{ clockText }}
        </span>
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
        v-if="card.question && !question && !isApprovalChange(card)"
        class="text-text-body text-sm break-words whitespace-pre-wrap"
        data-test="assistant-approval-question"
      >
        {{ card.question }}
      </p>
      <code
        v-if="card.command"
        class="rounded-default bg-surface-subtle text-text-body block p-2 font-mono text-xs break-all whitespace-pre-wrap"
        data-test="assistant-approval-command"
        >{{ card.command }}</code
      >
      <OText
        v-if="gateLine"
        variant="body"
        as="p"
        class="text-xs"
        data-test="assistant-approval-gated"
      >
        {{ gateLine }}
      </OText>

      <!-- The buttons stay while the decision is on its way, so focus stays where it was -->
      <div class="-ms-2.5 flex min-w-0 flex-wrap items-center gap-1">
        <template v-if="question && !replying">
          <OButton
            v-for="option in card.options ?? []"
            :key="option.id"
            variant="ghost"
            size="xs"
            :disabled="sending"
            focusable-unavailable
            :class="TOUCH_TARGET_CLASS"
            :data-test="`assistant-question-option-${option.id}`"
            @click="(event: MouseEvent) => act(event, () => choose(option))"
          >
            {{ raw(option.label) }}
          </OButton>
          <OButton
            v-if="card.allowOther || !card.options?.length"
            variant="ghost"
            size="xs"
            :disabled="sending"
            focusable-unavailable
            :class="TOUCH_TARGET_CLASS"
            data-test="assistant-question-other"
            @click="(event: MouseEvent) => act(event, () => emit('reply'))"
          >
            {{ t("assistant.question.otherAnswer") }}
          </OButton>
        </template>
        <template v-else-if="!replying">
          <OButton
            ref="denyButton"
            variant="ghost"
            size="xs"
            :disabled="sending"
            focusable-unavailable
            :class="TOUCH_TARGET_CLASS"
            data-test="assistant-approval-deny"
            @click="
              (event: MouseEvent) => act(event, () => decide({ approved: false, reason: 'deny' }))
            "
          >
            {{ t("assistant.approval.deny") }}
          </OButton>
          <OButton
            variant="ghost"
            size="xs"
            :disabled="sending"
            focusable-unavailable
            :class="TOUCH_TARGET_CLASS"
            data-test="assistant-approval-reply"
            @click="(event: MouseEvent) => act(event, () => emit('reply'))"
          >
            {{ t("assistant.approval.reply") }}
          </OButton>
          <OButton
            v-if="planned && card.editable && !gated"
            variant="ghost"
            size="xs"
            :disabled="sending"
            focusable-unavailable
            :class="TOUCH_TARGET_CLASS"
            data-test="assistant-approval-edit"
            @click="(event: MouseEvent) => act(event, edit)"
          >
            {{ t("assistant.approval.edit") }}
          </OButton>
        </template>
        <OButton
          v-if="moreTime"
          variant="ghost"
          size="xs"
          :disabled="sending"
          focusable-unavailable
          :class="TOUCH_TARGET_CLASS"
          data-test="assistant-approval-extend"
          @click="(event: MouseEvent) => act(event, () => emit('extend'))"
        >
          {{ t("assistant.approval.moreTime") }}
        </OButton>
        <OButton
          v-if="!question && !replying && !gated"
          :variant="card.destructive ? 'destructive' : 'primary'"
          size="xs"
          :disabled="sending || nothingSelected"
          focusable-unavailable
          :class="['ms-auto', TOUCH_TARGET_CLASS]"
          data-test="assistant-approval-approve"
          @click="(event: MouseEvent) => act(event, approve)"
        >
          {{ approveLabel }}
          <template v-if="nothingSelected && !sending" #unavailable-reason>
            {{ t("assistant.approval.nothingSelected") }}
          </template>
        </OButton>
      </div>
      <OText v-if="narrowedNote" variant="meta" as="p" data-test="assistant-approval-narrowed">
        {{ narrowedNote }}
      </OText>

      <OCollapsible
        v-if="hasDetails && !replying"
        :default-open="gated"
        :trigger-class="DETAILS_TRIGGER"
        data-test="assistant-approval-details"
      >
        <template #trigger="{ open }">
          <span class="text-text-secondary flex items-center gap-1 text-xs">
            <OIcon
              :name="open ? assistantGlyph.collapse : assistantGlyph.expand"
              size="xs"
              aria-hidden="true"
            />
            {{ t("assistant.approval.details") }}
          </span>
        </template>
        <div class="flex min-w-0 flex-col items-start gap-1.5 pt-1">
          <ul
            v-if="targets.length && !planned && targets.length + moreTargets > 1"
            class="flex min-w-0 flex-col gap-0.5"
            data-test="assistant-approval-targets"
          >
            <li v-for="target in targets" :key="target.key" class="min-w-0 break-all">
              <OText as="span" class="text-xs">{{ target.label }}</OText>
            </li>
            <li v-if="moreTargets > 0">
              <OText variant="meta" as="span">
                {{ t("assistant.approval.moreTargets", { count: moreTargets }) }}
              </OText>
            </li>
          </ul>
          <dl
            v-if="diff.length"
            class="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs"
            data-test="assistant-approval-diff"
          >
            <template v-for="row in diff" :key="row.field">
              <dt class="text-text-secondary break-all">{{ row.field }}</dt>
              <dd class="text-text-body font-mono break-all">
                <template v-if="row.before">
                  <s class="text-text-secondary">{{ row.before }}</s>
                  {{ raw("→") }}
                </template>
                {{ row.value }}
              </dd>
            </template>
          </dl>
          <ul
            v-if="impact.length"
            class="text-text-body flex min-w-0 list-disc flex-col gap-0.5 ps-4 text-xs"
            data-test="assistant-approval-impact"
          >
            <li v-for="(line, index) in impact" :key="index" class="break-words">{{ line }}</li>
          </ul>
          <OSelect
            v-if="scopeOptions.length"
            v-model="scope"
            :options="scopeOptions"
            :label="t('assistant.approval.scope.label')"
            :disabled="sending"
            size="sm"
            data-test="assistant-approval-scope"
          />
          <OCodeBlock
            v-if="card.args && !diff.length"
            :code="argsText"
            lang="json"
            contrast="aa"
            :scroll-label="t('assistant.approval.arguments')"
            :copy-message="t('assistant.evidence.copied')"
            :copy-button-class="TOUCH_TARGET_CLASS"
            class="w-full"
            data-test="assistant-approval-args"
          />
          <OButton
            v-if="editor"
            variant="ghost"
            size="xs"
            :icon-left="assistantGlyph.newTab"
            :disabled="sending"
            focusable-unavailable
            :class="['-ms-2.5', TOUCH_TARGET_CLASS]"
            data-test="assistant-approval-finish-in"
            @click="(event: MouseEvent) => act(event, editInEditor)"
          >
            {{ t("assistant.approval.finishIn", { editor: editorLabel }) }}
          </OButton>
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
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { useRouter } from "vue-router";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  registerAssistantFocusTarget,
  assistantKeydownAt,
  registerEscapeRung,
  useAssistantIdleFocus,
  useAssistantName,
  type ApprovalDecision,
  type ApprovalScope,
} from "@/composables/assistant";
import {
  approvalClock,
  approvalDiff,
  approvalDuration,
  approvalEditor,
  approvalEntity,
  approvalHeading,
  approvalName,
  approvalNoun,
  approvalNotifies,
  approvalObjectId,
  approvalFolderId,
  approvalTargetHref,
  approvalUntil,
  approvalVerb,
  approvalVerbText,
  canAlwaysAllow,
  isReplyingTo,
  isApprovalChange,
  type QuestionOption,
} from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";

import AssistantPlanBlock from "./AssistantPlanBlock.vue";
import { lowerFirst } from "./approvalText";
import {
  assistantApprovalsHostKey,
  type ApprovalCardDecision,
  type ApprovalCardView,
} from "./approvals.types";

/** The first targets listed; the rest are counted. */
const FIRST_TARGETS = 5;

/** An id the name could not be resolved for is shown this short (D3-n). */
const SHORT_ID_CHARS = 8;

/** The last minute weighs the timer and speaks once (`30` §7.3). */
const WARN_AT_MS = 60_000;

/** Past this many items the impact says it is a large batch, without blocking it. */
const LARGE_BATCH = 20;

/** A key pressed this close before the card mounted may land its keyup on the card; that one activation is ignored. */
const CARRIED_KEY_MS = 1_000;

/** The two warnings of every window, longest first (`30` §7.3). */
const WARN_ATS_MS = [60_000, 20_000];

const DETAILS_TRIGGER = "min-h-6 w-fit px-0 py-0 max-md:min-h-11 pointer-coarse:min-h-11";

const props = withDefaults(
  defineProps<{
    card: ApprovalCardView;
    org?: string;
    /** The decision is on its way: the buttons stay, unavailable, under `aria-busy`. */
    sending?: boolean;
    /** The server lets the card ask for more time. */
    extendable?: boolean;
    /** The server has no split budgets: Deny and Reply only (PO A14, B96). */
    gated?: boolean;
    /** The org's display name; shown only when the user can switch between orgs. */
    orgName?: string;
    multiOrg?: boolean;
  }>(),
  { org: "", sending: false, extendable: false, gated: false, orgName: "", multiOrg: false },
);

const emit = defineEmits<{
  (e: "decide", value: ApprovalCardDecision): void;
  (e: "reply"): void;
  (e: "extend"): void;
  /** One line for the turn region: the card says it is waiting, and where it is. */
  (e: "announce", text: I18nText): void;
}>();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const router = useRouter();
const idle = useAssistantIdleFocus();
const metaId = `assistant-approval-meta-${useId()}`;

const root = ref<HTMLElement | null>(null);
const headingEl = ref<HTMLElement | null>(null);
const plan = ref<{ $el: HTMLElement } | null>(null);
const now = ref(Date.now());
const scope = ref<ApprovalScope>("once");
const selected = ref<string[]>(props.card.targets.map((target) => target.id ?? target.name));
// Activations carried over from a key pressed before the card existed never decide it.
const mountedAt = ref(Number.POSITIVE_INFINITY);
let keydownAt = Number.NEGATIVE_INFINITY;
let carriedKey = false;
// A card that mounts inside a warning's window said its time in the mount announcement.
let warned = new Set(WARN_ATS_MS.filter((at) => initialLeft() <= at));
let unmounted = false;
// Decided when the card mounts, so a server upgrade never changes a card under the reader (`30` §7.3).
const gated = props.gated;
let timer: ReturnType<typeof setInterval> | null = null;
const offs: (() => void)[] = [];

const question = computed(() => props.card.kind === "question");
const total = computed(() => props.card.total ?? props.card.targets.length);
const planned = computed(
  () => props.card.kind === "delete" && total.value > 1 && props.card.targets.length > 0,
);
const count = computed(() =>
  planned.value && props.card.editable ? selected.value.length : total.value,
);
const heading = computed(() => approvalHeading(t, props.card, count.value));
const groupName = computed(() =>
  question.value
    ? t("assistant.question.needsAnswer", { question: heading.value })
    : t("assistant.approval.needsOkName", { name: raw(lowerFirst(heading.value)) }),
);
const nothingSelected = computed(() => planned.value && count.value === 0);

const approvalsHost = inject(assistantApprovalsHostKey, null);

// The composer takes over while the reader writes a reply or their own answer.
const replying = computed(() => isReplyingTo(props.card.sessionId, props.card.id));

const remainingMs = computed(() =>
  typeof props.card.expiresAt === "number" ? Math.max(0, props.card.expiresAt - now.value) : null,
);
const clockText = computed(() => raw(approvalClock(remainingMs.value ?? 0)));
// From mount, so the reader never has to race the countdown for it (PO A11, A23).
const extendsSpent = computed(() => props.card.userExtendsLeft === 0);
const moreTime = computed(
  () =>
    props.extendable &&
    !gated &&
    !extendsSpent.value &&
    remainingMs.value !== null &&
    remainingMs.value > 0,
);
const expiringSoon = computed(() => remainingMs.value !== null && remainingMs.value <= WARN_AT_MS);

const allTargets = computed(() =>
  props.card.targets.map((target) => ({
    key: target.id ?? target.name,
    label: raw(target.name),
    href: target.id ? approvalTargetHref(router, props.org, target) : null,
  })),
);
const targets = computed(() => allTargets.value.slice(0, FIRST_TARGETS));
const moreTargets = computed(() => Math.max(0, allTargets.value.length - FIRST_TARGETS));

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
  const unknown = t("assistant.approval.currentUnknown");
  const rows = (changed?.rows ?? []).map((row) => {
    const value = raw(valueText(row.after));
    if (props.card.kind === "create") return { field: raw(row.field), value, before: null };
    const before = "before" in row ? valueText(row.before) : changed?.oneSided ? unknown : null;
    return { field: raw(row.field), value, before: before === null ? null : raw(before) };
  });
  const notifies = approvalNotifies(props.card);
  return notifies
    ? [...rows, { field: t("assistant.approval.notifies"), value: raw(notifies), before: null }]
    : rows;
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

const endAndScope = computed<I18nText | null>(() => {
  const until = approvalUntil(props.card);
  const folder = approvalFolderId(props.card);
  const name = folder ? (approvalsHost?.folderName?.(folder) ?? null) : null;
  const time = until === null ? null : raw(formatOrgTime(until));
  if (time && name) return t("assistant.approval.meta", { time, scope: raw(name) });
  if (time) return t("assistant.approval.metaUntil", { time });
  return name ? raw(name) : null;
});

const metaLine = computed<I18nText | null>(() => {
  const inOrg =
    props.multiOrg && props.orgName
      ? t("assistant.approval.inOrg", { org: raw(props.orgName) })
      : null;
  const parts = [endAndScope.value, nameUnknown.value, inOrg].filter(Boolean);
  return parts.length ? raw(parts.join(" · ")) : null;
});

const editor = computed(() => (planned.value ? null : approvalEditor(props.card, props.org)));
const editorLabel = computed(() =>
  editor.value ? t(`assistant.approval.editor.${editor.value.type}`) : raw(""),
);

const gateLine = computed<I18nText | null>(() => {
  if (!gated || question.value) return null;
  return editor.value
    ? t("assistant.approval.gateTiming", { editor: editorLabel.value })
    : t("assistant.approval.gateNoEditor", { product });
});

// A single change has nothing to scope: "always" would grant a write the reader saw once (D3-p).
const scopeOptions = computed(() =>
  !gated &&
  canAlwaysAllow(props.card) &&
  (!isApprovalChange(props.card) || props.card.targets.length > 1)
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

const hasDetails = computed(
  () =>
    !question.value &&
    (diff.value.length > 0 ||
      impact.value.length > 0 ||
      scopeOptions.value.length > 0 ||
      !!editor.value ||
      !!props.card.args ||
      (!planned.value && allTargets.value.length > 1)),
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

const argsText = computed(() => JSON.stringify(props.card.args ?? {}, null, 2));

function initialLeft(): number {
  return typeof props.card.expiresAt === "number" ? props.card.expiresAt - Date.now() : Infinity;
}

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

function approve(): void {
  if (nothingSelected.value || gated) return;
  decide({
    approved: true,
    scope: canAlwaysAllow(props.card) ? scope.value : "once",
    ...(planned.value && props.card.editable && { items: [...selected.value] }),
  });
}

function choose(option: QuestionOption): void {
  decide({ approved: false, reason: "answer", answer: option.id, answerLabel: option.label });
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
  const target = headingEl.value;
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
  return approvalDuration(ms, t);
}

// Each warning speaks once per window; an extension starts the window over.
function tick(): void {
  now.value = Date.now();
  const ms = remainingMs.value;
  if (ms === null || props.sending) return;
  const due = WARN_ATS_MS.find((at) => ms <= at && !warned.has(at));
  if (due === undefined) return;
  for (const at of WARN_ATS_MS) if (ms <= at) warned.add(at);
  const key = extendsSpent.value
    ? "assistant.announce.approvalExpiringFinal"
    : "assistant.announce.approvalExpiring";
  const line = t(key, { title: heading.value, duration: duration(ms) });
  const focused = root.value?.contains(document.activeElement);
  emit("announce", focused ? line : t(idle.jumpKey(), { line, keys: t(idle.spokenKeys()) }));
}

onMounted(async () => {
  mountedAt.value = Date.now();
  carriedKey = mountedAt.value - assistantKeydownAt() < CARRIED_KEY_MS;
  root.value?.addEventListener("keydown", onKeydown, true);
  if (remainingMs.value !== null) timer = setInterval(tick, 1_000);
  offs.push(
    registerAssistantFocusTarget("card", focusDefault),
    // Escape never decides, and it stops here so it cannot close the panel on a waiting card either.
    registerEscapeRung("b", (event) => {
      const target = event.target instanceof Node ? event.target : document.activeElement;
      return !!target && !!root.value?.contains(target);
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
  () => props.card.expiresAt,
  (next, before) => {
    if (typeof next !== "number" || typeof before !== "number" || next <= before) return;
    warned = new Set();
    now.value = Date.now();
    emit(
      "announce",
      t("assistant.announce.approvalExtended", { duration: duration(next - now.value) }),
    );
  },
);

watch(
  () => props.card.id,
  () => (selected.value = props.card.targets.map((target) => target.id ?? target.name)),
);

defineExpose({ focusDefault });
</script>
