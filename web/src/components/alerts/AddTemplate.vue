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
    class="overflow-hidden"
    :title="
      isUpdatingTemplate
        ? t('alert_templates.updateTitle')
        : isClone
          ? t('alert_templates.cloneTitle')
          : t('alert_templates.addTitle')
    "
    title-data-test="add-template-title"
    :back="{
      label: t('alert_templates.header'),
      onClick: () => emit('cancel:hideform'),
    }"
    bleed
  >
    <OSplitter class="h-full" v-model="splitterModel" unit="%" :horizontal="false">
      <template v-slot:before>
        <OForm :form="form" v-slot="{ isSubmitting }" class="bg-card-glass-bg flex h-full flex-col">
          <div class="overflow-auto p-3">
            <!-- `title` explains WHY the field is locked in update mode — a bare
                 greyed-out input reads as broken, not intentional. -->
            <div
              class="o2-input w-full pt-2 pb-2"
              :title="isUpdatingTemplate ? t('alert_templates.nameLockedHint') : undefined"
            >
              <OFormInput
                name="name"
                data-test="add-template-name-input"
                :label="t('alerts.name')"
                :placeholder="t('alert_templates.namePlaceholder')"
                required
                :readonly="isUpdatingTemplate"
                :disabled="isUpdatingTemplate"
                tabindex="0"
              />
            </div>
            <div class="w-full pb-3">
              <div class="app-tabs-container w-fit">
                <AppTabs
                  class="tabs-selection-container"
                  data-test="add-template-mode-tabs"
                  :tabs="modeTabs"
                  :active-tab="editorMode"
                  @update:active-tab="onModeChange"
                />
              </div>
            </div>

            <div
              v-if="showLegacyBanner"
              class="border-border-default bg-surface-panel rounded-default mb-3 flex items-center justify-between gap-3 border p-3"
              data-test="add-template-legacy-banner"
            >
              <span class="text-sm">{{ t("alert_templates.legacyBanner") }}</span>
              <OButton
                variant="outline"
                size="sm-action"
                data-test="add-template-start-content-version-btn"
                @click="startContentVersion"
                >{{ t("alert_templates.startContentVersion") }}</OButton
              >
            </div>

            <template v-if="editorMode === 'content'">
              <ContentTemplateForm
                v-model="contentSpec"
                :is-seeded="isSeededTemplate"
                data-test="add-template-content-form"
              />
            </template>

            <template v-else>
              <div class="w-full pb-3">
                <div class="app-tabs-container w-fit">
                  <AppTabs
                    class="tabs-selection-container"
                    :tabs="tabs"
                    :active-tab="templateType"
                    @update:active-tab="onTypeChange"
                  />
                </div>
              </div>
              <div v-if="templateType === 'email'" class="o2-input w-full pt-1">
                <OFormInput
                  name="title"
                  data-test="add-template-email-title-input"
                  :label="t('alerts.title')"
                  required
                  tabindex="0"
                />
              </div>
              <div class="w-full py-3">
                <div
                  class="flex items-center gap-0.5 font-bold"
                  data-test="add-template-body-input-title"
                >
                  <span>{{ t("alert_templates.body") }}</span>
                  <span aria-hidden="true" class="select-none">*</span>
                </div>
                <div
                  class="text-text-secondary pb-2 text-xs"
                  data-test="add-template-raw-body-caption"
                >
                  {{ t("alert_templates.rawBodyCaption") }}
                </div>
                <!-- `:key` forces a remount when the type flips. CodeQueryEditor
                   reads `language` only at monaco.editor.create() — it never
                   watches the prop, and setModelLanguage is used nowhere — so
                   without this the editor keeps its mount-time language and paints
                   a markdown body with JSON errors (pre-migration got the remount
                   for free from two v-if/v-else editors). -->
                <!-- The editor is a bare Monaco bridged into the form via
                   setFieldValue, so it has no OFormInput error slot of its
                   own. Mirror one here: a red border plus a message, driven
                   by the `body` field's own validation state, so a rejected
                   save points AT the offending field (o2-enterprise#2394). -->
                <!-- `aria-*` goes on this shell, NOT on <QueryEditor>:
                   CodeQueryEditor sets `inheritAttrs: false` and binds
                   `$attrs` to a non-focusable wrapper, while Monaco builds
                   its real textarea in a different child — so attributes
                   passed to the component would be inert. A `group` with an
                   accessible name and a described-by is what actually
                   survives; the message below also carries `role="alert"`,
                   so it is announced the moment a rejected save renders it. -->
                <div
                  data-test="add-template-body-editor-shell"
                  role="group"
                  :aria-label="t('alert_templates.body')"
                  :aria-invalid="bodyError ? 'true' : undefined"
                  :aria-describedby="bodyError ? 'add-template-body-error' : undefined"
                  :data-error="String(!!bodyError)"
                  :class="[
                    'rounded-default mb-1 w-full overflow-hidden border',
                    bodyError ? 'border-input-border-error' : 'border-card-glass-border',
                  ]"
                >
                  <QueryEditor
                    :key="bodyLanguage"
                    data-test="template-body-editor"
                    editor-id="template-body-editor"
                    class="min-h-77.5! w-full resize-y overflow-auto"
                    :language="bodyLanguage"
                    :query="body"
                    @update:query="onBodyChange"
                  />
                </div>
                <div
                  v-if="bodyError"
                  id="add-template-body-error"
                  data-test="add-template-body-error"
                  class="text-input-error-text mb-3 text-xs"
                  role="alert"
                >
                  {{ bodyError }}
                </div>
                <div v-else class="mb-3"></div>
              </div>
            </template>
          </div>
          <div
            class="bg-surface-base border-border-default flex w-full justify-end gap-2 border-t px-4 py-4"
          >
            <OButton
              v-close-popup
              variant="outline"
              size="sm-action"
              :disabled="isSubmitting"
              @click="$emit('cancel:hideform')"
              data-test="add-template-cancel-btn"
              >{{ t("alerts.cancel") }}</OButton
            >
            <OButton
              variant="primary"
              size="sm-action"
              :loading="isSubmitting"
              data-test="add-template-submit-btn"
              @click="handleSave"
              >{{ t("alerts.save") }}</OButton
            >
          </div>
        </OForm>
      </template>
      <template v-slot:after>
        <div
          class="bg-card-glass-bg border-border-default flex h-full flex-col overflow-auto border-l px-2 pt-2"
        >
          <template v-if="editorMode === 'content'">
            <!--
              NOT `flex-1`/`h-full`: this panel shares a scrollable column
              (`overflow-auto` on the wrapper above) with the Variable Guide
              collapsible below it. `flex-1` claims 100% of the column's
              CURRENT available height at layout time — fine while the guide
              is collapsed, but flexbox does not re-flow siblings when the
              guide later expands past that reserved space; the two boxes
              overlap instead of the column growing and scrolling. Live-
              reported bug: expanding the guide drew its text directly under
              this panel's toolbar. Sizing to content (the default) lets the
              column's own `overflow-auto` do the scrolling instead.
            -->
            <TemplatePreviewPanel :spec="contentSpec" data-test="add-template-preview-panel" />
            <OSeparator class="mt-2 mr-2 -ml-2" />
          </template>

          <OCollapsible
            :label="t('alert_templates.variable_guide_header')"
            v-model="variableGuideOpen"
            data-test="add-template-variable-guide-collapsible"
          >
            <div class="px-1 py-3">
              <div>{{ raw("org_name, stream_type, stream_name") }}</div>
              <div>{{ raw("alert_name, alert_type") }}</div>
              <div>{{ raw("alert_period, alert_operator, alert_threshold") }}</div>
              <div>{{ raw("alert_count, alert_agg_value") }}</div>
              <div>{{ raw("alert_description") }}</div>
              <div>{{ raw("alert_start_time, alert_end_time, alert_url") }}</div>
              <div>
                {{
                  raw(
                    "alert_trigger_time, alert_trigger_time_millis, alert_trigger_time_seconds, alert_trigger_time_str",
                  )
                }}
              </div>
              <div>
                <b>{{ raw("rows") }}</b> {{ t("alert_templates.variableRowsDescription") }}
              </div>
              <div>
                <b>{{ t("alert_templates.variableStreamFields") }}</b>
              </div>
              <div>{{ t("alert_templates.variableLimits") }}</div>
              <div>{{ t("alert_templates.variableTimezoneNote") }}</div>
            </div>
            <div class="px-1 pb-3">
              <div class="text-body-1 pb-2 font-bold">
                {{ t("alert_templates.variable_usage_examples") }}:
              </div>
              <div
                v-for="(template, index) in sampleTemplates"
                class="pb-3"
                :key="template.name"
                :data-test="`add-template-sample-template-${index}`"
              >
                <div class="flex items-center justify-between">
                  <div class="pb-1">{{ template.name }}</div>
                  <OIcon
                    data-test="add-template-sample-template-copy-btn"
                    class="cursor-pointer"
                    name="content-copy"
                    size="xs"
                    @click="copyTemplateBody(template.body)"
                  />
                </div>
                <div
                  data-test="add-template-sample-template-text"
                  class="rounded-default bg-black/[0.07] px-2"
                >
                  <pre class="text-3xs my-0">
                    {{ template.body }}
                  </pre>
                </div>
              </div>
            </div>
          </OCollapsible>
        </div>
      </template>
    </OSplitter>
  </OPageLayout>
