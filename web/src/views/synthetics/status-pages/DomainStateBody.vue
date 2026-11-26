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

<!-- What one custom domain row says under its name. It reads the view alone: the record comes
     from cname_target or txt_name, the sentence from serving_state, reason and warning. -->
<template>
  <p
    v-if="state === 'expired'"
    class="text-text-secondary text-sm"
    :data-test="`status-page-domain-expired-${d.id}`"
  >
    {{ t("statusPages.domains.expiredNote") }}
  </p>

  <template v-else>
    <div
      v-if="line"
      class="flex flex-wrap items-center gap-2"
      :data-test="`status-page-domain-reason-${d.id}`"
    >
      <span class="text-text-secondary text-sm">
        {{ nextStep ? `${say(line)} ${t(nextStep)}` : say(line) }}
      </span>
      <router-link
        v-if="d.serving_state === 'not_serving' && d.reason === 'plan_required'"
        :to="plansRoute"
        class="text-accent text-sm hover:underline"
        :data-test="`status-page-domain-upgrade-btn-${d.id}`"
      >
        {{ t("billing.upgradeNow") }}
      </router-link>
    </div>

    <span
      v-if="nextTry"
      class="text-text-secondary text-sm"
      :data-test="`status-page-domain-next-try-${d.id}`"
    >
      {{ say(nextTry) }}
    </span>

    <OButton
      v-if="canCheckAgain"
      variant="outline"
      size="sm"
      class="self-start"
      :disabled="checking"
      :data-test="`status-page-domain-check-again-${d.id}`"
      @click="emit('check-again')"
    >
      {{ t("statusPages.domains.checkAgain") }}
    </OButton>

    <span
      v-if="evidence.length"
      class="text-text-secondary text-sm"
      :data-test="`status-page-domain-evidence-${d.id}`"
    >
      {{ evidence.map(say).join(" ") }}
    </span>

    <OBanner
      v-if="warning"
      variant="warning"
      icon="warning"
      dense
      :data-test="`status-page-domain-warning-${d.id}`"
    >
      {{ say(warning) }}
    </OBanner>

    <div v-if="kind" class="flex flex-col gap-2" :data-test="`status-page-domain-record-${d.id}`">
      <span
        v-if="showsRecordInstructions"
        class="text-text-heading text-sm font-medium"
        :data-test="kind === 'cname' ? `status-page-domain-cname-${d.id}` : undefined"
      >
        {{
          kind === "cname"
            ? t("statusPages.domains.cnameInstruction", {
                domain: d.domain,
                target: d.cname_target,
              })
            : t("statusPages.domains.recordInstructions")
        }}
      </span>

      <div v-for="field in recordFields" :key="field.id" class="flex flex-col gap-1">
        <span class="text-text-label text-2xs font-medium">{{ t(field.label) }}</span>
        <div class="flex min-w-0 items-center gap-1">
          <OCode truncate class="min-w-0">{{ raw(field.value) }}</OCode>
          <OButton
            variant="ghost"
            size="icon-xs"
            icon-left="content-copy"
            :data-test="`status-page-domain-copy-${field.id}-${d.id}`"
            @click="field.copyValue"
          >
            <OTooltip side="bottom" :content="t(field.copy)" />
          </OButton>
        </div>
      </div>

      <span
        v-if="kind === 'txt' || state === 'serving'"
        class="text-text-secondary text-sm"
        :data-test="`status-page-domain-keep-${kind === 'txt' ? 'record' : 'cname'}-${d.id}`"
      >
        {{
          t(
            kind === "txt"
              ? "statusPages.domains.keepRecord"
              : "statusPages.domains.keepCnameRecord",
          )
        }}
      </span>
      <span
        v-if="
          kind === 'cname' &&
          (state === 'pending' || (state === 'waiting_for_dns' && d.reason === 'no_record'))
        "
        class="text-text-secondary text-sm"
        :data-test="`status-page-domain-apex-${d.id}`"
      >
        {{ t("statusPages.domains.apexNote") }}
      </span>
      <span
        v-if="state === 'pending' && kind === 'txt'"
        class="text-text-secondary text-sm"
        :data-test="`status-page-domain-routing-${d.id}`"
      >
        {{ t("statusPages.domains.routingNote") }}
      </span>
    </div>

    <template v-if="state === 'pending' && kind">
      <span
        v-if="d.expires_at"
        class="text-text-secondary text-sm"
        :data-test="`status-page-domain-expires-${d.id}`"
      >
        {{ t("statusPages.domains.expiresAt", { date: fmt(d.expires_at) }) }}
      </span>
      <span
        class="text-text-secondary text-sm"
        :data-test="`status-page-domain-auto-verify-${d.id}`"
      >
        {{ t("statusPages.domains.nextStepVerify", { seconds: verifyIntervalSeconds }) }}
      </span>
    </template>
  </template>

  <span
    v-if="stale"
    class="text-text-secondary text-sm italic"
    :data-test="`status-page-domain-stale-${d.id}`"
  >
    {{ t("statusPages.domains.staleNote") }}
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useNow } from "@/composables/useNow";
import { copyToClipboard } from "@/utils/clipboard";
import type { StatusPageDomain } from "@/services/status_pages";
import { shownServingState } from "./statusPageBadges";
import {
  domainEvidence,
  domainMessage,
  domainNextStep,
  domainRecordKind,
  domainWarning,
  formatDomainTime,
  isActsReason,
  isStateStale,
  type DomainText,
} from "./domainMessages";

