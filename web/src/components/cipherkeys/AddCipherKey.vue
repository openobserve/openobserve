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
  <OPageLayout
    class="min-h-[inherit]"
    :back="{
      label: t('cipherKey.header'),
      onClick: closeEditor,
    }"
    bleed
  >
    <template #title>
      <span data-test="add-template-title">
        {{ isUpdatingCipherKey ? t("cipherKey.update") : t("cipherKey.add") }}
      </span>
    </template>
    <div class="create-cipher-form">
      <!-- One OForm owns every field across the stepper (the children render
           OForm* controls connected by name); a single Zod schema gates the
           whole form. Inline form → the footer Save is type="submit" (Enter
           works natively) and its spinner is form-driven via v-slot. -->
      <OForm :form="form" v-slot="{ isSubmitting }">
        <!-- eslint-disable-next-line local/no-hardcoded-px -- mixed with vh/vw — vh tracks the window while rem tracks font-size; keep the expression unit-consistent -->
        <div class="overflow-auto" style="height: calc(100vh - var(--navbar-height) - 155px)">
          <!-- Constrain the whole form to a sensible reading width on wide screens
               while staying fluid below the breakpoint. -->
          <div class="w-full max-w-3xl">
            <div class="flex">
              <div class="o2-input mx-3 mt-3 mb-4 flex w-1/3">
                <OFormInput
                  data-test="add-cipher-key-name-input"
                  name="name"
                  :label="t('cipherKey.name')"
                  required
                  class="w-full"
                  :readonly="isUpdatingCipherKey"
                  :disabled="isUpdatingCipherKey"
                  tabindex="0"
                />
              </div>
            </div>

            <!-- eslint-disable-next-line local/no-hardcoded-px -- mixed with vh/vw — vh tracks the window while rem tracks font-size; keep the expression unit-consistent -->
            <div style="height: calc(100vh - var(--navbar-height) - 300px)">
              <OStepper
                v-model="step"
                orientation="vertical"
                animated
                navigable
                class="mx-3 h-full p-0"
              >
                <OStep
                  data-test="cipher-key-key-store-detils-step"
                  :name="1"
                  :title="step1Title"
                  icon="edit"
                  :done="step > 1"
                >
                  <div>
                    <div class="w-full">
                      <OFormSelect
                        data-test="add-cipher-key-type-input"
                        name="key.store.type"
                        :label="t('cipherKey.type')"
                        required
                        class="w-full"
                        :options="cipherKeyTypes"
                        labelKey="label"
                        valueKey="value"
                        tabindex="0"
                      />
                    </div>
                    <AddOpenobserveType
                      v-if="storeType === 'local'"
                      class="mt-2"
                      :is-update="isUpdatingCipherKey"
                    />
                    <AddAkeylessType
                      v-else-if="storeType === 'akeyless'"
                      class="mt-2"
                      :is-update="isUpdatingCipherKey"
                    />
                    <div class="mt-4 flex gap-2">
                      <OButton
                        data-test="add-report-step1-continue-btn"
                        variant="primary"
                        size="sm-action"
                        :disabled="isSubmitting"
                        @click="continueToStep2"
                      >
                        {{ t("cipherKey.continue") }}
                      </OButton>
                    </div>
                  </div>
                </OStep>

                <OStep
                  data-test="cipher-key-encryption-mechanism-step"
                  :name="2"
                  :title="t('cipherKey.step2')"
                  icon="add"
                  :done="step > 2"
                >
                  <AddEncryptionMechanism />
                  <div class="mt-4 flex gap-2">
                    <OButton
                      data-test="add-cipher-key-step2-back-btn"
                      variant="outline"
                      size="sm-action"
                      :disabled="isSubmitting"
                      @click="step = 1"
                    >
                      {{ t("common.back") }}
                    </OButton>
                  </div>
                </OStep>
              </OStepper>
            </div>
          </div>
        </div>
        <div class="mx-2">
          <div
            class="border-border-default sticky bottom-0 z-2 flex w-full justify-end gap-2 border-t px-2 py-4"
          >
            <OButton
              data-test="add-cipher-key-cancel-btn"
              variant="outline"
              size="sm-action"
              :disabled="isSubmitting"
              @click="closeEditor"
            >
              {{ t("common.cancel") }}
            </OButton>
            <OButton
              data-test="add-cipher-key-save-btn"
              variant="primary"
              size="sm-action"
              type="submit"
              :loading="isSubmitting"
            >
              {{ t("common.save") }}
            </OButton>
          </div>
        </div>
      </OForm>
    </div>
    <EditorDraftDialogs :draft="cipherKeyDraft" />
  </OPageLayout>
