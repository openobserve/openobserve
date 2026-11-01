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
  <div class="flex min-w-0 flex-col gap-2" data-test="assistant-share-quick">
    <template v-if="share">
      <OText
        as="h3"
        variant="label"
        class="text-text-heading"
        data-test="assistant-share-quick-title"
      >
        {{
          t(
            share.visibility === "public"
              ? "assistant.share.sharedPublic"
              : "assistant.share.sharedOrg",
          )
        }}
      </OText>
      <div
        class="border-border-default rounded-default flex min-w-0 items-center gap-2 border px-2 py-1"
        data-test="assistant-share-quick-link"
      >
        <span class="text-text-body min-w-0 flex-1 truncate font-mono text-xs">{{ link }}</span>
        <OButton
          variant="ghost"
          size="xs"
          class="shrink-0 max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-share-quick-copy"
          @click="copy"
        >
          {{ copied ? t("common.copied") : t("assistant.share.copyLink") }}
        </OButton>
      </div>
      <OText v-if="outOfDate" as="p" variant="meta" data-test="assistant-share-quick-changed">
        {{ t("assistant.share.changedSince") }} ·
        <button
          type="button"
          class="text-assistant-link cursor-pointer"
          :disabled="running || updating"
          data-test="assistant-share-quick-update"
          @click="updateSnapshot"
        >
          {{ t("assistant.share.updateSnapshot") }}
        </button>
      </OText>
      <div class="flex justify-end">
        <OButton
          variant="ghost"
          size="xs"
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-share-quick-settings"
          @click="emit('settings')"
        >
          {{ t("assistant.share.changeSettings") }}
        </OButton>
      </div>
    </template>
    <template v-else>
      <OText
        as="h3"
        variant="label"
        class="text-text-heading"
        data-test="assistant-share-quick-title"
      >
        {{ t("assistant.share.title") }}
      </OText>
      <ORadioGroup
        :model-value="visibility"
        :label="t('assistant.share.who')"
        :disabled="creating"
        data-test="assistant-share-quick-scope"
        @update:model-value="onScope"
      >
        <ORadio
          value="org"
          data-test="assistant-share-quick-org"
          :label="t('assistant.share.yourOrg')"
        />
        <ORadio
          v-if="publicLinks"
          value="public"
          :disabled="publicBlocked"
          data-test="assistant-share-quick-public"
          :label="t('assistant.share.public')"
        />
      </ORadioGroup>
      <OText as="p" variant="meta" data-test="assistant-share-quick-help">
        {{ t("assistant.share.readersNeedAccess") }}
      </OText>
      <div class="flex items-center justify-end gap-2">
        <OButton
          variant="ghost"
          size="xs"
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-share-quick-settings"
          @click="emit('settings')"
        >
          {{ t("assistant.share.changeSettings") }}
        </OButton>
        <OButton
          variant="primary"
          size="xs"
          :loading="creating"
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-share-quick-create"
          @click="create"
        >
          {{ t("assistant.share.createAndCopy") }}
        </OButton>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useMutation } from "@tanstack/vue-query";
import { computed, onBeforeUnmount, ref } from "vue";

import { useAssistantStore } from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import type { ShareView, ShareVisibility } from "@/services/ai_chat_share";
import { createShareMutation, updateShareMutation } from "@/services/ai_chat_share.queries";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";

import {
  buildCreateRequest,
  isOutOfDate,
  quickShareForm,
  shareLinkOf,
  statusOfError,
  switchVisibility,
  type ShareForm,
} from "./chatShare";
import { denyShare } from "./useQuickShare";

const COPIED_MS = 2_000;

const DAY_SECS = 86_400;

const props = defineProps<{
  org: string;
  sid: string;
  /** `null` is State A: nothing exists until Create and copy link. */
  share: ShareView | null;
  running: boolean;
  publicLinks: boolean;
  publicMaxExpiryDays: number;
  redactAttachments: boolean;
  hasAttachments: boolean;
}>();

const emit = defineEmits<{
  created: [share: ShareView, copied: boolean];
  settings: [];
  announce: [key: I18nKey];
}>();

const { t } = useI18nTyped();
const store = useAssistantStore();
// The 90-day expiry and hidden tool data sit behind Change settings, so this is their default.
const form = ref<ShareForm>(quickShareForm());
const creating = ref(false);
const updating = ref(false);
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

const createMutation = useMutation(() => createShareMutation(props.org, props.sid));
const updateMutation = useMutation(() => updateShareMutation(props.org));

const maxPublicSecs = computed(() => props.publicMaxExpiryDays * DAY_SECS);
const visibility = computed(() => form.value.visibility);
const publicBlocked = computed(() => !props.redactAttachments && props.hasAttachments);
const link = computed(() => (props.share ? shareLinkOf(props.share) : ""));
const outOfDate = computed(() => {
  const session = store.state.sessions[props.sid];
  if (!props.share) return false;
  return isOutOfDate(
    props.share,
    session?.record.cachedLastSeq ?? session?.turnMeta.lastSeq ?? null,
  );
});

function onScope(value: unknown): void {
  if (value === "public" && publicBlocked.value) return;
  switchVisibility(form.value, value as ShareVisibility, maxPublicSecs.value);
}

function flashCopied(): void {
  copied.value = true;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = false), COPIED_MS);
}

async function create(): Promise<void> {
  if (creating.value) return;
  creating.value = true;
  try {
    const body = buildCreateRequest(
      props.running ? { ...form.value, mode: "live" } : form.value,
      props.publicLinks && !publicBlocked.value,
      maxPublicSecs.value,
      props.redactAttachments,
    );
    const share = await createMutation.mutateAsync(body);
    const done = await copyToClipboard(shareLinkOf(share), t, { silent: true });
    trackAssistant("ai_share", {
      action: "create",
      visibility: share.visibility,
      mode: share.mode,
    });
    if (done) flashCopied();
    emit("created", share, done);
  } catch (err) {
    if (statusOfError(err) === 403) {
      denyShare(props.org);
      toast({ variant: "error", message: t("assistant.share.forbidden") });
      return;
    }
    toast({
      variant: "error",
      message: t("assistant.share.createFailed"),
      action: { label: t("common.retry"), handler: () => void create() },
    });
  } finally {
    creating.value = false;
  }
}

async function copy(): Promise<void> {
  const share = props.share;
  if (!share) return;
  if (await copyToClipboard(shareLinkOf(share), t, { silent: true })) {
    flashCopied();
    emit("announce", "assistant.share.copied");
  }
  trackAssistant("ai_share", {
    action: "copy_link",
    visibility: share.visibility,
    mode: share.mode,
  });
}

async function updateSnapshot(): Promise<void> {
  const share = props.share;
  if (!share || updating.value) return;
  updating.value = true;
  try {
    await updateMutation.mutateAsync({ id: share.id, body: { refresh_snapshot: true } });
    trackAssistant("ai_share", {
      action: "refresh",
      visibility: share.visibility,
      mode: share.mode,
    });
    emit("announce", "assistant.share.snapshotUpdated");
  } catch {
    toast({
      variant: "error",
      message: t("assistant.share.updateFailed"),
      action: { label: t("common.retry"), handler: () => void updateSnapshot() },
    });
  } finally {
    updating.value = false;
  }
}

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>