</template>
<script lang="ts" setup>
import { ref, onActivated, computed, watch, defineAsyncComponent } from "vue";
import type { Ref } from "vue";
import { useI18nTyped, raw } from "@/types/i18n";

import templateService from "@/services/alert_templates";
import { useStore } from "vuex";
import { copyToClipboard } from "@/utils/clipboard";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import { scrollToFirstError } from "@/lib/forms/Form/scrollToFirstError";
import type { TemplateData } from "@/ts/interfaces/index";
import { useRouter } from "vue-router";
import AppTabs from "@/components/common/AppTabs.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { useReo } from "@/services/reodotdev_analytics";
import { validateTemplateBody } from "@/utils/templates/validation";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import TemplatePreviewPanel from "./template-content/TemplatePreviewPanel.vue";
import {
  makeAddTemplateSchema,
  addTemplateDefaults,
  type AddTemplateForm,
} from "./AddTemplate.schema";
import ContentTemplateForm from "./template-content/ContentTemplateForm.vue";
import {
  emptyContentSpec,
  linkUrlBadScheme,
  NOT_A_URL,
  starterContentSpec,
  parseContentSpec,
  serializeContentSpec,
  type ContentSpec,
} from "./template-content/contentSpec";

const props = withDefaults(
  defineProps<{
    template: TemplateData | null;
    /**
     * When true, the form is in "clone" mode: it pre-fills body/type/title
     * from `template` but treats the save as a new template (so a renamed
     * "Copy of X" is created instead of overwriting X).
     */
    isClone?: boolean;
  }>(),
  { isClone: false },
);
const emit = defineEmits(["get:templates", "cancel:hideform"]);

