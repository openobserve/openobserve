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

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { SyntheticsEnvironment, SyntheticsVariable } from "@/types/synthetics";
import { MAX_CHECK_ENVIRONMENTS } from "@/constants/synthetics";
import OButton from "@/lib/core/Button/OButton.vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { environmentStartUrls, GLOBAL_ONLY } from "@/components/synthetics/variables/replayInputs";
import { namedEnvironments } from "@/components/synthetics/variables/scope";
import { atEnvironmentCap, lockedEnvironmentIds, toggleEnvironment } from "./startPillRules";
import { makeStartUrlSchema, type StartUrlForm } from "./JourneyStartPill.schema";

const FORM_ID = "synthetics-journey-start-pill-url-form";

const props = defineProps<{
  /** The check's Starting URL as written, placeholders included. */
  url: string;
  environments: SyntheticsEnvironment[];
  selectedIds: string[];
  checkVariables: { name: string; value: string }[];
  globals: SyntheticsVariable[];
  disabled: boolean;
}>();

const emit = defineEmits<{
  "update:url": [value: string];
  "update:selected-ids": [value: string[]];
}>();

const { t } = useI18nTyped();

const urlOpen = ref(false);
const envsOpen = ref(false);
const draftIds = ref<string[]>([]);

const named = computed(() => namedEnvironments(props.environments));

function urlsFor(ids: string[]): Map<string, string> {
  const resolved = environmentStartUrls(
    props.url,
    props.checkVariables,
    props.environments,
    props.globals,
    ids,
  );
  return new Map(resolved.map((r) => [r.id, r.url]));
}

const namedUrls = computed(() => urlsFor(named.value.map((env) => env.id)));

/** What the URL popover lists: each selected readable environment, or Global when none is selected. */
const opensIn = computed(() => {
  if (props.selectedIds.length === 0) {
    const url = urlsFor([GLOBAL_ONLY]).get(GLOBAL_ONLY) ?? "";
    return [{ id: "global", name: t("synthetics.journey.replayValues.global"), url }];
  }
  return props.selectedIds.flatMap((id) => {
    const env = named.value.find((e) => e.id === id);
    return env ? [{ id, name: raw(env.name), url: namedUrls.value.get(id) ?? "" }] : [];
  });
});

const lockedIds = computed(() => lockedEnvironmentIds(draftIds.value, named.value));
const atCap = computed(() => atEnvironmentCap(draftIds.value));

function envName(id: string) {
  return raw(named.value.find((env) => env.id === id)?.name ?? id);
}

const envSummary = computed(() => {
  const ids = props.selectedIds;
  if (ids.length === 0) {
    return {
      label: t("synthetics.journey.startPill.inGlobalOnly"),
      aria: t("synthetics.journey.startPill.summaryGlobalOnly"),
    };
  }
  if (ids.length === 1) {
    const name = envName(ids[0]);
    return {
      label: t("synthetics.journey.startPill.inOne", { name }),
      aria: t("synthetics.journey.startPill.summaryOne", { name }),
    };
  }
  return {
    label: t("synthetics.journey.startPill.inCount", { count: ids.length }, ids.length),
    aria: t("synthetics.journey.startPill.summaryCount", { count: ids.length }, ids.length),
  };
});

const form = useOForm<StartUrlForm>({
  defaultValues: { url: props.url },
  schema: makeStartUrlSchema(t),
  onSubmit: (values) => {
    emit("update:url", values.url.trim());
    urlOpen.value = false;
  },
});

watch(urlOpen, (open) => {
  if (open) form.reset({ url: props.url });
});

watch(envsOpen, (open) => {
  if (open) draftIds.value = [...props.selectedIds];
});

function applyEnvironments() {
  emit("update:selected-ids", [...draftIds.value]);
  envsOpen.value = false;
}
</script>

