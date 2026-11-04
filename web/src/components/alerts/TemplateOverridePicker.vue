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

<!-- One template select for a notification kind: an object's override. -->
<template>
  <div class="flex min-w-0 flex-col gap-1" :data-test="`template-override-${kind}`">
    <OButton
      variant="ghost-primary"
      size="xs"
      class="gap-1 self-start font-medium"
      data-test="template-override-help-btn"
      @click="helpOpen = true"
    >
      <OIcon name="help" size="xs" />
      <span>{{ t("alerts.alertSettings.helpLearnMore") }}</span>
    </OButton>
    <template v-if="state === 'empty'">
      <span class="text-text-secondary text-sm" data-test="template-override-empty">
        {{ t("alerts.templateOverride.empty", { kind: kindLabel }) }}
        <OButton
          variant="ghost-primary"
          size="xs"
          class="ms-1"
          data-test="template-override-create"
          @click="openCreate"
          >{{ t("alerts.templateOverride.create") }}</OButton
        >
      </span>
    </template>
    <template v-else-if="state === 'error'">
      <span class="text-input-error-text text-sm" data-test="template-override-error">
        {{ t("alerts.templateOverride.loadFailed") }}
        <OButton
          variant="ghost-primary"
          size="xs"
          class="ms-1"
          data-test="template-override-retry"
          @click="load"
          >{{ t("common.retry") }}</OButton
        >
      </span>
      <span
        v-if="modelValue"
        class="text-text-secondary text-sm"
        data-test="template-override-stored"
        >{{ modelValue }}</span
      >
    </template>
    <OSelect
      v-else
      :model-value="modelValue"
      :options="options"
      labelKey="label"
      valueKey="value"
      clearable
      searchable
      :loading="state === 'loading'"
      :disabled="disabled || state === 'loading' || state === 'forbidden'"
      :placeholder="t('alerts.templateOverride.placeholder')"
      :help-text="
        state === 'forbidden'
          ? t('alerts.templateOverride.forbidden')
          : t('alerts.templateOverride.help', { kind: kindLabel })
      "
      :error-message="serverError ? raw(serverError) : undefined"
      class="max-w-105"
      data-test="template-override-select"
      @update:model-value="onSelect"
    />
    <span
      v-if="isStale"
      class="text-status-warning-text text-xs"
      role="status"
      data-test="template-override-stale"
    >
      {{ t("alerts.templateOverride.stale", { name: modelValue ?? "" }) }}
    </span>
    <span
      v-if="mismatched.length"
      class="text-status-warning-text text-xs"
      role="status"
      data-test="template-override-mismatch"
    >
      {{
        t("alerts.templateOverride.mismatch", {
          count: mismatched.length,
          names: mismatched.join(", "),
        })
      }}
    </span>
    <div
      v-if="willUse.length"
      class="text-text-secondary flex flex-col text-xs"
      role="status"
      data-test="template-override-will-use"
    >
      <span v-if="willUse.length === 1">{{
        t("alerts.templateOverride.willUse", { template: willUse[0].label })
      }}</span>
      <template v-else>
        <span>{{ t("alerts.templateOverride.willUsePerDestination") }}</span>
        <span
          v-for="row in willUse"
          :key="row.destination"
          data-test="template-override-will-use-row"
        >
          {{
            t("alerts.templateOverride.willUseRow", {
              destination: row.destination,
              template: row.label,
            })
          }}
        </span>
      </template>
    </div>
    <AlertSettingsHelpDrawer
      v-model:open="helpOpen"
      topic="template"
      subject="object"
      :templates="templates"
      :current-template="modelValue ?? ''"
      :selected-destinations="formDestinations.map((d) => d.name)"
      :unfit-destinations="mismatched"
      :resolved-destinations="willUseByDestination"
      @apply:template="onSelect"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import AlertSettingsHelpDrawer from "@/components/alerts/AlertSettingsHelpDrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import { raw, useI18nTyped } from "@/types/i18n";