</template>
<script lang="ts" setup>
import { ref, computed, nextTick, onMounted, onActivated } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import AddOpenobserveType from "@/components/cipherkeys/AddOpenobserveType.vue";
import AddAkeylessType from "@/components/cipherkeys/AddAkeylessType.vue";
import AddEncryptionMechanism from "@/components/cipherkeys/AddEncryptionMechanism.vue";
import EditorDraftDialogs from "@/components/common/drafts/EditorDraftDialogs.vue";
import { useEditorDraft } from "@/composables/useEditorDraft";
import CipherKeysService from "@/services/cipher_keys";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm, type FormFieldPath } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import {
  makeAddCipherKeySchema,
  addCipherKeyDefaults,
  type AddCipherKeyForm,
} from "@/components/cipherkeys/AddCipherKey.schema";

const emit = defineEmits(["cancel:hideform"]);
const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();

const isUpdatingCipherKey = ref(false);
const step = ref(1);
// Continue advances the stepper by running a real form submit; this flag tells
// the @submit handler to advance instead of save (footer Save / Enter saves).
const pendingContinue = ref(false);
// JSON snapshot of the form values at load, for the cancel "discard changes"
// prompt and the edit "no changes detected" short-circuit (isUpdate diffing).
const originalData = ref("");

const cipherKeyTypes = [
  { label: raw("OpenObserve"), value: "local" },
  { label: raw("Akeyless"), value: "akeyless" },
];

const getTypeLabel = (type: string) => cipherKeyTypes.find((item) => item.value === type)?.label;

// The parent OWNS the form (headless useOForm): it renders <OForm>, so it sits
// above the provide boundary and can't inject — yet it needs store.type
// reactively to drive the OStepper's conditional child + the step-1 title.
// useOForm + form.useStore gives that directly; the children inject this SAME
// form via <OForm :form="form">. The save is wired here through useOForm (not
// @submit on the tag) — wrapped lazily so onFormSubmit (declared below)
// resolves at submit time, not at setup.
// Build the schema with useI18n's `t` so validation messages render in the
// active locale.
const addCipherKeySchema = makeAddCipherKeySchema(t);

const form = useOForm<AddCipherKeyForm>({
  defaultValues: addCipherKeyDefaults(),
  schema: addCipherKeySchema,
  onSubmit: (value) => onFormSubmit(value),
});

const storeType = form.useStore((s: any) => s?.values?.key?.store?.type ?? "local");

// Whole sentence in the message: "(Type: …)" was an untranslated English
// fragment appended to a translated title.
const step1Title = computed(() =>
  t("cipherKey.step1WithType", { type: getTypeLabel(storeType.value) }),
);

// Deep-merge the loaded record onto the default shape so any field the backend
// omits keeps its schema default (used for edit prefill).
function mergeObjects(base: any, updates: any) {
  for (const key in updates) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (updates[key] !== null && typeof updates[key] === "object" && !Array.isArray(updates[key])) {
      base[key] = mergeObjects(base[key] || {}, updates[key]);
    } else {
      base[key] = updates[key];
    }
  }
  return base;
}

interface LoadFailure {
  status?: number;
  response?: { status?: number; data?: { message?: string } };
}

// The loaded key in edit mode, or null once a load found it gone.
const serverRecord = ref<AddCipherKeyForm | null>(null);

const loadCipherKey = async (): Promise<boolean> => {
  if (router.currentRoute.value.query.action !== "edit") return true;
  isUpdatingCipherKey.value = true;
  const name = String(router.currentRoute.value.query.name || "");
  if (name === "") {
    toast({ variant: "error", message: t("toastMessages.cipherkeys.invalidCipherKeyName") });
    emit("cancel:hideform");
    return false;
  }
  try {
    const response = await CipherKeysService.get_by_name(
      store.state.selectedOrganization.identifier,
      name,
    );
    // :default-values is read once at mount; re-seed via reset now the record has arrived.
    const record = mergeObjects(addCipherKeyDefaults(), response.data) as AddCipherKeyForm;
    form.reset(record);
    originalData.value = JSON.stringify(form.state.values ?? record);
    serverRecord.value = JSON.parse(originalData.value) as AddCipherKeyForm;
    return true;
  } catch (error: unknown) {
    const failure = (error ?? {}) as LoadFailure;
    const status = failure.response?.status ?? failure.status;
    if (status !== 403) {
      toast({
        variant: "error",
        message: raw(failure.response?.data?.message) || t("cipherKeys.fetchCipherKeyError"),
      });
    }
    // A key that is gone still opens, so its stale draft is dropped; any other failure keeps it.
    return status === 404;
  }
};

