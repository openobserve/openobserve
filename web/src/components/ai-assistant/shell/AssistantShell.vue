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
  <component
    :is="landmark.tag"
    ref="root"
    v-bind="landmark.attrs"
    data-assistant-root
    data-dd-privacy="mask"
    :data-placement="placement"
    :data-sheet="sheet ? '' : undefined"
    :data-state="state"
    :data-test="`assistant-shell-${placement}`"
    tabindex="-1"
    class="bg-surface-base data-[dragging]:ring-border-strong flex h-full min-h-0 flex-col outline-none data-[dragging]:ring-2 data-[dragging]:ring-inset"
    @keydown="recordKeydown"
  >
    <div
      :class="[
        'border-border-default flex shrink-0 items-center gap-2 border-b px-3',
        placement === 'docked' ? 'h-15' : 'h-12 max-md:h-auto max-md:min-h-12 max-md:flex-wrap',
      ]"
      data-test="assistant-shell-chrome"
    >
      <AssistantThreadHeader
        v-if="showTitle && state !== 'loading'"
        ref="threadHeader"
        :sid="activeSid"
        :placement="sheet ? 'sheet' : placement"
        :density="headerDensity"
        :container="container"
      >
        <template #container-actions>
          <slot name="container-actions" />
          <AssistantIconButton
            v-if="placement === 'sidebar' && !sheet"
            :label="t('assistant.shell.openInFullView')"
            :icon="assistantGlyph.openFull"
            data-test="assistant-shell-open-in-full-view"
            @click="openInFullView"
          />
          <AssistantIconButton
            :label="t('assistant.shell.close', { product })"
            :icon="assistantGlyph.close"
            data-test="assistant-shell-close"
            @click="closeContainer"
          />
        </template>
        <template #menu-layout>
          <AssistantContainerMenu bare :placement="placement" :sheet="sheet" />
        </template>
        <template v-if="activeSid && state === 'conversation'" #share>
          <AssistantShareControl
            :sid="activeSid"
            variant="header"
            @manage="shareManagerOpen = true"
          />
        </template>
        <template v-if="activeSid && state === 'conversation'" #menu-share>
          <AssistantShareControl
            :sid="activeSid"
            variant="menu-item"
            @manage="shareManagerOpen = true"
          />
        </template>
      </AssistantThreadHeader>
      <template v-else>
        <OSkeleton v-if="state === 'loading'" type="text" class="w-40" />
        <span class="flex-1" />
        <div class="flex shrink-0 items-center gap-1">
          <slot name="container-actions" />
          <AssistantIconButton
            v-if="placement === 'sidebar' && (!sheet || state === 'gate')"
            :label="t('assistant.shell.openInFullView')"
            :icon="assistantGlyph.openFull"
            data-test="assistant-shell-open-in-full-view"
            @click="openInFullView"
          />
          <AssistantContainerMenu v-if="state !== 'gate'" :placement="placement" :sheet="sheet" />
          <AssistantIconButton
            :label="t('assistant.shell.close', { product })"
            :icon="assistantGlyph.close"
            data-test="assistant-shell-close"
            @click="closeContainer"
          />
        </div>
      </template>
    </div>

    <div
      v-if="notice || creditThreshold || historyUnavailable || $slots.notice"
      ref="noticeRow"
      class="shrink-0 px-3 pt-2"
      data-test="assistant-shell-notice-row"
    >
      <OBanner
        v-if="notice === 'signed_out'"
        variant="info"
        dense
        role="presentation"
        :content="t('assistant.shell.signedOutElsewhere')"
        data-test="assistant-shell-signed-out-block"
      >
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            class="max-md:min-h-11"
            data-test="assistant-shell-signed-out-sign-in"
            @click="signIn"
          >
            {{ t("assistant.error.signed_out.action") }}
          </OButton>
        </template>
      </OBanner>
      <OBanner
        v-else-if="notice === 'other_account'"
        variant="info"
        dense
        role="presentation"
        :content="t('assistant.shell.otherAccount')"
        data-test="assistant-shell-other-account-block"
      >
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            class="max-md:min-h-11"
            data-test="assistant-shell-other-account-reload"
            @click="reloadPage"
          >
            {{ t("assistant.shell.reload") }}
          </OButton>
        </template>
      </OBanner>
      <OBanner
        v-else-if="notice === 'unhealthy'"
        variant="info"
        dense
        :content="t('assistant.gate.unhealthy.notice', { product })"
        data-test="assistant-shell-unhealthy-notice"
      >
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            class="max-md:min-h-11"
            :disabled="!!turnLock"
            :focusable-unavailable="!!turnLock"
            data-test="assistant-shell-unhealthy-notice-retry"
            @click="retry"
          >
            {{ t("assistant.gate.tryAgain") }}
            <template v-if="turnLock" #unavailable-reason>{{ t(turnLockKey(turnLock)) }}</template>
            <OTooltip v-if="turnLock" :content="t(turnLockKey(turnLock))" />
          </OButton>
        </template>
      </OBanner>
      <OBanner
        v-else-if="historyUnavailable"
        variant="warning"
        dense
        role="presentation"
        :content="t('assistant.thread.historyUnavailable')"
        data-test="assistant-shell-history-unavailable"
      >
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-shell-history-retry"
            @click="retryHistory"
          >
            {{ t("common.retry") }}
          </OButton>
        </template>
      </OBanner>
      <AssistantCreditNotice
        v-else-if="creditThreshold"
        :threshold="creditThreshold"
        :can-manage="credits.canManage.value"
        :resets-at="credits.usage.value?.resetsAt"
        :org="org"
        @dismiss="dismissCreditNotice"
        @manage="creditNotice.noteAction('manage')"
        @ask-admin="creditNotice.noteAction('ask_admin')"
      />
      <slot v-else name="notice" />
    </div>

    <!-- The header region speaks only for sessions no container shows -->
    <AssistantStatusRegion ref="region" />

    <div
      :class="[
        'min-h-0 flex-1 max-md:min-h-20',
        state === 'conversation' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto',
      ]"
      data-test="assistant-shell-body"
    >
      <AssistantForkSource
        v-if="activeSid && (state === 'empty' || state === 'conversation')"
        :key="activeSid"
        :sid="activeSid"
      />
      <AssistantGateState
        v-if="state === 'gate'"
        :reason="gateReason"
        size="inline"
        :is-admin="capability.isAdmin"
        :context="{ org, feature: 'chat' }"
        :focus-on-mount="openedByUser"
        @action="onGateAction"
      />
      <div
        v-else-if="state === 'loading'"
        class="flex flex-col gap-3 p-4"
        data-test="assistant-shell-loading"
      >
        <span class="sr-only">{{ t("assistant.shell.loadingChat") }}</span>
        <OSkeleton type="rect" class="h-6 w-3/4" />
        <OSkeleton type="rect" class="h-16 w-full" />
        <OSkeleton type="rect" class="h-10 w-2/3" />
      </div>
      <OEmptyState
        v-else-if="state === 'not_found' || state === 'deleted_elsewhere'"
        size="block"
        :backdrop="false"
        :title="
          state === 'not_found'
            ? t('assistant.shell.notFound')
            : deletedHere === 'tab'
              ? t('assistant.shell.deletedInAnotherTab')
              : t('assistant.shell.deletedElsewhere')
        "
        :action-label="t('assistant.shell.newChat')"
        :data-test="state === 'not_found' ? 'assistant-shell-not-found' : 'assistant-shell-deleted'"
        @action="newChat"
      >
        <template #illustration>
          <AssistantMark size="lg" muted />
        </template>
      </OEmptyState>
      <OEmptyState
        v-else-if="state === 'unavailable'"
        size="block"
        :backdrop="false"
        :title="t('assistant.shell.loadFailed')"
        :action-label="t('common.retry')"
        data-test="assistant-shell-unavailable"
        @action="retryHistory"
      >
        <template #illustration>
          <AssistantMark size="lg" muted />
        </template>
      </OEmptyState>
      <AssistantWelcome
        v-else-if="state === 'empty' && welcome"
        :variant="density === 'roomy' ? 'roomy' : 'compact'"
        :scope="welcome.scope.value"
        :starters="welcome.starters.value"
        :loading="welcome.loading.value"
        :container="container"
        :sid="activeSid"
        @select-starter="onStarter"
        @open-chat="onOpenChat"
      />
      <slot v-else-if="state === 'conversation'" name="transcript">
        <AssistantTranscript
          ref="transcript"
          :sid="activeSid ?? undefined"
          :density="density"
          @status-visible="(shown) => (statusRowVisible = shown)"
          @outcome-shown="onOutcomeShown"
        >
          <template #cards>
            <slot name="cards">
              <div
                v-if="decisions"
                ref="decisionsEl"
                class="flex min-w-0 flex-col gap-2"
                data-test="assistant-decisions"
              >
                <AssistantActionTimeline
                  v-if="decisions.ledger.length || decisions.unreviewed.length"
                  :entries="decisions.ledger"
                  :unreviewed="decisions.unreviewed"
                  :sid="decisions.sid"
                />
                <AssistantApprovalCard
                  v-if="approvalCard"
                  ref="approvalCardEl"
                  :key="approvalCard.id"
                  :card="approvalCard"
                  :org="decisions.org"
                  :sending="approvalSending"
                  :extendable="capability.approvalExtend === true"
                  @decide="onDecide"
                  @reply="onReply"
                  @extend="onExtend"
                  @announce="(text) => region?.announce(text)"
                />
                <AssistantApprovalResult
                  v-else-if="approvalElsewhere"
                  state="waiting_elsewhere"
                  :sid="decisions.sid"
                  @stop="stopElsewhere"
                />
                <AssistantConsentCard
                  v-if="consentCard"
                  ref="consentCardEl"
                  :key="`consent:${consentCard.sid}:${consentCard.orgId}`"
                  v-bind="consentCard"
                  @enable="resolveConsent(true, true)"
                  @cancel="resolveConsent(false)"
                  @open-billing="trackConsent('view_billing')"
                  @ask-admin="trackConsent('ask_admin')"
                  @announce="(text) => region?.announce(text)"
                />
              </div>
            </slot>
          </template>
        </AssistantTranscript>
      </slot>
    </div>

    <div
      v-if="state !== 'gate' && !isTerminalBody"
      ref="lower"
      class="flex shrink-0 flex-col max-md:min-h-0 max-md:shrink max-md:overflow-y-auto"
      data-test="assistant-shell-lower"
    >
      <div
        v-if="elsewhere"
        class="border-border-default flex min-w-0 shrink-0 flex-col gap-1 border-t px-3 py-1"
        data-test="assistant-shell-elsewhere"
      >
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <OText
            variant="meta"
            as="p"
            class="min-w-0 flex-1"
            data-test="assistant-shell-elsewhere-status"
          >
            {{ elsewhere.line }}
          </OText>
          <OButton
            v-if="elsewhere.stalled"
            variant="ghost"
            size="sm"
            class="shrink-0 max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-shell-elsewhere-refresh"
            @click="refreshElsewhere"
          >
            {{ t("assistant.shell.refresh") }}
          </OButton>
          <OButton
            variant="outline"
            size="sm"
            :icon-left="assistantGlyph.stop"
            class="shrink-0 max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-shell-elsewhere-stop"
            @click="stopElsewhere"
          >
            {{ t("assistant.shell.stop") }}
          </OButton>
        </div>
        <OText
          v-if="elsewhere.approval"
          variant="meta"
          as="p"
          data-test="assistant-shell-elsewhere-approval"
        >
          {{ t("assistant.shell.approvalNotAnswerableHere") }}
        </OText>
      </div>
      <slot name="status-strip">
        <div
          v-if="strip || metered"
          class="border-border-default @container flex min-w-0 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t px-3 py-1"
          data-test="assistant-status-strip"
        >
          <AssistantTurnStatus
            v-if="strip?.status && session"
            variant="block"
            :turn="session.turn"
            :meta="session.turnMeta"
            :owned-by-this-tab="session.turnMeta.ownedByThisTab"
            class="min-w-0 flex-1"
            data-test="assistant-sticky-status"
          />
          <span v-else class="flex-1" />
          <OButton
            v-if="strip?.jump"
            variant="ghost"
            size="sm"
            :icon-left="assistantGlyph.jumpToLatest"
            :aria-label="jumpName"
            class="shrink-0 max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-scroll-latest"
            @click="jumpToLatest"
          >
            {{ jumpLabel }}
          </OButton>
          <OButton
            v-if="strip?.review"
            variant="outline"
            size="sm"
            :aria-label="t('assistant.strip.review')"
            class="shrink-0 max-md:min-h-11 max-md:w-full pointer-coarse:min-h-11"
            data-test="assistant-strip-review"
            @click="reviewRequest"
          >
            {{ reviewLabel }}
          </OButton>
          <OButton
            v-if="strip?.goToAnswer"
            variant="ghost"
            size="sm"
            class="shrink-0 max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-strip-go-to-answer"
            @click="goToAnswer"
          >
            {{ t("assistant.strip.goToAnswer") }}
          </OButton>
          <AssistantCreditMeter
            v-if="metered"
            size="compact"
            :usage="credits.usage.value"
            :overage="credits.overage.value"
            :status="credits.status.value"
            :can-manage="credits.canManage.value"
            :org-name="org"
            @retry="credits.retry()"
          />
        </div>
      </slot>
      <slot name="tray">
        <AssistantContextTray :sid="activeSid" :collapsed="trayCollapsed" :visible="visible" />
      </slot>
      <!-- A refusal stored nothing, so it sits above the composer that holds the restored prompt (`30` §4.2) -->
      <div v-if="refusal" class="shrink-0 px-3 pt-1.5">
        <AssistantTurnOutcome
          kind="refused"
          :error="refusal"
          :role="capability.isAdmin ? 'admin' : 'member'"
          :retry-snapshot-available="!!activeSid && store.canRetry(activeSid)"
          :at="refusalAt"
          :org="org"
          :sid="activeSid ?? undefined"
          :online="online"
          :persistence="capability.persistence"
          :signed-in="signedIn"
          :popup-blocked="popupBlocked"
          :credits="metered ? credits.refusal.value : undefined"
          @action="(action) => onOutcomeAction(activeSid!, action, refusalRecord!)"
          @open-here="openSignInHere"
          @retry-ready="onRetryReady"
        />
      </div>
      <p
        v-if="unknownNotice"
        class="text-text-secondary shrink-0 px-3 pb-1 text-xs"
        data-test="assistant-gate-unknown-notice"
      >
        {{ t("assistant.gate.noPermission.unknownNotice", { product }) }}
      </p>
      <!-- With B-06 reporting down, the gate replaces the composer -->
      <AssistantGateState
        v-if="composerLocked"
        reason="unhealthy"
        size="inline"
        :is-admin="capability.isAdmin"
        :context="{ org }"
      />
      <slot v-else name="composer">
        <AssistantComposer
          ref="composer"
          :sid="activeSid"
          :density="density"
          :ghost="ghost"
          :host="host"
          :visible="visible"
          :cooldown-reason="
            turnLock
              ? t(turnLockKey(turnLock))
              : session?.record.historyUnavailable
                ? t('assistant.thread.loadToContinue')
                : coolingDown
                  ? t('assistant.composer.rateLimited')
                  : undefined
          "
        />
      </slot>
      <slot name="disclosure">
        <div class="flex shrink-0 flex-col gap-1.5 px-3 pb-2">
          <OBanner
            v-if="disclosureBanner"
            variant="default"
            dense
            inline-actions
            :content="t('assistant.context.disclosure')"
            data-test="assistant-context-disclosure-banner"
          >
            <template #actions>
              <AssistantIconButton
                :label="t('assistant.context.disclosureDismiss')"
                :icon="assistantGlyph.close"
                data-test="assistant-context-disclosure-dismiss"
                @click="dismissDisclosure"
              />
            </template>
          </OBanner>
          <OText variant="meta" as="p" data-test="assistant-context-disclosure">
            {{ t("assistant.context.disclosureLine") }}
          </OText>
        </div>
      </slot>
    </div>

    <AssistantShareManager
      v-if="activeSid"
      v-model:open="shareManagerOpen"
      :sid="activeSid"
      initial-scope="chat"
    />

    <ODialog
      :open="learnOpen"
      size="md"
      :title="t('assistant.name')"
      data-test="assistant-shell-learn-dialog"
      @update:open="(open) => (learnOpen = open)"
    >
      <AssistantGateState
        v-if="learnOpen"
        reason="not_entitled"
        size="hero"
        learn-only
        :is-admin="capability.isAdmin"
        :context="{ org }"
        @action="(cta) => cta === 'close' && (learnOpen = false)"
      />
    </ODialog>
    <AssistantDraftHost />
  </component>
