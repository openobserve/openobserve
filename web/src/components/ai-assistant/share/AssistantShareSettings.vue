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
    ref="rootEl"
    class="flex flex-col gap-4"
    data-dd-privacy="mask"
    data-test="assistant-share-settings"
  >
    <section class="flex flex-col gap-2">
      <OText as="span" variant="label" aria-hidden="true">{{ t("assistant.share.who") }}</OText>
      <ORadioGroup
        :model-value="form.visibility"
        :label="t('assistant.share.who')"
        :disabled="!!share || pending !== null"
        data-test="assistant-share-visibility"
        @update:model-value="onVisibility"
      >
        <ORadio
          value="org"
          :label="t('assistant.share.org')"
          data-test="assistant-share-visibility-org"
        />
        <div v-if="publicLinks" class="contents" :aria-disabled="publicBlocked || undefined">
          <ORadio
            value="public"
            :label="t('assistant.share.public')"
            :disabled="publicBlocked"
            data-test="assistant-share-visibility-public"
          />
        </div>
      </ORadioGroup>
      <OText v-if="share" variant="meta" data-test="assistant-share-visibility-fixed">{{
        t("assistant.share.visibilityFixed")
      }}</OText>
      <OText variant="meta" data-test="assistant-share-visibility-help">
        <template v-if="form.visibility === 'org'"
          >{{ t("assistant.share.orgHelp") }} {{ t("assistant.share.orgHelpStreams") }}</template
        >
        <template v-else>{{
          t("assistant.share.publicMax", { days: publicMaxExpiryDays })
        }}</template>
      </OText>
      <OText v-if="!publicLinks" variant="meta" data-test="assistant-share-public-off">{{
        t("assistant.share.publicOff")
      }}</OText>
      <OText v-else-if="publicBlocked" variant="meta" data-test="assistant-share-public-blocked">{{
        t("assistant.share.publicNeedsAttachmentRedaction")
      }}</OText>
      <span
        v-if="attachmentsIncluded"
        class="text-text-secondary flex items-start gap-1.5 text-xs"
        data-test="assistant-share-attachments-included"
      >
        <OIcon :name="assistantGlyph.warning" size="sm" class="mt-px shrink-0" aria-hidden="true" />
        {{ t("assistant.share.attachmentsIncluded") }}
      </span>
    </section>

    <section class="flex flex-col gap-2">
      <OText as="span" variant="label" aria-hidden="true">{{ t("assistant.share.content") }}</OText>
      <ORadioGroup
        :model-value="form.mode"
        :label="t('assistant.share.content')"
        :disabled="pending !== null"
        data-test="assistant-share-mode"
        @update:model-value="onMode"
      >
        <ORadio value="snapshot" :label="snapshotLabel" data-test="assistant-share-mode-snapshot" />
        <ORadio
          value="live"
          :label="t('assistant.share.liveMode')"
          data-test="assistant-share-mode-live"
        />
      </ORadioGroup>
      <OButton
        v-if="share && share.mode === 'snapshot'"
        variant="outline"
        size="sm"
        class="self-start max-md:min-h-11 pointer-coarse:min-h-11"
        :disabled="running || pending !== null"
        :focusable-unavailable="running"
        :loading="pending === 'refresh'"
        data-test="assistant-share-update-snapshot"
        @click="refresh"
      >
        {{ t("assistant.share.updateSnapshot") }}
        <template v-if="running" #unavailable-reason>{{
          t("assistant.share.updateBlocked")
        }}</template>
        <OTooltip v-if="running" :content="t('assistant.share.updateBlocked')" />
      </OButton>
    </section>

    <section class="flex flex-col gap-2">
      <OCheckbox
        :model-value="form.redactTools"
        :label="t('assistant.share.redactTools')"
        :disabled="pending !== null || confirm === 'showTools'"
        data-test="assistant-share-redact-tools"
        @update:model-value="onRedact"
      />
      <div
        v-if="confirm === 'showTools'"
        ref="confirmEl"
        role="group"
        :aria-label="t('assistant.share.showToolsConfirm')"
        class="border-border-default rounded-default flex flex-col gap-2 border p-3"
        data-test="assistant-share-show-tools-confirm"
      >
        <OText variant="body">{{ t("assistant.share.showToolsConfirm") }}</OText>
        <div class="flex flex-wrap gap-2">
          <OButton
            variant="primary"
            size="sm"
            class="max-md:min-h-11"
            data-test="assistant-share-show-tools-confirm-show"
            @click="confirmShowTools"
            >{{ t("assistant.share.show") }}</OButton
          >
          <OButton
            variant="outline"
            size="sm"
            class="max-md:min-h-11"
            data-test="assistant-share-show-tools-confirm-cancel"
            @click="cancelConfirm"
            >{{ t("common.cancel") }}</OButton
          >
        </div>
      </div>
      <OCheckbox
        v-if="redactAttachments"
        :model-value="form.hideAttachments ?? true"
        :label="t('assistant.share.hideAttachments')"
        :disabled="pending !== null"
        data-test="assistant-share-hide-attachments"
        @update:model-value="onHideAttachments"
      />
    </section>

    <OSelect
      :model-value="expiry"
      :options="expiryOptions"
      :label="t('assistant.share.expires')"
      :disabled="pending !== null"
      size="sm"
      data-test="assistant-share-expiry"
      @update:model-value="onExpiry"
    />

    <div
      v-if="confirm === 'revoke'"
      ref="confirmEl"
      role="group"
      :aria-label="t('assistant.share.revokeConfirm')"
      class="border-border-default rounded-default flex flex-col gap-2 border p-3"
      data-test="assistant-share-revoke-confirm"
    >
      <OText variant="body">{{ t("assistant.share.revokeConfirm") }}</OText>
      <div class="flex flex-wrap gap-2">
        <OButton
          variant="destructive"
          size="sm"
          class="max-md:min-h-11"
          :loading="pending === 'revoke'"
          data-test="assistant-share-revoke-confirm-revoke"
          @click="revoke"
          >{{ t("assistant.share.revoke") }}</OButton
        >
        <OButton
          variant="outline"
          size="sm"
          class="max-md:min-h-11"
          data-test="assistant-share-revoke-confirm-cancel"
          @click="cancelConfirm"
          >{{ t("common.cancel") }}</OButton
        >
      </div>
    </div>

    <OInput
      v-if="share && link"
      :model-value="link"
      :label="t('assistant.share.link')"
      readonly
      size="sm"
      data-test="assistant-share-link"
      @focus="selectLink"
    />
    <div class="border-border-default flex flex-wrap items-center gap-2 border-t pt-3">
      <template v-if="share">
        <OButton
          ref="copyButton"
          variant="primary"
          size="sm"
          class="max-md:min-h-11"
          :icon-left="assistantGlyph.copy"
          data-test="assistant-share-copy"
          @click="copy"
          >{{ t("assistant.share.copyLink") }}</OButton
        >
        <span class="flex-1" />
        <OButton
          variant="ghost-destructive"
          size="sm"
          class="max-md:min-h-11"
          :disabled="pending !== null || confirm === 'revoke'"
          data-test="assistant-share-revoke"
          @click="askRevoke"
          >{{ t("assistant.share.revoke") }}</OButton
        >
      </template>
      <OButton
        v-else
        ref="createButton"
        variant="primary"
        size="sm"
        class="max-md:min-h-11"
        :loading="pending === 'create'"
        :disabled="pending !== null"
        data-test="assistant-share-create"
        @click="create"
        >{{ t("assistant.share.createAndCopy") }}</OButton
      >
    </div>
    <OButton
      v-if="linkCount > 3"
      variant="ghost"
      size="sm"
      class="self-start max-md:min-h-11"
      data-test="assistant-share-see-all"
      @click="emit('seeAll')"
      >{{ t("assistant.share.seeAll") }}</OButton
    >
  </div>