const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));
const { t } = useI18nTyped();
const splitterModel: Ref<number> = ref(55);
const store = useStore();
const router = useRouter();
const isUpdatingTemplate = ref(false);
const { track } = useReo();

// Owner pattern (Rule ③): AddTemplate OWNS <OForm>, and it needs to read `type`
// at setup to drive conditional rendering (the email title input v-if + the
// Monaco editor language). So the form is created here via useOForm and handed
// to <OForm :form="form">; state is read with form.useStore (single source of
// truth — no mirror), written with form.setFieldValue.
const addTemplateSchema = makeAddTemplateSchema(t);
const form = useOForm<AddTemplateForm>({
  defaultValues: addTemplateDefaults(),
  schema: addTemplateSchema,
  onSubmit: saveTemplate,
});

// Reactive views of the two bridged values.
const templateType = form.useStore((s: any) => s.values.type as "http" | "email");
const body = form.useStore((s: any) => (s.values.body as string) ?? "");
const bodyLanguage = computed(() => (templateType.value === "email" ? "markdown" : "json"));

// The body is a bare Monaco, not an OFormInput, so nothing renders its
// validation error. Read the SAME field state OFormInput reads
// (`meta.errors`) and drive a hand-rolled error affordance from it, so an
// empty body highlights the editor instead of only toasting
// (o2-enterprise#2394). Validation timing is submit-then-change, so this
// stays empty until the first save attempt and clears as soon as it is fixed.
const bodyError = form.useStore((s: any) =>
  firstFieldError(s.fieldMeta?.body?.errors as readonly unknown[] | undefined),
);

