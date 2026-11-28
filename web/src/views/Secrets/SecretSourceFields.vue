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

<!-- Local (typed) or external (read from a connected backend) value, inside a parent OForm. -->
<template>
  <slot v-if="!offerExternal" />
  <template v-else>
    <OFormRadioGroup
      name="source"
      orientation="horizontal"
      :label="t('secrets.external.source')"
      data-test="secret-source-mode"
    >
      <ORadio value="local" :label="t('secrets.sourceLocal')" />
      <ORadio value="external" :label="t('secrets.sourceExternal')" />
    </OFormRadioGroup>
    <slot v-if="source !== 'external'" />
    <div v-else class="flex flex-col gap-3" data-test="secret-source-external">
      <OFormSelect
        name="backend_id"
        required
        :label="t('secrets.external.backend')"
        :options="backendOptions"
        data-test="secret-source-backend"
      />
      <OFormInput
        name="locator"
        required
        autocomplete="off"
        :label="t('secrets.external.locator')"
        :help-text="t('secrets.external.locatorHint')"
        data-test="secret-source-locator"
      />
      <div class="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <OFormSelect
          name="version"
          :label="t('secrets.external.version')"
          :options="versionOptions"
          data-test="secret-source-version"
        />
        <OFormInput
          v-if="version !== 'latest'"
          name="version_ref"
          required
          autocomplete="off"
          :label="
            version === 'stage' ? t('secrets.external.stage') : t('secrets.external.versionId')
          "
          data-test="secret-source-version-ref"
        />
      </div>
      <OFormInput
        name="json_key"
        autocomplete="off"
        :label="t('secrets.external.jsonKey')"
        :help-text="t('secrets.external.jsonKeyHint')"
        data-test="secret-source-json-key"
      />
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import OFormRadioGroup from "@/lib/forms/Radio/OFormRadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import type { SecretKind } from "@/services/secrets";
import { secretBackendsQuery } from "@/services/secretBackends.queries";

const props = defineProps<{ kind: SecretKind }>();
const { t } = useI18nTyped();
const orgId = useOrgId();
const form = inject(FORM_CONTEXT_KEY, null);

interface SourceValues {
  values: { source?: string; version?: string };
}
const source = form ? form.useStore((s: SourceValues) => s.values.source) : computed(() => "local");
const version = form
  ? form.useStore((s: SourceValues) => s.values.version)
  : computed(() => "latest");

// Only secrets take a pointer; a 403 on the backend list just leaves the value local.
const backends = useQuery(() =>
  Object.assign(secretBackendsQuery(orgId.value), {
    enabled: !!orgId.value && props.kind === "secret",
  }),
);
const backendOptions = computed(() =>
  (backends.data.value ?? []).map((b) => ({ label: raw(b.name), value: b.id })),
);
const offerExternal = computed(() => props.kind === "secret" && backendOptions.value.length > 0);
const versionOptions = [
  { label: t("secrets.external.latest"), value: "latest" },
  { label: t("secrets.external.stage"), value: "stage" },
  { label: t("secrets.external.versionId"), value: "id" },
];
</script>