</template>

<script lang="ts">
import type { ShareView } from "@/services/ai_chat_share";
import type { I18nKey } from "@/types/i18n";

export interface AssistantShareSettingsProps {
  org: string;
  sid: string;
  /** `null` is create mode: nothing exists until Create and copy. */
  share: ShareView | null;
  running: boolean;
  publicLinks: boolean;
  publicMaxExpiryDays: number;
  /** The server strips attachments (`ai_share_redact_attachments`). */
  redactAttachments: boolean;
  hasAttachments: boolean;
  linkCount: number;
}

export interface AssistantShareSettingsEmits {
  (e: "created", share: ShareView, copied: boolean): void;
  (e: "revoked"): void;
  (e: "seeAll"): void;
  (e: "announce", key: I18nKey): void;
}
</script>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
  type ComponentPublicInstance,
} from "vue";
import { useMutation } from "@tanstack/vue-query";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { ShareMode, ShareVisibility, UpdateShareRequest } from "@/services/ai_chat_share";
import {
  createShareMutation,
  revokeShareMutation,
  updateShareMutation,
} from "@/services/ai_chat_share.queries";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";
import { copyToClipboard } from "@/utils/clipboard";

import {
  buildCreateRequest,
  expiryPresetsFor,
  presetOf,
  shareLinkOf,
  statusOfError,
  switchVisibility,
  type ShareForm,
} from "./chatShare";
import { denyShare } from "./useQuickShare";