</template>

<script lang="ts">
import type { InjectionKey, Ref } from "vue";

import type { AssistantHostAdapter } from "@/composables/assistant";

export interface AssistantShellProps {
  placement: "sidebar" | "full" | "docked";
  /** Rendered inside OSheet below `lg`; changes density and the menu items only. */
  sheet?: boolean;
  host?: AssistantHostAdapter;
  density?: "compact" | "roomy";
}

export type ShellState =
  "gate" | "loading" | "not_found" | "deleted_elsewhere" | "unavailable" | "empty" | "conversation";

export type ShellRouteState = "idle" | "loading" | "not_found" | "deleted";

/** What the full view tells its shell about the chat its route asked for. */
export interface ShellRouteContext {
  state: Ref<ShellRouteState>;
  newChat(): void;
}

export const SHELL_ROUTE_CONTEXT: InjectionKey<ShellRouteContext> = Symbol("assistantShellRoute");

/** Tool-step announcements are spaced at least this far apart (`95` §2.2). */
export const STEP_ANNOUNCE_MS = 3_000;

// Every mounted shell sees one history outcome; only the first visible one speaks it.
const historySpoken = new WeakMap<object, number>();

// The last focus request a shell took, so a shell mounting after the open serves it once and a remount never refocuses.
const focusServed = new WeakMap<object, number>();
</script>

