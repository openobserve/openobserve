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
  <OPageLayout
    :title="t('synthetics.locations.importTitle')"
    :back="{
      label: t('synthetics.locations.title'),
      onClick: handleBack,
      dataTest: 'synthetics-locations-import-back-btn',
    }"
    bleed
  >
    <template #actions>
      <OButton
        variant="outline"
        size="sm-action"
        @click="handleBack"
        data-test="synthetics-locations-import-cancel-btn"
        >{{ t("function.cancel") }}</OButton
      >
      <OButton
        variant="primary"
        size="sm-action"
        type="submit"
        @click="handleImport"
        :loading="isImporting"
        :disabled="isImporting || !parsedLocations.length"
        data-test="synthetics-locations-import-json-btn"
        >{{ t("dashboard.import") }}</OButton
      >
    </template>

    <div class="flex min-h-0 flex-1 gap-0">
      <!-- Left: JSON input area -->
      <div class="flex min-h-0 flex-1 flex-col p-4">
        <div class="text-text-heading mb-2 text-sm font-semibold">
          {{ t("synthetics.locations.importJsonLabel") }}
        </div>
        <textarea
          v-model="jsonString"
          class="rounded-default border-input-border bg-input-bg min-h-0 w-full flex-1 resize-none border p-3 font-mono text-sm"
          :placeholder="t('synthetics.locations.importPlaceholder')"
          data-test="synthetics-locations-import-json-input"
          @input="scheduleParse"
        />
        <div class="mt-2">
          <OButton
            variant="outline"
            size="sm"
            @click="triggerFileUpload"
            data-test="synthetics-locations-import-file-btn"
          >
            {{ t("synthetics.locations.uploadFile") }}
          </OButton>
          <input
            ref="fileInputRef"
            type="file"
            accept=".json"
            class="hidden"
            @change="handleFileChange"
          />
        </div>
      </div>

      <!-- Right: preview & results -->
      <div class="border-border-default flex min-h-0 flex-1 flex-col border-l p-4">
        <div class="text-text-heading mb-2 text-sm font-semibold">
          {{ t("synthetics.locations.preview") }}
          <span v-if="parsedLocations.length" class="text-text-secondary ml-1 font-normal">
            ({{ parsedLocations.length }})
          </span>
        </div>
        <OSeparator class="mb-2 shrink-0" />

        <!-- Validation errors -->
        <div v-if="validationErrors.length" class="mb-3 shrink-0">
          <div
            v-for="(err, idx) in validationErrors"
            :key="idx"
            class="text-status-negative py-1 text-sm"
            :data-test="`synthetics-locations-import-error-${idx}`"
          >
            {{ err }}
          </div>
        </div>

        <!-- Preview list -->
        <div class="min-h-0 flex-1 overflow-auto">
          <div
            v-for="(loc, idx) in parsedLocations"
            :key="idx"
            class="border-border-subtle flex items-center gap-2 border-b py-1.5 text-sm"
          >
            <span class="text-text-secondary w-6 text-xs">{{ idx + 1 }}.</span>
            <span class="font-medium">{{ loc.label || "-" }}</span>
            <span class="text-text-secondary text-xs">{{ loc.id || "-" }}</span>
            <span class="text-text-secondary text-xs">({{ loc.provider }})</span>
          </div>
          <div v-if="!parsedLocations.length" class="text-text-secondary py-4 text-sm">
            {{ t("synthetics.locations.noPreview") }}
          </div>
        </div>

        <!-- Import results -->
        <div v-if="importResults.length" class="mt-3 shrink-0">
          <OSeparator class="mb-2" />
          <div
            v-for="(result, idx) in importResults"
            :key="idx"
            class="py-1 text-sm"
            :class="result.ok ? 'text-green' : 'text-status-negative'"
            :data-test="`synthetics-locations-import-result-${idx}`"
          >
            {{ result.ok ? "✓" : "✗" }} {{ result.label || result.id }}
            <span v-if="!result.ok" class="text-xs"> — {{ result.error }}</span>
          </div>
        </div>
      </div>
    </div>
  </OPageLayout>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import syntheticsService from "@/services/synthetics";