<template>
  <OButtonGroup radius="sm">
    <OPopover
      v-model:open="urlOpen"
      :aria-label="t('synthetics.journey.startPill.urlTitle')"
      content-class="w-[min(26rem,calc(100vw-1.5rem))] p-3"
    >
      <template #trigger>
        <OButton
          variant="outline"
          size="sm"
          :disabled="disabled"
          :aria-label="t('synthetics.journey.startPill.urlAria', { url })"
          data-test="synthetics-journey-start-pill-url"
        >
          <OIcon name="language" size="sm" aria-hidden="true" />
          <span>{{ t("synthetics.journey.startRowLabel") }}</span>
          <span v-if="url" class="max-w-72 truncate font-mono">{{ url }}</span>
          <span v-else>{{ t("synthetics.journey.startPill.noUrl") }}</span>
          <OIcon name="edit" size="sm" aria-hidden="true" />
          <OTooltip :content="t('synthetics.journey.startPill.editUrl')" side="bottom" />
        </OButton>
      </template>
      <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <span class="text-text-heading text-sm font-semibold">
            {{ t("synthetics.journey.startPill.urlTitle") }}
          </span>
          <span class="text-text-secondary text-xs">
            {{ t("synthetics.journey.startPill.urlHelp") }}
          </span>
        </div>
        <OFormInput
          name="url"
          class="font-mono"
          :aria-label="t('synthetics.journey.startPill.urlTitle')"
          data-test="synthetics-journey-start-pill-url-input"
        />
        <div class="flex flex-col gap-1">
          <span class="text-text-secondary text-xs">
            {{ t("synthetics.journey.startPill.opensIn") }}
          </span>
          <div v-for="row in opensIn" :key="row.id" class="flex min-w-0 items-center gap-2 text-xs">
            <span class="text-text-body shrink-0">{{ row.name }}</span>
            <span class="text-text-secondary truncate font-mono">{{ row.url }}</span>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            data-test="synthetics-journey-start-pill-url-cancel"
            @click="urlOpen = false"
          >
            {{ t("common.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            type="submit"
            data-test="synthetics-journey-start-pill-url-apply"
          >
            {{ t("common.apply") }}
          </OButton>
        </div>
      </OForm>
    </OPopover>

    <OPopover
      v-model:open="envsOpen"
      :aria-label="t('synthetics.journey.startPill.envTitle')"
      content-class="w-[min(26rem,calc(100vw-1.5rem))] p-3"
    >
      <template #trigger>
        <OButton
          variant="outline"
          size="sm"
          :disabled="disabled"
          :aria-label="t('synthetics.journey.startPill.envAria', { summary: envSummary.aria })"
          data-test="synthetics-journey-start-pill-envs"
        >
          <span>{{ envSummary.label }}</span>
          <OIcon name="arrow-drop-down" size="sm" aria-hidden="true" />
          <OTooltip :content="t('synthetics.journey.startPill.editEnvironments')" side="bottom" />
        </OButton>
      </template>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <span class="text-text-heading text-sm font-semibold">
            {{ t("synthetics.environments.cardTitle") }}
          </span>
          <span class="text-text-secondary text-xs">
            {{ t("synthetics.journey.startPill.envHelp") }}
          </span>
        </div>
        <div class="flex flex-col gap-2">
          <div v-for="env in named" :key="env.id" class="flex min-w-0 items-center gap-2">
            <OCheckbox
              :model-value="draftIds.includes(env.id)"
              :label="raw(env.name)"
              :disabled="atCap && !draftIds.includes(env.id)"
              :data-test="`synthetics-journey-start-pill-env-${env.name}`"
              @update:model-value="draftIds = toggleEnvironment(draftIds, env.id)"
            />
            <span class="text-text-secondary truncate font-mono text-xs">
              {{ namedUrls.get(env.id) }}
            </span>
          </div>
          <div
            v-for="id in lockedIds"
            :key="id"
            class="flex min-w-0 items-center gap-2"
            data-test="synthetics-journey-start-pill-env-locked"
          >
            <OCheckbox :model-value="true" :label="raw(id)" disabled />
            <OIcon name="lock" size="sm" class="text-text-secondary" aria-hidden="true" />
            <span class="text-text-secondary text-xs">
              {{ t("synthetics.journey.startPill.noAccess") }}
            </span>
          </div>
        </div>
        <div class="text-text-secondary flex flex-col gap-1 text-xs">
          <span>
            {{
              t("synthetics.journey.startPill.capLine", {
                count: draftIds.length,
                cap: MAX_CHECK_ENVIRONMENTS,
              })
            }}
          </span>
          <span>{{ t("synthetics.journey.startPill.replayNote") }}</span>
        </div>
        <div class="flex justify-end gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            data-test="synthetics-journey-start-pill-envs-cancel"
            @click="envsOpen = false"
          >
            {{ t("common.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            data-test="synthetics-journey-start-pill-envs-apply"
            @click="applyEnvironments"
          >
            {{ t("common.apply") }}
          </OButton>
        </div>
      </div>
    </OPopover>
  </OButtonGroup>
</template>