// app-tabs is a UI toggle whose value is the schema discriminator (not an
// <input>) → bridge it into the form (sanctioned Rule-② bridge).
const onTypeChange = (value: unknown) => {
  form.setFieldValue("type", value as "http" | "email");
};

// Editor mode: "content" (structured ContentSpec editor, default for new
// templates) vs "custom" (today's raw-payload editor, untouched). Bridged
// from the mode AppTabs toggle into the `kind` schema field the same way
// `type` is bridged above. The wire values "content"/"custom" never surface
// as UI copy (design §7) — the tab labels come from kindContent/kindCustom.
const editorMode = form.useStore((s: any) => s.values.kind as "content" | "custom");

const modeTabs = computed(() => [
  { label: t("alert_templates.kindContent"), value: "content", style: {} },
  { label: t("alert_templates.kindCustom"), value: "custom", style: {} },
]);

// ContentSpec lives outside the OForm schema (it's a nested object, not a
// flat field) and is serialized into the form's plain `body` string on save
// — the same bridging pattern already used for the bare Monaco `body` field
// below. Kept as a local ref; ContentTemplateForm owns no state of its own.
const contentSpec = ref<ContentSpec>(emptyContentSpec());
/**
 * True only while showing a brand-new template still carrying the untouched
 * starter seed. The seed has optional content by design (rows on, three
 * fields), so without this the "auto-open when populated" rule would fire on
 * every new template and defeat the collapsed first run.
 */
const isSeededTemplate = ref(false);

// Keep the schema's `body` field (min-length-1 validated) in sync with the
// serialized ContentSpec while in content mode, so the OForm submit gate
// reflects the real save payload instead of a stale/empty string left over
// from switching modes.
watch(
  contentSpec,
  (spec) => {
    if (editorMode.value === "content") {
      form.setFieldValue("body", serializeContentSpec(spec));
    }
  },
  { deep: true },
);

// Controlled (not `default-open`) on purpose: `default-open` only seeds the
// collapsible's internal state ONCE at mount — it is not reactive to prop
// changes by design (standard "uncontrolled" collapsible semantics, same as
// this component's other consumers rely on). The Variable Guide instance
// itself never remounts across a mode switch (it lives in the `after` slot,
// outside the `editorMode` `v-if`/`v-else` above), so without an explicit
// `v-model` reset here, switching FROM custom mode (guide starts open) TO
// content mode leaves it open, overlapping the newly-visible
// TemplatePreviewPanel in the same scrollable column — live-verified.
const variableGuideOpen = ref(editorMode.value !== "content");
watch(editorMode, (mode) => {
  variableGuideOpen.value = mode !== "content";
});

