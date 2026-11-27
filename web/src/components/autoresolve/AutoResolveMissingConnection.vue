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
  <section
    class="rounded-surface flex min-w-0 flex-col gap-2 border px-4 py-3"
    :class="OUTCOME_TONE_CLASS.warning"
    data-test="autoresolve-missing-connection"
  >
    <h3 class="text-status-warning-text m-0 flex min-w-0 items-start gap-2 text-sm font-semibold">
      <OIcon name="warning" size="sm" class="mt-0.5 shrink-0" />
      <span class="min-w-0 wrap-anywhere" data-test="autoresolve-missing-connection-title">
        {{ title }}
      </span>
    </h3>
    <p
      v-if="missing.action.trim()"
      class="text-text-body text-compact m-0 wrap-anywhere whitespace-pre-wrap"
      data-test="autoresolve-missing-connection-action"
    >
      {{ action }}
    </p>
    <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <OButton
        variant="primary"
        size="sm-action"
        icon-left="link"
        :disabled="blocked"
        data-test="autoresolve-missing-connection-add"
        @click="dialogOpen = true"
      >
        {{ t("autoresolve.missing.add", { mcp }) }}
      </OButton>
      <span
        v-if="help"
        class="text-text-secondary min-w-0 text-xs wrap-anywhere"
        data-test="autoresolve-missing-connection-help"
      >
        {{ help }}
      </span>
    </div>
    <AutoResolveAddConnectionDialog
      v-if="!blocked"
      v-model:open="dialogOpen"
      :run="run"
      :missing="missing"
      @added="emit('added')"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import AutoResolveAddConnectionDialog from "@/components/autoresolve/AutoResolveAddConnectionDialog.vue";
import type { AutoResolveMissingConnection, AutoResolveRun } from "@/services/autoresolve";
import { useI18nTyped } from "@/types/i18n";
import {
  cannotAddConnectionText,
  OUTCOME_TONE_CLASS,
  sentenceStart,
  theMcps,
} from "@/utils/autoresolve/autoresolveText";

const props = defineProps<{
  run: AutoResolveRun;
  missing: AutoResolveMissingConnection;
}>();

const emit = defineEmits<{ added: [] }>();

const { t } = useI18nTyped();
const dialogOpen = ref(false);

const mcp = computed(() => theMcps([props.missing.name], t));
const title = computed(() =>
  props.run.autoresolve
    ? t("autoresolve.missing.title", { mcp: mcp.value })
    : t("autoresolve.missing.titleRun", { mcp: mcp.value }),
);

const action = computed(() => sentenceStart(props.missing.action.trim()));

const blocked = computed(() => !props.missing.can_add || !!props.missing.cannot_add_reason?.trim());

// A person who may not add it reads why; one who may reads what else the run offers.
// An ended run's outcome card already says nothing was changed.
const help = computed(() => {
  if (blocked.value) return cannotAddConnectionText(props.missing, t);
  if (props.run.state === "no_change") return null;
  const count = props.run.plan?.options.length ?? 0;
  return t("autoresolve.missing.orPartial", { count }, count);
});
</script>