<script setup lang="ts">
import {
  computed,
  effectScope,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onScopeDispose,
  provide,
  ref,
  shallowRef,
  toRaw,
  watch,
  type ComputedRef,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import AssistantActionTimeline from "@/components/ai-assistant/approvals/AssistantActionTimeline.vue";
import AssistantApprovalCard from "@/components/ai-assistant/approvals/AssistantApprovalCard.vue";
import AssistantApprovalResult from "@/components/ai-assistant/approvals/AssistantApprovalResult.vue";
import {
  assistantApprovalsHostKey,
  type ApprovalCardDecision,
  type ApprovalCardView,
  type AssistantApprovalsHost,
} from "@/components/ai-assistant/approvals/approvals.types";
import AssistantConsentCard from "@/components/ai-assistant/credits/AssistantConsentCard.vue";
import AssistantCreditMeter from "@/components/ai-assistant/credits/AssistantCreditMeter.vue";
import AssistantCreditNotice from "@/components/ai-assistant/credits/AssistantCreditNotice.vue";
import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import AssistantMark from "@/components/ai-assistant/common/AssistantMark.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import AssistantComposer from "@/components/ai-assistant/composer/AssistantComposer.vue";
import {
  announceComposer,
  composerUi,
  noteDraftCleared,
} from "@/components/ai-assistant/composer/composerUi";
import AssistantDraftHost from "@/components/ai-assistant/evidence/AssistantDraftHost.vue";
import AssistantContextTray from "@/components/ai-assistant/context/AssistantContextTray.vue";
import AssistantGateState, {
  type GateCta,
} from "@/components/ai-assistant/gate/AssistantGateState.vue";
import AssistantThreadHeader, {
  assistantThreadHostKey,
} from "@/components/ai-assistant/thread/AssistantThreadHeader.vue";
import AssistantShareControl from "@/components/ai-assistant/share/AssistantShareControl.vue";
import AssistantShareManager from "@/components/ai-assistant/share/AssistantShareManager.vue";
import AssistantForkSource from "@/components/ai-assistant/thread/AssistantForkSource.vue";
import AssistantTranscript from "@/components/ai-assistant/transcript/AssistantTranscript.vue";
import AssistantTurnOutcome, {
  outcomeActionLabel,
  outcomeActionOf,
  type OutcomeAction,
} from "@/components/ai-assistant/turn/AssistantTurnOutcome.vue";
import AssistantTurnStatus from "@/components/ai-assistant/turn/AssistantTurnStatus.vue";
import AssistantWelcome from "@/components/ai-assistant/welcome/AssistantWelcome.vue";
import {
  approvalClock,
  approvalOutcomeOf,
  assistantApprovals,
  consentCardFor,
  orgDisplayName,
  isRunning,
  markHintSeen,
  noteAssistantKeydown,
  markSignedIn,
  queryRunOf,
  readHints,
  registerAssistantFocusTarget,
  turnLockKey,
  useAssistantCapability,
  useAssistantCredits,
  useAssistantName,
  useAssistantHistory,
  useAssistantStarters,
  useAssistantStore,
  useCreditNotice,
  useOtherAccountSignedIn,
  useSignedOutElsewhere,
  stopElsewhere as stopHeldTurn,
  useTurnLock,
  type AssistantError,
  type Container,
  type Sid,
  type GateReason,
  type Starter,
} from "@/composables/assistant";
import {
  assistantEvidenceHostKey,
  assistantSessionSourceKey,
  assistantTranscriptHostKey,
  type AssistantEvidenceHost,
  type AssistantTranscriptHost,
} from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { refreshSession } from "@/services/http";
import type { ChatMessage, TurnOutcomeRecord } from "@/ts/interfaces/chat";
import { raw, useI18nTyped } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { formatCount, formatOrgIsoDay } from "@/utils/formatters";

import AssistantContainerMenu from "./AssistantContainerMenu.vue";
import AssistantStatusRegion from "./AssistantStatusRegion.vue";
import { closeLockedPanel, useLockedPanel } from "./lockedPanel";

const props = withDefaults(defineProps<AssistantShellProps>(), {
  sheet: false,
  host: undefined,
  density: "compact",
});

defineSlots<{
  "container-actions"?: () => unknown;
  notice?: () => unknown;
  transcript?: () => unknown;
  cards?: () => unknown;
  "status-strip"?: () => unknown;
  tray?: () => unknown;
  composer?: () => unknown;
  disclosure?: () => unknown;
}>();

const { t, te } = useI18nTyped();
const { product } = useAssistantName();
const store = useAssistantStore();
const history = useAssistantHistory();
const capability = useAssistantCapability();
const lockedPanel = useLockedPanel();
const routeContext = inject(SHELL_ROUTE_CONTEXT, null);
const route = useRoute();
const router = useRouter();
const vuex = useStore();
const { lgUp, mdUp } = useBreakpoint();
const root = ref<HTMLElement | null>(null);
const lower = ref<HTMLElement | null>(null);
const noticeRow = ref<HTMLElement | null>(null);
const region = ref<InstanceType<typeof AssistantStatusRegion> | null>(null);
const threadHeader = ref<InstanceType<typeof AssistantThreadHeader> | null>(null);
const composer = ref<InstanceType<typeof AssistantComposer> | null>(null);
const transcript = ref<InstanceType<typeof AssistantTranscript> | null>(null);
const decisionsEl = ref<HTMLElement | null>(null);
const approvalCardEl = ref<InstanceType<typeof AssistantApprovalCard> | null>(null);
const consentCardEl = ref<InstanceType<typeof AssistantConsentCard> | null>(null);
const statusRowVisible = ref(true);
const online = ref(typeof navigator === "undefined" || navigator.onLine !== false);
const signedIn = ref(false);
const popupBlocked = ref(false);
const dismissedRefusal = shallowRef<unknown>(null);
const learnOpen = ref(false);
const shareManagerOpen = ref(false);
const openedByUser = ref(false);
const disclosureDismissed = ref(false);

const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const session = computed(() => store.state.sessions[store.state.shell.activeSid ?? ""] ?? null);
const activeSid = computed(() => store.state.shell.activeSid);
const gateReason = computed<GateReason>(() =>
  capability.gate.value === "off_for_org" ? "off_for_org" : "no_permission",
);

const state = computed<ShellState>(() => {
  const gate = capability.gate.value;
  if (gate === "no_permission" || gate === "off_for_org") return "gate";
  const routed = routeContext?.state.value ?? "idle";
  if (routed === "loading") return "loading";
  if (routed === "not_found") return "not_found";
  if (routed === "deleted") return "deleted_elsewhere";
  if (deletedHere.value && !session.value?.messages.length) return "deleted_elsewhere";
  if (!session.value) return store.state.ready ? "empty" : "loading";
  if (session.value.messages.length) return "conversation";
  return session.value.record.historyUnavailable ? "unavailable" : "empty";
});

const isTerminalBody = computed(
  () => state.value === "not_found" || state.value === "deleted_elsewhere",
);
const showTitle = computed(() => state.value !== "gate" && !isTerminalBody.value);
const b06 = computed(() => capability.value.source === "capabilities");
const signedOutElsewhere = useSignedOutElsewhere();
const otherAccount = useOtherAccountSignedIn();
const turnLock = useTurnLock(() => activeSid.value);
// The turn the hint stopped already says so in its own outcome; the row speaks only for the rest.
const notice = computed(() => {
  if (otherAccount.value) return "other_account" as const;
  if (signedOutElsewhere.value)
    return session.value?.turn.state === "failed" && session.value.turn.error.code === "signed_out"
      ? null
      : ("signed_out" as const);
  return capability.gate.value === "unhealthy" && !b06.value ? ("unhealthy" as const) : null;
});
const composerLocked = computed(() => capability.gate.value === "unhealthy" && b06.value);
const unknownNotice = computed(() => capability.unknownNotice.value);

const container = computed<Container>(() => {
  if (props.placement === "full") return "full_view";
  if (props.sheet || !lgUp.value) return "sheet";
  return props.placement === "docked" && props.host ? `docked.${props.host.id}` : "sidebar";
});

const headerDensity = computed(() =>
  props.placement === "docked" || props.sheet || !mdUp.value ? "dense" : "default",
);
provide(assistantThreadHostKey, { newChat });

const historyUnavailable = computed(
  () => state.value === "conversation" && !!session.value?.record.historyUnavailable,
);

// Another tab or device runs this turn: server truth by tail or poll, and Stop still reaches it.
const elsewhere = computed(() => {
  const current = session.value;
  if (!current || !isRunning(current.turn) || current.turnMeta.ownedByThisTab) return null;
  const view = history.elsewhere(current.sid);
  const mode = view?.mode ?? "hint";
  const line =
    mode === "polling"
      ? t("assistant.shell.answeringElsewherePolling")
      : mode === "stalled"
        ? t("assistant.shell.stillRunningRefresh")
        : t("assistant.shell.answeringElsewhere");
  return {
    line,
    stalled: mode === "stalled",
    // A card this tab holds again after a reload is answerable right here.
    approval: !!view?.approval && !approvalElsewhere.value && !current.pendingApproval,
  };
});

// The chat this container last showed; a deletion of it elsewhere replaces the body, never another chat.
const lastShownSid = ref<Sid | null>(null);
const deletedHere = ref<"tab" | "server" | null>(null);
watch(
  activeSid,
  (sid) => {
    if (!sid) return;
    lastShownSid.value = sid;
    deletedHere.value = null;
  },
  { immediate: true },
);
watch(
  () => history.deletedNotice.value,
  (notice) => {
    if (!notice) return;
    // A chat opened from a list replaces an empty body; a chat with a transcript is never replaced.
    if (
      notice.opening
        ? !session.value?.messages.length
        : notice.sid === lastShownSid.value && !activeSid.value
    )
      deletedHere.value = notice.via;
  },
);

watch(
  () => history.announcement.value?.seq,
  (seq) => {
    const text = history.announcement.value?.text;
    if (!seq || !text || !visible.value || seq <= (historySpoken.get(history) ?? 0)) return;
    historySpoken.set(history, seq);
    region.value?.announce(text);
  },
);

// The elsewhere line speaks when it appears and when polling gives up, never on every poll.
watch(
  () => (elsewhere.value ? (elsewhere.value.stalled ? "stalled" : "running") : null),
  (mode, before) => {
    if (!mode || mode === before || !visible.value || !elsewhere.value) return;
    region.value?.announce(elsewhere.value.line);
  },
);

async function retryHistory(): Promise<void> {
  const sid = activeSid.value;
  if (sid) await history.open({ sid }).catch(() => undefined);
}

function refreshElsewhere(): void {
  if (activeSid.value) history.refreshElsewhere(activeSid.value);
}

const visible = computed(() => {
  if (state.value === "gate") return props.placement === "sidebar" && !!lockedPanel.value;
  const kind = store.state.shell.placement.kind;
  return kind === props.placement;
});

const landmark = computed(() => {
  const name = t("assistant.name");
  if (props.sheet) return { tag: "div", attrs: {} };
  if (props.placement === "sidebar") return { tag: "aside", attrs: { "aria-label": name } };
  return { tag: "section", attrs: { role: "region", "aria-label": name } };
});

// Docked, the sheet and a sidebar at the 24 rem default or narrower show the collapsed tray (`40` §1.2).
const trayCollapsed = computed(
  () =>
    props.sheet ||
    props.placement === "docked" ||
    (props.placement === "sidebar" && store.state.shell.sidebarWidthRem <= 24),
);

// Every credit surface is Cloud only and never on a locked door.
const metered = computed(
  () => capability.value.edition === "cloud" && capability.assistantCanChat.value,
);
const credits = useAssistantCredits(
  () => org.value,
  () => metered.value,
  () => capability.value.isAdmin,
);
// The row shows one banner; a credit notice behind another one has not been seen.
const creditNotice = useCreditNotice(
  () => store.state.userOrgKey,
  () => credits.usage.value,
  () => metered.value && visible.value && !notice.value && !historyUnavailable.value,
);
const creditThreshold = computed(() => creditNotice.threshold.value);

// The fuller disclosure shows once per user+org on the first attachment, and again in a shared chat (CT-04 AC 5).
const disclosureBanner = computed(() => {
  const current = session.value;
  const key = store.state.userOrgKey;
  if (!current || !key || disclosureDismissed.value) return false;
  // One notice at a time: the cleared notice wins while its Undo is offered.
  if (composerUi(current.sid).cleared) return false;
  if (!current.composer.chips.some((chip) => chip.provenance !== "page")) return false;
  return !!current.share || !readHints(key).disclosure;
});

// The welcome's data is built only once the welcome shows, so a gated container never reads it (IW-05 AC 10).
const welcomeScope = effectScope();
const welcome = shallowRef<ReturnType<typeof useAssistantStarters> | null>(null);
const page = () => (props.placement === "full" ? "assistant" : String(route.name ?? ""));
watch(
  () => state.value === "empty",
  (empty) => {
    if (!empty || welcome.value) return;
    welcome.value =
      welcomeScope.run(() => useAssistantStarters({ page, host: props.host })) ?? null;
  },
  { immediate: true },
);
onScopeDispose(() => welcomeScope.stop());

// The ghost is the first starter the welcome offers, never a recent chat (`70` §5).
const ghost = computed(() => {
  const first =
    state.value === "empty" ? welcome.value?.starters.value.find((s) => s.kind !== "recent") : null;
  return first
    ? { label: first.label, text: first.prompt, chips: first.chips, kind: first.kind }
    : null;
});

// The transcript imports no store (constraint 29); the shell hands it the session and the actions it may ask for.
const messageSources = new Map<string, ComputedRef<ChatMessage[]>>();
provide(assistantSessionSourceKey, (sid) => {
  let source = messageSources.get(sid);
  if (!source) {
    source = computed(() => store.state.sessions[sid]?.messages ?? []);
    messageSources.set(sid, source);
  }
  return source;
});

const transcriptHost: AssistantTranscriptHost = {
  session: (sid) => store.state.sessions[sid] ?? null,
  setFollow: (sid, follow) => store.setFollow(sid, follow),
  setScroll(sid, top) {
    const target = store.state.sessions[sid];
    if (target) target.scroll.top = top;
  },
  selectVersion: (sid, turnId, n) => store.selectVersion(sid, turnId, n),
  outcomeAction: (sid, action, outcome) => onOutcomeAction(sid, action, outcome),
  isAdmin: () => capability.value.isAdmin,
  persistence: () => capability.value.persistence,
  online: () => online.value,
  canRetry: (sid) => store.canRetry(sid),
  focusComposer: focusAfterAction,
};
provide(assistantTranscriptHostKey, transcriptHost);

// Every evidence action goes through the store's dispatch; the shell only lends it session state.
const evidenceHost: AssistantEvidenceHost = {
  dispatch: (sid, action) => store.dispatch(sid, action),
  session: (sid) => store.state.sessions[sid] ?? null,
  capability: () => capability.value,
  queryRun: (sid, blockId) => queryRunOf(sid, blockId),
  prefersNewTab: () => props.placement === "docked" || props.host?.isDirty() === true,
  currentOrg: () => org.value || null,
  markOpened: (sid, blockId) =>
    store.annotate(sid, blockId, { linkOutcome: { openedAt: Date.now() } }),
  toggleStep: (sid, callId) => store.toggleStep(sid, callId),
  announce: (sid, text) => announceComposer(sid, text),
  host: () => (props.placement === "docked" ? (props.host ?? null) : null),
};
provide(assistantEvidenceHostKey, evidenceHost);

const role = computed(() => (capability.value.isAdmin ? "admin" : "member"));

const refusal = computed<AssistantError | null>(() => {
  const turn = session.value?.turn;
  if (turn?.state !== "refused" || dismissedRefusal.value === toRaw(turn)) return null;
  return turn.error;
});

const refusalRecord = computed<TurnOutcomeRecord | null>(() =>
  refusal.value
    ? {
        kind: "failed",
        code: refusal.value.code,
        ...(refusal.value.turnId && { turnId: refusal.value.turnId }),
      }
    : null,
);

// The refusal's own end time, kept on the session, so a remounted shell shows the same deadline.
const refusalSeenAt = ref(Date.now());
const refusalAt = computed(() => session.value?.turnMeta.endedAt ?? refusalSeenAt.value);
const clock = ref(Date.now());
let cooldownTimer: ReturnType<typeof setInterval> | null = null;
const cooldownUntil = computed(() => {
  const error = refusal.value;
  return error?.code === "rate_limited" && error.retryAfterMs
    ? refusalAt.value + error.retryAfterMs
    : 0;
});
// Send waits out the same `retry_after` as the refusal's Retry, so the two paths agree (`80` §2.4).
const coolingDown = computed(() => cooldownUntil.value > clock.value);

// The strip speaks the status row's text while the row is out of view, and holds the one keyboard bridge (`30` §1.6, §3.2).
const strip = computed(() => {
  const current = session.value;
  if (!current || state.value !== "conversation") return null;
  const status = isRunning(current.turn) && !statusRowVisible.value;
  const jump = !current.ui.follow;
  // With no answer text there is nothing to go to; the outcome block is the latest content.
  const goToAnswer =
    ["done", "stopped", "failed"].includes(current.turn.state) && hasAnswerText(current.messages);
  // The keyboard bridge to a pending card; it stays while the card does, so the strip never shifts under a click.
  const review =
    (!!approvalCard.value && !approvalSending.value) ||
    (!!consentCard.value &&
      consentCard.value.state !== "resolved_here" &&
      consentCard.value.state !== "resolved_elsewhere");
  return status || jump || goToAnswer || review
    ? { status, jump, goToAnswer: goToAnswer && !review, review }
    : null;
});

const unseen = computed(() => session.value?.ui.unseen ?? 0);
const jumpLabel = computed(() =>
  unseen.value > 0
    ? t("assistant.scroll.jumpToLatestCount", { count: unseen.value })
    : t("assistant.scroll.jumpToLatest"),
);
const jumpName = computed(() =>
  unseen.value > 0
    ? t("assistant.scroll.jumpToLatestName", { count: unseen.value })
    : t("assistant.scroll.jumpToLatest"),
);

// The cards render in the visible container only; a hidden one shows the header light and its toast.
const decisions = computed(() => {
  const current = session.value;
  if (!current || !visible.value || state.value !== "conversation") return null;
  const unreviewed = current.messages.flatMap((message) =>
    (message.contentBlocks ?? []).flatMap((block) =>
      block.policy?.kind === "unreviewed" ? [block.policy] : [],
    ),
  );
  return { sid: current.sid, org: current.org, ledger: current.ledger, unreviewed };
});

const approvalCard = computed<ApprovalCardView | null>(() => {
  const current = session.value;
  const pending = current?.pendingApproval;
  if (!decisions.value || !current || !pending) return null;
  const block = current.messages
    .flatMap((message) => message.contentBlocks ?? [])
    .find((candidate) => candidate.approval?.id === pending.id)?.approval;
  return { typed: false, ...block, ...pending };
});

const approvalSending = computed(() => {
  const id = approvalCard.value?.id;
  return !!id && approvalOutcomeOf(session.value, id).outcome?.state === "sending";
});

const approvalElsewhere = computed(
  () => !!decisions.value && turnLock.value === "approval_elsewhere",
);

const consentCard = computed(() =>
  decisions.value ? consentCardFor(session.value, orgNameOf, "card") : null,
);

const reviewClock = ref(Date.now());
let reviewTimer: ReturnType<typeof setInterval> | null = null;
const reviewLabel = computed(() => {
  const until = approvalCard.value?.expiresAt;
  if (typeof until !== "number") return t("assistant.strip.review");
  return t("assistant.strip.reviewExpires", {
    time: raw(approvalClock(until - reviewClock.value)),
  });
});

const approvalsHost: AssistantApprovalsHost = {
  pendingId: (sid) => store.state.sessions[sid]?.pendingApproval?.id ?? null,
  currentUser: () => vuex.state.userInfo?.email ?? "",
  sendAgain: (sid, id) => void assistantApprovals()?.sendAgain(sid, id),
  askAgain: (sid, id) => void assistantApprovals()?.askAgain(sid, id),
  stop: (sid) => void stopHeldTurn(sid),
  undo: (sid, ledgerId) =>
    assistantApprovals()?.undo(sid, ledgerId) ?? Promise.resolve({ ok: false, reason: "failed" }),
};
provide(assistantApprovalsHostKey, approvalsHost);

function orgNameOf(id: string): string {
  return orgDisplayName(id, vuex.state.selectedOrganization);
}

function onDecide({ decision, approvalId }: ApprovalCardDecision): void {
  const sid = activeSid.value;
  if (sid) void store.decideApproval(sid, decision, approvalId);
}

// Reply is the composer's own mode: one text entry, its Enter answers the card.
function onReply(): void {
  const sid = activeSid.value;
  const id = approvalCard.value?.id;
  if (!sid || !id) return;
  store.startReply(sid, id);
  void nextTick(() => composer.value?.focusInput("end"));
}

function onExtend(): void {
  const sid = activeSid.value;
  if (sid) void assistantApprovals()?.extend(sid);
}

function stopElsewhere(): void {
  const sid = activeSid.value;
  if (sid) approvalsHost.stop(sid);
}

function resolveConsent(accepted: boolean, acknowledged = false): void {
  const sid = activeSid.value;
  if (!sid) return;
  void store.resolveConsent(sid, accepted, acknowledged);
  if (!accepted) focusAfterAction();
}

function trackConsent(step: "view_billing" | "ask_admin"): void {
  const card = consentCard.value;
  if (!card) return;
  trackAssistant("ai_consent", {
    step,
    surface: "chat",
    org_match: card.orgId === org.value,
    plan_type: card.planType,
  });
}

function reviewRequest(): void {
  decisionsEl.value?.scrollIntoView?.({ block: "nearest" });
  if (approvalCardEl.value?.focusDefault()) return;
  consentCardEl.value?.focusHeading();
}

function jumpToLatest(): void {
  trackAssistant("ai_scroll_jump", { unseen: unseen.value });
  transcript.value?.jumpToLatest();
}

function goToAnswer(): boolean {
  return !!transcript.value?.focusLatestAnswer();
}

// A failure or refusal says its state word and names its one action in the same sentence (`95` §2.2).
function announcementText(key: string, params: Record<string, unknown>): ReturnType<typeof t> {
  const text = t(key, params);
  const turn = session.value?.turn;
  if (
    !key.startsWith("assistant.error.") ||
    (turn?.state !== "failed" && turn?.state !== "refused")
  )
    return text;
  const state = turn.state === "failed" ? "failed" : "notSent";
  // While `retry_after` runs, Retry is unavailable, so the line names the wait, not an available action.
  const waitMs = turn.error.retryAfterMs
    ? (session.value?.turnMeta.endedAt ?? Date.now()) + turn.error.retryAfterMs - Date.now()
    : 0;
  if (waitMs > 0)
    return t(`assistant.announce.${state}RetryIn`, { title: text, s: Math.ceil(waitMs / 1000) });
  const action = outcomeActionOf(turn.state, turn.error, {
    role: role.value,
    persistence: capability.value.persistence,
    signedIn: signedIn.value,
  });
  if (!action) return t(`assistant.announce.${state}`, { title: text });
  const label = outcomeActionLabel(action, turn.error.code, role.value, t, te);
  return t(`assistant.announce.${state}WithAction`, { title: text, action: label });
}

// Tool steps are spoken at most once per STEP_ANNOUNCE_MS, the latest one winning (`95` §2.2).
function announceLine(key: string, params: Record<string, unknown>): void {
  const text = announcementText(key, params);
  if (stepTimer) clearTimeout(stepTimer);
  stepTimer = null;
  const wait = stepSpokenAt + STEP_ANNOUNCE_MS - Date.now();
  if (!key.startsWith("assistant.step.") || wait <= 0) {
    if (key.startsWith("assistant.step.")) stepSpokenAt = Date.now();
    return region.value?.announce(text);
  }
  stepTimer = setTimeout(() => {
    stepTimer = null;
    stepSpokenAt = Date.now();
    region.value?.announce(text);
  }, wait);
}

function onOutcomeAction(sid: string, action: OutcomeAction, outcome: TurnOutcomeRecord): void {
  const query = { org_identifier: org.value };
  const started = document.activeElement;
  switch (action) {
    case "ask_again":
      if ((outcome.kind === "expired" || outcome.code === "approval_expired") && askAgainCard(sid))
        return focusAfterAction();
      signedIn.value = false;
      void store.retry(sid);
      return focusAfterAction();
    case "retry":
      signedIn.value = false;
      void store.retry(sid);
      return focusAfterAction();
    case "continue":
      store.continueTurn(sid);
      return focusEntry();
    case "edit_resend":
      return stagePrompt(sid, outcome.turnId);
    case "stop_it":
      void stopBusy(sid).then((stopped) => stopped && focusAfterRequest(started));
      return;
    case "sign_in":
      return signIn();
    case "retry_save":
      void store.retrySave(sid, outcome.turnId ?? store.state.sessions[sid]?.turnMeta.turnId ?? "");
      return focusAfterAction();
    case "reload_chat":
      void store.openSession({ sid }).then(
        () => focusAfterRequest(started),
        () => undefined,
      );
      return;
    case "open_iam_roles":
      return void router.push({ name: "roles", query }).catch(() => undefined);
    case "manage_usage":
    case "view_plans":
      return void router.push({ name: "plans", query }).catch(() => undefined);
    case "copy_request":
      return copyCreditRequest();
    default:
      return;
  }
}

// What an account manager needs to add credits: the org, its count when known, and the day.
function copyCreditRequest(): void {
  const usage = credits.usage.value;
  const params = { org: raw(org.value), date: raw(formatOrgIsoDay(Date.now())) };
  const text = usage
    ? t("assistant.credits.copyRequest", {
        ...params,
        used: raw(formatCount(usage.credits_used)),
        limit: raw(formatCount(usage.credits_limit)),
      })
    : t("assistant.credits.copyRequestNoUsage", params);
  void copyToClipboard(text, t, { successMessage: t("common.copied") });
}

// The notice unmounts with focus inside it; the composer takes focus back instead of the page body.
function dismissCreditNotice(): void {
  const hadFocus = !!noticeRow.value?.contains(document.activeElement);
  creditNotice.dismiss();
  if (hadFocus) void nextTick(focusEntry);
}

// An expired card asks for itself again in one short turn, never a resend of the original prompt.
function askAgainCard(sid: string): boolean {
  const id = [...(store.state.sessions[sid]?.messages ?? [])]
    .reverse()
    .flatMap((message) => [...(message.contentBlocks ?? [])].reverse())
    .find((block) => block.approval)?.approval?.id;
  const approvals = assistantApprovals();
  if (!id || !approvals) return false;
  void approvals.askAgain(sid, id);
  return true;
}

function hasAnswerText(messages: ChatMessage[]): boolean {
  const last = messages.at(-1);
  return (
    last?.role === "assistant" &&
    !!last.contentBlocks?.some((block) => block.type === "text" && !!block.text?.trim())
  );
}

// A half sheet grows so the new outcome's title and action fit; no "Expanded.", the outcome's own line is speaking (`30` §4.3).
function onOutcomeShown(): void {
  if (props.sheet && store.state.shell.sheetSnap === "half") store.setSheetSnap("full");
}

function onRetryReady(): void {
  clock.value = Date.now();
  region.value?.announce(t("assistant.outcome.canRetryNow"));
}

// After a round-trip, focus moves only if the reader is still on the control that started it (or it unmounted).
function focusAfterRequest(started: Element | null): void {
  void nextTick(() => {
    const active = document.activeElement;
    if (active === started || !active || active === document.body) focusEntry();
  });
}

// The pressed control unmounts with its block or bar, so focus goes to the composer, never to the page.
function focusAfterAction(): void {
  void nextTick(focusEntry);
}

// Edit and resend from an outcome puts the original prompt back in the composer; nothing sends (HT-02 edge).
function stagePrompt(sid: string, turnId: string | undefined): void {
  const messages = store.state.sessions[sid]?.messages ?? [];
  const prompt =
    messages.find((message) => message.role === "user" && message.turnId === turnId) ??
    [...messages].reverse().find((message) => message.role === "user");
  if (!prompt) return;
  store.stage(sid, {
    text: String(prompt.content ?? ""),
    chips: (prompt.chips ?? []).map((chip) => ({ ...toRaw(chip) })),
    mode: "replace",
  });
  focusEntry();
}

// `turn_busy`'s Stop it cancels the turn that holds the lease, never the refused one (B-03).
async function stopBusy(sid: string): Promise<boolean> {
  const turn = store.state.sessions[sid]?.turn;
  const activeTurnId = turn?.state === "refused" ? (turn.error.turnId ?? null) : null;
  const stopped = await store.cancelTurn(sid, activeTurnId);
  region.value?.announce(
    stopped ? t("assistant.outcome.stopItSent") : t("assistant.outcome.stopItFailed"),
  );
  if (stopped && turn) dismissedRefusal.value = toRaw(turn);
  return stopped;
}

let awaitingSignIn = false;
let stepTimer: ReturnType<typeof setTimeout> | null = null;
let stepSpokenAt = Number.NEGATIVE_INFINITY;

// The sign-in runs in a new tab so this one keeps its page and draft (`80` §2.3; round 1 E-01).
function signIn(): void {
  awaitingSignIn = true;
  // Without `noopener` a blocked tab shows as null; the tab is this app's own page and loses its opener at once.
  const tab = window.open(router.resolve({ name: "closeTab" }).href, "_blank");
  if (tab) tab.opener = null;
  popupBlocked.value = !tab;
}

// This tab's chats belong to the signed-out account; only a fresh page load takes the new one.
function reloadPage(): void {
  window.location.reload();
}

// Signing in here reloads this page, so the sign-in returns to it and the saved draft comes back.
function openSignInHere(): void {
  store.drafts.flush();
  window.location.reload();
}

async function onVisibility(): Promise<void> {
  if (!awaitingSignIn || document.visibilityState !== "visible") return;
  awaitingSignIn = false;
  if ((await refreshSession()) !== "refreshed") return;
  signedIn.value = true;
  markSignedIn();
  region.value?.announce(t("assistant.outcome.signedIn"));
}

function onOnline(): void {
  online.value = true;
  if (refusal.value?.code === "offline") region.value?.announce(t("assistant.outcome.backOnline"));
}

function onOffline(): void {
  online.value = false;
}

const offs: (() => void)[] = [];

onMounted(() => {
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisibility);
  offs.push(
    registerAssistantFocusTarget("answer", () => visible.value && goToAnswer()),
    () => window.removeEventListener("online", onOnline),
    () => window.removeEventListener("offline", onOffline),
    () => document.removeEventListener("visibilitychange", onVisibility),
  );
});

