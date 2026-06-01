<template>
  <div class="eval-dialog" role="dialog" aria-modal="true" @click.self="$emit('cancel')">
    <form class="eval-dialog__panel" @submit.prevent="save">
      <div class="eval-dialog__head">
        <div>
          <h2>{{ mode === "create" ? t("onlineEvals.scoreConfig.createTitle") : t("onlineEvals.scoreConfig.editTitle") }}</h2>
          <p>{{ t("onlineEvals.scoreConfig.subtitle") }}</p>
        </div>
        <OButton type="button" icon-left="close" variant="ghost" size="icon-sm" @click="$emit('cancel')" />
      </div>

      <div class="eval-dialog__content">
        <label>
          {{ t("onlineEvals.scoreConfig.nameLabel") }}
          <input v-model.trim="form.name" required />
        </label>
        <label>
          {{ t("onlineEvals.scoreConfig.dataTypeLabel") }}
          <select v-model="form.dataType" :disabled="mode === 'edit'">
            <option value="numeric">{{ t("onlineEvals.scoreConfig.dataTypes.numeric") }}</option>
            <option value="categorical">{{ t("onlineEvals.scoreConfig.dataTypes.categorical") }}</option>
            <option value="boolean">{{ t("onlineEvals.scoreConfig.dataTypes.boolean") }}</option>
          </select>
        </label>
        <label class="eval-dialog__wide">
          {{ t("onlineEvals.scoreConfig.descriptionLabel") }}
          <input v-model.trim="form.description" />
        </label>
        <label>
          {{ t("onlineEvals.scoreConfig.numericRangeLabel") }}
          <textarea v-model="form.numericRange" rows="4" />
        </label>
        <label>
          {{ t("onlineEvals.scoreConfig.categoriesLabel") }}
          <textarea v-model="form.categories" rows="4" />
        </label>
        <label class="eval-dialog__wide">
          {{ t("onlineEvals.scoreConfig.healthyThresholdLabel") }}
          <textarea v-model="form.healthyThreshold" rows="4" />
        </label>
      </div>

      <div class="eval-dialog__foot">
        <OButton type="button" variant="outline" @click="$emit('cancel')">{{ t("onlineEvals.buttons.cancel") }}</OButton>
        <OButton type="submit" :loading="isSaving">
          {{ mode === "create" ? t("onlineEvals.buttons.create") : t("onlineEvals.buttons.save") }}
        </OButton>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService, { type ScoreConfig } from "@/services/online-evals.service";
import { dataTypeOf, entityId, valueOf } from "../utils/evalEntity";
import { parseOptionalJson, showError, stringifyJson } from "../utils/evalFormat";

const props = defineProps<{
  orgId: string;
  mode: "create" | "edit";
  row: ScoreConfig | null;
}>();

const emit = defineEmits<{
  (e: "saved"): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();
const form = ref(initForm(props.row));
const isSaving = ref(false);

function initForm(row: ScoreConfig | null) {
  if (!row) {
    return {
      name: "",
      dataType: "numeric",
      description: "",
      numericRange: '{\n  "min": 0,\n  "max": 1\n}',
      categories: "",
      healthyThreshold: '{\n  "direction": "gte",\n  "value": 0.8\n}',
    };
  }
  return {
    name: row.name,
    dataType: dataTypeOf(row),
    description: row.description || "",
    numericRange: stringifyJson(valueOf(row, "numericRange", "numeric_range")),
    categories: stringifyJson(row.categories),
    healthyThreshold: stringifyJson(valueOf(row, "healthyThreshold", "healthy_threshold")),
  };
}

async function save() {
  if (!props.orgId) return;
  isSaving.value = true;
  try {
    const basePayload: Record<string, any> = {
      name: form.value.name,
      description: form.value.description || null,
      numericRange: parseOptionalJson(form.value.numericRange, t("onlineEvals.scoreConfig.numericRangeLabel")),
      categories: parseOptionalJson(form.value.categories, t("onlineEvals.scoreConfig.categoriesLabel")),
      healthyThreshold: parseOptionalJson(form.value.healthyThreshold, t("onlineEvals.scoreConfig.healthyThresholdLabel")),
    };

    if (props.mode === "edit" && props.row) {
      await onlineEvalsService.scoreConfigs.update(props.orgId, entityId(props.row), basePayload);
    } else {
      await onlineEvalsService.scoreConfigs.create(props.orgId, {
        ...basePayload,
        dataType: form.value.dataType,
      });
    }
    toast({
      variant: "success",
      message: t("onlineEvals.saved", { label: t("onlineEvals.singular.scoreConfigs") }),
    });
    emit("saved");
  } catch (err: any) {
    showError(err, t("onlineEvals.scoreConfig.saveError"));
  } finally {
    isSaving.value = false;
  }
}
</script>
