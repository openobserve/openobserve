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

<!-- Mockup B1: post a manual narrative against a page (Journey 3, step 3).
     When an incident is already open, defaults to attaching this update to
     it (per the mockup's "This update attaches to it" context hint) instead
     of silently stacking a second, independent active incident — worst-wins
     status precedence means two concurrent incidents both stay visible and
     resolving one never quietly clears the page, so opening a second one is
     rarely what the operator meant. "Post as new incident" is still one
     click away for the genuine second-incident case. -->
<template>
  <ODialog
    :open="open"
    persistent
    size="sm"
    :title="t('statusPages.postUpdate.title', { name: pageName })"
    :form-id="FORM_ID"
    :primary-button-label="t('statusPages.postUpdate.post')"
    :primary-button-disabled="mode === 'new' && components.length === 0"
    :secondary-button-label="t('common.cancel')"
    data-test="status-page-post-update-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <div v-if="loadingIncident" class="flex justify-center py-8">
      <OSpinner />
    </div>

    <template v-else>
      <div v-if="activeIncident" class="mb-4 flex flex-col gap-2">
        <div class="bg-surface-subtle rounded-default flex flex-col gap-1 p-3 text-sm">
          <span class="text-text-secondary">{{
            t("statusPages.postUpdate.openIncidentHint")
          }}</span>
          <span class="font-medium">{{ raw(activeIncident.title) }}</span>
        </div>
        <OToggleGroup v-model="mode" type="single" :label="t('statusPages.postUpdate.mode')">
          <OToggleGroupItem
            value="attach"
            size="sm"
            data-test="status-page-post-update-mode-attach"
            >{{ t("statusPages.postUpdate.modeAttach") }}</OToggleGroupItem
          >
          <OToggleGroupItem value="new" size="sm" data-test="status-page-post-update-mode-new">{{
            t("statusPages.postUpdate.modeNew")
          }}</OToggleGroupItem>
        </OToggleGroup>
      </div>

      <!-- Attach: a narrative update on the already-open incident, plus an
           optional escalation-only impact bump. -->
      <OForm
        v-if="mode === 'attach' && activeIncident"
        :id="FORM_ID"
        :schema="attachSchema"
        :default-values="attachDefaults"
        class="flex flex-col gap-5"
        @submit="onSubmitAttach"
      >
        <OFormToggleGroup name="escalateTo" :label="t('statusPages.postUpdate.escalate')">
          <OToggleGroupItem
            value="none"
            size="sm"
            data-test="status-page-post-update-escalate-none"
            >{{ t("statusPages.postUpdate.escalateNone") }}</OToggleGroupItem
          >
          <template v-for="opt in escalationOptions" :key="opt">
            <OToggleGroupItem
              :value="opt"
              size="sm"
              :data-test="`status-page-post-update-escalate-${opt}`"
              >{{ t(impactLabelKey(opt)) }}</OToggleGroupItem
            >
          </template>
        </OFormToggleGroup>
        <OFormInput
          name="body"
          type="textarea"
          :rows="4"
          :label="t('statusPages.postUpdate.message')"
          :placeholder="t('statusPages.postUpdate.messagePlaceholder')"
          required
          data-test="status-page-post-update-body-input"
        />
      </OForm>

      <!-- New incident: today's full form. -->
      <OForm
        v-else
        :id="FORM_ID"
        :schema="newSchema"
        :default-values="newDefaults"
        class="flex flex-col gap-5"
        @submit="onSubmitNew"
      >
        <OFormToggleGroup name="impact" :label="t('statusPages.postUpdate.impact')">
          <OToggleGroupItem
            value="degraded"
            size="sm"
            data-test="status-page-post-update-impact-degraded"
            >{{ t("statusPages.postUpdate.impactDegraded") }}</OToggleGroupItem
          >
          <OToggleGroupItem
            value="partial_outage"
            size="sm"
            data-test="status-page-post-update-impact-partial"
            >{{ t("statusPages.postUpdate.impactPartial") }}</OToggleGroupItem
          >
          <OToggleGroupItem
            value="major_outage"
            size="sm"
            data-test="status-page-post-update-impact-major"
            >{{ t("statusPages.postUpdate.impactMajor") }}</OToggleGroupItem
          >
        </OFormToggleGroup>

        <div class="flex flex-col gap-2">
          <span class="text-text-secondary text-sm font-medium">{{
            t("statusPages.postUpdate.affectedComponents")
          }}</span>
          <p v-if="components.length === 0" class="text-input-error-text text-sm">
            {{ t("statusPages.postUpdate.noComponents") }}
          </p>
          <OFormCheckboxGroup v-else name="component_ids" class="flex flex-col gap-2">
            <OCheckbox
              v-for="comp in components"
              :key="comp.id"
              :value="comp.id"
              :label="raw(comp.name)"
              :data-test="`status-page-post-update-component-${comp.id}`"
            />
          </OFormCheckboxGroup>
        </div>

        <OFormInput
          name="title"
          :label="t('statusPages.postUpdate.titleLabel')"
          :placeholder="t('statusPages.postUpdate.titlePlaceholder')"
          required
          data-test="status-page-post-update-title-input"
        />
        <OFormInput
          name="body"
          type="textarea"
          :rows="4"
          :label="t('statusPages.postUpdate.message')"
          :placeholder="t('statusPages.postUpdate.messagePlaceholder')"
          required
          data-test="status-page-post-update-body-input"
        />
      </OForm>
    </template>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { I18nKey } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OFormCheckboxGroup from "@/lib/forms/Checkbox/OFormCheckboxGroup.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import statusPagesService, { type StatusPageNotice } from "@/services/status_pages";
import {
  makePostUpdateSchema,
  postUpdateDefaults,
  impactToWire,
  impactFromWire,
  makeAttachUpdateSchema,
  attachUpdateDefaults,
  type PostUpdateForm,
  type AttachUpdateForm,
  type ImpactMode,
} from "./PostUpdate.schema";

const FORM_ID = "status-page-post-update-form";

const props = defineProps<{
  open: boolean;
  orgIdentifier: string;
  pageId: string;
  pageName: string;
  components: { id: string; name: string }[];
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  posted: [];
}>();

const { t } = useI18nTyped();
const newSchema = computed(() => makePostUpdateSchema(t));
const newDefaults = computed(() => postUpdateDefaults(props.components.map((c) => c.id)));
const attachSchema = computed(() => makeAttachUpdateSchema(t));
const attachDefaults = attachUpdateDefaults();

const loadingIncident = ref(false);
const activeIncident = ref<StatusPageNotice | null>(null);
const mode = ref<"attach" | "new">("attach");

// Escalation offers only impacts strictly worse than the current one — this
// is a one-way widen, matching mark_false_positive/update_notice's backend
// contract (narrowing an incident's impact is what resolving it is for).
const ALL_IMPACTS: ImpactMode[] = ["degraded", "partial_outage", "major_outage"];
const escalationOptions = computed<ImpactMode[]>(() => {
  if (!activeIncident.value) return [];
  const current = impactFromWire(activeIncident.value.impact);
  const currentIdx = ALL_IMPACTS.indexOf(current);
  return ALL_IMPACTS.slice(currentIdx + 1);
});

function impactLabelKey(mode: ImpactMode): I18nKey {
  const KEYS: Record<ImpactMode, I18nKey> = {
    degraded: "statusPages.postUpdate.impactDegraded",
    partial_outage: "statusPages.postUpdate.impactPartial",
    major_outage: "statusPages.postUpdate.impactMajor",
  };
  return KEYS[mode];
}

async function loadActiveIncident() {
  loadingIncident.value = true;
  activeIncident.value = null;
  try {
    const res = await statusPagesService.listNotices(props.orgIdentifier, props.pageId);
    const notices = (res.data as StatusPageNotice[]) ?? [];
    activeIncident.value = notices.find((n) => n.kind === 0 && n.state === 1) ?? null;
    mode.value = activeIncident.value ? "attach" : "new";
  } catch (err) {
    // Non-fatal: fall back to "new incident" so posting is never blocked by
    // this best-effort check.
    console.error("[status-pages] failed to check for an open incident", err);
    mode.value = "new";
  } finally {
    loadingIncident.value = false;
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) loadActiveIncident();
  },
  { immediate: true },
);