interface ImportResult {
  id?: string;
  label?: string;
  ok: boolean;
  error?: string;
}

export default defineComponent({
  name: "ImportSyntheticsLocations",
  emits: ["cancel:hideform", "update:list"],
  components: {
    OPageLayout,
    OButton,
    OSeparator,
  },
  setup(_props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();

    const jsonString = ref("");
    const fileInputRef = ref<HTMLInputElement | null>(null);
    const isImporting = ref(false);
    const parsedLocations = ref<any[]>([]);
    const validationErrors = ref<string[]>([]);
    const importResults = ref<ImportResult[]>([]);

    const parseAndValidate = () => {
      validationErrors.value = [];
      parsedLocations.value = [];
      importResults.value = [];

      if (!jsonString.value.trim()) return;

      try {
        const parsed = JSON.parse(jsonString.value);
        const items = Array.isArray(parsed) ? parsed : [parsed];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const idx = i + 1;

          if (!item.provider || typeof item.provider !== "string") {
            validationErrors.value.push(
              t("synthetics.locations.importProviderRequired", { index: idx }),
            );
            continue;
          }
          if (!item.region || typeof item.region !== "string") {
            validationErrors.value.push(
              t("synthetics.locations.importRegionRequired", { index: idx }),
            );
            continue;
          }
          if (!item.label || typeof item.label !== "string") {
            validationErrors.value.push(
              t("synthetics.locations.importLabelRequired", { index: idx }),
            );
            continue;
          }

          const id = `${item.provider}-${item.region}`;
          parsedLocations.value.push({
            kind: "public",
            id,
            provider: item.provider,
            region: item.region,
            label: item.label,
            enabled: item.enabled ?? true,
          });
        }
      } catch (e: any) {
        validationErrors.value.push(e.message || t("synthetics.locations.invalidJson"));
      }
    };

    const handleImport = async () => {
      if (!parsedLocations.value.length) {
        parseAndValidate();
        return;
      }

      isImporting.value = true;
      try {
        const response = await syntheticsService.createLocation(
          store.state.selectedOrganization.identifier,
          { locations: parsedLocations.value },
        );

        if (response.data?.results) {
          importResults.value = response.data.results.map((r: any) => ({
            id: r.id,
            label: r.label,
            ok: r.ok,
            error: r.error,
          }));
        }

        const successCount = importResults.value.filter((r) => r.ok).length;
        if (successCount === parsedLocations.value.length) {
          toast({
            message: t("synthetics.locations.importSuccess", { count: successCount }),
            variant: "success",
          });
          setTimeout(() => {
            emit("update:list");
            emit("cancel:hideform");
          }, 400);
        }
      } catch (error: any) {
        toast({
          message: error?.response?.data?.message || t("synthetics.locations.importFailed"),
          variant: "error",
        });
      } finally {
        isImporting.value = false;
      }
    };

    const triggerFileUpload = () => {
      fileInputRef.value?.click();
    };

    const handleFileChange = (event: Event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        jsonString.value = e.target?.result as string;
        parseAndValidate();
      };
      reader.readAsText(file);
      // Reset so the same file can be re-uploaded
      input.value = "";
    };

    const handleBack = () => {
      emit("cancel:hideform");
    };

    // Re-validate on jsonString change (debounced by user typing pace)
    let parseTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleParse = () => {
      if (parseTimer) clearTimeout(parseTimer);
      parseTimer = setTimeout(parseAndValidate, 300);
    };

    return {
      t,
      store,
      router,
      jsonString,
      fileInputRef,
      isImporting,
      parsedLocations,
      validationErrors,
      importResults,
      handleImport,
      triggerFileUpload,
      handleFileChange,
      handleBack,
      scheduleParse,
    };
  },
});
</script>
