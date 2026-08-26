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

<!--
  Full-page status-page editor. Replaces the old edit drawer: a status page
  carries too much configuration (branding, visibility, display, confirmation,
  and a repeatable component list) to sit comfortably in a slide-over, and the
  configurer wants to see the result. Mirrors the app's heavy-editor house
  pattern (alerts, dashboard panels): OForm → OPageLayout, config on the left,
  a live preview of the public page on the right.
-->
<template>
  <OForm :id="FORM_ID" :form="form" v-slot="{ isSubmitting }" class="h-full w-full">
    <OPageLayout
      bleed
      :title="t('statusPages.editTitle')"
      :subtitle="pageName ? raw(pageName) : undefined"
      :back="{ label: t('statusPages.back'), onClick: goBack, dataTest: 'status-page-editor-back' }"
      title-overflow="truncate"
    >
      <template #actions>
        <OButton
          variant="outline-destructive"
          size="sm-action"
          data-test="status-page-editor-cancel"
          @click="goBack"
          >{{ t("common.cancel") }}</OButton
        >
        <OButton
          variant="primary"
          size="sm-action"
          type="submit"
          :form="FORM_ID"
          :loading="isSubmitting"
          data-test="status-page-editor-save"
          >{{ t("common.save") }}</OButton
        >
      </template>

      <!-- Loading / not-found guards -->
      <div v-if="loading" class="flex h-full items-center justify-center">
        <OSpinner />
      </div>
      <div
        v-else-if="!page"
        class="text-text-secondary flex h-full items-center justify-center text-sm"
      >
        {{ t("statusPages.loadFailed") }}
      </div>

      <!-- Two-pane split: config (left) | live preview (right) -->
      <OSplitter
        v-else
        v-model="splitPct"
        :limits="[40, 70]"
        separator-class="field-list-separator"
        class="h-full"
      >
        <template #before>
          <div class="flex h-full min-h-0 flex-col overflow-y-auto px-6 py-5">
            <!-- Public URL -->
            <div class="rounded-surface bg-surface-subtle mb-6 flex flex-col gap-2 p-3">
              <span class="text-text-label text-xs font-medium">{{
                t("statusPages.publicUrl")
              }}</span>
              <div class="flex items-center gap-2">
                <span class="text-text-body min-w-0 flex-1 truncate font-mono text-xs">{{
                  publicUrl
                }}</span>
                <OButton
                  variant="outline"
                  size="sm"
                  icon-left="content-copy"
                  data-test="status-page-editor-copy-url"
                  @click="copyUrl"
                  >{{ t("statusPages.copyUrl") }}</OButton
                >
                <OButton
                  variant="outline"
                  size="sm"
                  icon-left="refresh"
                  :loading="rotating"
                  data-test="status-page-editor-rotate-slug"
                  @click="rotateSlug"
                  >{{ t("statusPages.rotateSlug") }}</OButton
                >
              </div>
            </div>

            <div class="flex flex-col gap-4">
              <!-- Details -->
              <OFormSection :title="t('statusPages.sections.details')">
                <div class="flex flex-col gap-5">
                  <OFormInput name="name" :label="t('statusPages.fields.name')" required />
                  <OFormInput
                    name="description"
                    type="textarea"
                    :rows="3"
                    :label="t('statusPages.fields.description')"
                  />
                  <OFormInput name="brand_name" :label="t('statusPages.fields.brandName')" />

                  <!-- Logo — mirrors the field-level lock pattern used for
                       Notices/Custom Domains dropdown items in StatusPagesList,
                       adapted to an input: a disabled control plus a lock icon
                       and tooltip rather than a disabled menu item. -->
                  <div class="flex flex-col gap-1.5">
                    <div class="flex items-center gap-1.5">
                      <span class="text-text-label text-sm font-medium">{{
                        t("statusPages.fields.logo")
                      }}</span>
                      <template v-if="!logoUploadEnabled">
                        <OIcon
                          name="lock"
                          size="xs"
                          aria-hidden="true"
                          data-test="status-page-logo-lock"
                        />
                        <OTooltip side="right" :content="t('statusPages.fields.logoLocked')" />
                      </template>
                    </div>

                    <p
                      v-if="orgLogoOverrideEnabled && usingOrgLogoDefault"
                      class="text-text-secondary text-xs"
                    >
                      {{ t("statusPages.fields.logoUsingOrgDefault") }}
                    </p>

                    <div v-if="logoPreview" class="flex items-center gap-2">
                      <img
                        :src="logoPreview"
                        :alt="t('statusPages.fields.logo')"
                        data-test="status-page-logo-preview"
                        class="max-h-9 max-w-37.5 object-contain"
                      />
                      <OButton
                        v-if="logoUploadEnabled"
                        type="button"
                        variant="ghost-destructive"
                        size="icon-xs-sq"
                        icon-left="close"
                        data-test="status-page-logo-clear"
                        @click="clearLogo"
                      >
                        <OTooltip
                          side="bottom"
                          :content="
                            usingOrgLogoDefault
                              ? t('statusPages.fields.logoRevertToOrg')
                              : t('statusPages.fields.logoRemove')
                          "
                        />
                      </OButton>
                    </div>
                    <OFile
                      v-else
                      :disabled="!logoUploadEnabled"
                      :model-value="null"
                      :placeholder="t('statusPages.fields.logoUpload')"
                      accept=".png, .jpg, .jpeg, .gif, .svg, image/*"
                      data-test="status-page-logo-upload"
                      @update:model-value="onLogoFileSelected"
                    />
                  </div>

                  <OFormColor
                    name="accent_color"
                    :label="t('statusPages.fields.accentColor')"
                    :placeholder="raw('#2563EB')"
                  />
                </div>
              </OFormSection>

              <!-- Visibility -->
              <OFormSection :title="t('statusPages.sections.visibility')">
                <div class="flex flex-col gap-5">
                <OFormToggleGroup name="visibility" :label="t('statusPages.fields.visibility')">
                  <OToggleGroupItem value="draft" size="sm" data-test="status-page-visibility-draft">{{
                    t("statusPages.visibility.draft")
                  }}</OToggleGroupItem>
                  <OToggleGroupItem
                    value="public"
                    size="sm"
                    data-test="status-page-visibility-public"
                    >{{ t("statusPages.visibility.public") }}</OToggleGroupItem
                  >
                  <OToggleGroupItem
                    value="password"
                    size="sm"
                    data-test="status-page-visibility-password"
                    >{{ t("statusPages.visibility.password") }}</OToggleGroupItem
                  >
                </OFormToggleGroup>
                <OFormInput
                  v-if="visibilityMode === 'password'"
                  name="password"
                  type="password"
                  :label="t('statusPages.fields.password')"
                  :placeholder="
                    page.password_set
                      ? t('statusPages.fields.passwordSetPlaceholder')
                      : t('statusPages.fields.passwordPlaceholder')
                  "
                  :help-text="
                    page.password_set
                      ? t('statusPages.fields.passwordSetHelp')
                      : t('statusPages.fields.passwordHelp')
                  "
                  data-test="status-page-password-input"
                />
                </div>
              </OFormSection>

              <!-- Display toggles -->
              <OFormSection :title="t('statusPages.sections.display')">
                <div class="grid grid-cols-2 items-start gap-x-6 gap-y-5">
                  <OFormSwitch
                    name="show_uptime_percent"
                    :label="t('statusPages.fields.showUptimePercent')"
                  />
                  <OFormSwitch
                    name="show_timeline_bars"
                    :label="t('statusPages.fields.showTimelineBars')"
                  />
                  <OFormSwitch
                    name="show_response_time"
                    :label="t('statusPages.fields.showResponseTime')"
                    :help-text="t('statusPages.fields.showResponseTimeHelp')"
                  />
                  <OFormSwitch
                    name="noindex"
                    :label="t('statusPages.fields.noindex')"
                    :help-text="t('statusPages.fields.noindexHelp')"
                  />
                </div>
              </OFormSection>

              <!-- Confirmation -->
              <OFormSection :title="t('statusPages.sections.confirmation')">
                <!-- Small integers: the input is content-sized, but its help text
                     keeps the full column width so it reads on one or two lines. -->
                <div class="grid grid-cols-2 items-start gap-x-6 gap-y-1">
                  <OFormInput
                    name="confirm_failures"
                    type="number"
                    width="xs"
                    :label="t('statusPages.fields.confirmFailures')"
                  />
                  <OFormInput
                    name="confirm_recovery"
                    type="number"
                    width="xs"
                    :label="t('statusPages.fields.confirmRecovery')"
                  />
                  <p class="text-input-hint text-xs">
                    {{ t("statusPages.fields.confirmFailuresHelp") }}
                  </p>
                  <p class="text-input-hint text-xs">
                    {{ t("statusPages.fields.confirmRecoveryHelp") }}
                  </p>
                </div>
              </OFormSection>

              <!-- Components -->
              <OFormSection :title="t('statusPages.sections.components')">
                <template #actions>
                  <OButton
                    variant="outline"
                    size="sm"
                    icon-left="add"
                    data-test="status-page-add-component"
                    @click="addComponent"
                    >{{ t("statusPages.components.add") }}</OButton
                  >
                </template>

                <div class="flex flex-col gap-3">
                <p v-if="components.length === 0" class="text-text-secondary text-sm">
                  {{ t("statusPages.components.empty") }}
                </p>

                <div
                  v-for="(comp, idx) in components"
                  :key="comp._uid"
                  class="rounded-surface border-border-default flex flex-col gap-3 border p-3"
                  :data-test="`status-page-component-row-${idx}`"
                >
                  <div class="flex items-start gap-2">
                    <div class="min-w-0 flex-1">
                      <OInput
                        v-model="comp.name"
                        :label="t('statusPages.components.name')"
                        :placeholder="t('statusPages.components.namePlaceholder')"
                        :data-test="`status-page-component-name-${idx}`"
                      />
                    </div>
                    <OButton
                      variant="ghost-destructive"
                      size="icon-sm"
                      icon-left="delete"
                      class="mt-6"
                      :data-test="`status-page-component-remove-${idx}`"
                      @click="removeComponent(idx)"
                    >
                      <OTooltip side="bottom" :content="t('statusPages.components.remove')" />
                    </OButton>
                  </div>
                  <OSelect
                    v-model="comp.check_ids"
                    multiple
                    :label="t('statusPages.components.checks')"
                    :options="checkOptions"
                    :loading="checksLoading"
                    :placeholder="t('statusPages.components.checksPlaceholder')"
                    :data-test="`status-page-component-checks-${idx}`"
                  >
                    <template #empty>{{ t("statusPages.components.noChecks") }}</template>
                  </OSelect>
                </div>
                </div>
              </OFormSection>
            </div>
          </div>
        </template>

        <template #after>
          <div class="bg-surface-subtle h-full min-h-0 overflow-hidden p-5">
            <StatusPagePreview
              :name="previewValues.name"
              :brand-name="previewValues.brand_name"
              :accent-color="previewValues.accent_color"
              :logo-img="previewValues.logo_img"
              :visibility="previewValues.visibility"
              :show-uptime-percent="previewValues.show_uptime_percent"
              :show-timeline-bars="previewValues.show_timeline_bars"
              :public-url="publicUrl"
              :components="components"
            />
          </div>
        </template>
      </OSplitter>
    </OPageLayout>
  </OForm>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormColor from "@/lib/forms/Color/OFormColor.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OFile from "@/lib/forms/File/OFile.vue";
