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
  TemplatePreviewPanel: live server-rendered preview of a ContentSpec, driven
  by templateService.preview() (Task 12/13 seam). Debounces spec mutations
  300ms before firing the request so a rapid burst of edits collapses into a
  single call. Renders two views per channel: an approximate visual card
  (sanitized via DOMPurify before v-html — the one hard security requirement)
  and the raw wire payload as pretty-printed JSON.

  Test-send (Task 15): a destination picker + "Send test" button that posts
  the CURRENT draft spec to a REAL destination via
  destinationService.testSend(), gated behind a confirm dialog that states
  plainly a real message will be posted. Every rendered title/subject the
  backend sends is prefixed `[TEST] ` — see src/core/src/alerts/notifications/
  test_send.rs. This is the only action in the templates UI that reaches a
  live channel.
-->
<template>
  <div class="flex h-full flex-col gap-3" data-test="template-preview-panel">
    <div class="flex flex-wrap items-end gap-x-4 gap-y-3">
      <!--
        Two unrelated control groups share this row: Channel/Severity only
        change what the PREVIEW BELOW shows (no network call, nothing sent
        anywhere); Destination/Send-test post a REAL `[TEST] `-marked
        message to a live destination. Each group keeps its own text label
        AND is wrapped so the pairing survives `flex-wrap` at any width —
        a single divider element between them (tried first) orphans itself
        with nothing beside it once the row wraps at a narrow panel width.
      -->
      <div class="flex flex-col gap-1">
        <div class="text-text-tertiary text-xs">
          {{ t("alert_templates.previewGroupLabel") }}
        </div>
        <div class="flex flex-wrap items-end gap-3">
          <OSelect
            v-model="channel"
            :label="t('alert_templates.previewChannel')"
            :options="channelOptions"
            width="sm"
            :searchable="false"
            data-test="template-preview-panel-channel-select"
          />
          <OSelect
            v-model="severity"
            :label="t('alert_templates.previewSeverity')"
            :options="severityOptions"
            width="sm"
            :searchable="false"
            data-test="template-preview-panel-severity-select"
          />
        </div>
      </div>
      <div class="border-border-default flex flex-col gap-1 border-l pl-4">
        <div class="text-text-tertiary text-xs">
          {{ t("alert_templates.testSendGroupLabel") }}
        </div>
        <div class="flex flex-wrap items-end gap-3">
          <OSelect
            v-model="selectedDestination"
            :label="t('alert_templates.testSendDestinationLabel')"
            :options="destinationOptions"
            width="sm"
            clearable
            data-test="template-preview-panel-destination-select"
          />
          <OButton
            variant="outline"
            size="sm-action"
            :disabled="!selectedDestination"
            :loading="isTestSending"
            data-test="template-preview-panel-test-send-btn"
            @click="openConfirm"
            >{{ t("alert_templates.testSend") }}</OButton
          >
        </div>
      </div>
    </div>

    <ConfirmDialog
      v-model="showConfirm"
      :title="t('alert_templates.testSendConfirmTitle')"
      :message="t('alert_templates.testSendConfirm')"
      :ok-label="t('alert_templates.testSend')"
      data-test="template-preview-panel-test-send-confirm-dialog"
      @update:ok="runTestSend"
    />

    <div
      v-if="unknownVariables.length > 0"
      class="flex flex-wrap items-center gap-1"
      data-test="template-preview-panel-unknown-variables-warning"
    >
      <OTag variant="warning-soft" data-test="template-preview-panel-unknown-variables-chip">
        {{ t("alert_templates.unknownVariables") }}: {{ unknownVariables.join(", ") }}
      </OTag>
    </div>

    <OTabs
      data-test="template-preview-panel-view-tabs"
      :model-value="view"
      @update:model-value="(v: unknown) => (view = v as PreviewView)"
    >
      <OTab
        name="visual"
        :label="t('alert_templates.previewApproximate')"
        data-test="template-preview-panel-visual-tab"
      />
      <OTab
        name="raw"
        :label="t('alert_templates.previewRawPayload')"
        data-test="template-preview-panel-raw-tab"
      />
    </OTabs>

    <div class="min-h-0 flex-1 overflow-auto">
      <div
        v-if="isLoading && !previewModel"
        class="text-text-secondary flex items-center gap-2 p-3 text-sm"
        data-test="template-preview-panel-loading"
      >
        <OSpinner size="xs" />
        {{ t("common.loading") }}
      </div>

      <template v-else-if="view === 'visual'">
        <div
          v-if="previewModel"
          class="rounded-surface bg-surface-panel border-border-default flex flex-col gap-2 border border-s-4 p-3"
          :class="severityAccentClass"
          data-test="template-preview-panel-visual-card"
        >
          <!-- The card is a NORMALISED shape — the backend returns the same
               preview_model for every channel, only `payload` differs. Without
               naming the channel here, switching the Channel select looks like
               it did nothing, because the card genuinely does not change. -->
          <div
            class="text-text-secondary text-2xs flex items-center gap-1 font-medium uppercase"
            data-test="template-preview-panel-channel-badge"
          >
            {{ activeChannelLabel }}
          </div>
          <div class="text-sm font-bold" data-test="template-preview-panel-title">
            {{ previewModel.title }}
          </div>
          <!-- `prose` is load-bearing, not decoration: Tailwind's preflight
               strips <ul> markers and <strong>/<em> emphasis to unstyled, so
               without it the backend's correct HTML renders as flat text and
               bold/bullets look broken to the author. Same treatment the
               dashboard markdown panel uses (MarkdownRenderer.vue). -->
          <!-- eslint-disable-next-line vue/no-v-html -- sanitized via DOMPurify.sanitize above -->
          <div
            class="prose prose-sm max-w-none text-sm"
            :class="isDark && 'prose-invert'"
            data-test="template-preview-panel-body"
            v-html="sanitizedBodyHtml"
          />
          <div
            v-if="previewModel.fields.length > 0"
            class="grid grid-cols-2 gap-2"
            data-test="template-preview-panel-fields"
          >
            <div
              v-for="(field, index) in previewModel.fields"
              :key="`${field.label}-${index}`"
              class="flex flex-col"
            >
              <span class="text-text-secondary text-xs">{{ field.label }}</span>
              <span class="text-sm">{{ field.value }}</span>
            </div>
          </div>
          <div
            v-if="previewModel.links.length > 0 || previewModel.footer"
            class="flex flex-wrap gap-2"
            data-test="template-preview-panel-links"
          >
            <OButton
              v-for="(link, index) in previewModel.links"
              :key="`${link.label}-${index}`"
              variant="outline"
              size="sm-action"
              :data-test="`template-preview-panel-link-${index}`"
              @click="openLink(link.url)"
              >{{ link.label }}</OButton
            >
            <!-- `footer` is the default alert-URL link with no authored
                 label (§4.2: an empty label means "use the channel's
                 default text"). Every real channel renders it as a styled
                 button — often the primary one, e.g. Slack's green
                 "View in OpenObserve" (see slack.rs render_slack) — so the
                 preview must too, not as trailing plain-text URL, or the
                 card looks like it's missing the button real messages show.
                 `preview-action` (not a per-channel brand color) matches
                 this card's normalized, channel-agnostic design — the
                 fidelity note below already directs users to Payload for
                 the exact per-channel styling. -->
            <OButton
              v-if="previewModel.footer"
              variant="preview-action"
              data-test="template-preview-panel-default-link"
              @click="openLink(previewModel.footer)"
              >{{ t("alert_templates.viewAlertLinkLabel") }}</OButton
            >
          </div>
          <!-- `chart_placeholder` is a BOOLEAN flag from the preview endpoint
               (preview.rs) — a real chart needs a real alert's evaluation
               history, so the preview shows a labeled placeholder box. -->
          <div
            v-if="previewModel.chart_placeholder"
            class="border-border-default text-text-secondary rounded-default border border-dashed p-2 text-center text-xs"
            data-test="template-preview-panel-chart-placeholder"
          >
            {{ t("alert_templates.chartPreviewPlaceholder") }}
          </div>
        </div>
        <!-- The fidelity caveat belongs here, not in the tab label: the tab
             names what the pane shows ("Preview" vs "Payload"), and this line
             sets expectations without making the user wonder what is wrong. -->
        <p
          v-if="previewModel"
          class="text-text-secondary mt-2 text-xs"
          data-test="template-preview-panel-fidelity-note"
        >
          {{ fidelityNote }}
        </p>
        <OEmptyState
          v-else
          preset="no-data"
          :title="t('alert_templates.previewEmptyTitle')"
          data-test="template-preview-panel-empty"
        />
      </template>

      <template v-else>
        <pre
          class="bg-surface-panel rounded-default text-3xs overflow-auto p-3"
          data-test="template-preview-panel-raw-json"
          >{{ rawPayloadJson }}</pre>
      </template>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18nTyped, raw, type I18nText } from "@/types/i18n";
