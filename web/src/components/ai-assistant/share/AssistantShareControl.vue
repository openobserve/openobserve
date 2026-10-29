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
  <ODropdownItem
    v-if="variant === 'menu-item' && state.kind !== 'absent'"
    :icon-left="assistantGlyph.share"
    :disabled="state.kind === 'blocked'"
    :focusable-unavailable="state.kind === 'blocked'"
    :description="state.kind === 'blocked' ? t(state.reason) : null"
    data-test="assistant-thread-menu-share"
    @select="onMenuSelect"
    >{{
      state.kind === "manage" ? t("assistant.share.manageLinks") : t("assistant.share.share")
    }}</ODropdownItem
  >
  <span
    v-else-if="state.kind !== 'absent'"
    ref="rootEl"
    class="inline-flex min-w-0 flex-wrap items-center gap-1"
    data-test="assistant-share-control"
  >
    <component :is="mdUp ? OPopover : ODrawer" v-model:open="open" v-bind="surfaceProps">
      <template v-if="mdUp" #anchor>
        <span class="inline-flex min-w-0 flex-wrap items-center gap-1">
          <AssistantShareChip :share="summary" @open="openSettings('copy')" />
          <OButton
            variant="ghost"
            size="sm"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            :icon-left="assistantGlyph.share"
            :disabled="state.kind === 'blocked' || creating"
            :focusable-unavailable="state.kind === 'blocked'"
            :loading="creating"
            data-test="assistant-thread-share"
            @click="onShare"
          >
            {{ t("assistant.share.share") }}
            <template v-if="state.kind === 'blocked'" #unavailable-reason>{{
              t(state.reason)
            }}</template>
            <OTooltip :content="t(state.kind === 'blocked' ? state.reason : state.tooltip)" />
          </OButton>
        </span>
      </template>
      <AssistantShareSettings
        v-if="open"
        ref="settings"
        :org="org"
        :sid="sid"
        :share="current"
        :running="running"
        :public-links="capability.publicLinks"
        :public-max-expiry-days="capability.publicMaxExpiryDays"
        :redact-attachments="redactAttachments"
        :has-attachments="attachments"
        :link-count="shares.length"
        @created="onCreated"
        @revoked="open = false"
        @see-all="seeAll"
        @announce="announce"
      />
    </component>
    <template v-if="!mdUp">
      <AssistantShareChip :share="summary" @open="openSettings('copy')" />
      <OButton
        variant="ghost"
        size="sm"
        class="min-h-11"
        :icon-left="assistantGlyph.share"
        :disabled="state.kind === 'blocked' || creating"
        :focusable-unavailable="state.kind === 'blocked'"
        :loading="creating"
        data-test="assistant-thread-share"
        @click="onShare"
      >
        {{ t("assistant.share.share") }}
        <template v-if="state.kind === 'blocked'" #unavailable-reason>{{
          t(state.reason)
        }}</template>
      </OButton>
    </template>
  </span>
</template>

<script lang="ts">
import type { Sid } from "@/composables/assistant";

export interface AssistantShareControlProps {
  sid: Sid;
  variant: "header" | "menu-item";
}

export interface AssistantShareControlEmits {
  /** The menu item's Manage links and review, and the popover's See all: the manager scoped to this chat. */
  (e: "manage"): void;
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import {
  useAssistantCapability,
  useAssistantSession,
  useAssistantStore,
} from "@/composables/assistant";
import { isTerminal } from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { ShareView } from "@/services/ai_chat_share";
import { chatSharesQuery } from "@/services/ai_chat_share.queries";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped, type I18nKey } from "@/types/i18n";

import AssistantShareChip from "./AssistantShareChip.vue";
import AssistantShareSettings from "./AssistantShareSettings.vue";
import { checkAttachments, knownAttachments } from "./chatAttachments";
import { canRedactAttachments, shareButtonState, summarizeShares } from "./chatShare";
import { isShareDenied, useQuickShare } from "./useQuickShare";

const props = defineProps<AssistantShareControlProps>();

const emit = defineEmits<AssistantShareControlEmits>();

const { t } = useI18nTyped();
const vuex = useStore();
const store = useAssistantStore();
const capability = useAssistantCapability();
const view = useAssistantSession(() => props.sid);
const quickShare = useQuickShare();
const { mdUp } = useBreakpoint();

const open = ref(false);
const creating = ref(false);
const focusOnOpen = ref<"copy" | "field" | "link">("copy");
const settings = ref<InstanceType<typeof AssistantShareSettings> | null>(null);
const rootEl = ref<HTMLElement | null>(null);
// A just-created link shows in the popover before the list re-reads.
const created = ref<ShareView | null>(null);