type Pending = "create" | "update" | "refresh" | "revoke" | null;

const DAY_SECS = 86_400;

// A link whose expiry was changed matches no preset; it shows its own date instead.
const CURRENT_EXPIRY = -1;

const props = defineProps<AssistantShareSettingsProps>();

const emit = defineEmits<AssistantShareSettingsEmits>();

const { t } = useI18nTyped();

const form = reactive<ShareForm>(formOf(props.share));
const pending = ref<Pending>(null);
const confirm = ref<"showTools" | "revoke" | null>(null);
const confirmEl = ref<HTMLElement | null>(null);
const copyButton = ref<ComponentPublicInstance | null>(null);
const createButton = ref<ComponentPublicInstance | null>(null);
const chosenExpiry = ref<number | null>(null);
const rootEl = ref<HTMLElement | null>(null);

const createMutation = useMutation(() => createShareMutation(props.org, props.sid));
const updateMutation = useMutation(() => updateShareMutation(props.org));
const revokeMutation = useMutation(() => revokeShareMutation(props.org));

const maxPublicSecs = computed(() => props.publicMaxExpiryDays * DAY_SECS);
const attachmentsIncluded = computed(
  () => !props.share && !props.redactAttachments && props.hasAttachments,
);
const publicBlocked = computed(() => attachmentsIncluded.value);

const snapshotLabel = computed(() => {
  const at = props.share?.mode === "snapshot" ? props.share.updated_at : null;
  return at
    ? t("assistant.share.snapshotAsOf", { time: formatOrgTime(at / 1000, { showZone: true }) })
    : t("assistant.share.snapshot");
});

const link = computed(() => (props.share ? shareLinkOf(props.share) : ""));

const expiry = computed(() => {
  if (chosenExpiry.value !== null) return chosenExpiry.value;
  return props.share ? (presetOf(props.share) ?? CURRENT_EXPIRY) : form.expiresInSecs;
});

const expiryOptions = computed(() => {
  const presets = expiryPresetsFor(form.visibility, maxPublicSecs.value).map((preset) => ({
    value: preset.value,
    label: preset.value === 0 ? t("assistant.share.never") : t(preset.labelKey),
  }));
  const expiresAt = props.share?.expires_at;
  if (expiry.value !== CURRENT_EXPIRY || !expiresAt) return presets;
  const time = formatOrgTime(expiresAt / 1000, { showZone: true });
  return [{ value: CURRENT_EXPIRY, label: t("assistant.share.expiresOn", { time }) }, ...presets];
});

watch(
  () => props.share,
  (share) => {
    if (pending.value === null) Object.assign(form, formOf(share));
  },
);

onMounted(() => rootEl.value?.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => rootEl.value?.removeEventListener("keydown", onKeydown));

function formOf(share: ShareView | null): ShareForm {
  if (!share) {
    return {
      mode: "snapshot",
      visibility: "org",
      expiresInSecs: 90 * DAY_SECS,
      redactTools: true,
      hideAttachments: true,
    };
  }
  return {
    mode: share.mode,
    visibility: share.visibility,
    expiresInSecs: presetOf(share) ?? CURRENT_EXPIRY,
    redactTools: share.redact_tools,
    hideAttachments: share.hide_attachments ?? true,
  };
}

function onVisibility(value: unknown): void {
  if (props.share || (value === "public" && publicBlocked.value)) return;
  switchVisibility(form, value as ShareVisibility, maxPublicSecs.value);
}

function onMode(value: unknown): void {
  const mode = value as ShareMode;
  if (mode === form.mode) return;
  form.mode = mode;
  if (props.share) void apply({ mode }, "update");
}

function onRedact(value: unknown): void {
  const redact = value === true;
  // Showing tool data to anyone with the link is the one change that asks first.
  if (!redact && form.visibility === "public") {
    confirm.value = "showTools";
    void focusConfirm();
    return;
  }
  form.redactTools = redact;
  if (props.share) void apply({ redact_tools: redact }, "update");
}