async function onSubmitAttach(values: AttachUpdateForm) {
  if (!activeIncident.value) return;
  const dismiss = toast({
    variant: "loading",
    message: t("statusPages.postUpdate.posting"),
    timeout: 0,
  });
  try {
    if (values.escalateTo !== "none") {
      await statusPagesService.updateNotice(props.orgIdentifier, activeIncident.value.id, {
        impact: impactToWire(values.escalateTo),
      });
    }
    await statusPagesService.addNoticeUpdate(
      props.orgIdentifier,
      activeIncident.value.id,
      values.body,
    );
    dismiss();
    toast({ variant: "success", message: t("statusPages.postUpdate.posted") });
    emit("update:open", false);
    emit("posted");
  } catch (err: any) {
    dismiss();
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("statusPages.postUpdate.postFailed"),
    });
    console.error("[status-pages] attach update failed", err);
  }
}

async function onSubmitNew(values: PostUpdateForm) {
  const dismiss = toast({
    variant: "loading",
    message: t("statusPages.postUpdate.posting"),
    timeout: 0,
  });
  try {
    await statusPagesService.createNotice(props.orgIdentifier, props.pageId, {
      kind: 0,
      impact: impactToWire(values.impact),
      title: values.title,
      body: values.body,
      component_ids: values.component_ids,
    });
    dismiss();
    toast({ variant: "success", message: t("statusPages.postUpdate.posted") });
    emit("update:open", false);
    emit("posted");
  } catch (err: any) {
    dismiss();
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("statusPages.postUpdate.postFailed"),
    });
    console.error("[status-pages] post update failed", err);
  }
}
</script>
