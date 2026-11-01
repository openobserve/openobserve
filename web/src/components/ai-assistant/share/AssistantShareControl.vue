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
    >{{ t("assistant.share.share") }}</ODropdownItem
  >
  <OPopover
    v-else-if="variant === 'quick' && state.kind !== 'absent'"
    v-model:open="open"
    side="bottom"
    align="start"
    privacy="mask"
    :aria-label="t('assistant.share.title')"
    :content-class="quickWidth"
  >
    <template #anchor>
      <span aria-hidden="true" class="absolute start-0 bottom-0 size-0" />
    </template>
    <AssistantShareQuick
      v-if="open"
      :org="org"
      :sid="sid"
      :share="current"
      :running="running"
      :public-links="capability.publicLinks"
      :public-max-expiry-days="capability.publicMaxExpiryDays"
      :redact-attachments="redactAttachments"
      :has-attachments="attachments"
      @created="onCreated"
      @settings="emit('settings')"
      @announce="announce"
    />
  </OPopover>
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
</template>

<script lang="ts">
import type { Sid } from "@/composables/assistant";

export interface AssistantShareControlProps {
  sid: Sid;
  /** `quick` and `drawer` have no trigger of their own: the title menu's Share opens them through `open`. */
  variant: "menu-item" | "quick" | "drawer";
}

export interface AssistantShareControlEmits {
  /** All shared links: the Shared links manager. */
  (e: "manage"): void;
  /** Change settings, or Share where no popover fits; the drawer holds everything. */
  (e: "settings"): void;
  /** The title menu's Share, which cannot hold a surface once its menu closes. */
  (e: "open-quick"): void;
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
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import type { ShareView } from "@/services/ai_chat_share";
import { chatSharesQuery } from "@/services/ai_chat_share.queries";
import { useI18nTyped, type I18nKey } from "@/types/i18n";

import AssistantShareQuick from "./AssistantShareQuick.vue";
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

const quickWidth = computed(() => (mdUp.value ? "w-80 p-3" : "w-70 p-3"));

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

watch(open, async (isOpen) => {
  if (!isOpen) {
    anotherLink.value = false;
    return;
  }
  if (props.variant !== "drawer") return;
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

// The menu closes on select and unmounts this item, so the surface opens from the shell.
function onMenuSelect(event: Event): void {
  if (state.value.kind === "blocked") {
    event.preventDefault();
    return;
  }
  if (mdUp.value) emit("open-quick");
  else emit("settings");
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