function confirmShowTools(): void {
  confirm.value = null;
  form.redactTools = false;
  if (props.share) void apply({ redact_tools: false }, "update");
}

function onHideAttachments(value: unknown): void {
  form.hideAttachments = value === true;
  if (props.share) void apply({ hide_attachments: form.hideAttachments }, "update");
}

function onExpiry(value: unknown): void {
  const secs = Number(value);
  if (!Number.isFinite(secs) || secs < 0) return;
  chosenExpiry.value = secs;
  form.expiresInSecs = secs;
  if (props.share) void apply({ expires_in_secs: secs > 0 ? secs : null }, "update");
}

async function apply(body: UpdateShareRequest, kind: "update" | "refresh"): Promise<boolean> {
  const share = props.share;
  if (!share) return false;
  pending.value = kind;
  try {
    await updateMutation.mutateAsync({ id: share.id, body });
    trackAssistant("ai_share", {
      action: kind,
      visibility: share.visibility,
      mode: body.mode ?? share.mode,
    });
    return true;
  } catch {
    Object.assign(form, formOf(share));
    chosenExpiry.value = null;
    toast({
      variant: "error",
      message: t("assistant.share.updateFailed"),
      action: { label: t("common.retry"), handler: () => void apply(body, kind) },
    });
    return false;
  } finally {
    pending.value = null;
  }
}

async function refresh(): Promise<void> {
  if (props.running) return;
  if (await apply({ refresh_snapshot: true }, "refresh"))
    emit("announce", "assistant.share.snapshotUpdated");
}

async function copy(): Promise<void> {
  const share = props.share;
  if (!share) return;
  if (await copyToClipboard(shareLinkOf(share), t, { silent: true })) {
    emit("announce", "assistant.share.copied");
  }
  trackAssistant("ai_share", {
    action: "copy_link",
    visibility: share.visibility,
    mode: share.mode,
  });
}

async function create(): Promise<void> {
  if (pending.value !== null) return;
  pending.value = "create";
  try {
    const body = buildCreateRequest(
      form,
      props.publicLinks && !publicBlocked.value,
      maxPublicSecs.value,
      props.redactAttachments,
    );
    const share = await createMutation.mutateAsync(body);
    const copied = await copyToClipboard(shareLinkOf(share), t, { silent: true });
    trackAssistant("ai_share", {
      action: "create",
      visibility: share.visibility,
      mode: share.mode,
    });
    emit("created", share, copied);
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
    pending.value = null;
  }
}

function askRevoke(): void {
  confirm.value = "revoke";
  void focusConfirm();
}

async function revoke(): Promise<void> {
  const share = props.share;
  if (!share) return;
  pending.value = "revoke";
  try {
    await revokeMutation.mutateAsync(share.id);
    trackAssistant("ai_share", {
      action: "revoke",
      visibility: share.visibility,
      mode: share.mode,
    });
    confirm.value = null;
    emit("announce", "assistant.share.revoked");
    emit("revoked");
  } catch {
    toast({
      variant: "error",
      message: t("assistant.share.revokeFailed"),
      action: { label: t("common.retry"), handler: () => void revoke() },
    });
  } finally {
    pending.value = null;
  }
}

function selectLink(event: FocusEvent): void {
  (event.target as HTMLInputElement | null)?.select?.();
}

function cancelConfirm(): void {
  confirm.value = null;
}

async function focusConfirm(): Promise<void> {
  await nextTick();
  confirmEl.value?.querySelector<HTMLElement>("button")?.focus();
}

// An open confirm keeps Tab inside it and takes Escape before the popover does.
function onKeydown(event: KeyboardEvent): void {
  if (!confirm.value || event.isComposing) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    confirm.value = null;
    return;
  }
  if (event.key !== "Tab" || !confirmEl.value) return;
  const buttons = Array.from(confirmEl.value.querySelectorAll<HTMLElement>("button"));
  const index = buttons.indexOf(document.activeElement as HTMLElement);
  event.preventDefault();
  const next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}

function focusPrimary(): void {
  const target = copyButton.value ?? createButton.value;
  (target?.$el as HTMLElement | undefined)?.focus();
}

function focusFirstField(): void {
  rootEl.value?.querySelector<HTMLElement>('[role="radio"]:not([disabled])')?.focus();
}

function focusLink(): void {
  rootEl.value?.querySelector<HTMLElement>('[data-test="assistant-share-link"] input')?.focus();
}

defineExpose({ focusPrimary, focusFirstField, focusLink });
</script>