// Starter body for raw-payload mode on a PRISTINE new template. Without
// this, switching a fresh template to raw mode showed the serialized
// ContentSpec (an internal representation) as the payload — which would be
// sent verbatim to a webhook. Live-UX-audit finding. A generic
// Slack-compatible example teaches the right mental model instead.
const RAW_PAYLOAD_STARTER = JSON.stringify(
  {
    text: "🚨 {alert_name} fired on {stream_name} — observed {alert_agg_value} ({alert_operator} {alert_threshold}). {alert_url}",
  },
  null,
  2,
);

// The two modes share the single schema `body` field, and entering content
// mode overwrites it with the serialized ContentSpec. Stash the raw payload
// on the way out of custom mode so a round trip through the Template tab can
// restore it — without this, an existing custom template's payload was
// destroyed by one tab click, and Save then persisted an empty spec over it
// (P0 o2-enterprise#2364).
const customBodyStash = ref<string | null>(null);

const onModeChange = (value: unknown) => {
  const rawBody = body.value;
  const wasCustom = editorMode.value === "custom";
  form.setFieldValue("kind", value as "content" | "custom");
  if (value === "content") {
    if (wasCustom) {
      customBodyStash.value = rawBody;
      // A still-empty spec means this custom template never had a content
      // version (existing templates load with an empty spec). Prefill it from
      // the payload's {vars} — same as startContentVersion — so the Template
      // tab never opens blank.
      if (serializeContentSpec(contentSpec.value) === serializeContentSpec(emptyContentSpec())) {
        const spec = emptyContentSpec();
        spec.body = detectBodyVars(rawBody)
          .map((v) => `{${v}}`)
          .join(" ");
        contentSpec.value = spec;
      }
    }
    form.setFieldValue("body", serializeContentSpec(contentSpec.value));
  } else if (customBodyStash.value !== null) {
    // Coming back to custom mode after a stash always restores the user's
    // payload — including unsaved raw-mode edits, which the stash captured.
    form.setFieldValue("body", customBodyStash.value);
  } else if (
    isSeededTemplate.value &&
    serializeContentSpec(contentSpec.value) === serializeContentSpec(starterContentSpec())
  ) {
    // Only when the content spec is still the untouched starter seed — any
    // authored content keeps the serialize round-trip so nothing is lost.
    form.setFieldValue("body", RAW_PAYLOAD_STARTER);
  }
};

// Persistent banner on an existing CUSTOM template offering to start a
// content version. Only ever shown for a saved (non-new) custom template —
// never for a brand-new template (which already defaults to content mode).
const showLegacyBanner = computed(() => editorMode.value === "custom" && isUpdatingTemplate.value);

// Detects `{var_name}` placeholders in a raw custom body so
// `startContentVersion` can prefill the new ContentSpec's body with the
// same variables the user was already relying on, rather than starting from
// a blank slate.
const detectBodyVars = (rawBody: string): string[] => {
  const matches = Array.from(rawBody.matchAll(/\{([a-zA-Z0-9_.:]+)\}/g));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of matches) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      result.push(m[1]);
    }
  }
  return result;
};

const startContentVersion = () => {
  // Same data-loss hazard as the mode tabs: the contentSpec watcher rewrites
  // `body` the moment the spec below is assigned, so stash the payload first
  // or switching back to Raw payload would show the serialized spec instead.
  customBodyStash.value = body.value;
  const vars = detectBodyVars(body.value);
  const spec = emptyContentSpec();
  spec.body = vars.map((v) => `{${v}}`).join(" ");
  contentSpec.value = spec;
  form.setFieldValue("kind", "content");
};

