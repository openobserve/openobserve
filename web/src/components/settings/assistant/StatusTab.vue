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
  <div class="flex flex-col gap-4" data-test="settings-assistant-status-tab">
    <AssistantStatusCard
      :capabilities="capabilities.data.value ?? null"
      :status="status"
      :config="config"
      :is-admin="page.isAdmin.value"
      :test-state="testState"
      :data-level="dataLevel"
      @test="runTest"
      @retry="refresh"
      @open-access="openAccess"
    />
    <div
      v-if="page.isAdmin.value"
      class="flex flex-col gap-1"
      data-test="settings-assistant-v2-optin"
    >
      <OSwitch
        :model-value="optInLocked || optedIn"
        :label="t('assistant.settings.v2Optin')"
        :disabled="optInLocked"
        :aria-describedby="optinHelpId"
        data-test="settings-assistant-v2-optin-switch"
        @update:model-value="setOptIn"
      />
      <p :id="optinHelpId" class="text-text-secondary text-xs">
        {{
          optInLocked
            ? t("assistant.settings.v2OptinDeployment")
            : t("assistant.settings.v2OptinHelp")
        }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMutation, useQuery } from "@tanstack/vue-query";
import { computed, ref, useId } from "vue";
import { useRouter } from "vue-router";

import { toAssistantError, useAssistantName } from "@/composables/assistant";
import { ASSISTANT_V2_STORAGE_KEY, assistantV2Source } from "@/composables/assistant/flags";
import { errorTitle } from "@/composables/assistant/pure";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { capabilitiesQuery } from "@/services/assistant.queries";
import {
  assistantSettingsQuery,
  testCapabilitiesMutation,
} from "@/services/assistant_settings.queries";
import { raw, useI18nTyped } from "@/types/i18n";

import AssistantStatusCard, { type AssistantTestState } from "./AssistantStatusCard.vue";
import { useAssistantSettingsPage } from "./useAssistantSettingsPage";

const { t } = useI18nTyped();
const router = useRouter();
const page = useAssistantSettingsPage();
const name = useAssistantName();
const optinHelpId = useId();
// Only a browser opt-in can be undone here; a deployment or harness flag wins over it.
const optInLocked = assistantV2Source() !== "local";

const capabilities = useQuery(
  computed(() => capabilitiesQuery(page.org.value, page.aiEnabled.value)),
);
const settings = useQuery(computed(() => assistantSettingsQuery(page.org.value)));
const test = useMutation(() => testCapabilitiesMutation(page.org.value));

const testState = ref<AssistantTestState>("idle");
const optedIn = ref(readOptIn());

const status = computed(() => {
  if (capabilities.isPending.value && capabilities.fetchStatus.value !== "idle") return "loading";
  if (capabilities.isError.value) return "error";
  if (capabilities.data.value === null) return "unsupported";
  return "ready";
});

// A stored level only restricts anything once the agent enforces it.
const dataLevel = computed(() =>
  capabilities.data.value?.policy_enforced === true
    ? settings.data.value?.data_sharing_level
    : undefined,
);

const config = computed(() => {
  const org = settings.data.value;
  const off = org?.enabled === false;
  return {
    aiEnabled: page.aiEnabled.value,
    orgEnabled: org ? org.enabled : undefined,
    orgEnabledBy:
      off && org?.updated_by && org.updated_at
        ? { actor: org.updated_by, at: org.updated_at }
        : undefined,
  };
});

async function runTest() {
  if (testState.value === "running") return;
  testState.value = "running";
  try {
    const res = await test.mutateAsync();
    testState.value = {
      ok: res.ok,
      durationMs: res.duration_ms,
      cause: res.error ? raw(res.error) : undefined,
      at: Date.now(),
    };
  } catch (err) {
    const title = errorTitle(toAssistantError(err), { product: String(name.product) });
    testState.value = { ok: false, cause: t(title.key, title.params), at: Date.now() };
    // Invalidation runs only on success, so a thrown test refetches the stored health itself.
    void capabilities.refetch();
  }
}

async function refresh() {
  await Promise.all([capabilities.refetch(), settings.refetch()]);
}

function openAccess() {
  void router.push({
    name: "assistantSettings",
    params: { tab: "access" },
    query: { org_identifier: page.org.value },
  });
}

function readOptIn(): boolean {
  try {
    return localStorage.getItem(ASSISTANT_V2_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setOptIn(value: unknown) {
  const on = value === true;
  try {
    if (on) localStorage.setItem(ASSISTANT_V2_STORAGE_KEY, "1");
    else localStorage.removeItem(ASSISTANT_V2_STORAGE_KEY);
    optedIn.value = on;
  } catch {
    optedIn.value = readOptIn();
  }
}

defineExpose({ refresh });
</script>
