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

<!-- One template override select for a notification kind; lists only user templates that apply to it. -->
<template>
  <div class="flex min-w-0 flex-col gap-1" :data-test="`template-override-${kind}`">
    <template v-if="state === 'empty'">
      <span class="text-text-secondary text-sm" data-test="template-override-empty">
        {{ t("alerts.templateOverride.empty", { kind: kindLabel }) }}
        <a
          class="text-text-link ms-1 cursor-pointer underline"
          data-test="template-override-create"
          @click="openCreate"
          >{{ t("alerts.templateOverride.create") }}</a
        >
      </span>
    </template>
    <template v-else-if="state === 'error'">
      <span class="text-input-error-text text-sm" data-test="template-override-error">
        {{ t("alerts.templateOverride.loadFailed") }}
        <a
          class="text-text-link ms-1 cursor-pointer underline"
          data-test="template-override-retry"
          @click="load"
          >{{ t("common.retry") }}</a
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import { raw, useI18nTyped } from "@/types/i18n";
import templateService from "@/services/alert_templates";
import {
  kindLabelKey,
  templateFitsTransport,
  type NotificationKind,
} from "@/utils/alerts/notificationKinds";

interface PickerTemplate {
  name: string;
  kind?: string;
  type?: string;
}

const props = withDefaults(
  defineProps<{
    kind: NotificationKind;
    modelValue: string | null;
    disabled?: boolean;
    /** The form's destinations with their transport, for the Custom fit warning. */
    destinations?: { name: string; type?: string }[];
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

// A Custom template renders only on its own transport; other destinations use their own template.
const mismatched = computed(() => {
  const tpl = selected.value;
  if (!tpl || tpl.kind === "content") return [];
  return props.destinations
    .filter((d) => d.type && !templateFitsTransport(tpl.type, d.type))
    .map((d) => d.name);
});

const load = async () => {
  state.value = "loading";
  try {
    const res = await templateService.list({
      org_identifier: store.state.selectedOrganization.identifier,
      applies_to: props.kind,
    });
    templates.value = (Array.isArray(res.data) ? res.data : []).filter(
      (tpl: any) => !tpl.isPrebuilt,
    );
    state.value = templates.value.length ? "ready" : "empty";
  } catch (e: any) {
    state.value = e?.response?.status === 403 ? "forbidden" : "error";
  }
};

const onSelect = (value: unknown) => {
  emit("update:modelValue", typeof value === "string" && value ? value : null);
};

const openCreate = () => {
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

watch(() => props.kind, load);
onMounted(load);

defineExpose({ load });
</script>