// PARITY with pre-migration saveTemplate (HEAD ~:334-346): an unfilled required
// field ALWAYS toasted "Please fill required fields". Post-migration the schema
// rejects the submit BEFORE onSubmit(saveTemplate) runs — and saveTemplate owns
// every toast — so a rejected save said nothing at all. `body` is the sharp edge:
// it's a bare Monaco bridged in via setFieldValue with no name= binding, so it has
// no field to highlight either. Restore the toast on a rejected submit.
const handleSave = async () => {
  await form.handleSubmit();
  if (!form.state.isValid) {
    toast({
      variant: "error",
      message: t("common.fillRequiredFields"),
      timeout: 1500,
    });
    // The offending field is often scrolled off-screen on this form (the body
    // editor is tall), so the toast alone left the user hunting for what was
    // wrong. Bring the first invalid field into view and focus it.
    await scrollToFirstError();
  }
};

// Bare Monaco body → bridge its value into the form so schema min(1) covers it.
const onBodyChange = (value: unknown) => {
  form.setFieldValue("body", (value as string) ?? "");
};

const sampleTemplates = [
  {
    name: "Slack",
    body: `
{
  "text": "{alert_name} is active"
}`,
  },
  {
    name: "Alert Manager",
    body: `
[
  {
    "labels": {
        "alertname": "{alert_name}",
        "stream": "{stream_name}",
        "organization": "{org_name}",
        "alerttype": "{alert_type}",
        "severity": "critical"
    },
    "annotations": {
        "timestamp": "{timestamp}"
    }
  }
]`,
  },
];

const tabs = computed(() => [
  {
    label: t("alerts.webhook"),
    value: "http",
    style: {},
    icon: "webhook",
  },
  {
    label: t("alerts.email"),
    value: "email",
    style: {},
    icon: "mail",
  },
]);

// Edit/clone prefill arrives via the `template` prop (possibly async). Seed the
// form with form.reset(record) when it loads — NOT a per-field setFieldValue
// loop (playbook §4 "Resetting / repopulating form values").
const applyTemplateData = () => {
  const params = router.currentRoute.value.query;
  const next = addTemplateDefaults();
  // A stash from a previously viewed template must never restore into this
  // one (the component is kept alive — onActivated re-runs this).
  customBodyStash.value = null;
  if (props.template) {
    // Clone mode pre-fills the form but stays in create mode so save
    // produces a new template; edit mode would overwrite the original.
    isUpdatingTemplate.value = !props.isClone;
    // Real stored content — the disclosure must open on it, so this is never
    // treated as a seed (including in clone mode, where the body is the
    // source template's, not the starter's).
    isSeededTemplate.value = false;
    next.name = props.template.name;
    next.body = props.template.body;
    next.type = props.template.type as "http" | "email";
    next.title = props.template.title;

    // Mode is picked from the template's `kind`, never guessed. Old
    // templates saved before `kind` existed have no explicit kind — treat
    // those as custom (their body is a raw payload string, not ContentSpec
    // JSON) rather than attempting to parse it as content.
    if (props.template.kind === "content") {
      const parsed = parseContentSpec(props.template.body);
      contentSpec.value = parsed ?? emptyContentSpec();
      next.kind = "content";
    } else {
      contentSpec.value = emptyContentSpec();
      next.kind = "custom";
    }
  } else {
    // New templates default to content mode (design §7 / brief step 3) and
    // are seeded with a working starter spec (Task 17 D2) so the preview
    // paints real output on first load. An EXISTING template (handled above)
    // always parses its own stored body instead — never overwritten here.
    isUpdatingTemplate.value = false;
    contentSpec.value = starterContentSpec();
    isSeededTemplate.value = true;
    next.kind = "content";
  }

  // A ?type= query param (e.g. deep link) preselects the tab. Guard the cast so
  // an unexpected value can never enter the enum-typed form.
  if (params.type === "email" || params.type === "http") {
    next.type = params.type;
  }

  form.reset(next);
};

watch(() => props.template, applyTemplateData, { immediate: true });
onActivated(() => applyTemplateData());

