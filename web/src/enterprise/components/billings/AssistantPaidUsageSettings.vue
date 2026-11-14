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
    id="paid-usage-settings"
    tabindex="-1"
    class="border-border-default flex flex-col gap-3 border-t pt-3"
    :aria-labelledby="ids.heading"
    data-test="paid-usage-settings"
  >
    <h3 :id="ids.heading" class="text-text-heading text-sm font-semibold">
      {{ t("assistant.billing.paidUsage.title") }}
    </h3>
    <div v-if="overage.isPending.value" class="flex flex-col gap-2">
      <OSkeleton type="rect" class="h-6 w-full max-w-120" />
    </div>
    <p v-else-if="!status" class="text-text-body text-sm" data-test="paid-usage-unavailable">
      {{ t("assistant.billing.paidUsage.unavailable") }}
      <OButton
        variant="ghost-primary"
        size="xs"
        data-test="paid-usage-retry"
        @click="overage.refetch()"
      >
        {{ t("common.retry") }}
      </OButton>
    </p>
    <template v-else>
      <div
        class="flex items-center justify-between gap-3 max-md:flex-wrap"
        data-test="paid-usage-own-row"
      >
        <div class="flex min-w-0 flex-col gap-1">
          <span class="text-text-body text-sm">
            {{ t("assistant.billing.paidUsage.thisOrg", { org: ownName }) }}
          </span>
          <span
            v-if="lockedOn"
            class="text-text-secondary text-xs"
            :id="ids.helper"
            data-test="paid-usage-own-helper"
          >
            {{ lockedOn }}
          </span>
        </div>
        <OSwitch
          v-if="status.organization.can_manage"
          :model-value="ownOn"
          :disabled="saving || (!ownOn && !!lockedOn)"
          :aria-describedby="lockedOn ? ids.helper : undefined"
          class="max-md:min-h-11"
          data-test="paid-usage-own-switch"
          @update:model-value="(value) => toggle(value === true)"
        >
          <template #label>
            <span aria-hidden="true">{{ t("assistant.billing.paidUsage.allow") }}</span>
            <span class="sr-only">{{
              t("assistant.billing.paidUsage.allowFor", { org: ownName })
            }}</span>
          </template>
        </OSwitch>
        <div v-else class="flex flex-wrap items-center gap-2" data-test="paid-usage-own-readonly">
          <OTag
            variant="default-soft"
            :label="
              ownOn
                ? t('assistant.billing.paidUsage.allowed')
                : t('assistant.billing.paidUsage.notAllowed')
            "
          />
          <span class="text-text-secondary text-xs">{{ t("paidUsage.readOnlyAdmin") }}</span>
          <AssistantAskAdminPopover kind="settings" :org="org">
            <template #trigger>
              <OButton
                variant="outline"
                size="sm"
                class="max-md:min-h-11"
                data-test="paid-usage-ask-admin"
              >
                {{ t("assistant.gate.noPermission.askAdmin") }}
              </OButton>
            </template>
          </AssistantAskAdminPopover>
        </div>
      </div>
      <OBanner v-if="writeFailed" variant="error" data-test="paid-usage-error">
        {{ t("assistant.billing.paidUsage.updateFailed") }}
        <OButton
          variant="ghost-primary"
          size="xs"
          data-test="paid-usage-error-retry"
          @click="toggle(lastWanted.on, lastWanted.who)"
        >
          {{ t("common.retry") }}
        </OButton>
      </OBanner>
      <div
        v-if="status.payer"
        class="flex items-center justify-between gap-3 max-md:flex-wrap"
        data-test="paid-usage-payer-state"
      >
        <span class="text-text-body text-sm">
          {{ t("assistant.billing.paidUsage.payerOrg", { org: payerName }) }}
        </span>
        <OSwitch
          v-if="status.payer.can_manage"
          :model-value="payerOn"
          :disabled="saving"
          class="max-md:min-h-11"
          data-test="paid-usage-payer-switch"
          @update:model-value="(value) => toggle(value === true, 'payer')"
        >
          <template #label>
            <span aria-hidden="true">{{ t("assistant.billing.paidUsage.allow") }}</span>
            <span class="sr-only">{{
              t("assistant.billing.paidUsage.allowFor", { org: payerName })
            }}</span>
          </template>
        </OSwitch>
        <div v-else class="flex flex-wrap items-center gap-2">
          <OTag
            variant="default-soft"
            :label="
              status.payer.enabled
                ? t('assistant.billing.paidUsage.allowed')
                : t('assistant.billing.paidUsage.notAllowed')
            "
          />
          <span class="text-text-secondary text-xs">{{
            t("assistant.billing.paidUsage.managedBy", { org: payerName })
          }}</span>
        </div>
      </div>
      <p role="status" class="text-text-body text-sm" data-test="paid-usage-effective">
        {{ effectiveLine }}
      </p>
      <p v-if="enabledBy" class="text-text-secondary text-xs" data-test="paid-usage-enabled-by">
        {{ t("assistant.billing.paidUsage.enabledBy", enabledBy) }}
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { computed, ref, useId, watch } from "vue";
import { useStore } from "vuex";