import templateService from "@/services/alert_templates";
import { templatesQuery } from "@/services/alert_templates.queries";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { queryClient } from "@/composables/query/queryClient";
import {
  kindLabelKey,
  resolveEffectiveTemplate,
  sendsLegacyPayload,
  templateFitsTransport,
  type NotificationKind,
  type ResolvableTemplate,
  type TemplateSource,
} from "@/utils/alerts/notificationKinds";

type PickerTemplate = ResolvableTemplate;

interface FormDestination {
  name: string;
  type?: string;
  template?: string | null;
  destination_type_name?: string | null;
  metadata?: Record<string, string> | null;
}

const props = withDefaults(
  defineProps<{
    kind: NotificationKind;
    modelValue: string | null;
    disabled?: boolean;
    /** The form's destinations by name; a missing type or template is read from the destination list. */
    destinations?: (string | FormDestination)[];
    /** The server's 400 message for this field, shown under the select. */
    serverError?: string | null;
  }>(),
  { disabled: false, destinations: () => [], serverError: null },
);

const emit = defineEmits<{ (e: "update:modelValue", value: string | null): void }>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const state = ref<"loading" | "ready" | "empty" | "error" | "forbidden">("loading");
const templates = ref<PickerTemplate[]>([]);
const helpOpen = ref(false);

const kindLabel = computed(() => t(kindLabelKey(props.kind)));

const suffix = (tpl: PickerTemplate) => {
  if (tpl.kind === "content") return "";
  if (tpl.type === "email") return ` ${t("alerts.templateOverride.emailOnly")}`;
  if (tpl.type === "sns") return ` ${t("alerts.templateOverride.snsOnly")}`;
  return ` ${t("alerts.templateOverride.webhookOnly")}`;
};

const options = computed<SelectOption[]>(() => {
  const content = templates.value.filter((tpl) => tpl.kind === "content");
  const custom = templates.value.filter((tpl) => tpl.kind !== "content");
  const group = (label: string, list: PickerTemplate[]): SelectOption[] =>
    list.length
      ? [
          { label: raw(label), value: `__header_${label}`, header: true },
          ...list.map((tpl) => ({ label: raw(`${tpl.name}${suffix(tpl)}`), value: tpl.name })),
        ]
      : [];
  return [
    ...group(t("alerts.templateOverride.groupContent"), content),
    ...group(t("alerts.templateOverride.groupCustom"), custom),
  ];
});

const selected = computed(() => templates.value.find((tpl) => tpl.name === props.modelValue));
// A deleted or renamed template would be re-sent under its old name until the server refused it.
const isStale = computed(() => state.value === "ready" && !!props.modelValue && !selected.value);

// What the effective-template line needs beyond the picker's own list.
const allTemplates = ref<ResolvableTemplate[] | null>(null);
const orgDestinations = ref<FormDestination[]>([]);

const formDestinations = computed<FormDestination[]>(() =>
  props.destinations.map((d) => {
    const given = typeof d === "string" ? { name: d } : d;
    const known = orgDestinations.value.find((o) => o.name === given.name);
    return {
      name: given.name,
      type: given.type ?? known?.type,
      template: given.template ?? known?.template ?? null,
      destination_type_name: given.destination_type_name ?? known?.destination_type_name ?? null,
      metadata: given.metadata ?? known?.metadata ?? null,
    };
  }),
);

// A Custom template renders only on its own transport; other destinations use their own template.
const mismatched = computed(() => {
  const tpl = selected.value;
  if (!tpl || tpl.kind === "content") return [];
  return formDestinations.value
    .filter((d) => d.type && !templateFitsTransport(tpl.type, d.type))
    .map((d) => d.name);
});

const SOURCE_KEYS = {
  explicit: "alerts.templateOverride.sourceExplicit",
  destination: "alerts.templateOverride.sourceDestination",
  compiled: "alerts.templateOverride.sourceCompiled",
} as const satisfies Record<TemplateSource, string>;