import type { FileValue } from "@/lib/forms/File/OFile.types";
import StatusPagePreview from "./StatusPagePreview.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";
import { getFoldersListByType } from "@/utils/commons";
import statusPagesService, { type StatusPageListItem } from "@/services/status_pages";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import syntheticsService from "@/services/synthetics";
import {
  makeEditStatusPageSchema,
  visibilityToMode,
  modeToVisibility,
  type EditStatusPageForm,
} from "./EditStatusPage.schema";
import { publicStatusPageUrl } from "./statusPageBadges";
import { syntheticsListRoute, syntheticsNavContextFromRoute } from "@/utils/synthetics/routes";

// A component row carries a client-only stable id so the v-for key never keys on
// the array index — index keys made "add a second component" reuse the first
// row's OSelect state and drop the new row.
interface ComponentRow {
  _uid: number;
  id?: string;
  name: string;
  description: string;
  check_ids: string[];
}

const FORM_ID = "status-page-edit-form";

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();

const orgIdentifier = computed<string>(
  () => (store.state as any).selectedOrganization?.identifier ?? "",
);

// Logo upload itself is available on any licensed build (cloud or self-hosted
// enterprise) — unlike Notices/Custom Domains (see StatusPagesList's
// `advancedEnabled`), which stay enterprise-only.
const logoUploadEnabled = computed(() => store.state.zoConfig?.build_type !== "opensource");