import { useStore } from "vuex";
import DOMPurify from "dompurify";
import { useTheme } from "@/composables/useTheme";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import templateService from "@/services/alert_templates";
import destinationService from "@/services/alert_destination";
import type { ContentSpec } from "./contentSpec";

// Wire values the backend documents for POST …/templates/preview. Kept local
// (not exported) — no other module needs these literal strings.
type PreviewChannel =
  | "slack"
  | "teams_adaptivecard"
  | "teams_messagecard"
  | "email"
  | "webhook"
  | "discord"
  | "pagerduty"
  | "opsgenie"
  | "servicenow"
  | "sns";
type PreviewSeverityOption = "single_level" | "critical" | "warning" | "ok" | "no_data";
type PreviewView = "visual" | "raw";

interface PreviewField {
  label: string;
  value: string;
}
interface PreviewLink {
  label: string;
  url: string;
}
interface PreviewModel {
  title: string;
  body_html: string;
  fields: PreviewField[];
  links: PreviewLink[];
  color: string;
  severity: string | null;
  footer: string | null;
  // Boolean in the backend (preview.rs `chart_placeholder: bool`); the old
  // `string | null` here was a latent type mismatch.
  chart_placeholder: boolean;
}
interface PreviewResponseData {
  payload: unknown;
  preview_model: PreviewModel;
  unknown_variables: string[];
}

