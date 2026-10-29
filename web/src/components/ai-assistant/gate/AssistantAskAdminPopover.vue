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
  <span v-if="isMobile" :ref="bindTrigger" class="contents">
    <slot name="trigger" />
  </span>
  <component :is="isMobile ? OSheet : OPopover" v-model:open="open" v-bind="wrapperProps">
    <template v-if="!isMobile" #trigger>
      <slot name="trigger" />
    </template>
    <template v-if="isMobile" #header>
      <div class="flex justify-end px-2">
        <AssistantIconButton
          :label="t('assistant.gate.close')"
          :icon="assistantGlyph.close"
          data-test="assistant-ask-admin-close"
          @click="open = false"
        />
      </div>
    </template>
    <div class="flex flex-col gap-3 p-4" data-test="assistant-ask-admin">
      <h3 class="text-text-heading text-sm font-medium">{{ t("assistant.askAdmin.title") }}</h3>
      <div v-if="admins.length" class="flex flex-col gap-1" data-test="assistant-ask-admin-admins">
        <p class="text-text-secondary text-xs">
          {{ t("assistant.askAdmin.adminsOf", { org: targetOrg }) }}
        </p>
        <OUserCell v-for="email in admins.slice(0, ADMIN_LIST_MAX)" :key="email" :value="email" />
      </div>
      <p v-else class="text-text-secondary text-sm" data-test="assistant-ask-admin-unknown">
        {{ t("assistant.askAdmin.anAdminOf", { org: targetOrg }) }}
      </p>
      <div ref="messageField">
        <OTextarea
          :model-value="message"
          :label="t('assistant.askAdmin.messageLabel')"
          readonly
          autogrow
          :rows="3"
          data-test="assistant-ask-admin-message"
        />
      </div>
      <p
        v-if="copyFailed"
        class="text-text-secondary text-xs"
        data-test="assistant-ask-admin-copy-manually"
      >
        {{ t("assistant.client.copyManually") }}
      </p>
      <OCheckbox
        v-if="offersPrompt"
        v-model="includePrompt"
        :label="t('assistant.askAdmin.includePrompt')"
        data-test="assistant-ask-admin-include-prompt"
      />
      <div class="flex flex-wrap gap-2">
        <OButton
          variant="primary"
          size="sm"
          class="max-md:min-h-11"
          data-test="assistant-ask-admin-copy"
          @click="copy"
        >
          {{ t("assistant.askAdmin.copy") }}
        </OButton>
        <OButton
          v-if="admins.length"
          variant="outline"
          size="sm"
          as="a"
          :href="mailto"
          class="max-md:min-h-11"
          data-test="assistant-ask-admin-email"
          @click="emit('emailed')"
        >
          {{ t("assistant.askAdmin.email") }}
        </OButton>
      </div>
    </div>
  </component>
</template>

<script lang="ts">
export type AskAdminKind =
  "access" | "credits" | "consent" | "share_read" | "settings" | "tool_policy";

export interface AssistantAskAdminPopoverProps {
  kind: AskAdminKind;
  org: string;
  /** Credits and consent billed to a payer target the payer's admins. */
  payer?: string;
  tool?: string;
  /** The prompt the user typed; only its first 80 characters, and only once the box is ticked. */
  promptPreview?: string;
}

export interface AssistantAskAdminPopoverEmits {
  (e: "copied"): void;
  (e: "emailed"): void;
}

export const PROMPT_PREVIEW_CHARS = 80;

export const ADMIN_LIST_MAX = 5;

const ADMIN_ROLES: ReadonlySet<string> = new Set(["admin", "root"]);

const PROMPT_KINDS: ReadonlySet<AskAdminKind> = new Set(["credits", "consent"]);

/** The org's admins, from a member list someone already loaded; never a request of its own. */
export function adminEmails(members: unknown): string[] {
  if (!Array.isArray(members)) return [];
  return members
    .filter((m) => ADMIN_ROLES.has(String(m?.role ?? "").toLowerCase()) && !!m?.email)
    .map((m) => String(m.email));
}