// Self-hosted enterprise only, never cloud: the org-wide logo (Settings →
// General) is an on-prem-org concept, so defaulting/overriding a status
// page's logo from it only makes sense off cloud. Cloud gets its own
// independent logo field with no relationship to an org-level logo.
const orgLogoOverrideEnabled = computed(() => store.state.zoConfig?.build_type === "enterprise");

const orgLogoImg = computed<string>(() =>
  orgLogoOverrideEnabled.value ? ((store.state as any).zoConfig?.custom_logo_img ?? "") : "",
);

const loading = ref(true);
const page = ref<StatusPageListItem | null>(null);
const pageName = ref("");
const rotating = ref(false);
const currentSlug = ref("");
const splitPct = ref(58);
// True while the form's logo_img still IS the org default (no page-specific
// override saved yet) — drives the "Using org logo" note and whether Clear
// means "remove" or "revert to org default".
const usingOrgLogoDefault = ref(false);

const publicUrl = computed(() => publicStatusPageUrl(currentSlug.value));
const schema = computed(() => makeEditStatusPageSchema(t));

const emptyDefaults = (): EditStatusPageForm => ({
  name: "",
  description: "",
  brand_name: "",
  accent_color: "",
  logo_img: "",
  visibility: "draft",
  password: "",
  noindex: false,
  show_uptime_percent: true,
  show_timeline_bars: true,
  show_response_time: true,
  confirm_failures: "0",
  confirm_recovery: "0",
  _passwordSet: false,
});