const props = defineProps<{
  spec: ContentSpec;
}>();

const { t } = useI18nTyped();
// `prose-invert` on the rendered markdown body — the typography plugin's
// light-mode defaults are unreadable on the dark card surface.
const { isDark } = useTheme();
const store = useStore();

const channel = ref<PreviewChannel>("slack");
const severity = ref<PreviewSeverityOption>("single_level");
const view = ref<PreviewView>("visual");

const channelOptions = computed(() => [
  { label: t("alert_templates.channelSlack"), value: "slack" },
  { label: t("alert_templates.channelTeamsAdaptiveCard"), value: "teams_adaptivecard" },
  { label: t("alert_templates.channelTeamsMessageCard"), value: "teams_messagecard" },
  { label: t("alert_templates.channelEmail"), value: "email" },
  { label: t("alert_templates.channelWebhook"), value: "webhook" },
  // Every channel a template's title_overrides can target is previewable —
  // the backend preview endpoint parses all of these (preview.rs
  // parse_channel); listing only half was a live-UX-audit incoherence.
  { label: t("alert_templates.channelDiscord"), value: "discord" },
  { label: t("alert_templates.channelPagerduty"), value: "pagerduty" },
  { label: t("alert_templates.channelOpsgenie"), value: "opsgenie" },
  { label: t("alert_templates.channelServicenow"), value: "servicenow" },
  { label: t("alert_templates.channelSns"), value: "sns" },
]);

/** Name of the channel the card is previewing, shown on the card itself. */
const activeChannelLabel = computed(
  () => channelOptions.value.find((o) => o.value === channel.value)?.label ?? channel.value,
);

/**
 * What actually differs per channel. The visual card is normalised, so this
 * line — and the Payload tab — are where a user sees that switching Channel
 * changed anything. Machine-consumer channels get a blunter statement than
 * the human-facing ones.
 */
const fidelityNote = computed(() => {
  switch (channel.value) {
    case "webhook":
      return t("alert_templates.previewFidelityWebhook");
    case "email":
      return t("alert_templates.previewFidelityEmail");
    // Machine-consumed formats: nobody "reads" these — the visual card is a
    // normalized rendering and the Payload tab is the truth.
    case "pagerduty":
    case "opsgenie":
    case "servicenow":
    case "sns":
      return t("alert_templates.previewFidelityMachine");
    default:
      return t("alert_templates.previewFidelityNote");
  }
});

const severityOptions = computed(() => [
  { label: t("alert_templates.previewSeveritySingle"), value: "single_level" },
  { label: t("alert_templates.severityCritical"), value: "critical" },
  { label: t("alert_templates.severityWarning"), value: "warning" },
  { label: t("alert_templates.severityOk"), value: "ok" },
  { label: t("alert_templates.severityNoData"), value: "no_data" },
]);

const previewData = ref<PreviewResponseData | null>(null);
const isLoading = ref(false);

