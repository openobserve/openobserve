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
      t(
        state.kind === "manage"
          ? "assistant.thread.shareSettings"
          : "assistant.share.shareEllipsis",
      )
    }}</ODropdownItem
  >
  <ODrawer
    v-else-if="variant === 'drawer' && state.kind !== 'absent'"
    v-model:open="open"
    side="right"
    size="md"
    :width="mdUp ? undefined : 100"
    :title="t('assistant.share.title')"
    data-test="assistant-share-drawer"
  >
    <AssistantShareSettings
      v-if="open"
      ref="settings"
      v-bind="settingsProps"
      @created="onCreated"
      @revoked="open = false"
      @see-all="seeAll"
      @new-link="newLink"
      @cancel-new="cancelNew"
      @announce="announce"
    />
  </ODrawer>
  <span
    v-else-if="variant === 'header' && state.kind !== 'absent'"
    ref="rootEl"
    class="inline-flex min-w-0 flex-wrap items-center gap-1"
    data-test="assistant-share-control"
  >
    <component :is="mdUp ? OPopover : ODrawer" v-model:open="open" v-bind="surfaceProps">
      <template v-if="mdUp" #anchor>
        <OButton
          variant="ghost"
          size="sm"
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          :icon-left="shared ? assistantGlyph.shared : assistantGlyph.share"
          :disabled="state.kind === 'blocked'"
          :focusable-unavailable="state.kind === 'blocked'"
          :aria-label="buttonName"
          :aria-expanded="open ? 'true' : 'false'"
          aria-haspopup="dialog"
          :data-shared="shared ? '' : undefined"
          data-test="assistant-thread-share"
          @click="onShare"
        >
          <span class="@max-[32rem]:sr-only" data-test="assistant-thread-share-label">{{
            buttonLabel
          }}</span>
          <template v-if="state.kind === 'blocked'" #unavailable-reason>{{
            t(state.reason)
          }}</template>
          <OTooltip :content="t(state.kind === 'blocked' ? state.reason : state.tooltip)" />
        </OButton>
      </template>
      <AssistantShareSettings
        v-if="open"
        ref="settings"
        v-bind="settingsProps"
        @created="onCreated"
        @revoked="open = false"
        @see-all="seeAll"
        @new-link="newLink"
        @cancel-new="cancelNew"
        @announce="announce"
      />
    </component>
    <OButton
      v-if="!mdUp"
      variant="ghost"
      size="sm"
      class="min-h-11"
      :icon-left="shared ? assistantGlyph.shared : assistantGlyph.share"
      :disabled="state.kind === 'blocked'"
      :focusable-unavailable="state.kind === 'blocked'"
      :aria-label="buttonName"
      :data-shared="shared ? '' : undefined"
      data-test="assistant-thread-share"
      @click="onShare"
    >
      {{ buttonLabel }}
      <template v-if="state.kind === 'blocked'" #unavailable-reason>{{ t(state.reason) }}</template>
    </OButton>
  </span>
</template>

<script lang="ts">
import type { Sid } from "@/composables/assistant";

export interface AssistantShareControlProps {
  sid: Sid;
  /** `drawer` has no trigger of its own: More's Share opens it through `open`. */
  variant: "header" | "menu-item" | "drawer";
}

