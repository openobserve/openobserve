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
  <li
    data-test="autoresolve-step-card"
    :data-state="step.state"
    class="flex min-w-0 list-none flex-col gap-2 px-4 py-3"
    :class="held ? 'bg-status-warning-bg' : ''"
  >
    <div class="flex min-w-0 items-center gap-2 max-md:flex-wrap max-md:gap-y-1">
      <span
        class="bg-surface-subtle text-text-heading text-2xs inline-flex size-5 shrink-0 items-center justify-center rounded-full font-semibold tabular-nums"
        data-test="autoresolve-step-card-seq"
      >
        {{ step.seq }}
      </span>
      <AutoResolveRemovedConnection
        v-if="step.connection.removed"
        :name="step.connection.name"
        class="min-w-0"
      />
      <OTruncatedText
        v-else
        as="span"
        class="text-text-heading text-compact min-w-0 font-semibold max-md:wrap-anywhere max-md:whitespace-normal"
      >
        {{ step.connection.name }}
      </OTruncatedText>
      <span class="text-text-secondary shrink-0" aria-hidden="true">·</span>
      <OTruncatedText
        as="span"
        class="text-text-body min-w-0 font-mono text-xs max-md:wrap-anywhere max-md:whitespace-normal"
        data-test="autoresolve-step-card-tool"
      >
        {{ step.tool }}
      </OTruncatedText>
      <span class="flex-1" />
      <OTag
        type="autoresolveStepState"
        :value="step.state"
        :label="runningFor"
        class="shrink-0 tabular-nums"
        data-test="autoresolve-step-card-state"
      />
    </div>

    <p
      v-if="held"
      class="text-status-warning-text m-0 text-xs font-semibold"
      data-test="autoresolve-step-card-held"
    >
      {{ t("autoresolve.step.held") }}
    </p>

    <div class="flex min-w-0 flex-col items-start gap-1">
      <OCodeBlock
        :code="argsText"
        :lang="argsLang"
        :max-lines="expanded ? undefined : MAX_LINES"
        chrome="editor"
        :filename="t('autoresolve.step.arguments')"
        copyable
        wrap
        padded
        data-test="autoresolve-step-card-args"
        class="my-0! w-full"
      />
      <OButton
        v-if="long"
        variant="ghost-primary"
        size="xs"
        :icon-right="expanded ? 'expand-less' : 'expand-more'"
        :aria-expanded="expanded"
        data-test="autoresolve-step-card-args-toggle"
        @click="expanded = !expanded"
      >
        {{ expanded ? t("autoresolve.step.showLess") : t("autoresolve.step.showAll") }}
      </OButton>
    </div>

    <div
      v-if="step.refs.length"
      class="flex min-w-0 flex-col gap-1"
      data-test="autoresolve-step-card-refs"
    >
      <div class="flex flex-wrap gap-1.5">
        <OTag
          v-for="ref in step.refs"
          :key="ref.arg_path"
          variant="blue-soft"
          :label="t('autoresolve.step.refChip', { arg: raw(ref.arg_path), step: ref.from_step })"
        />
      </div>
      <p class="text-text-secondary m-0 text-xs">
        {{ t("autoresolve.step.refNote", { steps: refSteps }, refStepCount) }}
      </p>
    </div>

    <ODescriptionList dense label-width="narrow">
      <ODescriptionItem :label="t('autoresolve.step.reason')">
        <AutoResolveModelText
          :text="step.reason"
          class="text-compact"
          data-test="autoresolve-step-card-reason"
        />
      </ODescriptionItem>
      <ODescriptionItem v-if="step.dry_run_after_approval" :label="t('autoresolve.step.preview')">
        <span class="text-compact" data-test="autoresolve-step-card-dry-run-after">
          {{ t("autoresolve.step.dryRunAfter") }}
        </span>
      </ODescriptionItem>
      <ODescriptionItem v-if="result?.kind === 'text'" :label="t('autoresolve.step.result')">
        <AutoResolveStepResultText :text="result.text" />
      </ODescriptionItem>
      <ODescriptionItem v-if="step.error" :label="t('autoresolve.step.error')">
        <span
          class="text-status-negative text-compact wrap-anywhere whitespace-pre-wrap"
          data-test="autoresolve-step-card-error"
          >{{ step.error }}</span
        >
      </ODescriptionItem>
    </ODescriptionList>

    <div v-if="result?.kind === 'json'" class="flex min-w-0 flex-col items-start gap-1">
      <OCodeBlock
        :code="result.text"
        lang="json"
        :max-lines="expandedResult ? undefined : RESULT_JSON_LINES"
        chrome="editor"
        :filename="t('autoresolve.step.result')"
        copyable
        wrap
        padded
        data-test="autoresolve-step-card-result-json"
        class="my-0! w-full"
      />
      <OButton
        v-if="result.long"
        variant="ghost-primary"
        size="xs"
        :icon-right="expandedResult ? 'expand-less' : 'expand-more'"
        :aria-expanded="expandedResult"
        data-test="autoresolve-step-card-result-toggle"
        @click="expandedResult = !expandedResult"
      >
        {{ expandedResult ? t("autoresolve.step.showLess") : t("autoresolve.step.showFullResult") }}
      </OButton>
    </div>

    <OCodeBlock
      v-if="step.preview && !step.dry_run_after_approval"
      :code="step.preview"
      lang="plaintext"
      chrome="editor"
      :filename="t('autoresolve.step.preview')"
      :max-lines="MAX_LINES"
      :copyable="false"
      wrap
      padded
      data-test="autoresolve-step-card-preview"
      class="my-0!"
    />
  </li>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import AutoResolveRemovedConnection from "@/components/autoresolve/AutoResolveRemovedConnection.vue";