// http bodies must be valid JSON (with template placeholders). This stays a
// submit-time toast side-effect — NOT a schema rule — to preserve the exact
// pre-migration behaviour (Rule ④).
const isTemplateBodyValid = (bodyValue: string) => {
  const result = validateTemplateBody(bodyValue);

  if (!result.valid) {
    toast({
      variant: "error",
      message: t("alert_templates.bodyInvalidJsonHelp"),
      timeout: 1500,
    });
  }

  return result.valid;
};

// @submit(value) is the source of truth. OForm awaits this, so the inline Save
// button's spinner (v-slot isSubmitting) spans the whole request.
async function saveTemplate(value: AddTemplateForm) {
  const isContentMode = value.kind === "content";

  // Custom mode keeps the pre-migration JSON-validity check (http only);
  // content mode's body is always valid JSON (it's ContentSpec, serialized
  // here) so the check never applies to it.
  if (!isContentMode && value.type !== "email" && !isTemplateBodyValid(value.body)) return;

  // Content mode: don't dispatch a save the API will reject with a 400 whose
  // message is far from the offending field. The inline error under the link
  // input already says what is wrong (#13742); this stops the round trip and
  // points at the first bad link.
  if (isContentMode) {
    const badLink = contentSpec.value.links
      .map((l) => ({ link: l, scheme: linkUrlBadScheme(l.url) }))
      .find((c) => c.scheme);
    if (badLink?.scheme) {
      toast({
        variant: "error",
        message: t("alerts.validation.linkUrlInvalid", {
          label: badLink.link.label || t("alert_templates.linkUrl"),
          reason:
            badLink.scheme === NOT_A_URL
              ? t("alerts.validation.linkUrlNotAUrl")
              : t("alerts.validation.linkUrlUnsupportedScheme", {
                  scheme: badLink.scheme,
                }),
        }),
      });
      await scrollToFirstError();
      return;
    }
  }

  const dismiss = toast({
    variant: "loading",
    message: t("common.pleaseWait"),
    timeout: 0,
  });

  // Content-mode templates always save as `type: "http"` with the
  // ContentSpec JSON-serialized into `body` (brief: "Mode model"). Custom
  // mode keeps sending the raw body/type/title the pre-migration form built.
  // `kind` is set EXPLICITLY on every save — never left absent — because
  // server-side sticky-kind is a compatibility rule for OLD clients only.
  const data = isContentMode
    ? {
        name: value.name.trim(),
        body: serializeContentSpec(contentSpec.value),
        type: "http" as const,
        title: contentSpec.value.title,
        kind: "content" as const,
      }
    : {
        name: value.name.trim(),
        body: value.body,
        type: value.type,
        title: value.title,
        kind: "custom" as const,
      };

  const onSuccess = () => {
    dismiss();
    emit("get:templates");
    emit("cancel:hideform");
    toast({
      variant: "success",
      message: t("alert_templates.savedSuccessfully"),
    });
  };

  const onError = (err: any) => {
    if (err.response?.status == 403) {
      return;
    }
    dismiss();
    toast({
      variant: "error",
      message: err.response?.data?.error || err.response?.data?.message,
    });
  };

  if (isUpdatingTemplate.value) {
    const request = templateService
      .update({
        org_identifier: store.state.selectedOrganization.identifier,
        template_name: value.name,
        data,
      })
      .then(onSuccess)
      .catch(onError);
    track("Button Click", {
      button: "Update Template",
      page: "Add Template",
    });
    return request;
  }

  const request = templateService
    .create({
      org_identifier: store.state.selectedOrganization.identifier,
      template_name: value.name,
      data,
    })
    .then(onSuccess)
    .catch(onError);
  track("Button Click", {
    button: "Create Template",
    page: "Add Template",
  });
  return request;
}

const copyTemplateBody = (text: any) => {
  copyToClipboard(JSON.parse(JSON.stringify(text)), t, {
    successMessage: t("alert_templates.contentCopied"),
    timeout: 1000,
  });
};
</script>