const props = defineProps<{
  domain: StatusPageDomain;
  // Cloud picks a wording only; it never picks a state.
  cloud: boolean;
  orgIdentifier: string;
  checking: boolean;
}>();

const emit = defineEmits<{ "check-again": [] }>();

const { t } = useI18nTyped();
const store = useStore();
const now = useNow();

// Mirrors ZO_STATUS_PAGE_DOMAIN_VERIFY_INTERVAL's server-side default; the
// backend exposes no endpoint for it, so an operator override drifts from this.
const verifyIntervalSeconds = 30;

const d = computed(() => props.domain);
const state = computed(() => shownServingState(d.value));
const kind = computed(() => domainRecordKind(d.value));

const fmt = (us: number) => formatDomainTime(us, store.state.timezone);
const say = (text: DomainText) => t(text.key, text.named ?? {});

const line = computed(() => domainMessage(d.value, props.cloud, fmt));
const nextStep = computed(() => domainNextStep(d.value, props.cloud));
const nextTry = computed<DomainText | null>(() =>
  isActsReason(d.value) && d.value.next_action_at
    ? {
        key: "statusPages.domains.reason.nextTry",
        named: { time: fmt(d.value.next_action_at) },
      }
    : null,
);
const warning = computed(() => domainWarning(d.value, fmt));
const evidence = computed(() => domainEvidence(d.value, fmt));
const stale = computed(() => isStateStale(d.value, now.value));
const canCheckAgain = computed(
  () =>
    state.value === "not_serving" && d.value.can_check_again && !!d.value.reason?.startsWith("ca_"),
);

// The record is asked for while the claim is pending or waiting.
const showsRecordInstructions = computed(
  () => state.value === "pending" || state.value === "waiting_for_dns",
);

interface RecordField {
  id: string;
  label: I18nKey;
  value: string;
  copy: I18nKey;
  copyValue: () => void;
}

const recordFields = computed<RecordField[]>(() => {
  if (kind.value === "cname") {
    return [
      {
        id: "cname-name",
        label: "statusPages.domains.cnameNameLabel",
        value: d.value.domain,
        copy: "statusPages.domains.copyCnameName",
        copyValue: () => copyRecord(d.value.domain, "statusPages.domains.cnameNameCopied"),
      },
      {
        id: "cname-value",
        label: "statusPages.domains.cnameValueLabel",
        value: d.value.cname_target ?? "",
        copy: "statusPages.domains.copyCnameValue",
        copyValue: () => copyRecord(d.value.cname_target, "statusPages.domains.cnameValueCopied"),
      },
    ];
  }
  if (kind.value === "txt") {
    return [
      {
        id: "txt-name",
        label: "statusPages.domains.txtNameLabel",
        value: d.value.txt_name ?? "",
        copy: "statusPages.domains.copyTxtName",
        copyValue: copyTxtName,
      },
      {
        id: "txt-value",
        label: "statusPages.domains.txtValueLabel",
        value: d.value.verification_token ?? "",
        copy: "statusPages.domains.copyTxtValue",
        copyValue: copyTxtValue,
      },
    ];
  }
  return [];
});

const plansRoute = computed(() => ({
  name: "plans",
  query: { org_identifier: props.orgIdentifier },
}));

function copyRecord(value: string | null, copied: I18nKey) {
  if (!value) return;
  copyToClipboard(value, t, { successMessage: t(copied) });
}

function copyTxtName() {
  copyRecord(d.value.txt_name, "statusPages.domains.txtNameCopied");
}

function copyTxtValue() {
  copyRecord(d.value.verification_token, "statusPages.domains.txtValueCopied");
}
</script>