import AutoResolveStepResultText from "@/components/autoresolve/AutoResolveStepResultText.vue";
import AutoResolveModelText from "@/components/autoresolve/AutoResolveModelText.vue";
import type { AutoResolveStep } from "@/services/autoresolve";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  RESULT_JSON_LINES,
  autoresolveDuration,
  namesSentence,
  stepResultView,
} from "@/utils/autoresolve/autoresolveText";

const MAX_LINES = 20;
// A wrapped single line can fill the capped box too, so long text also gets the full-view control.
const MAX_CHARS = MAX_LINES * 100;
/** Arguments this short read on one line; longer ones are indented. */
const ONE_LINE_MAX_CHARS = 120;

const props = defineProps<{
  step: AutoResolveStep;
  /** The page's ticking clock; a running step counts from when it was sent. */
  nowUs?: number;
}>();

const { t } = useI18nTyped();

const expanded = ref(false);
const expandedResult = ref(false);

const result = computed(() => stepResultView(props.step.result_summary));

const held = computed(() => props.step.state === "held");

const runningFor = computed(() => {
  const { state, consumed_at_us: sent } = props.step;
  if (state !== "running" || sent === null || props.nowUs === undefined) return undefined;
  return t("autoresolve.step.runningFor", {
    elapsed: autoresolveDuration(props.nowUs - sent, t),
  });
});

const argsText = computed(() => {
  const args = props.step.arguments;
  if (typeof args === "string") return args;
  const line = oneLineJson(args);
  return line.length <= ONE_LINE_MAX_CHARS ? line : JSON.stringify(args, null, 2);
});
const argsLang = computed(() => (typeof props.step.arguments === "string" ? "plaintext" : "json"));
const lineCount = computed(() => argsText.value.split("\n").length);
const long = computed(() => lineCount.value > MAX_LINES || argsText.value.length > MAX_CHARS);

function oneLineJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(oneLineJson).join(", ")}]`;
  if (value && typeof value === "object") {
    const fields = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${oneLineJson(v)}`);
    return `{${fields.join(", ")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const refStepNumbers = computed(() => [...new Set(props.step.refs.map((r) => r.from_step))]);
const refStepCount = computed(() => refStepNumbers.value.length);
const refSteps = computed(() => namesSentence(refStepNumbers.value.map(String), t));
</script>