import AssistantAskAdminPopover from "@/components/ai-assistant/gate/AssistantAskAdminPopover.vue";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { usePaidOverageConsent } from "@/composables/usePaidOverageConsent";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { paidOverageQuery, setPaidOverageMutation } from "@/services/paidOverage.queries";
import { useI18nTyped } from "@/types/i18n";
import { dayOf, orgNameOf } from "./assistantBilling";

type Who = "own" | "payer";

const emit = defineEmits<{ (e: "change"): void }>();

const { t } = useI18nTyped();
const store = useStore();
const { confirm } = useConfirmDialog();
const { promptForConsent } = usePaidOverageConsent();
const queryClient = useQueryClient();
const ids = { heading: useId(), helper: useId() };

const org = computed(() => (store.state.selectedOrganization?.identifier as string) ?? "");
const overage = useQuery(computed(() => paidOverageQuery(org.value, "ai_credits")));
const setOverage = useMutation(() => setPaidOverageMutation(org.value, "ai_credits"));
const setPayer = useMutation(() =>
  setPaidOverageMutation(overage.data.value?.payer?.org_id ?? "", "ai_credits"),
);

const saving = ref(false);
const writeFailed = ref(false);
const lastWanted = ref<{ on: boolean; who: Who }>({ on: false, who: "own" });
// Shown while a write is in flight so the switch never jumps back before the server answers.
const pendingOwn = ref<boolean | null>(null);
const pendingPayer = ref<boolean | null>(null);

const status = computed(() => overage.data.value ?? null);
const orgs = computed(() => store.state.organizations as unknown);
const ownName = computed(() =>
  orgNameOf(orgs.value, org.value, store.state.selectedOrganization?.label),
);
const payerName = computed(() => orgNameOf(orgs.value, status.value?.payer?.org_id ?? ""));
const ownOn = computed(() => pendingOwn.value ?? status.value?.organization.enabled === true);
const payerOn = computed(() => pendingPayer.value ?? status.value?.payer?.enabled === true);

/** Turning on needs an eligible billing state; turning off never does. */
const lockedOn = computed(() => {
  const billing = status.value?.billing_status;
  if (!billing || billing === "eligible") return "";
  return billing === "subscription_required"
    ? t("assistant.billing.paidUsage.subscribeFirst")
    : t("assistant.billing.paidUsage.creditsFirst");
});

const effectiveLine = computed(() => {
  const s = status.value!;
  if (s.effective) return t("assistant.billing.paidUsage.effectiveOn");
  if (s.organization.enabled && s.payer && !s.payer.enabled)
    return t("assistant.billing.paidUsage.effectiveWaiting", { org: payerName.value });
  return t("assistant.billing.paidUsage.effectiveOff");
});

const enabledBy = computed(() => {
  const by = status.value?.organization.enabled_by;
  if (!status.value?.organization.enabled || typeof by?.email !== "string" || !by.email)
    return null;
  return { email: by.email, date: dayOf(by.at) };
});

watch(org, () => {
  writeFailed.value = false;
  pendingOwn.value = null;
  pendingPayer.value = null;
});

/** Turning on goes through consent for the org that pays; turning off asks first and never needs eligibility. */
async function decide(on: boolean, who: Who, target: string): Promise<boolean> {
  const name = who === "own" ? ownName.value : payerName.value;
  if (!on)
    return confirm({
      title: t("assistant.billing.paidUsage.offTitle", { org: name }),
      message: t("assistant.billing.paidUsage.offMessage"),
      confirmLabel: t("assistant.billing.paidUsage.offConfirm"),
      confirmVariant: "destructive",
      focusCancel: true,
    });
  const current =
    who === "own"
      ? status.value!
      : await queryClient.fetchQuery(paidOverageQuery(target, "ai_credits"));
  return promptForConsent(target, "ai_credits", current);
}

async function toggle(on: boolean, who: Who = "own") {
  const current = status.value;
  if (!current || saving.value) return;
  const target = who === "own" ? org.value : current.payer?.org_id;
  if (!target) return;
  const opened = org.value;
  const pending = who === "own" ? pendingOwn : pendingPayer;
  lastWanted.value = { on, who };
  writeFailed.value = false;
  saving.value = true;
  pending.value = on;
  const track = (result: "ok" | "failed" | "cancelled") =>
    trackAssistant("ai_admin", {
      section: "paid_usage",
      action: on ? "enable" : "disable",
      result,
    });
  try {
    if (!(await decide(on, who, target))) {
      track("cancelled");
      return;
    }
    if (!on && opened === org.value)
      await (who === "own" ? setOverage : setPayer).mutateAsync(false);
    track("ok");
    await overage.refetch();
    emit("change");
  } catch {
    writeFailed.value = true;
    track("failed");
  } finally {
    pending.value = null;
    saving.value = false;
  }
}
</script>
