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
  <div class="q-px-md q-py-md">
    <div class="password-policy-title">{{ t("settings.passwordPolicy") }}</div>
    <div class="password-policy-description">
      {{ t("settings.passwordPolicyDesc") }}
    </div>

    <div
      v-if="loading"
      data-test="password-policy-loading"
      class="tw:py-8 tw:text-center"
    >
      <q-spinner size="24px" />
    </div>

    <!-- A non-admin of _meta is a designed state: the console has no per-org role to gate the nav entry on. -->
    <div
      v-else-if="forbidden"
      data-test="password-policy-not-admin-empty-state"
      class="tw:py-8 tw:text-center"
    >
      <q-icon name="lock" size="32px" class="text-grey-6" />
      <div class="text-subtitle1 tw:mt-2">
        {{ t("passwordPolicy.notAdminTitle") }}
      </div>
      <div class="text-grey-7">{{ t("passwordPolicy.notAdmin") }}</div>
    </div>

    <div
      v-else-if="loadError"
      data-test="password-policy-load-error-empty-state"
      class="tw:py-8 tw:text-center"
    >
      <q-icon name="error" size="32px" class="text-negative" />
      <div class="text-subtitle1 tw:mt-2">
        {{ t("passwordPolicy.loadFailedTitle") }}
      </div>
      <div class="text-grey-7">{{ t("passwordPolicy.loadFailed") }}</div>
      <q-btn
        flat
        no-caps
        color="primary"
        class="tw:mt-2"
        :label="t('common.retry')"
        @click="loadPolicy"
      />
    </div>

    <q-form v-else ref="formRef" @submit="save">
      <template v-for="section in sections" :key="section.title">
        <GroupHeader
          :title="section.title"
          :show-icon="false"
          class="tw:mt-4"
        />
        <template v-for="row in section.rows" :key="row.path">
          <div
            v-if="!row.hidden?.()"
            class="password-policy-row"
            :data-test="`settings-password-policy-${row.testId}`"
          >
            <span class="password-policy-label">{{ row.label }}</span>
            <q-toggle
              v-if="row.kind === 'toggle'"
              :model-value="get(row.path)"
              :disable="row.disabled?.()"
              @update:model-value="(v: boolean) => onToggle(row.path, v)"
            />
            <q-select
              v-else-if="row.kind === 'select'"
              :model-value="get(row.path)"
              :options="backoffOptions"
              emit-value
              map-options
              dense
              outlined
              :disable="row.disabled?.()"
              class="tw:w-48"
              @update:model-value="(v: string) => set(row.path, v)"
            />
            <q-input
              v-else
              :model-value="get(row.path)"
              :type="row.kind === 'text' ? 'text' : 'number'"
              :placeholder="row.placeholder"
              dense
              outlined
              hide-bottom-space
              :disable="row.disabled?.()"
              :rules="row.rules"
              class="tw:w-48"
              @update:model-value="
                (v: string | number | null) => set(row.path, v)
              "
            />
            <span class="password-policy-description">{{
              row.description
            }}</span>
          </div>
        </template>
        <p
          v-for="note in section.notes?.() ?? []"
          :key="note.testId"
          class="password-policy-description tw:py-3"
          :data-test="`settings-password-policy-${note.testId}`"
        >
          {{ note.text }}
        </p>
      </template>

      <!-- Standing, not one-off: a warning shown once is one the next administrator never sees. -->
      <q-banner
        v-if="form.apply_to_root"
        dense
        class="bg-red-1 text-negative tw:my-3 tw:rounded"
        data-test="settings-password-policy-root-warning"
      >
        <template #avatar><q-icon name="warning" /></template>
        {{ t("passwordPolicy.rootWarning") }}
      </q-banner>

      <div class="tw:flex tw:justify-end tw:gap-2 tw:py-3">
        <q-btn
          data-test="settings-password-policy-cancel-btn"
          outline
          no-caps
          :disable="!isDirty || saving"
          :label="t('common.cancel')"
          @click="resetForm"
        />
        <q-btn
          data-test="settings-password-policy-save-btn"
          color="primary"
          no-caps
          type="submit"
          :loading="saving"
          :disable="!isDirty || !loadedPolicy"
          :label="t('settings.saveChanges')"
        />
      </div>
    </q-form>

    <!-- Switching apply_to_root back OFF is the safe direction and confirms nothing. -->
    <q-dialog
      v-model="rootDialogOpen"
      persistent
      data-test="settings-password-policy-root-dialog"
    >
      <q-card class="tw:w-[28rem] tw:max-w-full">
        <q-card-section class="text-h6">{{
          t("passwordPolicy.rootDialogTitle")
        }}</q-card-section>
        <q-card-section class="tw:pt-0 tw:flex tw:flex-col tw:gap-3">
          <q-banner dense class="bg-red-1 text-negative tw:rounded">
            <template #avatar><q-icon name="warning" /></template>
            {{ t("passwordPolicy.rootWarning") }}
          </q-banner>
          <p>{{ t("passwordPolicy.rootDialogMessage") }}</p>
          <q-checkbox
            v-model="rootAcknowledged"
            :label="t('passwordPolicy.rootDialogAck')"
            data-test="settings-password-policy-root-ack"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn
            flat
            no-caps
            :label="t('common.cancel')"
            @click="cancelApplyToRoot"
          />
          <q-btn
            color="negative"
            no-caps
            :disable="!rootAcknowledged"
            :label="t('passwordPolicy.rootDialogConfirm')"
            @click="rootDialogOpen = false"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { date, useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

import GroupHeader from "@/components/common/GroupHeader.vue";
import passwordPolicy, {
  type LockoutPolicy,
  type PasswordPolicy,
} from "@/services/passwordPolicy";
import { DEFAULT_COMPLEXITY } from "@/utils/passwordComplexity";
import { durationFormatter } from "@/utils/zincutils";

type Rule = (_value: any) => true | string;

interface Row {
  path: string;
  testId: string;
  label: string;
  description: string;
  kind: "number" | "text" | "toggle" | "select";
  rules?: Rule[];
  placeholder?: string;
  disabled?: () => boolean;
  hidden?: () => boolean;
}

interface Section {
  title: string;
  rows: Row[];
  notes?: () => { testId: string; text: string }[];
}

const DAY_MS = 86_400_000;

/** The server's default policy, shown until the real one loads. */
const INITIAL_POLICY: PasswordPolicy = {
  ...DEFAULT_COMPLEXITY,
  rotation_days: 0,
  rotation_warning_days: 7,
  history_count: 0,
  history_max_retained: 30,
  lockout: {
    threshold: 0,
    bucket_size: 0,
    start_secs: 60,
    max_secs: 3600,
    backoff: "exponential",
  },
  cookie_max_age_secs: 0,
  apply_to_root: false,
};

const clone = (policy: PasswordPolicy): PasswordPolicy => ({
  ...policy,
  lockout: { ...policy.lockout },
});

const { t, locale } = useI18n();
const q = useQuasar();
const store = useStore();

// The WHOLE policy as the server returned it: the PUT is a full replacement.
const loadedPolicy = ref<PasswordPolicy | null>(null);
const form = ref<PasswordPolicy>(clone(INITIAL_POLICY));
const formRef = ref();
const loading = ref(true);
const saving = ref(false);
const forbidden = ref(false);
const loadError = ref(false);
const rootDialogOpen = ref(false);
const rootAcknowledged = ref(false);

const get = (path: string): any =>
  path.split(".").reduce((obj: any, key) => obj?.[key], form.value);

const set = (path: string, value: unknown) => {
  const keys = path.split(".");
  const last = keys.pop() as string;
  const target = keys.reduce((obj: any, key) => obj[key], form.value);
  target[last] = value;
};

const num = (value: unknown) => Number(value);

/** Number inputs hand back strings; the server wants integers, and `special_char_set` only while it applies. */
const buildPolicyPayload = (
  loaded: PasswordPolicy,
  values: PasswordPolicy,
): PasswordPolicy => ({
  ...loaded,
  ...values,
  min_length: num(values.min_length),
  max_length: num(values.max_length),
  // A stale set would resurrect the next time someone flips the switch back on.
  special_char_set: values.require_special
    ? values.special_char_set.trim()
    : "",
  rotation_days: num(values.rotation_days),
  rotation_warning_days: num(values.rotation_warning_days),
  history_count: num(values.history_count),
  history_max_retained: num(values.history_max_retained),
  lockout: {
    threshold: num(values.lockout.threshold),
    bucket_size: num(values.lockout.bucket_size),
    start_secs: num(values.lockout.start_secs),
    max_secs: num(values.lockout.max_secs),
    backoff: values.lockout.backoff,
  },
  cookie_max_age_secs: num(values.cookie_max_age_secs),
});

/** The lockout durations an account would serve, level by level, capped so a far ceiling still renders as one line. */
const lockoutLadder = (lockout: LockoutPolicy, maxLevels = 6): number[] => {
  const start = num(lockout.start_secs);
  const max = num(lockout.max_secs);
  const ladder: number[] = [];
  for (let level = 1; level <= maxLevels; level++) {
    const secs = Math.min(
      lockout.backoff === "linear" ? start * level : start * 2 ** (level - 1),
      max,
    );
    ladder.push(secs);
    if (secs >= max) break;
  }
  return ladder;
};

const rotationOn = () => num(form.value.rotation_days) > 0;
const lockoutOn = () => num(form.value.lockout.threshold) > 0;

// Only the server's four cross-field rules are mirrored; no floor is enforced because the API accepts a weak policy.
const sections = computed<Section[]>(() => [
  {
    title: t("passwordPolicy.complexity"),
    rows: [
      {
        path: "min_length",
        testId: "min-length",
        label: t("passwordPolicy.minLength"),
        description: t("passwordPolicy.minLengthDesc"),
        kind: "number",
      },
      {
        path: "max_length",
        testId: "max-length",
        label: t("passwordPolicy.maxLength"),
        description: t("passwordPolicy.maxLengthDesc"),
        kind: "number",
        rules: [
          // 0 is "unbounded", anything else must leave room for the minimum.
          (v) =>
            num(v) === 0 ||
            num(v) >= num(form.value.min_length) ||
            t("passwordPolicy.maxLengthTooSmall"),
        ],
      },
      ...(["uppercase", "lowercase", "digit", "special"] as const).map(
        (kind): Row => ({
          path: `require_${kind}`,
          testId: `require-${kind}`,
          label: t(
            `passwordPolicy.require${kind[0].toUpperCase()}${kind.slice(1)}`,
          ),
          description: t(
            `passwordPolicy.require${kind[0].toUpperCase()}${kind.slice(1)}Desc`,
          ),
          kind: "toggle",
        }),
      ),
      {
        path: "special_char_set",
        testId: "special-char-set",
        label: t("passwordPolicy.specialCharSet"),
        description: t("passwordPolicy.specialCharSetDesc"),
        kind: "text",
        placeholder: "!@#$%^&*()",
        hidden: () => !form.value.require_special,
      },
    ],
  },
  {
    title: t("passwordPolicy.rotation"),
    rows: [
      {
        path: "rotation_days",
        testId: "rotation-days",
        label: t("passwordPolicy.rotationDays"),
        description: t("passwordPolicy.rotationDaysDesc"),
        kind: "number",
      },
      {
        path: "rotation_warning_days",
        testId: "rotation-warning-days",
        label: t("passwordPolicy.rotationWarningDays"),
        description: t("passwordPolicy.rotationWarningDaysDesc"),
        kind: "number",
        disabled: () => !rotationOn(),
        rules: [
          // Equal is valid (warn from the first sign-in); only a LONGER window describes a deadline that never exists.
          (v) =>
            !rotationOn() ||
            num(v) <= num(form.value.rotation_days) ||
            t("passwordPolicy.warningDaysTooLong"),
        ],
      },
    ],
    notes: () =>
      rotationOn()
        ? [{ testId: "rotation-preview", text: rotationPreview.value }]
        : [],
  },
  {
    title: t("passwordPolicy.reuse"),
    rows: [
      {
        path: "history_count",
        testId: "history-count",
        label: t("passwordPolicy.historyCount"),
        description: t("passwordPolicy.historyCountDesc"),
        kind: "number",
      },
      {
        path: "history_max_retained",
        testId: "history-max-retained",
        label: t("passwordPolicy.historyMaxRetained"),
        description: t("passwordPolicy.historyMaxRetainedDesc"),
        kind: "number",
        rules: [
          (v) =>
            num(v) >= num(form.value.history_count) ||
            t("passwordPolicy.historyRetainedTooSmall"),
        ],
      },
    ],
    notes: () => [
      { testId: "reuse-explainer", text: t("passwordPolicy.reuseExplainer") },
    ],
  },
  {
    title: t("passwordPolicy.lockout"),
    rows: [
      {
        path: "lockout.threshold",
        testId: "lockout-threshold",
        label: t("passwordPolicy.lockoutThreshold"),
        description: t("passwordPolicy.lockoutThresholdDesc"),
        kind: "number",
      },
      {
        path: "lockout.start_secs",
        testId: "lockout-start-secs",
        label: t("passwordPolicy.lockoutStartSecs"),
        description: t("passwordPolicy.lockoutStartSecsDesc"),
        kind: "number",
        disabled: () => !lockoutOn(),
        rules: [
          // Threshold 0 switches lockout off, so the durations are inert; the rule fires again once it is re-enabled.
          (v) =>
            !lockoutOn() ||
            num(v) <= num(form.value.lockout.max_secs) ||
            t("passwordPolicy.lockoutStartTooLong"),
        ],
      },
      {
        path: "lockout.max_secs",
        testId: "lockout-max-secs",
        label: t("passwordPolicy.lockoutMaxSecs"),
        description: t("passwordPolicy.lockoutMaxSecsDesc"),
        kind: "number",
        disabled: () => !lockoutOn(),
      },
      {
        path: "lockout.bucket_size",
        testId: "lockout-bucket-size",
        label: t("passwordPolicy.lockoutBucketSize"),
        description: t("passwordPolicy.lockoutBucketSizeDesc"),
        kind: "number",
        disabled: () => !lockoutOn(),
      },
      {
        path: "lockout.backoff",
        testId: "lockout-backoff",
        label: t("passwordPolicy.lockoutBackoff"),
        description: t("passwordPolicy.lockoutBackoffDesc"),
        kind: "select",
        disabled: () => !lockoutOn(),
      },
    ],
    notes: () =>
      lockoutOn()
        ? [{ testId: "lockout-preview", text: lockoutPreview.value }]
        : [],
  },
  {
    title: t("passwordPolicy.sessionEnforcement"),
    rows: [
      {
        path: "cookie_max_age_secs",
        testId: "cookie-max-age",
        label: t("passwordPolicy.cookieMaxAge"),
        description: t("passwordPolicy.cookieMaxAgeDesc", {
          envVar: "ZO_COOKIE_MAX_AGE",
        }),
        kind: "number",
      },
      {
        path: "apply_to_root",
        testId: "apply-to-root",
        label: t("passwordPolicy.applyToRoot"),
        description: t("passwordPolicy.applyToRootDesc"),
        kind: "toggle",
      },
    ],
  },
]);

const backoffOptions = computed(() => [
  { label: t("passwordPolicy.backoffExponential"), value: "exponential" },
  { label: t("passwordPolicy.backoffLinear"), value: "linear" },
]);

// Two integers do not communicate a date; the two dates an operator reasons about do.
const rotationPreview = computed(() => {
  const days = num(form.value.rotation_days);
  const warn = num(form.value.rotation_warning_days);
  const expires = date.formatDate(Date.now() + days * DAY_MS, "MMM D, YYYY");
  if (warn <= 0)
    return t("passwordPolicy.rotationPreviewNoWarning", { expires });
  const warns = date.formatDate(
    Date.now() + (days - warn) * DAY_MS,
    "MMM D, YYYY",
  );
  return t("passwordPolicy.rotationPreview", { expires, warns });
});

const lockoutPreview = computed(() => {
  const lockout = form.value.lockout;
  const [first, ...rest] = lockoutLadder(lockout).map((secs) =>
    durationFormatter(secs),
  );
  return t("passwordPolicy.lockoutPreview", {
    threshold: num(lockout.threshold),
    // 0 reuses the first threshold for every later lockout.
    bucket: num(lockout.bucket_size) || num(lockout.threshold),
    first,
    rest: new Intl.ListFormat(locale.value, { type: "unit" }).format(rest),
    max: durationFormatter(num(lockout.max_secs)),
  });
});

const isDirty = computed(
  () =>
    !!loadedPolicy.value &&
    JSON.stringify(buildPolicyPayload(loadedPolicy.value, form.value)) !==
      JSON.stringify(loadedPolicy.value),
);

const metaOrg = computed(() => store.state.zoConfig?.meta_org);

const loadPolicy = async () => {
  loading.value = true;
  forbidden.value = false;
  loadError.value = false;

  try {
    const response = await passwordPolicy.getPolicy(metaOrg.value);
    loadedPolicy.value = response.data;
    form.value = clone(response.data);
  } catch (error: any) {
    if (error?.response?.status === 403) forbidden.value = true;
    else loadError.value = true;
  } finally {
    loading.value = false;
  }
};

const resetForm = () => {
  if (loadedPolicy.value) form.value = clone(loadedPolicy.value);
};

const onToggle = (path: string, on: boolean) => {
  set(path, on);
  if (path !== "apply_to_root" || !on) return;
  rootAcknowledged.value = false;
  rootDialogOpen.value = true;
};

// The switch must not stay on behind a dialog the operator dismissed.
const cancelApplyToRoot = () => {
  rootDialogOpen.value = false;
  form.value.apply_to_root = false;
};

// Every save confirms, not only a tightening: the sweep a save triggers cannot be undone.
const save = () => {
  if (!loadedPolicy.value) return;
  q.dialog({
    title: t("passwordPolicy.confirmTitle"),
    message: t("passwordPolicy.confirmMessage"),
    cancel: { flat: true, noCaps: true, label: t("common.cancel") },
    ok: { color: "primary", noCaps: true, label: t("settings.saveChanges") },
    persistent: true,
  }).onOk(persist);
};

const persist = async () => {
  if (!loadedPolicy.value) return;
  saving.value = true;
  try {
    const response = await passwordPolicy.updatePolicy(
      metaOrg.value,
      buildPolicyPayload(loadedPolicy.value, form.value),
    );
    loadedPolicy.value = response.data.policy;
    form.value = clone(response.data.policy);

    const flagged = response.data.users_flagged ?? 0;
    q.notify({
      type: "positive",
      message: t("passwordPolicy.saved", { count: flagged }, flagged),
    });
  } catch (error: any) {
    q.notify({
      type: "negative",
      message: error?.response?.data?.message || t("passwordPolicy.saveFailed"),
    });
  } finally {
    saving.value = false;
  }
};

onMounted(loadPolicy);
</script>

<style scoped lang="scss">
.password-policy-title {
  font-size: 20px;
  font-weight: 700;
  line-height: 24px;
}

.password-policy-row {
  display: grid;
  grid-template-columns: 1fr 1fr 2fr;
  gap: 1rem;
  align-items: center;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--o2-border-color);
}

.password-policy-label {
  font-size: 14px;
  font-weight: 500;
}

.password-policy-description {
  font-size: 13px;
  opacity: 0.7;
}
</style>
