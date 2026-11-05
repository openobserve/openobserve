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
  <section
    ref="root"
    :aria-labelledby="headingId"
    :aria-busy="state === 'submitting' ? 'true' : undefined"
    :class="[
      'rounded-surface bg-surface-base flex min-w-0 flex-col gap-3 border',
      variant === 'compact' ? 'p-2' : 'p-3',
      resolved ? 'border-border-default' : 'border-badge-warning-ol-border',
    ]"
    :data-variant="variant"
    data-test="assistant-consent-card"
  >
    <h3
      :id="headingId"
      ref="heading"
      tabindex="-1"
      class="text-text-heading rounded-default focus-visible:ring-border-strong text-sm font-semibold break-words outline-none focus-visible:ring-2"
      data-test="assistant-consent-card-org"
    >
      {{ title }}
    </h3>
    <p v-if="resolved" class="text-text-body text-sm" data-test="assistant-consent-card-resolved">
      {{ resolvedLine }}
    </p>
    <template v-else>
      <PaidOverageConsentBody
        v-model:acknowledged="acknowledged"
        :org-name="orgName"
        :org-id="orgId || orgName"
        :payer-name="payerName"
        :plan-type="planType"
        :can-enable="canEnable"
        :variant="variant"
        @open-billing="emit('open-billing')"
      >
        <template #member-actions>
          <AssistantAskAdminPopover
            kind="consent"
            :org="orgId || orgName"
            :payer="planType === 'payer' ? payerName || undefined : undefined"
            :prompt-preview="promptPreview"
            @copied="emit('ask-admin')"
            @emailed="emit('ask-admin')"
          >
            <template #trigger>
              <OButton
                variant="outline"
                size="sm"
                :class="TOUCH_TARGET_CLASS"
                data-test="assistant-consent-card-ask-admin"
              >
                {{ t("assistant.outcome.actions.askAdmin") }}
              </OButton>
            </template>
          </AssistantAskAdminPopover>
        </template>
      </PaidOverageConsentBody>
      <OBanner
        v-if="state === 'error'"
        variant="error"
        dense
        role="alert"
        :content="
          error === 'still_required'
            ? t('assistant.consent.stillRequired')
            : t('assistant.consent.error')
        "
        data-test="assistant-consent-card-error"
      />
      <div class="flex min-w-0 justify-end gap-2 max-md:flex-col">
        <OButton
          variant="outline"
          size="sm-action"
          :disabled="submitting"
          focusable-unavailable
          :class="TOUCH_TARGET_CLASS"
          data-test="assistant-consent-card-cancel"
          @click="(event: MouseEvent) => act(event, () => emit('cancel'))"
        >
          {{ t("assistant.consent.cancel") }}
        </OButton>
        <OButton
          v-if="canEnable"
          variant="primary"
          size="sm-action"
          :disabled="!acknowledged || submitting"
          :focusable-unavailable="submitting"
          :loading="submitting"
          :class="TOUCH_TARGET_CLASS"
          data-test="assistant-consent-card-enable"
          @click="(event: MouseEvent) => act(event, () => acknowledged && emit('enable'))"
        >
          {{ t("assistant.consent.enable") }}
        </OButton>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";

import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import AssistantAskAdminPopover from "@/components/ai-assistant/gate/AssistantAskAdminPopover.vue";
import PaidOverageConsentBody from "@/components/PaidOverageConsentBody.vue";
import {
  registerAssistantFocusTarget,
  assistantKeydownAt,
  registerEscapeRung,
  useAssistantIdleFocus,
  type AssistantConsentCardProps,
} from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

/** A key pressed this close before the card mounted may land its keyup on the card; that one activation is ignored. */
const CARRIED_KEY_MS = 1_000;

const props = withDefaults(
  defineProps<
    AssistantConsentCardProps & {
      /** The identifier Billing and Ask an admin act on; the name when not given. */
      orgId?: string;
      /** Only the payer still needs enabling, so the card names the payer. */
      payerOnly?: boolean;
      error?: "failed" | "still_required";
      /** Where a grant made elsewhere was seen: the hint of another tab, or a focus re-read. */
      via?: "tab" | "focus";
      promptPreview?: string;
    }
  >(),
  {
    payerName: "",
    orgId: "",
    payerOnly: false,
    error: "failed",
    via: "tab",
    promptPreview: undefined,
  },
);

const emit = defineEmits<{
  (e: "enable"): void;
  (e: "cancel"): void;
  (e: "open-billing"): void;
  (e: "ask-admin"): void;
  (e: "announce", text: I18nText): void;
}>();

const { t } = useI18nTyped();
const idle = useAssistantIdleFocus();
const headingId = `assistant-consent-heading-${useId()}`;
const root = ref<HTMLElement | null>(null);
const heading = ref<HTMLElement | null>(null);
const acknowledged = ref(false);
// A key pressed before the card existed never cancels or enables it.
const mountedAt = ref(Number.POSITIVE_INFINITY);
let keydownAt = Number.NEGATIVE_INFINITY;
let carriedKey = false;
let unmounted = false;
const offs: (() => void)[] = [];

const resolved = computed(
  () => props.state === "resolved_here" || props.state === "resolved_elsewhere",
);
const submitting = computed(() => props.state === "submitting");

// Only the payer missing names the payer; any member org missing names the member; a resolved card states what happened.
const title = computed(() => {
  if (resolved.value) return t("assistant.consent.titleResolved", { org: props.orgName });
  return props.payerOnly && props.payerName
    ? t("assistant.consent.titlePayer", { payer: props.payerName })
    : t("assistant.consent.title", { org: props.orgName });
});

const resolvedLine = computed(() => {
  if (props.state === "resolved_here") return t("assistant.consent.resolvedHere");
  return props.via === "focus"
    ? t("assistant.consent.resolvedElsewhereFocus")
    : t("assistant.consent.resolvedElsewhere");
});

function onKeydown(): void {
  keydownAt = Date.now();
}

function act(event: MouseEvent, run: () => void): void {
  const fresh = Date.now() - mountedAt.value < CARRIED_KEY_MS;
  if (event.detail === 0 && carriedKey && fresh && keydownAt < mountedAt.value) return;
  run();
}

function focusHeading(): boolean {
  if (!heading.value || resolved.value) return false;
  heading.value.focus();
  return true;
}

onMounted(async () => {
  mountedAt.value = Date.now();
  carriedKey = mountedAt.value - assistantKeydownAt() < CARRIED_KEY_MS;
  root.value?.addEventListener("keydown", onKeydown, true);
  offs.push(
    registerAssistantFocusTarget("card", focusHeading),
    // While Enable is on its way Escape does nothing here, so it never reaches the panel's close.
    registerEscapeRung("b", (event) => {
      const target = event.target instanceof Node ? event.target : document.activeElement;
      if (!target || !root.value?.contains(target)) return false;
      if (!submitting.value) emit("cancel");
      return true;
    }),
  );
  await nextTick();
  if (unmounted) return;
  const moved = idle.canTakeFocus() && focusHeading();
  const line = t("assistant.announce.consent", {
    state: t("assistant.turn.waitingConsent"),
    org: props.orgName,
  });
  emit("announce", moved ? line : t(idle.jumpKey(), { line, keys: t(idle.spokenKeys()) }));
});

onBeforeUnmount(() => {
  unmounted = true;
  root.value?.removeEventListener("keydown", onKeydown, true);
  offs.forEach((off) => off());
});

defineExpose({ focusHeading });
</script>
