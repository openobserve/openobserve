<template>
  <OFormSection
    variant="plain"
    class="mb-4"
    :title="t('about.online_title')"
    data-test="license-online-card"
  >
    <template v-if="canUpdate" #actions>
      <OButton
        v-if="canCopy && refresh.successor_available"
        variant="outline"
        size="sm-action"
        icon-left="content-copy"
        data-test="license-online-copy"
        @click="copyStoredKey"
        >{{ t("about.online_copy_renewed") }}</OButton
      >
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="refresh"
        :loading="busy"
        data-test="license-online-refresh"
        @click="run(false)"
        >{{ busy ? t("about.online_refreshing") : t("about.refresh_now") }}</OButton
      >
      <OButton
        v-if="canCopy && !refresh.successor_available"
        variant="outline"
        size="sm-action"
        icon-left="content-copy"
        data-test="license-online-copy"
        @click="copyStoredKey"
        >{{ t("about.online_copy_fetched") }}</OButton
      >
      <OButton
        v-if="canRotate"
        variant="outline"
        size="sm-action"
        :disabled="busy"
        data-test="license-online-rotate"
        @click="run(true)"
        >{{ t("about.online_rotate") }}</OButton
      >
      <OButton
        v-if="
          refresh.mode === 'airgapped' || refresh.mode === 'not_v2' || refresh.mode === 'no_license'
        "
        variant="outline"
        size="sm-action"
        data-test="license-online-add-key"
        @click="emit('add-license-key')"
        >{{ t("about.add_new_license_key") }}</OButton
      >
    </template>
    <OSettingRow control-at="end" :label="t('about.status_lbl')">
      <div class="text-sm">
        <OTag :variant="badgeVariant">{{ statusLabel(registrationStatus, t) }}</OTag>
        <span class="text-text-secondary ms-1">{{ statusHint }}</span>
      </div>
    </OSettingRow>
    <OSettingRow
      v-if="showKey || (refresh.mode === 'disabled' && refresh.last_success_at)"
      control-at="end"
      :label="t('about.online_last_refreshed')"
    >
      <div class="text-sm">
        <span>{{ lastRefreshed }}</span>
        <!-- The saved outcome already prints below the rows; only a different one is repeated here. -->
        <span v-if="lastOutcome && lastOutcome !== outcome?.text" class="text-text-secondary">
          {{
            t("about.online_last_outcome", {
              outcome: lastOutcome,
            })
          }}
        </span>
      </div>
    </OSettingRow>
    <OSettingRow v-if="refresh.last_error" control-at="end" :label="t('about.online_last_error')">
      <div class="text-sm">
        <div class="text-status-negative" data-test="license-online-last-error">
          {{ lastError }}
        </div>
        <div v-if="isNetworkError" class="text-text-secondary mt-1 text-xs">
          {{ t("about.online_proxy_hint") }}
        </div>
      </div>
    </OSettingRow>
    <OSettingRow v-if="showKey" control-at="end" :label="t('about.online_installation_key')">
      <div class="text-sm">
        <template v-if="isRoot && refresh.key_id">
          <code class="bg-surface-subtle rounded-default px-1">{{ shortKey }}</code>
          <span class="text-text-secondary">{{
            t("about.online_key_storage", { storage: keyStorage })
          }}</span>
          <div v-if="refresh.key_at_rest === 'plaintext'" class="text-text-secondary mt-1 text-xs">
            {{ t("about.online_plaintext_hint") }}
          </div>
        </template>
        <span v-else-if="!refresh.key_created" class="text-text-secondary">{{
          t("about.online_no_key")
        }}</span>
        <span v-else class="text-text-secondary">{{ t("about.online_key_root_only") }}</span>
      </div>
    </OSettingRow>
    <div
      v-if="!canUpdate || outcome || neverRefreshed || refresh.rotate_recommended"
      class="px-4 py-3"
    >
      <div v-if="!canUpdate" class="text-text-secondary text-sm">
        {{ t("about.online_ask_admin") }}
      </div>
      <template v-else>
        <div v-if="refresh.rotate_recommended" class="text-status-warning-text mb-2 text-sm">
          {{ t("about.online_rotate_hint") }}
        </div>
        <div v-if="neverRefreshed" class="text-text-secondary mb-2 text-xs">
          {{ t("about.online_first_refresh") }}
        </div>
        <div
          v-if="outcome"
          role="status"
          aria-live="polite"
          class="flex items-start gap-2 text-sm"
          :class="outcomeClass"
          data-test="license-online-outcome"
        >
          <OIcon :name="outcomeIcon" size="sm" class="mt-0.5 shrink-0" />
          <span>{{ outcome.text }}</span>
        </div>
        <div
          v-if="result && outcome?.hint && !isNetworkError"
          class="text-text-secondary mt-1 text-xs"
        >
          {{ outcome.hint }}
        </div>
      </template>
    </div>
  </OFormSection>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLicenseRefresh } from "@/composables/useLicenseRefresh";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import { useI18nTyped } from "@/types/i18n";