onBeforeUnmount(() => {
  offs.forEach((off) => off());
  if (stepTimer) clearTimeout(stepTimer);
  if (cooldownTimer) clearInterval(cooldownTimer);
  if (reviewTimer) clearInterval(reviewTimer);
});

// The strip's countdown runs only while a card with a known expiry is shown.
watch(
  () => typeof approvalCard.value?.expiresAt === "number",
  (counting) => {
    if (reviewTimer) clearInterval(reviewTimer);
    reviewTimer = counting ? setInterval(() => (reviewClock.value = Date.now()), 1_000) : null;
  },
  { immediate: true },
);

// A resolved card unmounts under the pressed button; focus goes to its record's action, else the composer.
watch(
  () => [session.value?.pendingApproval?.id ?? null, !!session.value?.pendingConsent] as const,
  async ([id, consent], [before, hadConsent]) => {
    if ((!before || id) && (!hadConsent || consent)) return;
    await nextTick();
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const action = before
      ? root.value?.querySelector<HTMLElement>(
          `[data-approval-id="${CSS.escape(before)}"] :is(a, button)`,
        )
      : null;
    if (action) action.focus();
    else focusEntry();
  },
);

watch(
  cooldownUntil,
  (until) => {
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = null;
    clock.value = Date.now();
    if (until <= clock.value) return;
    cooldownTimer = setInterval(() => {
      clock.value = Date.now();
      if (clock.value < until || !cooldownTimer) return;
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }, 1_000);
  },
  { immediate: true },
);

