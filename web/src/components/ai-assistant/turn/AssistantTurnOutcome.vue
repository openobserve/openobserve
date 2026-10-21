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
  <OText
    v-if="readonly"
    variant="meta"
    as="p"
    data-test="assistant-turn-outcome"
    :data-kind="kind"
    :data-code="code"
    data-readonly=""
  >
    {{ readonlyLine }}
  </OText>
  <OBanner
    v-else
    :variant="look.variant"
    :icon="look.icon"
    dense
    role="presentation"
    data-test="assistant-turn-outcome"
    :data-kind="kind"
    :data-code="code"
  >
    <p :id="titleId" class="min-w-0 break-words" data-test="assistant-turn-outcome-title">
      {{ title }}
    </p>
    <p
      v-for="line in lines"
      :key="line"
      class="min-w-0 text-xs break-words"
      data-test="assistant-turn-outcome-body"
    >
      {{ line }}
    </p>
    <p
      v-if="popupBlocked"
      class="min-w-0 text-xs break-words"
      data-test="assistant-turn-outcome-popup-blocked"
    >
      {{ t("assistant.client.popupBlocked") }}
      <OButton
        variant="ghost-primary"
        size="xs"
        class="max-md:min-h-11 pointer-coarse:min-h-11"
        data-test="assistant-turn-outcome-open-here"
        @click="emit('open-here')"
      >
        {{ t("assistant.outcome.openHere") }}
      </OButton>
    </p>
    <!-- The one action comes before Details in reading and tab order (`30` §4.4, HT-10 AC 5) -->
    <div v-if="action" class="flex flex-wrap items-center gap-2 pt-1.5">
      <AssistantAskAdminPopover
        v-if="action === 'ask_admin'"
        :kind="askKind"
        :org="org"
        :payer="creditCopy?.payer"
      >
        <template #trigger>
          <OButton
            variant="secondary"
            size="sm"
            class="max-md:min-h-11 max-md:w-full pointer-coarse:min-h-11"
            :aria-describedby="titleId"
            data-test="assistant-turn-outcome-action"
            @click="emit('action', 'ask_admin')"
          >
            {{ actionLabel }}
          </OButton>
        </template>
      </AssistantAskAdminPopover>
      <OButton
        v-else-if="newTabHref"
        variant="secondary"
        size="sm"
        as="a"
        :href="newTabHref"
        target="_blank"
        rel="noopener noreferrer"
        class="max-md:min-h-11 max-md:w-full pointer-coarse:min-h-11"
        :aria-describedby="titleId"
        data-test="assistant-turn-outcome-action"
        :data-docs="docsLink ? '' : undefined"
      >
        {{ actionLabel }}
        <span class="sr-only">{{ t("assistant.docs.opensInNewTab") }}</span>
        <template #icon-right><OIcon :name="newTabIcon" size="sm" /></template>
      </OButton>
      <OButton
        v-else
        variant="secondary"
        size="sm"
        :disabled="unavailable"
        :focusable-unavailable="unavailable"
        class="max-md:min-h-11 max-md:w-full pointer-coarse:min-h-11"
        :aria-describedby="disabledReason ? undefined : titleId"
        data-test="assistant-turn-outcome-action"
        @click="emit('action', action)"
      >
        {{ actionLabel }}
        <template v-if="disabledReason" #unavailable-reason>{{ disabledReason }}</template>
        <OTooltip v-if="disabledReason" :content="disabledReason" />
      </OButton>
    </div>
    <OButton
      v-if="manualShown"
      variant="ghost-primary"
      size="sm"
      class="self-start max-md:min-h-11 pointer-coarse:min-h-11"
      data-test="assistant-turn-outcome-manual"
      @click="emit('manual', manualRoute!)"
    >
      {{ manualLabel }}
    </OButton>
    <AssistantErrorDetails
      v-if="error && showsDetails"
      class="pt-1"
      :error="error"
      :at="at ?? now()"
      :is-admin="role === 'admin'"
    />
  </OBanner>
</template>

<script lang="ts">
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import type { AskAdminKind } from "@/components/ai-assistant/gate/AssistantAskAdminPopover.vue";
import type { AssistantError, AssistantErrorAction, QueryRef } from "@/composables/assistant/pure";
import type { CreditRefusalContext } from "@/composables/assistant";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";

export type OutcomeKind =
  "failed" | "refused" | "stopped" | "doneNotSaved" | "expired" | "restored" | "cancelledElsewhere";

/** What an outcome's one button asks the host to do. */
export type OutcomeAction = AssistantErrorAction | "continue" | "copy_request";