const org = computed(
  () => view.session.value?.org ?? vuex.state.selectedOrganization?.identifier ?? "",
);
const sharesRead = useQuery(() =>
  Object.assign(chatSharesQuery(org.value, props.sid), {
    enabled: !!org.value && !!props.sid && capability.value.persistence,
  }),
);
const shares = computed<ShareView[]>(() => {
  const list = sharesRead.data.value ?? [];
  const fresh = created.value;
  return fresh && !list.some((item) => item.id === fresh.id) ? [fresh, ...list] : list;
});
const current = computed<ShareView | null>(() => shares.value[0] ?? null);
const lastSeq = computed(
  () => view.session.value?.record.cachedLastSeq ?? view.session.value?.turnMeta.lastSeq ?? null,
);
const summary = computed(() => summarizeShares(shares.value, lastSeq.value));
const running = computed(() => {
  const turn = view.turn.value;
  return !!turn && turn.state !== "idle" && !isTerminal(turn);
});
const known = computed(() =>
  knownAttachments(org.value, props.sid, view.session.value ? view.messages.value : undefined),
);
// Unknown counts as present: a row's chat is checked before a one-click link leaves it.
const attachments = computed(() => known.value !== "no");
const redactAttachments = computed(() => canRedactAttachments(vuex.state.zoConfig));

const state = computed(() => {
  const session = view.session.value;
  const turn = view.turn.value;
  return shareButtonState({
    persistence: capability.value.persistence,
    canShare: capability.value.canShare,
    denied: isShareDenied(org.value),
    // A history row's chat is not loaded, and a listed chat always holds a turn.
    hasTurn: !session || session.messages.some((message) => message.role === "assistant"),
    running: running.value,
    notSaved: turn?.state === "done" && turn.saved === "not_saved",
    historyUnavailable: !!session?.record.historyUnavailable,
    shared: shares.value.length > 0,
    hasAttachments: attachments.value,
    redactAttachments: redactAttachments.value,
  });
});

const surfaceProps = computed<Record<string, unknown>>(() =>
  mdUp.value
    ? {
        side: "bottom",
        align: "end",
        ariaLabel: t("assistant.share.manage"),
        contentClass: "w-96 max-w-[calc(100vw-1.5rem)] p-4",
      }
    : {
        width: 100,
        title: t("assistant.share.manage"),
        anchor: rootEl.value?.closest<HTMLElement>("[data-assistant-root]") ?? null,
        returnFocusTo: () =>
          rootEl.value?.querySelector<HTMLElement>('[data-test="assistant-thread-share"]') ?? null,
      },
);

watch(open, async (isOpen) => {
  if (!isOpen) return;
  await nextTick();
  // Reka focuses the first field on open; a link that exists is two clicks from the clipboard.
  requestAnimationFrame(() => {
    if (focusOnOpen.value === "field") settings.value?.focusFirstField();
    else if (focusOnOpen.value === "link") settings.value?.focusLink();
    else settings.value?.focusPrimary();
  });
});

watch(
  () => sharesRead.data.value,
  (list) => {
    if (created.value && list?.some((item) => item.id === created.value?.id)) {
      created.value = null;
    }
  },
);

async function onShare(): Promise<void> {
  const kind = state.value.kind;
  if (kind === "blocked" || kind === "absent" || creating.value) return;
  if (kind === "manage") return emit("manage");
  creating.value = true;
  try {
    if (kind === "review" && (await stillNeedsReview())) return openSettings("field");
    await share(() => openSettings("field"));
  } finally {
    creating.value = false;
  }
}

async function share(onSettings?: () => void): Promise<void> {
  const result = await quickShare.create(org.value, props.sid, onSettings && { onSettings });
  if (!result.ok) return;
  created.value = result.share;
  if (!result.copied && props.variant === "header") openSettings("link");
}

// Only an unknown answer is worth a read; a failed read refuses rather than share blind.
async function stillNeedsReview(): Promise<boolean> {
  if (known.value !== "unknown") return true;
  try {
    return await checkAttachments(org.value, props.sid);
  } catch {
    toast({ variant: "error", message: t("assistant.share.attachmentsCheckFailed") });
    return true;
  }
}

// The menu closes on select and unmounts this item, so anything after an await cannot emit.
function onMenuSelect(event: Event): void {
  const kind = state.value.kind;
  if (kind === "blocked") {
    event.preventDefault();
    return;
  }
  if (kind === "manage" || kind === "review") emit("manage");
  else if (kind === "quick") void share();
}

function openSettings(focus: "copy" | "field" | "link"): void {
  focusOnOpen.value = focus;
  open.value = true;
}

function onCreated(share: ShareView, copied: boolean): void {
  created.value = share;
  announce(copied ? "assistant.share.createdCopied" : "assistant.share.created");
}

function seeAll(): void {
  open.value = false;
  emit("manage");
}

function announce(key: I18nKey): void {
  store.announce(props.sid, key);
}
</script>