let restoredText: string | null = null;

// Read after the restore lands, so the restored prompt itself never counts as an edit.
watch(
  refusal,
  (error) => {
    if (error) refusalSeenAt.value = Date.now();
    restoredText = error ? (session.value?.composer.text ?? "") : null;
  },
  { flush: "post" },
);

// A declined consent note clears on the first keystroke after it (CC-06 AC 4).
watch(
  () => session.value?.composer.text,
  (text) => {
    const turn = session.value?.turn;
    if (turn?.state !== "refused" || turn.error.code !== "consent_declined") return;
    if (restoredText !== null && text !== restoredText) dismissedRefusal.value = toRaw(turn);
  },
);

function dismissDisclosure(): void {
  disclosureDismissed.value = true;
  const key = store.state.userOrgKey;
  if (key) markHintSeen(key, "disclosure");
}

function recordKeydown(): void {
  noteAssistantKeydown();
}

function focusEntry(): void {
  if (composer.value) return composer.value.focusInput("end");
  const el = root.value;
  const target =
    el?.querySelector<HTMLElement>("[data-assistant-composer]") ??
    el?.querySelector<HTMLElement>('[data-test="assistant-gate-state"] button') ??
    el;
  target?.focus();
}

function ensureSession(): string {
  return (
    store.state.shell.activeSid ??
    store.createSession({
      origin: { entryKind: "empty_state", objectKind: "none", container: container.value },
    })
  );
}

