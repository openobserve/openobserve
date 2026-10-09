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
import { toast } from "@/lib/feedback/Toast/useToast";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { environmentStartUrls, GLOBAL_ONLY } from "@/components/synthetics/variables/replayInputs";
import { namedEnvironments } from "@/components/synthetics/variables/scope";
import { atEnvironmentCap, lockedEnvironmentIds, toggleEnvironment } from "./startPillRules";
import { makeStartUrlSchema, type StartUrlForm } from "./JourneyStartPill.schema";

const FORM_ID = "synthetics-journey-start-pill-url-form";
// Past either limit the names collapse to "first +N"; the tooltip keeps the full list.
const ENV_LABEL_MAX_NAMES = 2;
const ENV_LABEL_MAX_CHARS = 24;

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

const lockedIds = computed(() => lockedEnvironmentIds(props.selectedIds, named.value));
const atCap = computed(() => atEnvironmentCap(props.selectedIds));
const selectedCount = computed(() => props.selectedIds.length);

// An environment the author cannot read is named by its id, as the picker lists it.
const selectedNames = computed(() =>
  props.selectedIds.map((id) => named.value.find((env) => env.id === id)?.name ?? id),
);
const envsFullLabel = computed(() =>
  selectedNames.value.length
    ? raw(selectedNames.value.join(", "))
    : t("synthetics.journey.replayValues.global"),
);
const envsCollapsed = computed(
  () =>
    selectedNames.value.length > ENV_LABEL_MAX_NAMES ||
    (selectedNames.value.length > 1 && envsFullLabel.value.length > ENV_LABEL_MAX_CHARS),
);
const envsLabel = computed(() =>
  envsCollapsed.value
    ? t("synthetics.journey.startPill.envOverflow", {
        first: selectedNames.value[0],
        count: selectedNames.value.length - 1,
      })
    : envsFullLabel.value,
);
const envsTooltip = computed(() =>
  envsCollapsed.value ? envsFullLabel.value : t("synthetics.journey.startPill.editEnvironments"),
);

const schema = makeStartUrlSchema(t);
const form = useOForm<StartUrlForm>({
  defaultValues: { url: props.url },
  schema,
  onSubmit: (values) => {
    const next = values.url.trim();
    if (next !== props.url) emit("update:url", next);
  },
});

const urlDraft = form.useStore((state) => state.values.url);

watch(urlOpen, (open) => {
  if (open) form.reset({ url: props.url });
  else warnIfDraftDropped();
});

// No Apply: every valid edit goes to the check at once and the page's Save persists it.
watch(urlDraft, () => {
  if (urlOpen.value) void form.handleSubmit();
});

// Closing discards an invalid draft, so the author has to hear that the check kept its old URL.
function warnIfDraftDropped() {
  const draft = urlDraft.value ?? "";
  if (draft.trim() === props.url) return;
  const parsed = schema.safeParse({ url: draft });
  if (parsed.success) return;
  toast({
    variant: "warning",
    message: t("synthetics.journey.startPill.urlNotChanged", {
      reason: parsed.error.issues[0]?.message ?? "",
    }),
  });
}

function onToggleEnvironment(id: string) {
  emit("update:selected-ids", toggleEnvironment(props.selectedIds, id));
}
</script>

<template>
  <div class="flex items-center gap-2">
    <OPopover
      v-model:open="urlOpen"
      :aria-label="t('synthetics.journey.startPill.urlTitle')"
      content-class="w-[min(26rem,calc(100vw-1.5rem))] p-3"
    >
      <template #trigger>
        <OButton
          variant="outline"
          size="xs"
          :disabled="disabled"
          :aria-label="t('synthetics.journey.startPill.urlAria', { url })"
          data-test="synthetics-journey-start-pill-url"
        >
          <!-- First child so it anchors to the whole button rather than the URL text. -->
          <OTooltip :content="t('synthetics.journey.startPill.editUrl')" side="bottom" />
          <OIcon name="language" size="sm" aria-hidden="true" />
          <span v-if="url" class="max-w-72 truncate font-mono font-normal max-md:hidden">{{
            url
          }}</span>
          <span v-else class="font-normal max-md:hidden">{{
            t("synthetics.journey.startPill.noUrl")
          }}</span>
          <OIcon
            name="edit"
            size="sm"
            class="text-text-secondary max-md:hidden"
            aria-hidden="true"
          />
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
            <!-- The filled-in URL can hold secure variable values, so it never gets a hover reveal. -->
            <OTruncatedText class="text-text-secondary font-mono" :tooltip="false">{{
              row.url
            }}</OTruncatedText>
          </div>
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
          size="xs"
          :disabled="disabled"
          :aria-label="
            t('synthetics.journey.startPill.envAria', { count: selectedCount }, selectedCount)
          "
          data-test="synthetics-journey-start-pill-envs"
        >
          <!-- First child so it anchors to the whole button rather than the names. -->
          <OTooltip :content="envsTooltip" side="bottom" />
          <OIcon name="layers" size="sm" aria-hidden="true" />
          <span class="text-text-secondary font-normal max-md:hidden">
            {{ t("synthetics.journey.startPill.runsIn") }}
          </span>
          <span
            class="max-w-60 truncate max-md:hidden"
            data-test="synthetics-journey-start-pill-envs-label"
            >{{ envsLabel }}</span
          >
          <OIcon name="arrow-drop-down" size="sm" class="max-md:hidden" aria-hidden="true" />
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
              :model-value="selectedIds.includes(env.id)"
              :label="raw(env.name)"
              :disabled="atCap && !selectedIds.includes(env.id)"
              :data-test="`synthetics-journey-start-pill-env-${env.name}`"
              @update:model-value="onToggleEnvironment(env.id)"
            />
            <!-- The filled-in URL can hold secure variable values, so it never gets a hover reveal. -->
            <OTruncatedText class="text-text-secondary font-mono text-xs" :tooltip="false">
              {{ namedUrls.get(env.id) }}
            </OTruncatedText>
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
        <span class="text-text-secondary text-xs">
          {{
            t("synthetics.journey.startPill.capLine", {
              count: selectedCount,
              cap: MAX_CHECK_ENVIRONMENTS,
            })
          }}
        </span>
      </div>
    </OPopover>
  </div>
</template>