const willUseByDestination = computed(() => {
  const templatesList = allTemplates.value;
  if (!templatesList) return [];
  return formDestinations.value.map((d) => {
    const { name, source } = resolveEffectiveTemplate({
      kind: props.kind,
      override: props.modelValue,
      destination: d,
      templates: templatesList,
    });
    if (sendsLegacyPayload({ kind: props.kind, destination: d, source })) {
      return {
        destination: d.name,
        key: "|legacy",
        label: t("alerts.templateOverride.sourceLegacyPayload"),
      };
    }
    const template = name ?? t("alerts.templateOverride.builtIn", { kind: kindLabel.value });
    return {
      destination: d.name,
      key: `${name ?? ""}|${source}`,
      label: t("alerts.templateOverride.templateWithSource", {
        name: template,
        source: t(SOURCE_KEYS[source]),
      }),
    };
  });
});

// One line when every destination gets the same template, one row per destination otherwise.
const willUse = computed(() => {
  const rows = willUseByDestination.value;
  return rows.every((r) => r.key === rows[0]?.key) ? rows.slice(0, 1) : rows;
});

// Each read is optional: a failure (or a 403) leaves the line out rather than guessing.
const loadResolution = async (fresh = false) => {
  const org = store.state.selectedOrganization.identifier;
  const templatesOptions = fresh ? { ...templatesQuery(org), staleTime: 0 } : templatesQuery(org);
  const [templatesList, destinationList] = await Promise.all([
    queryClient.fetchQuery(templatesOptions).catch(() => null),
    queryClient.fetchQuery(destinationsQuery(org, "alert")).catch(() => []),
  ]);
  allTemplates.value = Array.isArray(templatesList) ? templatesList : null;
  orgDestinations.value = (Array.isArray(destinationList) ? destinationList : []).map((d: any) => ({
    name: d.name,
    type: d.type,
    template: d.template ?? null,
    destination_type_name: d.destination_type_name ?? null,
    metadata: d.metadata ?? null,
  }));
};

const loadTemplates = async (silent: boolean) => {
  if (!silent) state.value = "loading";
  try {
    const res = await templateService.list({
      org_identifier: store.state.selectedOrganization.identifier,
      applies_to: props.kind,
    });
    const list: PickerTemplate[] = Array.isArray(res.data) ? res.data : [];
    templates.value = list.filter((tpl) => !tpl.isPrebuilt);
    state.value = templates.value.length ? "ready" : "empty";
  } catch (e: any) {
    // A failed background reload keeps the list the user is already looking at.
    if (!silent) state.value = e?.response?.status === 403 ? "forbidden" : "error";
  }
};

const load = () => loadTemplates(false);

const onSelect = (value: unknown) => {
  emit("update:modelValue", typeof value === "string" && value ? value : null);
};

// Set once "Create template" opened the editor in another tab, so a return to this tab reloads.
const createOpened = ref(false);
let refreshing = false;

const refreshAfterCreate = async () => {
  if (!createOpened.value || refreshing || document.visibilityState === "hidden") return;
  refreshing = true;
  try {
    await Promise.all([loadTemplates(true), loadResolution(true)]);
  } finally {
    refreshing = false;
  }
};

const openCreate = () => {
  createOpened.value = true;
  const route = router.resolve({
    name: "alertTemplates",
    query: {
      action: "add",
      applies_to: props.kind,
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
  window.open(route.href, "_blank");
};

watch(
  () => props.kind,
  () => {
    void load();
    void loadResolution();
  },
);
const onReturn = () => void refreshAfterCreate();

onMounted(() => {
  void load();
  void loadResolution();
  window.addEventListener("focus", onReturn);
  document.addEventListener("visibilitychange", onReturn);
});
onBeforeUnmount(() => {
  window.removeEventListener("focus", onReturn);
  document.removeEventListener("visibilitychange", onReturn);
});

defineExpose({ load });
</script>