function onStarter(starter: Starter): void {
  const sid = ensureSession();
  if (composer.value) return composer.value.prefill({ text: starter.prompt, chips: starter.chips });
  const draft = store.state.sessions[sid]?.composer.text.trim() ?? "";
  store.stage(sid, {
    chips: starter.chips,
    text: starter.prompt,
    mode: draft ? "append" : "replace",
  });
  focusEntry();
}

// A deleted chat shows its own state; any other failure says so instead of doing nothing.
function onOpenChat(target: { sid: Sid } | { chatId: number }): void {
  void store.openSession(target, { focus: true }).catch((err: { code?: string } | null) => {
    if (err?.code === "deleted_elsewhere") return;
    void toast({ variant: "error", message: t("assistant.history.openFailed") });
  });
}

/** New from outside the header (the full view's rail): the header's guard and the shell's drafts still apply. */
function askNew(): void {
  if (threadHeader.value) threadHeader.value.askNew();
  else newChat();
}

// The previous chat keeps its draft; "Bring it here" moves it into the new chat (SH-03 AC 6, CT-06 AC 5, V6).
function newChat(): void {
  deletedHere.value = null;
  history.clearDeletedNotice();
  if (routeContext) return routeContext.newChat();
  const previous = session.value;
  const { text = "", chips = [], images = [] } = previous?.composer ?? {};
  const drafted = !!text.trim() || chips.length > 0 || images.length > 0;
  // A card the old chat still waits on is declined, so the new chat starts free.
  if (previous?.pendingApproval)
    void store.decideApproval(previous.sid, { approved: false, reason: "new_chat" });
  store.setActive(null);
  const sid = ensureSession();
  if (!previous || !drafted || previous.sid === sid) return;
  noteDraftCleared(sid, { token: null, from: previous.sid, at: Date.now() });
  trackAssistant("ai_composer_cleared", { reason: "new_chat", undone: false });
}