const setupTemplateData = () => {
  void loadCipherKey();
};

onActivated(() => setupTemplateData());

const formValues = form.useStore((s: { values: AddCipherKeyForm }) => s.values);
// Set while the leave dialog's Save runs, so a successful save does not close the editor itself.
let leaveSave: { saved: boolean } | null = null;

const AKEYLESS = "/key/store/akeyless";
// Key material and the credentials that unlock it never reach browser storage.
const SECRET_FIELDS: Record<string, I18nKey> = {
  "/key/store/local": "cipherKey.secret",
  [`${AKEYLESS}/access_id`]: "cipherKey.accessId",
  [`${AKEYLESS}/auth/access_key`]: "cipherKey.accessKey",
  [`${AKEYLESS}/auth/ldap/username`]: "cipherKey.ldapUsername",
  [`${AKEYLESS}/auth/ldap/password`]: "cipherKey.ldapPassword",
  [`${AKEYLESS}/store/static_secret`]: "cipherKey.staticSecretNameNotKept",
  [`${AKEYLESS}/store/dfc/iv`]: "cipherKey.dfcIV",
  [`${AKEYLESS}/store/dfc/encrypted_data`]: "cipherKey.dfcEncryptedData",
};

const redactCipherKeyDraft = (data: AddCipherKeyForm) => {
  const copy = JSON.parse(JSON.stringify(data)) as AddCipherKeyForm;
  const paths: string[] = [];
  for (const path of Object.keys(SECRET_FIELDS)) {
    const segments = path.slice(1).split("/");
    const field = segments.pop() as string;
    const holder = segments.reduce<Record<string, unknown> | undefined>(
      (node, segment) => node?.[segment] as Record<string, unknown> | undefined,
      copy as unknown as Record<string, unknown>,
    );
    if (!holder || typeof holder[field] !== "string" || holder[field] === "") continue;
    holder[field] = "";
    paths.push(path);
  }
  return { data: copy, paths };
};

// The product name is never translated, so it is passed into the label.
const STATIC_SECRET_PATH = `${AKEYLESS}/store/static_secret`;

const secretFieldLabel = (path: string): I18nText | null => {
  if (path === STATIC_SECRET_PATH) {
    return t("cipherKey.staticSecretNameNotKept", { product: raw("Akeyless") });
  }
  return SECRET_FIELDS[path] ? t(SECRET_FIELDS[path]) : null;
};

const describeRedactedCipherKey = (paths: string[]): I18nText[] => [
  ...new Set(paths.flatMap((path) => secretFieldLabel(path) ?? [])),
];

const flagReentries = (paths: string[]) => {
  for (const path of paths) {
    const name = path.slice(1).split("/").join(".") as FormFieldPath<AddCipherKeyForm>;
    const meta = form.getFieldMeta(name);
    if (!meta) continue;
    form.setFieldMeta(name, {
      ...meta,
      errorMap: { ...meta.errorMap, onSubmit: t("common.editorDraft.reenterField") },
    });
  }
};

/** A changed secret the draft could not keep must be typed again before saving. */
const blockOnPendingReentries = (): boolean => {
  const pending = cipherKeyDraft.pendingReentries();
  if (!pending.length) return false;
  flagReentries(pending);
  toast({ variant: "error", message: t("common.editorDraft.reenterBeforeSave") });
  return true;
};

const cipherKeyDraft = useEditorDraft<AddCipherKeyForm>({
  kind: "cipher_key",
  entityLabel: () => t("common.editorDraft.entities.cipher_key"),
  entityId: () =>
    isUpdatingCipherKey.value ? String(router.currentRoute.value.query.name ?? "") : null,
  snapshot: () => JSON.parse(JSON.stringify(formValues.value)) as AddCipherKeyForm,
  apply: async (data, { notKeptPaths }) => {
    // A saved key's name is locked, so the draft can never rename it.
    form.reset({ ...data, name: isUpdatingCipherKey.value ? form.state.values.name : data.name });
    // After the form's own error sweep, which runs on the reset values.
    await nextTick();
    flagReentries(notKeptPaths);
  },
  base: () => (isUpdatingCipherKey.value ? serverRecord.value : null),
  redactBase: (base) => redactCipherKeyDraft(base as AddCipherKeyForm).data,
  hasChanges: () => JSON.stringify(form.state.values ?? {}) !== originalData.value,
  save: async () => {
    const run = { saved: false };
    leaveSave = run;
    try {
      await form.handleSubmit();
    } finally {
      leaveSave = null;
    }
    return run.saved;
  },
  redact: redactCipherKeyDraft,
  describeRedacted: describeRedactedCipherKey,
  leaveOnRouteUpdate: (to, from) =>
    to.path !== from.path ||
    to.query.action !== from.query.action ||
    to.query.name !== from.query.name,
});