/** A `mailto:` with the subject and body URL-encoded, so no character of the message breaks the link. */
export function mailtoHref(emails: string[], subject: string, body: string): string {
  const to = emails.map(encodeURIComponent).join(",");
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** The first line of the visible prompt, cut at 80 characters; chips never travel. */
export function promptLine(prompt: string | undefined): string {
  const first = (prompt ?? "").split("\n")[0].trim();
  return first.slice(0, PROMPT_PREVIEW_CHARS);
}
</script>

<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { useAssistantName } from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OSheet from "@/lib/overlay/Sheet/OSheet.vue";
import type { SheetSnap } from "@/lib/overlay/Sheet/OSheet.types";
import { orgUsersQuery } from "@/services/users.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";

const props = withDefaults(defineProps<AssistantAskAdminPopoverProps>(), {
  payer: undefined,
  tool: undefined,
  promptPreview: undefined,
});

const emit = defineEmits<AssistantAskAdminPopoverEmits>();

defineSlots<{ trigger?: () => unknown }>();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const { isMobile } = useBreakpoint();
const router = useRouter();
const open = ref(false);
const includePrompt = ref(false);
const sheetSnap = ref<SheetSnap>("half");
const copyFailed = ref(false);
const messageField = ref<HTMLElement | null>(null);
const mobileTrigger = ref<HTMLElement | null>(null);

const targetOrg = computed(() => props.payer ?? props.org);

// A disabled observer reads the IAM users page's cache, so a role that cannot list members sends nothing.
const members = useQuery(
  computed(() => ({ ...orgUsersQuery(targetOrg.value), enabled: false as const })),
);
const admins = computed(() => adminEmails(members.data.value));

const whereToGrant = computed(() =>
  t("assistant.gate.whereToGrant", {
    iam: t("menu.iam"),
    roles: t("iam.roles"),
    group: t("iam.modules.groups.assistant"),
  }),
);

const offersPrompt = computed(
  () => PROMPT_KINDS.has(props.kind) && promptLine(props.promptPreview) !== "",
);

const message = computed<I18nText>(() => {
  const params = {
    product,
    org: raw(targetOrg.value),
    whereToGrant: whereToGrant.value,
    tool: raw(props.tool),
    link: raw(linkFor(props.kind)),
  };
  const base = t(`assistant.askAdmin.message.${props.kind}`, params);
  if (!offersPrompt.value || !includePrompt.value) return base;
  return t("assistant.askAdmin.withPrompt", {
    message: base,
    prompt: raw(promptLine(props.promptPreview)),
  });
});

const subject = computed(() =>
  t(`assistant.askAdmin.subject.${props.kind}`, { product, org: raw(targetOrg.value) }),
);

const mailto = computed(() => mailtoHref(admins.value, subject.value, message.value));

// The sheet and the popover take different props; the one rendered gets its own set.
const wrapperProps = computed<Record<string, unknown>>(() =>
  isMobile.value
    ? {
        snap: sheetSnap.value,
        "onUpdate:snap": (next: SheetSnap) => (sheetSnap.value = next),
        snapPoints: ["half", "full"],
        ariaLabel: t("assistant.askAdmin.title"),
        expandLabel: t("assistant.shell.sheetExpand"),
        collapseLabel: t("assistant.shell.sheetPeek"),
        dataTest: "assistant-ask-admin-sheet",
        privacy: "mask",
      }
    : {
        side: "bottom",
        align: "start",
        ariaLabel: t("assistant.askAdmin.title"),
        contentClass: "w-[min(24rem,calc(100vw-1.5rem))]",
        privacy: "mask",
      },
);

// Only Billing exists to link to; Settings › Assistant is named in words until its route ships.
function linkFor(kind: AskAdminKind): string {
  if (kind !== "credits" && kind !== "consent") return "";
  try {
    const target = { name: "plans", query: { org_identifier: targetOrg.value } };
    return new URL(router.resolve(target).href, window.location.origin).toString();
  } catch {
    return "";
  }
}

async function copy(): Promise<void> {
  copyFailed.value = false;
  const copied = await copyToClipboard(message.value, t, { silent: true });
  if (copied) {
    toast({ variant: "success", message: t("assistant.askAdmin.copied") });
    emit("copied");
    return;
  }
  copyFailed.value = true;
  await nextTick();
  messageField.value?.querySelector("textarea")?.select();
}

// The sheet has no trigger slot, so the phone path opens it from the trigger's own click, bound as it renders.
function bindTrigger(el: unknown): void {
  const next = el instanceof HTMLElement ? el : null;
  if (next === mobileTrigger.value) return;
  mobileTrigger.value?.removeEventListener("click", showSheet);
  next?.addEventListener("click", showSheet);
  mobileTrigger.value = next;
}

function showSheet(): void {
  open.value = true;
}

watch(open, async (shown) => {
  if (!shown) {
    // The phone sheet is not anchored to its trigger, so focus is handed back by hand.
    if (isMobile.value)
      mobileTrigger.value?.querySelector<HTMLElement>("button, [tabindex]")?.focus();
    return;
  }
  await nextTick();
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>('[data-test="assistant-ask-admin-copy"]')?.focus(),
  );
});
</script>