export interface AssistantTurnOutcomeProps {
  kind: OutcomeKind;
  error?: AssistantError;
  steps?: number;
  role: "admin" | "member";
  /** The non-AI path: the turn's last query, opened through the explorer applier. */
  manualRoute?: QueryRef;
  readonly?: boolean;
  retrySnapshotAvailable: boolean;
  /** When the turn ended, for Details. */
  at?: number;
  /** Answer text is visible above, so "Findings so far are kept above." is true; steps render only from WP-08. */
  partial?: boolean;
  cancelUnconfirmed?: boolean;
  /** The values titles name: the org of `credits_exhausted`, the elapsed of `stream_dropped`. */
  org?: string;
  /** The chat this outcome belongs to; its cross-tab lock disables the actions that start a turn. */
  sid?: string;
  elapsedMs?: number;
  online?: boolean;
  /** Server mode: Retry save can apply (`80` §1.3). */
  persistence?: boolean;
  /** `session_expired` after the new-tab sign-in re-probed: the action becomes Retry (`80` §2.3). */
  signedIn?: boolean;
  /** The Sign in tab was blocked; the block offers Open here (`80` §1.7). */
  popupBlocked?: boolean;
  /** The overage and usage reads a 402 is worded by; absent off Cloud. */
  credits?: CreditRefusalContext;
  now?: () => number;
}

export interface AssistantTurnOutcomeEmits {
  (e: "action", action: OutcomeAction): void;
  (e: "open-here"): void;
  /** "Open in Logs instead": the host opens it through the explorer applier. */
  (e: "manual", query: QueryRef): void;
  /** A `retry_after` countdown reached zero; the host's region says it once (`80` §2.4). */
  (e: "retry-ready"): void;
}

/** The codes whose block offers the explorer as the way forward without the assistant. */
const MANUAL_ROUTE_CODES: ReadonlySet<string> = new Set([
  "credits_exhausted",
  "subscription_required",
  "agent_unavailable",
  "provider_error",
  "stream_dropped",
  "stream_oversized",
]);

/** Above this the countdown says "Try again later" instead of counting (`80` §2.4). */
export const COUNTDOWN_MAX_MS = 600_000;

const LOOKS: Record<OutcomeKind, { variant: "info" | "error-soft" | "default"; icon: IconName }> = {
  failed: { variant: "error-soft", icon: assistantGlyph.failed },
  refused: { variant: "info", icon: assistantGlyph.refused },
  stopped: { variant: "default", icon: assistantGlyph.stopped },
  doneNotSaved: { variant: "default", icon: assistantGlyph.notSaved },
  expired: { variant: "default", icon: assistantGlyph.expired },
  restored: { variant: "default", icon: assistantGlyph.restored },
  cancelledElsewhere: { variant: "default", icon: assistantGlyph.elsewhere },
};

// Bodies that claim findings exist are said only when they do (`80` §1.3).
const FINDINGS_BODIES: ReadonlySet<string> = new Set(["provider_error", "stream_dropped"]);

const ROLE_SPLIT_KINDS: Record<string, AskAdminKind> = {
  permission_denied: "access",
  credits_exhausted: "credits",
  subscription_required: "credits",
  consent_still_required: "consent",
  not_enabled: "settings",
  off_for_org: "settings",
  permission_denied_tool: "tool_policy",
  data_level_blocked: "tool_policy",
};

const RETRYING: ReadonlySet<OutcomeAction> = new Set(["retry", "ask_again"]);

const STARTS_TURN: ReadonlySet<OutcomeAction> = new Set([
  "retry",
  "ask_again",
  "continue",
  "edit_resend",
]);

// Billing opens in a new tab so the open thread is never left.
const BILLING_ACTIONS: ReadonlySet<OutcomeAction> = new Set(["manage_usage", "view_plans"]);

/** Actions whose control does not exist yet; they lead to the setup guide, labelled as such (HT-02 AC 6). */
export const DOCS_ACTIONS: ReadonlySet<OutcomeAction> = new Set(["open_settings", "change_level"]);

// A code the client does not know is labelled by its action, never by the unknown code's Retry.
const ACTION_LABEL_KEYS: Partial<Record<OutcomeAction, I18nKey>> = {
  sign_in: "assistant.outcome.actions.signIn",
  ask_admin: "assistant.outcome.actions.askAdmin",
  open_iam_roles: "assistant.outcome.actions.openIamRoles",
  manage_usage: "assistant.outcome.actions.managePaidUsage",
  view_plans: "assistant.outcome.actions.viewPlans",
  copy_request: "assistant.error.credits_exhausted.actionCopy",
  stop_it: "assistant.outcome.actions.stopIt",
  reload_chat: "assistant.outcome.actions.reloadChat",
  send_again: "assistant.outcome.actions.sendAgain",
  open_settings: "assistant.docs.setupGuide",
  change_level: "assistant.docs.setupGuide",
};

let outcomeSeq = 0;