const previewModel = computed(() => previewData.value?.preview_model ?? null);
const unknownVariables = computed(() => previewData.value?.unknown_variables ?? []);

/**
 * Severity accent for the preview card.
 *
 * The response also carries `preview_model.color` (a hex the non-web renderers
 * embed in their payloads), but a literal colour may not enter a component —
 * including through a `:style` binding, which the design linter cannot see.
 * So the card maps the `severity` enum to registered token utilities instead,
 * and the hex stays where it belongs: in the raw payload tab.
 */
const severityAccentClass = computed(() => {
  switch (previewModel.value?.severity) {
    case "critical":
      return "border-s-status-negative";
    case "warning":
      return "border-s-status-warning-text";
    case "ok":
      return "border-s-status-positive";
    default:
      return "border-s-accent";
  }
});

const sanitizedBodyHtml = computed(() =>
  previewModel.value ? DOMPurify.sanitize(previewModel.value.body_html) : "",
);

const rawPayloadJson = computed(() =>
  previewData.value ? JSON.stringify(previewData.value.payload, null, 2) : "",
);

const openLink = (url: string) => {
  window.open(url, "_blank", "noopener,noreferrer");
};

// single_level maps to `severity: null` on the wire request — it is the
// default/common case (no multi-level severity), and the backend documents
// absence-or-"single_level" as equivalent. We always send null explicitly for
// clarity/consistency (brief: "pick one, be consistent").
const requestSeverity = (): string | null =>
  severity.value === "single_level" ? null : severity.value;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
// Guards against a stale response landing after a newer request was already
// issued (out-of-order network resolution).
let requestSeq = 0;

const fetchPreview = async () => {
  const seq = ++requestSeq;
  isLoading.value = true;
  try {
    const response = await templateService.preview({
      org_identifier: store.state.selectedOrganization?.identifier,
      data: {
        definition: props.spec,
        channel: channel.value,
        severity: requestSeverity(),
      },
    });
    if (seq !== requestSeq) return; // superseded by a newer request
    previewData.value = response.data as PreviewResponseData;
  } catch {
    if (seq !== requestSeq) return;
    previewData.value = null;
  } finally {
    if (seq === requestSeq) isLoading.value = false;
  }
};

const schedulePreview = () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    fetchPreview();
  }, 300);
};

watch(() => props.spec, schedulePreview, { deep: true, immediate: true });
watch([channel, severity], schedulePreview);

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
});

// --- Test-send (Task 15) ---------------------------------------------------
// Posts a REAL message to a REAL destination. Loading the destination list is
// read-only (list permission); the write/USE permission that actually lets a
// user post is enforced server-side on the test_send route itself — this
// panel enables the button whenever a destination is selected, and lets the
// backend 403 if the user lacks destination-write.
interface DestinationOption {
  label: I18nText;
  value: string;
}

const destinationOptions = ref<DestinationOption[]>([]);
const selectedDestination = ref<string | null>(null);
const showConfirm = ref(false);
const isTestSending = ref(false);

const loadDestinations = async () => {
  try {
    const response = await destinationService.list({
      org_identifier: store.state.selectedOrganization?.identifier,
      page_num: 1,
      page_size: 100000,
      sort_by: "name",
      desc: false,
      module: "alert",
    });
    destinationOptions.value = (response.data ?? []).map((dest: { name: string }) => ({
      // Destination names are user data, not prose — nothing to translate.
      label: raw(dest.name),
      value: dest.name,
    }));
  } catch {
    destinationOptions.value = [];
  }
};
loadDestinations();

const openConfirm = () => {
  if (!selectedDestination.value) {
    toast({ variant: "error", message: t("alert_templates.testSendNoDestination") });
    return;
  }
  showConfirm.value = true;
};

const runTestSend = async () => {
  if (!selectedDestination.value) return;
  isTestSending.value = true;
  try {
    await destinationService.testSend({
      org_identifier: store.state.selectedOrganization?.identifier,
      destination_name: selectedDestination.value,
      data: { definition: props.spec },
    });
    toast({ variant: "success", message: t("alert_templates.testSendSuccess") });
  } catch (err: any) {
    const message =
      err?.response?.status === 429
        ? t("alert_templates.testSendRateLimited")
        : (err?.response?.data?.message ?? err?.response?.data?.error ?? String(err));
    toast({ variant: "error", message });
  } finally {
    isTestSending.value = false;
  }
};

defineExpose({ channel, severity, view, selectedDestination, runTestSend });
</script>