// Under a cross-tab lock the retry is refused; the reader hears why instead of nothing happening.
function retry(): void {
  const sid = store.state.shell.activeSid;
  if (!sid) return;
  if (turnLock.value) return region.value?.announce(t(turnLockKey(turnLock.value)));
  void store.retry(sid);
}

// The locked sidebar has no placement to move, so its full view is the route's hero gate.
function openInFullView(): void {
  if (state.value === "gate") {
    closeLockedPanel("move");
    void router.push({ name: "assistant" });
    return;
  }
  const sid = store.state.shell.activeSid;
  trackAssistant("ai_container_moved", {
    from: store.state.shell.sidebarMode,
    to: "full",
    turn_running: !!session.value && !isAtRest(session.value.turn.state),
  });
  store.moveTo({ kind: "full" });
  void router.push({ name: "assistant", params: sid ? { chatId: sid } : {} });
}

function closeContainer(): void {
  trackAssistant("ai_container_closed", { reason: "close" });
  closeLockedPanel();
  store.close("close");
  if (props.placement !== "full" || route.name !== "assistant") return;
  if (window.history.state?.back) router.back();
  else void router.push("/");
}

function onGateAction(cta: GateCta): void {
  if (cta === "learn_more") learnOpen.value = true;
}

function isAtRest(turn: string): boolean {
  return ["idle", "done", "failed", "refused", "stopped"].includes(turn);
}

