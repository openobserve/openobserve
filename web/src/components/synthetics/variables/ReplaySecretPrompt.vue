<!--
Copyright 2026 OpenObserve Inc.

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

Replay substitutes in the browser, so any value it could use is a value the
page could read - the same property as write-only, with the sign flipped. A
shared secret therefore has no value here, and the honest options are to ask or
to let it type as literal text. This asks.
-->

<template>
  <ODialog
    :open="open"
    @update:open="$emit('update:open', $event)"
    :title="t('synthetics.replaySecrets.title')"
    data-test="synthetics-replay-secret-prompt"
  >
    <div class="flex flex-col gap-3">
      <p class="text-text-secondary text-sm">{{ t("synthetics.replaySecrets.description") }}</p>

      <div v-for="name in names" :key="name" class="flex flex-col gap-1">
        <label class="font-mono text-sm" :for="`replay-secret-${name}`">{{ name }}</label>
        <OInput
          :id="`replay-secret-${name}`"
          v-model="values[name]"
          type="password"
          :placeholder="t('synthetics.replaySecrets.valuePlaceholder')"
          :data-test="`synthetics-replay-secret-${name}`"
        />
      </div>

      <OCheckbox v-model="remember" data-test="synthetics-replay-secret-remember">
        {{ t("synthetics.replaySecrets.remember") }}
      </OCheckbox>
      <p class="text-text-secondary text-xs">{{ t("synthetics.replaySecrets.rememberHint") }}</p>
    </div>

    <template #footer>
      <!-- Skipping is legitimate: an unsupplied secret types as literal text,
           so the replay still runs and fails where the value was needed. -->
      <OButton variant="outline" size="sm" data-test="synthetics-replay-secret-skip" @click="skip">
        {{ t("synthetics.replaySecrets.skip") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm"
        data-test="synthetics-replay-secret-confirm"
        @click="submit"
        >{{ t("synthetics.replaySecrets.confirm") }}</OButton
      >
    </template>
  </ODialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { rememberReplaySecret } from "./replaySecrets";

const props = defineProps<{ open: boolean; names: string[] }>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  supplied: [values: Record<string, string>];
}>();

const { t } = useI18nTyped();
const values = ref<Record<string, string>>({});
const remember = ref(false);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    // Never carry typed credentials between openings.
    values.value = Object.fromEntries(props.names.map((n) => [n, ""]));
    remember.value = false;
  },
);

function submit() {
  const supplied = Object.fromEntries(Object.entries(values.value).filter(([, v]) => v.length > 0));
  // In memory only, for this tab. See `replaySecrets.ts` for why not storage.
  if (remember.value) {
    for (const [name, value] of Object.entries(supplied)) rememberReplaySecret(name, value);
  }
  emit("supplied", supplied);
  emit("update:open", false);
  values.value = {};
}

function skip() {
  emit("supplied", {});
  emit("update:open", false);
  values.value = {};
}
</script>