export interface AssistantShareControlEmits {
  /** All shared links: the Shared links manager. */
  (e: "manage"): void;
  /** More's Share item, which cannot hold a surface once its menu closes. */
  (e: "settings"): void;
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import {
  orgDisplayName,
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
import { useI18nTyped, type I18nKey } from "@/types/i18n";

import AssistantShareSettings from "./AssistantShareSettings.vue";
import { knownAttachments } from "./chatAttachments";
import { canRedactAttachments, shareButtonState } from "./chatShare";
import { isShareDenied } from "./useQuickShare";

const props = defineProps<AssistantShareControlProps>();

const emit = defineEmits<AssistantShareControlEmits>();

const open = defineModel<boolean>("open", { default: false });

const { t } = useI18nTyped();
const vuex = useStore();
const store = useAssistantStore();
const capability = useAssistantCapability();
const view = useAssistantSession(() => props.sid);
const { mdUp } = useBreakpoint();

const settings = ref<InstanceType<typeof AssistantShareSettings> | null>(null);
const rootEl = ref<HTMLElement | null>(null);
// A just-created link shows in the popover before the list re-reads.
const created = ref<ShareView | null>(null);
// Create mode beside an existing link, so a second audience never needs a revoke first.
const anotherLink = ref(false);

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
const shared = computed(() => shares.value.length > 0);
const running = computed(() => {
  const turn = view.turn.value;
  return !!turn && turn.state !== "idle" && !isTerminal(turn);
});
const known = computed(() =>
  knownAttachments(org.value, props.sid, view.session.value ? view.messages.value : undefined),
);
// Unknown counts as present until the stored chat has been read.
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
    shared: shared.value,
    hasAttachments: attachments.value,
    redactAttachments: redactAttachments.value,
  });
});

const buttonLabel = computed(() =>
  shared.value ? t("assistant.share.shared") : t("assistant.share.share"),
);
const buttonName = computed(() => {
  const share = current.value;
  if (!share) return undefined;
  return t(
    share.visibility === "public" ? "assistant.share.sharedPublic" : "assistant.share.sharedOrg",
  );
});

const settingsProps = computed(() => ({
  org: org.value,
  orgName: orgDisplayName(org.value, vuex.state.selectedOrganization),
  sid: props.sid,
  share: anotherLink.value ? null : current.value,
  cancelable: anotherLink.value,
  running: running.value,
  publicLinks: capability.value.publicLinks,
  publicMaxExpiryDays: capability.value.publicMaxExpiryDays,
  redactAttachments: redactAttachments.value,
  hasAttachments: attachments.value,
}));

const surfaceProps = computed<Record<string, unknown>>(() =>
  mdUp.value
    ? {
        side: "bottom",
        align: "end",
        ariaLabel: t("assistant.share.title"),
        contentClass: "w-96 max-w-[calc(100vw-1.5rem)] p-4",
      }
    : {
        width: 100,
        title: t("assistant.share.title"),
        anchor: rootEl.value?.closest<HTMLElement>("[data-assistant-root]") ?? null,
        returnFocusTo: () =>
          rootEl.value?.querySelector<HTMLElement>('[data-test="assistant-thread-share"]') ?? null,
      },
);

watch(open, async (isOpen) => {
  if (!isOpen) {
    anotherLink.value = false;
    return;
  }
  await nextTick();
  // Reka focuses the first field on open; the primary action is the one a sharer wants next.
  requestAnimationFrame(() => settings.value?.focusPrimary());
});

watch(
  () => sharesRead.data.value,
  (list) => {
    if (created.value && list?.some((item) => item.id === created.value?.id)) {
      created.value = null;
    }
  },
);

// Share never creates a link by itself: the popover shows what would be shared first (D5 decision 6).
function onShare(): void {
  const kind = state.value.kind;
  if (kind === "blocked" || kind === "absent") return;
  open.value = true;
}

// The menu closes on select and unmounts this item, so the surface opens from the shell.
function onMenuSelect(event: Event): void {
  if (state.value.kind === "blocked") {
    event.preventDefault();
    return;
  }
  emit("settings");
}

function onCreated(share: ShareView, copied: boolean): void {
  created.value = share;
  anotherLink.value = false;
  announce(copied ? "assistant.share.createdCopied" : "assistant.share.created");
  // A blocked clipboard leaves the link selected for a manual copy.
  void nextTick(() => (copied ? settings.value?.focusPrimary() : settings.value?.focusLink()));
}

function newLink(): void {
  anotherLink.value = true;
  void nextTick(() => settings.value?.focusFirstField());
}

function cancelNew(): void {
  anotherLink.value = false;
  void nextTick(() => settings.value?.focusPrimary());
}

function seeAll(): void {
  open.value = false;
  emit("manage");
}

function announce(key: I18nKey): void {
  store.announce(props.sid, key);
}
</script>