function defaultsFromPage(p: StatusPageListItem): EditStatusPageForm {
  // No page-specific logo saved yet: fall back to the org default (enterprise
  // only) so the admin sees what visitors will actually see, with an explicit
  // override/clear control rather than a silent substitution.
  const hasOwnLogo = !!p.logo_img;
  usingOrgLogoDefault.value = !hasOwnLogo && !!orgLogoImg.value;
  return {
    name: p.name,
    description: p.description ?? "",
    brand_name: p.brand_name ?? "",
    accent_color: p.accent_color ?? "",
    logo_img: hasOwnLogo ? p.logo_img : orgLogoImg.value,
    visibility: visibilityToMode(p.visibility),
    password: "",
    noindex: p.noindex,
    show_uptime_percent: p.show_uptime_percent,
    show_timeline_bars: p.show_timeline_bars,
    show_response_time: p.show_response_time,
    confirm_failures: String(p.confirm_failures ?? 0),
    confirm_recovery: String(p.confirm_recovery ?? 0),
    _passwordSet: p.password_set,
  };
}

const form = useOForm<EditStatusPageForm>({
  defaultValues: emptyDefaults(),
  schema: schema.value,
  onSubmit: saveSettings,
});

const visibilityMode = form.useStore((s: any) => s.values.visibility);

// Live form values that drive the preview pane.
const previewValues = form.useStore((s: any) => ({
  name: s.values.name ?? "",
  brand_name: s.values.brand_name ?? "",
  accent_color: s.values.accent_color ?? "",
  logo_img: s.values.logo_img ?? "",
  visibility: s.values.visibility ?? "draft",
  show_uptime_percent: !!s.values.show_uptime_percent,
  show_timeline_bars: !!s.values.show_timeline_bars,
}));

const logoPreview = computed(() => {
  const v = previewValues.value.logo_img;
  return v ? `data:image;base64,${v}` : "";
});

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      // FileReader.readAsDataURL yields "data:<mime>;base64,<data>" — the page
      // stores/serves the bare base64 payload, matching custom_logo_img.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function onLogoFileSelected(value: FileValue) {
  const file = Array.isArray(value) ? value[0] : value;
  if (!file) return;
  try {
    const base64 = await readFileAsBase64(file);
    usingOrgLogoDefault.value = false;
    form.setFieldValue("logo_img", base64);
  } catch (err) {
    console.error("[status-pages] failed to read logo file", err);
    toast({ variant: "error", message: t("statusPages.fields.logoReadFailed") });
  }
}

// Clears the page-specific override. If an org logo exists, that means
// reverting to it (Clear reads as "use the org default" per the label change
// above); otherwise it empties the field entirely.
function clearLogo() {
  usingOrgLogoDefault.value = !!orgLogoImg.value;
  form.setFieldValue("logo_img", orgLogoImg.value);
}

// ── Components ─────────────────────────────────────────────────────────────
let uidSeq = 0;
const components = ref<ComponentRow[]>([]);
const checkOptions = ref<SelectOption[]>([]);
const checksLoading = ref(false);