/** The visible label of an outcome's action; role-split codes word it per role (`80` §1.3). */
export function outcomeActionLabel(
  action: OutcomeAction,
  code: string,
  role: "admin" | "member",
  t: TranslateFn,
  te: (key: string) => boolean,
): I18nText {
  if (action === "continue") return t("assistant.turn.continue");
  if (action === "retry_save") return t("assistant.turn.retrySave");
  if (action === "ask_again") return t("assistant.outcome.askAgain");
  if (action === "edit_resend") return t("assistant.outcome.editResend");
  if (action === "retry") return t("assistant.outcome.retry");
  if (DOCS_ACTIONS.has(action)) return t("assistant.docs.setupGuide");
  const split = `assistant.error.${code}.action${role === "admin" ? "Admin" : "Member"}`;
  if (code !== "unknown" && te(split)) return t(split);
  const own = `assistant.error.${code}.action`;
  if (code !== "unknown" && te(own)) return t(own);
  return t(ACTION_LABEL_KEYS[action] ?? "assistant.outcome.retry");
}

/** The one action of a block, before the role and the device are applied. */
export function outcomeActionOf(
  kind: OutcomeKind,
  error: AssistantError | undefined,
  opts: { role: "admin" | "member"; persistence: boolean; signedIn: boolean },
): OutcomeAction | null {
  if (kind === "stopped") return "continue";
  if (kind === "doneNotSaved") return opts.persistence ? "retry_save" : null;
  if (kind === "expired") return "ask_again";
  if (kind === "restored" || kind === "cancelledElsewhere" || !error) return null;
  if (error.code === "session_expired" && opts.signedIn) return "retry";
  if (error.action === "none" || error.action === "send_again") return null;
  if (ROLE_SPLIT_KINDS[error.code] && opts.role === "member") return "ask_admin";
  return error.action;
}
</script>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";

import AssistantErrorDetails, {
  ASSISTANT_SETUP_DOCS_URL,
} from "@/components/ai-assistant/common/AssistantErrorDetails.vue";
import { billingHrefOf } from "@/components/ai-assistant/credits/AssistantCreditManage.vue";
import { explorerLabel } from "@/components/ai-assistant/evidence/evidenceText";
import {
  errorTitle,
  turnLockKey,
  useAssistantName,
  useTurnLock,
} from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { explorerOf } from "@/utils/assistant/explorerRoutes";
import { formatOrgDay } from "@/utils/formatters";

import { creditsRefusal } from "./creditsRefusal";

// The request flow reads the org's members, so it loads only when a block offers Ask an admin.
const AssistantAskAdminPopover = defineAsyncComponent(
  () => import("@/components/ai-assistant/gate/AssistantAskAdminPopover.vue"),
);

const props = withDefaults(defineProps<AssistantTurnOutcomeProps>(), {
  error: undefined,
  steps: 0,
  manualRoute: undefined,
  readonly: false,
  at: undefined,
  partial: false,
  cancelUnconfirmed: false,
  org: "",
  elapsedMs: undefined,
  online: true,
  persistence: false,
  signedIn: false,
  popupBlocked: false,
  credits: undefined,
  now: undefined,
});

const emit = defineEmits<AssistantTurnOutcomeEmits>();

const { t, te } = useI18nTyped();
const { product } = useAssistantName();
outcomeSeq += 1;
const titleId = `assistant-turn-outcome-${outcomeSeq}`;
const now = () => (props.now ?? Date.now)();

const code = computed(() => props.error?.code);
const router = useRouter();

const creditCopy = computed(() =>
  props.kind === "refused" || props.kind === "failed"
    ? creditsRefusal(code.value, props.role, props.org, props.credits ?? {}, formatOrgDay)
    : null,
);
const creditParams = computed(() => {
  const params = creditCopy.value?.params;
  return params
    ? { org: raw(params.org), payer: raw(params.payer ?? ""), date: raw(params.date ?? "") }
    : {};
});

const manualShown = computed(
  () =>
    !props.readonly &&
    !!props.manualRoute &&
    !!props.manualRoute.text &&
    MANUAL_ROUTE_CODES.has(code.value ?? ""),
);

const manualLabel = computed(() => {
  const explorer = props.manualRoute ? explorerOf(props.manualRoute) : "logs";
  return t("assistant.outcome.manualRoute", { explorer: explorerLabel(explorer, t) });
});
const look = computed(() => LOOKS[props.kind]);
const askKind = computed<AskAdminKind>(() => ROLE_SPLIT_KINDS[code.value ?? ""] ?? "access");