import type { RefreshResult } from "@/ts/interfaces/licenseRefresh";
import { refreshMessage, statusLabel, type RefreshStatus } from "@/utils/licenseRefresh";
import { copyToClipboard } from "@/utils/clipboard";
import { formatUtc, issuedOn } from "@/utils/licenseWaivers";

const props = defineProps<{
  refresh: RefreshStatus;
  canUpdate: boolean;
  envKeyActive: boolean;
  isRoot: boolean;
  licenseExpiresAt?: number;
}>();
const emit = defineEmits<{ "add-license-key": []; refreshed: [] }>();
const { t, locale } = useI18nTyped();
const { refreshLicenseLimits, rotateInstanceKey } = useLicenseRefresh();
const busy = ref(false);
const result = ref<RefreshResult>();
const rotated = ref(false);
const registrationStatus = computed(() =>
  props.refresh.mode === "online" ? props.refresh.registration : props.refresh.mode,
);
const badgeVariant = computed(() =>
  registrationStatus.value === "registered"
    ? "success-outline"
    : registrationStatus.value === "blocked"
      ? "error-outline"
      : registrationStatus.value === "key_conflict"
        ? "warning-outline"
        : "default-outline",
);
const statusHint = computed(() =>
  props.refresh.registration === "blocked" && props.licenseExpiresAt
    ? t("about.online_blocked_until", { date: issuedOn(props.licenseExpiresAt, locale.value) })
    : props.refresh.mode === "airgapped"
      ? t("about.online_airgapped")
      : props.refresh.mode === "online" && props.refresh.registration === "registered"
        ? t("about.online_with_host", { host: props.refresh.server_host })
        : props.refresh.registration === "key_conflict"
          ? t("about.online_key_conflict")
          : "",
);
const showKey = computed(() => props.refresh.mode === "online");
const shortKey = computed(() => {
  const key = props.refresh.key_id ?? "";
  return key.length > 12 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key;
});
const keyStorage = computed(() =>
  props.refresh.key_at_rest === "plaintext"
    ? t("about.online_plaintext")
    : props.refresh.registration === "not_registered"
      ? t("about.online_created_key")
      : props.refresh.key_at_rest === "encrypted"
        ? t("about.online_encrypted")
        : t("about.online_no_key"),
);
const lastRefreshed = computed(() => {
  const at = props.refresh.last_success_at;
  if (!at) return "—";
  const date = formatUtc(at, locale.value, true);
  return props.refresh.last_attempt_by && props.refresh.last_attempt_at === at
    ? t("about.online_refreshed_by", { date, by: props.refresh.last_attempt_by })
    : t("about.online_refreshed_at", { date });
});
const lastOutcome = computed(() => {
  const successor = props.refresh.successor_available;
  if (successor)
    return t("about.online_successor_fetched", {
      id: successor.license_id,
      date: issuedOn(successor.expires_at, locale.value),
    });
  const outcome = props.refresh.last_outcome?.outcome;
  return outcome ? statusLabel(outcome, t) : null;
});
const isNetworkError = computed(() =>
  ["timeout", "unreachable"].includes(props.refresh.last_error ?? ""),
);
const lastError = computed(() => {
  const text =
    props.refresh.last_error_detail || refreshMessage({ error: props.refresh.last_error }, t).text;
  const at = props.refresh.last_attempt_at;
  return at
    ? t("about.online_error_at", { date: formatUtc(at, locale.value, true), error: text })
    : text;
});
const canCopy = computed(
  () => props.canUpdate && props.isRoot && props.envKeyActive && !!props.refresh.stored_key,
);
const canRotate = computed(
  () =>
    props.refresh.mode === "online" &&
    props.refresh.registration === "registered" &&
    (!canCopy.value || props.refresh.rotate_recommended),
);
const neverRefreshed = computed(
  () => props.refresh.mode === "online" && !props.refresh.last_attempt_at,
);
const outcome = computed(() => {
  if (busy.value) return { variant: "info" as const, text: t("about.online_refreshing_detail") };
  if (result.value) {
    const message = refreshMessage(result.value.body, t, result.value.status, locale.value);
    return rotated.value && message.variant === "success"
      ? { ...message, text: t("about.online_rotated") }
      : message;
  }
  if (props.refresh.last_outcome)
    return refreshMessage(
      {
        ...props.refresh.last_outcome,
        successor_available:
          props.refresh.successor_available ?? props.refresh.last_outcome.successor_available,
      },
      t,
      undefined,
      locale.value,
    );
  if (props.refresh.mode !== "online") return refreshMessage({ error: props.refresh.mode }, t);
  return null;
});
const outcomeClass = computed(
  () =>
    ({
      success: "text-status-positive",
      error: "text-status-negative",
      warning: "text-status-warning-text",
      info: "text-text-secondary",
    })[outcome.value?.variant ?? "info"],
);
const outcomeIcon = computed(() =>
  outcome.value?.variant === "success"
    ? "check-circle"
    : outcome.value?.variant === "error"
      ? "error"
      : outcome.value?.variant === "warning"
        ? "warning"
        : "info",
);
let newestAttempt = 0;
let clearAfter: number | undefined;
// a lost response may still have recorded an attempt, so it keys off the pre-click value
const clickBoundary = (clicked: RefreshResult, before: number) => {
  const body = clicked.body;
  if (typeof body === "object" && body !== null) {
    if (typeof body.attempt_at === "number") return body.attempt_at;
    if (body.attempt_recorded === false) return newestAttempt;
  }
  if (clicked.ok) return undefined;
  return clicked.status === undefined ? before : newestAttempt;
};
const dropClickedOutcome = () => {
  if (clearAfter === undefined || newestAttempt <= clearAfter) return;
  clearAfter = undefined;
  result.value = undefined;
  rotated.value = false;
};
watch(
  () => props.refresh.last_attempt_at,
  (at) => {
    newestAttempt = Math.max(newestAttempt, at ?? 0);
    dropClickedOutcome();
  },
);
const copyStoredKey = () => {
  if (canCopy.value && props.refresh.stored_key) copyToClipboard(props.refresh.stored_key, t);
};
const run = async (rotate: boolean) => {
  if (!props.canUpdate || busy.value || (rotate && !canRotate.value)) return;
  busy.value = true;
  rotated.value = rotate;
  clearAfter = undefined;
  const before = props.refresh.last_attempt_at ?? 0;
  newestAttempt = before;
  try {
    const clicked = await (rotate
      ? rotateInstanceKey(() => emit("refreshed"))
      : refreshLicenseLimits(() => emit("refreshed")));
    result.value = clicked;
    clearAfter = clickBoundary(clicked, before);
    dropClickedOutcome();
    emit("refreshed");
  } finally {
    busy.value = false;
  }
};
</script>
