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
  <OSelect
    :model-value="selectedKey"
    :options="options"
    searchable
    size="sm"
    :loading="pending"
    :search-placeholder="t('alertStarter.library.scopeSearch')"
    :aria-label="t('alertStarter.library.scopeLabel')"
    data-test="alert-starter-scope-select"
    @update:model-value="onPick"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";

import type { StarterScope } from "@/components/create-starter/createStarter.types";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue, SelectOption } from "@/lib/forms/Select/OSelect.types";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import { formatNumber } from "@/utils/alerts/alertCopy";
import { scopeKey, type ScopeStreamType } from "@/utils/alerts/starterScope";

import { useStarterScopeOptions } from "./libraryPaneData";

const props = defineProps<{ modelValue: StarterScope }>();
const emit = defineEmits<{ (e: "update:modelValue", value: StarterScope): void }>();

const { t } = useI18nTyped();
const { built, streams, pending } = useStarterScopeOptions();

const STREAM_TYPE_LABEL: Record<ScopeStreamType, I18nKey> = {
  logs: "common.logs",
  metrics: "common.metrics",
  traces: "common.traces",
};

const EVERY: StarterScope = { kind: "all" };

const selectedKey = computed(() => scopeKey(props.modelValue));

const choice = (scope: StarterScope, name: string, suffix?: ScopeStreamType): SelectOption => ({
  value: scopeKey(scope),
  label: t("alertStarter.library.scopeFor", { name: raw(name) }),
  listLabel: raw(name),
  ...(suffix ? { suffix: t(STREAM_TYPE_LABEL[suffix]) } : {}),
  scope,
});

const header = (label: string, count: number): SelectOption => ({
  header: true,
  label: raw(label),
  headerCount: formatNumber(count),
});

/** The current scope is always listed, so the trigger names it even before the lists arrive. */
const currentName = (scope: StarterScope) =>
  scope.kind === "stream" ? scope.streamName : scope.kind === "service" ? scope.service : "";

const options = computed<SelectOption[]>(() => {
  const list: SelectOption[] = [
    {
      value: scopeKey(EVERY),
      label: t("alertStarter.library.scopeEvery"),
      listLabel: t("alertStarter.library.scopeEveryItem"),
      scope: EVERY,
    },
  ];
  const { services, dimensions } = built.value;
  if (services.length) {
    list.push(header(t("alertStarter.library.scopeServices"), services.length));
    services.forEach((option) => list.push(choice(option.scope, option.label)));
  }
  for (const group of dimensions) {
    list.push(header(group.label, group.options.length));
    group.options.forEach((option) => list.push(choice(option.scope, option.label)));
  }
  if (streams.value.length) {
    list.push(header(t("alertStarter.library.scopeStreams"), streams.value.length));
    streams.value.forEach(({ type, name }) =>
      list.push(choice({ kind: "stream", streamType: type, streamName: name }, name, type)),
    );
  }
  if (!list.some((option) => option.value === selectedKey.value)) {
    const scope = props.modelValue;
    list.push(choice(scope, currentName(scope)));
  }
  return list;
});

const onPick = (value: SelectModelValue) => {
  const picked = options.value.find((option) => !option.header && option.value === value);
  if (picked) emit("update:modelValue", picked.scope as StarterScope);
};
</script>