const title = computed<I18nText>(() => {
  switch (props.kind) {
    case "stopped":
      return props.steps > 0 && props.partial
        ? t("assistant.turn.stoppedWithSteps", { n: props.steps }, props.steps)
        : t("assistant.turn.stopped");
    case "doneNotSaved":
      return t("assistant.turn.notSaved");
    case "restored":
      return t("assistant.turn.restored");
    case "cancelledElsewhere":
      return t("assistant.error.cancelled_elsewhere.title");
    case "expired":
      return t("assistant.error.approval_expired.title");
    default: {
      if (!props.error) return t("assistant.error.unknown.title");
      if (creditCopy.value) return t(creditCopy.value.titleKey, creditParams.value);
      const copy = { t, org: props.org, product, elapsedMs: props.elapsedMs ?? 0 };
      const { key, params } = errorTitle(props.error, copy);
      return t(key, params);
    }
  }
});

const lines = computed<I18nText[]>(() => {
  const out: I18nText[] = [];
  const error = props.error;
  if (props.kind === "stopped" && props.cancelUnconfirmed)
    out.push(t("assistant.turn.cancelUnconfirmed"));
  if (!error || (props.kind !== "failed" && props.kind !== "refused")) return out;
  if (creditCopy.value) return [...out, t(creditCopy.value.bodyKey, creditParams.value)];
  const bodyKey = `assistant.error.${error.code}.body`;
  const claimsFindings = FINDINGS_BODIES.has(error.code);
  if (te(bodyKey) && (!claimsFindings || props.partial)) out.push(t(bodyKey));
  if (action.value === "ask_again") out.push(t("assistant.turn.retryNote"));
  return out;
});

const readonlyLine = computed<I18nText>(() =>
  props.kind === "failed"
    ? t("assistant.outcome.readonlyFailed", { title: title.value })
    : title.value,
);

const action = computed<OutcomeAction | null>(
  () =>
    creditCopy.value?.action ??
    outcomeActionOf(props.kind, props.error, {
      role: props.role,
      persistence: props.persistence,
      signedIn: props.signedIn,
    }),
);
const billingHref = computed(() =>
  action.value && BILLING_ACTIONS.has(action.value) ? billingHrefOf(router, props.org) : null,
);
const docsLink = computed(() => !!action.value && DOCS_ACTIONS.has(action.value));
const newTabHref = computed(
  () => billingHref.value ?? (docsLink.value ? ASSISTANT_SETUP_DOCS_URL : null),
);
const newTabIcon = assistantGlyph.newTab;

// Retry after `retry_after` counts down once a second; the count is never announced (`80` §2.4).
const deadline = ref<number | null>(null);
const tick = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

const remainingMs = computed(() => {
  void tick.value;
  return deadline.value === null ? 0 : Math.max(0, deadline.value - now());
});

const countingDown = computed(() => RETRYING.has(action.value ?? "none") && remainingMs.value > 0);

const actionLabel = computed<I18nText>(() => {
  const value = action.value;
  if (!value) return t("assistant.error.unknown.action");
  // A 402's per-code labels name only its default action; the split may pick another.
  if (creditCopy.value) return t(ACTION_LABEL_KEYS[value] ?? "assistant.outcome.retry");
  if (countingDown.value) {
    if (remainingMs.value > COUNTDOWN_MAX_MS) return t("assistant.outcome.tryLater");
    return t("assistant.outcome.retryIn", { s: Math.ceil(remainingMs.value / 1000) });
  }
  return outcomeActionLabel(value, code.value ?? "unknown", props.role, t, te);
});

// A signed-out tab, or another tab holding this chat's approval, may not start a turn from here.
const turnLock = useTurnLock(() => props.sid ?? null);

const disabledReason = computed<I18nText | null>(() => {
  if (turnLock.value && STARTS_TURN.has(action.value ?? "none"))
    return t(turnLockKey(turnLock.value));
  if (!RETRYING.has(action.value ?? "none")) return null;
  if (!props.online) return t("assistant.outcome.retryOffline");
  if (!props.retrySnapshotAvailable) return t("assistant.outcome.noSnapshot");
  return null;
});

// While counting down the label itself says why, so the button needs no separate reason.
const unavailable = computed(() => !!disabledReason.value || countingDown.value);

const showsDetails = computed(
  () => props.kind === "failed" || props.kind === "refused" || props.cancelUnconfirmed,
);

function stopTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

// The deadline follows `at`, which a host may learn after mount (the refusal's end time on the session).
watch(
  [() => props.error?.retryAfterMs, () => props.at],
  ([ms]) => {
    stopTimer();
    deadline.value = ms ? (props.at ?? now()) + ms : null;
    if (!deadline.value || deadline.value <= now()) return;
    timer = setInterval(() => {
      tick.value += 1;
      if (remainingMs.value > 0) return;
      stopTimer();
      emit("retry-ready");
    }, 1_000);
  },
  { immediate: true },
);

onBeforeUnmount(stopTimer);
</script>
