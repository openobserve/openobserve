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
  <ODialog
    :open="!!view"
    size="sm"
    :title="view?.title"
    :show-close="false"
    :data-test="view?.dataTest"
    @update:open="(open) => !open && answer(view?.escape ?? 'cancel')"
  >
    <div class="flex flex-col gap-3">
      <OText as="p" class="break-words" :data-test="view ? `${view.dataTest}-body` : undefined">
        {{ view?.body }}
      </OText>
      <OText
        v-if="view?.note"
        as="p"
        class="break-words"
        :data-test="view ? `${view.dataTest}-note` : undefined"
      >
        {{ view.note }}
      </OText>
      <slot v-if="view?.kind === 'sign_out'" name="sign-out-extra">
        <OCheckbox
          v-if="localHistory"
          :model-value="deleteLocal"
          :label="t('assistant.signout.deleteLocal')"
          data-test="assistant-signout-delete-local"
          @update:model-value="setDeleteLocal"
        />
      </slot>
    </div>
    <template #footer>
      <div
        class="flex flex-wrap items-center justify-end gap-2 max-md:flex-col max-md:items-stretch"
      >
        <OButton
          v-for="action in view?.actions ?? []"
          :key="action.choice"
          :ref="(el) => setButton(action.choice, el)"
          :variant="action.variant"
          size="sm-action"
          class="max-md:min-h-11 max-md:w-full pointer-coarse:min-h-11"
          :data-test="action.dataTest"
          @click="answer(action.choice)"
        >
          {{ action.label }}
        </OButton>
      </div>
    </template>
  </ODialog>
</template>

<script lang="ts">
import type { ButtonVariant } from "@/lib/core/Button/OButton.types";
import type { I18nText } from "@/types/i18n";

interface DialogAction {
  choice: string;
  label: I18nText;
  variant: ButtonVariant;
  dataTest: string;
}

/** What one open question renders: copy, actions in reading order, the focused one and Escape's meaning. */
export interface LifecycleDialogView {
  kind: "sign_out" | "org_switch" | "leave_guard";
  title: I18nText;
  body: I18nText;
  /** What Keep also does, said before the user picks it. */
  note?: I18nText | null;
  dataTest: string;
  actions: DialogAction[];
  focus: string;
  escape: string;
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import {
  registerLifecycleDialogs,
  useAssistantHistory,
  useLifecycleQuestion,
  type LifecycleQuestion,
} from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { raw, useI18nTyped } from "@/types/i18n";

defineSlots<{
  /** Extra sign-out choices, such as deleting this browser's chats. */
  "sign-out-extra"?: () => unknown;
}>();

const { t } = useI18nTyped();
const open = useLifecycleQuestion();
const buttons = new Map<string, HTMLElement>();
const unregister = registerLifecycleDialogs();
let returnFocusTo: HTMLElement | null = null;
let fallbackFocus: HTMLElement | null = null;

const view = computed<LifecycleDialogView | null>(() =>
  open.value ? viewOf(open.value.question) : null,
);

// Local mode only: the choice is the persistent sign-out preference, read when the dialog opens.
const history = useAssistantHistory();
const localHistory = computed(() => history.mode.value === "local");
const deleteLocal = ref(false);
watch(
  () => view.value?.kind,
  (kind) => {
    if (kind === "sign_out") deleteLocal.value = history.clearOnSignOut();
  },
  { immediate: true },
);

function setDeleteLocal(value: unknown): void {
  deleteLocal.value = value === true;
  history.setClearOnSignOut(deleteLocal.value);
}

function viewOf(question: LifecycleQuestion): LifecycleDialogView {
  if (question.kind === "sign_out") {
    const { count } = question;
    return {
      kind: question.kind,
      title: t("assistant.shell.signOutRunningTitle"),
      body: t("assistant.shell.signOutRunningBody", { count }, count),
      dataTest: "assistant-shell-sign-out-dialog",
      actions: [
        action("cancel", t("common.cancel"), "outline", "assistant-shell-sign-out-cancel"),
        action(
          "proceed",
          t("assistant.shell.stopAndSignOut"),
          "primary",
          "assistant-shell-sign-out-stop",
        ),
      ],
      focus: "proceed",
      escape: "cancel",
    };
  }
  if (question.kind === "org_switch") {
    const { count } = question;
    const org = raw(question.org);
    return {
      kind: question.kind,
      title: t("assistant.shell.orgSwitchRunningTitle", { org }),
      body: t("assistant.shell.orgSwitchRunningBody", { count, org }, count),
      note: question.waiting
        ? t("assistant.shell.orgSwitchWithdrawn", { count: question.waiting }, question.waiting)
        : null,
      dataTest: "assistant-shell-org-switch-dialog",
      actions: [
        action("stop", t("assistant.shell.stop"), "outline", "assistant-shell-org-switch-stop"),
        action("keep", t("assistant.shell.keep"), "primary", "assistant-shell-org-switch-keep"),
        action("cancel", t("common.cancel"), "ghost", "assistant-shell-org-switch-cancel"),
      ],
      focus: "keep",
      escape: "cancel",
    };
  }
  return {
    kind: question.kind,
    title: t("assistant.shell.leaveGuardTitle"),
    body: t("assistant.shell.leaveGuardBody", { name: question.name }),
    dataTest: "assistant-shell-leave-guard",
    actions: [
      action(
        "keep",
        t("assistant.shell.keepEditing"),
        "primary",
        "assistant-shell-leave-guard-keep",
      ),
      action(
        "discard",
        t("assistant.shell.discardChanges"),
        "destructive",
        "assistant-shell-leave-guard-discard",
      ),
    ],
    focus: "keep",
    escape: "keep",
  };
}

function action(choice: string, label: I18nText, variant: ButtonVariant, dataTest: string) {
  return { choice, label, variant, dataTest };
}

function setButton(choice: string, el: unknown): void {
  const node = (el as { $el?: unknown } | null)?.$el;
  if (node instanceof HTMLElement) buttons.set(choice, node);
  else buttons.delete(choice);
}

function answer(choice: string): void {
  open.value?.answer(choice);
}

// The default is focused once the dialog's own focus scope has settled; focus returns to the trigger after.
watch(
  () => open.value,
  async (current, previous) => {
    if (current && !previous) {
      const active = document.activeElement;
      const invoker = "invoker" in current.question ? (current.question.invoker ?? null) : null;
      returnFocusTo = active instanceof HTMLElement && active !== document.body ? active : invoker;
      fallbackFocus = invoker;
      await nextTick();
      requestAnimationFrame(() => {
        const focus = view.value?.focus;
        if (focus) buttons.get(focus)?.focus();
      });
      return;
    }
    if (!current && previous) {
      // The menu item that asked is gone once its menu closed, so its trigger takes focus instead.
      const target = [returnFocusTo, fallbackFocus].find((el) => el?.isConnected) ?? null;
      returnFocusTo = null;
      fallbackFocus = null;
      await nextTick();
      requestAnimationFrame(() => target?.focus());
    }
  },
);

onBeforeUnmount(unregister);
</script>