onMounted(async () => {
  // Baseline for the cancel diff; edit mode re-snapshots after the record loads.
  originalData.value = JSON.stringify(form.state.values ?? addCipherKeyDefaults());
  if (await loadCipherKey()) await cipherKeyDraft.start();
});

/** Ends a successful save: the leave dialog's Save stays on the page, any other save closes it. */
const finishSave = () => {
  if (leaveSave) {
    leaveSave.saved = true;
    return;
  }
  cipherKeyDraft.markSaved();
  emit("cancel:hideform");
};

// Continue: validate the whole form by submitting through it (reveals any step-1
// errors on the mounted fields); advance only when valid. pendingContinue makes
// the @submit handler advance instead of save.
const continueToStep2 = async () => {
  pendingContinue.value = true;
  try {
    await form.handleSubmit();
  } finally {
    pendingContinue.value = false;
  }
};

// @submit fires only when the whole schema passes. For a Continue submit we just
// advance the stepper; for a footer Save / Enter submit we create or update.
const onFormSubmit = async (value: AddCipherKeyForm) => {
  if (pendingContinue.value) {
    step.value = 2;
    return;
  }
  if (blockOnPendingReentries()) return;
  if (isUpdatingCipherKey.value) {
    await updateCipherKey(value);
  } else {
    await createCipherKey(value);
  }
};

const createCipherKey = async (value: AddCipherKeyForm) => {
  const dismiss = toast({
    variant: "loading",
    message: t("toastMessages.cipherkeys.pleaseWaitWhileProcessingYourRequest"),
    timeout: 0,
  });
  try {
    // The service's CipherKeyData type declares a `provider` field the payload
    // doesn't include; cast to keep the real shape without editing the shared
    // service type.
    // `isUpdate` is a UI flag, not a form field — merged in here outside the
    // schema. The backend ignores it (KeyAddRequest deserializes only `name` +
    // `key`, no deny_unknown_fields).
    await CipherKeysService.create(store.state.selectedOrganization.identifier, {
      ...value,
      isUpdate: isUpdatingCipherKey.value,
    } as any);
    dismiss();
    toast({
      variant: "success",
      message: t("toastMessages.cipherkeys.cipherKeyCreatedSuccessfully"),
    });
    finishSave();
  } catch (error: any) {
    dismiss();
    if (error.status != 403) {
      toast({ variant: "error", message: error.response?.data?.message });
    }
  }
};

const updateCipherKey = async (value: AddCipherKeyForm) => {
  const current = JSON.stringify(form.state.values ?? value);
  if (current === originalData.value) {
    toast({ variant: "success", message: t("toastMessages.cipherkeys.noChangesDetected") });
    finishSave();
    return;
  }
  const dismiss = toast({
    variant: "loading",
    message: t("toastMessages.cipherkeys.pleaseWaitWhileProcessingYourRequest"),
    timeout: 0,
  });
  try {
    // Merge the `isUpdate` UI flag into the body (backend ignores it — see
    // createCipherKey).
    await CipherKeysService.update(
      store.state.selectedOrganization.identifier,
      { ...value, isUpdate: isUpdatingCipherKey.value } as any,
      value.name,
    );
    dismiss();
    toast({
      variant: "success",
      message: t("toastMessages.cipherkeys.cipherKeyUpdatedSuccessfully"),
    });
    finishSave();
  } catch (error: any) {
    dismiss();
    if (error.status != 403) {
      toast({ variant: "error", message: error.response?.data?.message });
    }
  }
};

const closeEditor = async () => {
  if (await cipherKeyDraft.confirmLeave()) emit("cancel:hideform");
};

defineExpose({
  form,
  step,
  isUpdatingCipherKey,
  storeType,
  cipherKeyTypes,
  getTypeLabel,
  continueToStep2,
  closeEditor,
});
</script>