// An explicit open focuses the composer once; the sheet keeps it mounted, so this works there too.
watch(
  () => store.focusRequest.value?.seq,
  async (seq) => {
    if (seq === undefined || !visible.value) return;
    focusServed.set(store, seq);
    openedByUser.value = true;
    await nextTick();
    focusEntry();
  },
);

// A late request is served only while it is the latest and focus has not moved on; a rejected one is retired so no remount replays it.
function lateRequestVerdict(seq: number): "serve" | "retire" | "skip" {
  const request = store.focusRequest.value;
  if (!request || request.seq !== seq || focusServed.get(store) === seq || !visible.value)
    return "skip";
  if (request.superseded) return "retire";
  const active = document.activeElement;
  if (!active || active === document.body || root.value?.contains(active)) return "serve";
  return active === request.from?.deref() ? "serve" : "retire";
}

// Records the verdict and says whether to serve; only a visible shell retires, so a hidden placement never voids the visible one's request.
function takeLateRequest(seq: number): boolean {
  const verdict = lateRequestVerdict(seq);
  if (verdict !== "skip") focusServed.set(store, seq);
  return verdict === "serve";
}

// The host chunk can load after a click or chord already opened it, so no seq change is left for the watcher above.
onMounted(async () => {
  const seq = store.focusRequest.value?.seq;
  if (seq === undefined) return;
  if (lateRequestVerdict(seq) !== "serve") {
    takeLateRequest(seq);
    return;
  }
  await nextTick();
  if (!takeLateRequest(seq)) return;
  openedByUser.value = true;
  focusEntry();
  region.value?.announce(t("assistant.announce.opened", { product }));
});

// Only an open that asked for focus is the user's; a restore or a silent route enter says nothing.
let seqWhenHidden = store.focusRequest.value?.seq;
watch(visible, async (shown) => {
  if (!shown) {
    seqWhenHidden = store.focusRequest.value?.seq;
    openedByUser.value = false;
    return;
  }
  await nextTick();
  if (store.focusRequest.value?.seq !== seqWhenHidden || openedByUser.value)
    region.value?.announce(t("assistant.announce.opened", { product }));
});

watch(
  () => lockedPanel.value,
  async (locked) => {
    if (!locked || props.placement !== "sidebar") return;
    openedByUser.value = true;
    await nextTick();
    region.value?.announce(t("assistant.gate.announce.locked", { product }));
  },
  { immediate: true },
);

watch(
  () => store.announcement.value,
  (line) => {
    if (!line || !visible.value || line.sid !== store.state.shell.activeSid) return;
    announceLine(line.key, line.params ?? {});
  },
);

watch(
  () => state.value === "loading" && visible.value,
  (loading) => {
    if (loading) region.value?.announce(t("assistant.shell.loadingChat"));
  },
);

// A half sheet whose composer area no longer fits grows to full, so no chip, cap line or control hides in a scroll box (V5).
watch(lower, (el, _was, onCleanup) => {
  if (!el || !props.sheet || typeof ResizeObserver === "undefined") return;
  // Only content that grew moves the snap; a user who drags back to half is not bounced to full.
  let lastContent = 0;
  const grow = () => {
    // A peeked or closed sheet measures 0; that is not content shrinking, so it never makes the next show look like growth.
    if (!el.clientHeight) return;
    const grew = el.scrollHeight > lastContent + 1;
    lastContent = el.scrollHeight;
    if (!grew) return;
    const shell = root.value;
    const overflows =
      el.scrollHeight > el.clientHeight + 1 ||
      (!!shell && shell.scrollHeight > shell.clientHeight + 1);
    if (!overflows || store.state.shell.sheetSnap !== "half") return;
    store.setSheetSnap("full");
    region.value?.announce(t("assistant.announce.sheetExpanded"));
  };
  const sizes = new ResizeObserver(grow);
  const watchChildren = () => {
    sizes.disconnect();
    sizes.observe(el);
    for (const child of Array.from(el.children)) sizes.observe(child);
  };
  const children = new MutationObserver(watchChildren);
  children.observe(el, { childList: true });
  watchChildren();
  onCleanup(() => {
    sizes.disconnect();
    children.disconnect();
  });
});

defineExpose({ askNew });
</script>