async function loadChecks() {
  if (!orgIdentifier.value) return;
  checksLoading.value = true;
  try {
    let folderNames: Record<string, string> = {};
    try {
      const folders = await getFoldersListByType(store, "synthetics");
      folderNames = Object.fromEntries((folders ?? []).map((f: any) => [f.folderId, f.name]));
    } catch {
      // Non-fatal: fall back to ungrouped checks.
    }
    const res = await syntheticsService.listByFolderId(orgIdentifier.value);
    const rows: any[] = (res.data as any).checks ?? (res.data as any).monitors ?? [];
    const byFolder = new Map<string, any[]>();
    for (const r of rows) {
      const fid = r.folder_id ?? "default";
      if (!byFolder.has(fid)) byFolder.set(fid, []);
      byFolder.get(fid)!.push(r);
    }
    const opts: SelectOption[] = [];
    for (const [fid, checks] of byFolder) {
      opts.push({ label: raw(folderNames[fid] ?? fid), header: true });
      for (const c of checks) opts.push({ label: raw(c.name), value: c.id });
    }
    checkOptions.value = opts;
  } catch (err) {
    console.error("[status-pages] failed to load checks", err);
  } finally {
    checksLoading.value = false;
  }
}

function addComponent() {
  components.value.push({ _uid: uidSeq++, name: "", description: "", check_ids: [] });
}

function removeComponent(idx: number) {
  components.value.splice(idx, 1);
}

async function load() {
  const id = String(route.params.id ?? "");
  if (!id || !orgIdentifier.value) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const res = await statusPagesService.get(orgIdentifier.value, id);
    const p = res.data as StatusPageListItem;
    page.value = p;
    pageName.value = p.name;
    currentSlug.value = p.slug;
    form.reset(defaultsFromPage(p));
    components.value = ((res.data as any).components ?? []).map((c: any) => ({
      _uid: uidSeq++,
      id: c.id,
      name: c.name,
      description: c.description ?? "",
      check_ids: c.check_ids ?? [],
    }));
    loadChecks();
  } catch (err) {
    console.error("[status-pages] failed to load page", err);
    page.value = null;
  } finally {
    loading.value = false;
  }
}

async function saveSettings(values: EditStatusPageForm) {
  if (!page.value) return;
  const payload: Record<string, unknown> = {
    name: values.name,
    description: values.description,
    brand_name: values.brand_name,
    accent_color: values.accent_color,
    // Still on the org default: persist nothing page-specific so a later org
    // logo change keeps following through, rather than freezing today's copy.
    logo_img: usingOrgLogoDefault.value ? "" : values.logo_img,
    visibility: modeToVisibility(values.visibility),
    noindex: values.noindex,
    show_uptime_percent: values.show_uptime_percent,
    show_timeline_bars: values.show_timeline_bars,
    show_response_time: values.show_response_time,
    confirm_failures: Number(values.confirm_failures),
    confirm_recovery: Number(values.confirm_recovery),
  };
  if (values.visibility === "password" && values.password) {
    payload.password = values.password;
  }
  const dismiss = toast({ variant: "loading", message: t("statusPages.toast.saving"), timeout: 0 });
  try {
    await statusPagesService.update(orgIdentifier.value, page.value.id, payload);
    await statusPagesService.updateComponents(
      orgIdentifier.value,
      page.value.id,
      components.value
        .filter((c) => c.name.trim())
        .map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          check_ids: c.check_ids,
        })),
    );
    dismiss();
    toast({ variant: "success", message: t("statusPages.toast.saved") });
    goBack();
  } catch (err: any) {
    dismiss();
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("statusPages.toast.saveFailed"),
    });
    console.error("[status-pages] save failed", err);
  }
}

function copyUrl() {
  copyToClipboard(publicUrl.value, t, { successMessage: t("statusPages.toast.urlCopied") });
}

async function rotateSlug() {
  if (!page.value) return;
  rotating.value = true;
  try {
    const res = await statusPagesService.rotateSlug(orgIdentifier.value, page.value.id);
    const slug = (res.data as any).slug;
    if (slug) currentSlug.value = slug;
    toast({ variant: "success", message: t("statusPages.toast.slugRotated") });
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("statusPages.toast.slugRotateFailed"),
    });
    console.error("[status-pages] rotate slug failed", err);
  } finally {
    rotating.value = false;
  }
}

function goBack() {
  const ctx = syntheticsNavContextFromRoute(route);
  if (!ctx.orgIdentifier && orgIdentifier.value) ctx.orgIdentifier = orgIdentifier.value;
  const base = syntheticsListRoute(ctx) as { name: string; query: Record<string, string> };
  router.push({ name: base.name, query: { ...base.query, section: "status-pages" } });
}

watch(orgIdentifier, (org) => {
  if (org && loading.value) load();
});
load();
</script>
