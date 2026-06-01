<template>
  <form class="eval-form-page" @submit.prevent="save">
    <div class="eval-form-page__top">
      <button class="eval-form-page__back" type="button" @click="$emit('cancel')">
        <OIcon name="chevron-left" size="xs" />
        {{ t("onlineEvals.provider.backTo") }}
      </button>
      <div class="eval-form-page__top-actions">
        <OButton type="button" icon-left="close" variant="ghost" size="icon-sm" @click="$emit('cancel')" />
      </div>
    </div>

    <div class="eval-form-page__head">
      <h1>{{ mode === "create" ? t("onlineEvals.provider.createTitle") : t("onlineEvals.provider.editTitle") }}</h1>
      <p>{{ t("onlineEvals.provider.subtitle") }}</p>
    </div>

    <div class="eval-form-page__body">
      <div class="eval-form-page__main">
        <section class="eval-form-section">
          <div class="eval-form-section__title"><span>01</span> {{ t("onlineEvals.provider.sectionTitle") }}</div>
          <label>
            {{ t("onlineEvals.provider.nameLabel") }}
            <input v-model.trim="form.name" required :placeholder="t('onlineEvals.provider.namePlaceholder')" />
          </label>
          <label>
            {{ t("onlineEvals.provider.typeLabel") }}
            <input v-model.trim="form.providerType" required :placeholder="t('onlineEvals.provider.typePlaceholder')" />
          </label>
          <label class="eval-form-section__wide">
            {{ t("onlineEvals.provider.endpointLabel") }}
            <input v-model.trim="form.endpoint" :placeholder="t('onlineEvals.provider.endpointPlaceholder')" />
          </label>
          <label>
            {{ t("onlineEvals.provider.defaultModelLabel") }}
            <input v-model.trim="form.defaultModel" required :placeholder="t('onlineEvals.provider.defaultModelPlaceholder')" />
          </label>
          <label>
            {{ t("onlineEvals.provider.availableModelsLabel") }}
            <input v-model.trim="form.availableModels" :placeholder="t('onlineEvals.provider.availableModelsPlaceholder')" />
          </label>
          <label class="eval-form-check">
            <input v-model="form.isDefault" type="checkbox" />
            <span>{{ t("onlineEvals.provider.useAsDefault") }}</span>
          </label>
          <label class="eval-form-section__wide">
            {{ t("onlineEvals.provider.authConfigLabel") }}
            <textarea v-model="form.authConfig" rows="7" required />
          </label>
        </section>
      </div>
    </div>

    <div class="eval-form-page__foot">
      <OButton type="button" variant="outline" @click="$emit('cancel')">{{ t("onlineEvals.buttons.cancel") }}</OButton>
      <OButton type="submit" :loading="isSaving">
        {{ mode === "create" ? t("onlineEvals.buttons.create") : t("onlineEvals.buttons.save") }}
      </OButton>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService, { type Provider } from "@/services/online-evals.service";
import { availableModelsOf, booleanOf, defaultModelOf, providerTypeOf } from "../utils/evalEntity";
import { parseJson, showError, splitCsv } from "../utils/evalFormat";

const props = defineProps<{
  orgId: string;
  mode: "create" | "edit";
  row: Provider | null;
}>();

const emit = defineEmits<{
  (e: "saved"): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();
const form = ref(initForm(props.row));
const isSaving = ref(false);

function initForm(row: Provider | null) {
  if (!row) {
    return {
      name: "",
      providerType: "openai",
      endpoint: "",
      defaultModel: "",
      availableModels: "",
      authConfig: '{\n  "api_key": ""\n}',
      isDefault: false,
    };
  }
  return {
    name: row.name,
    providerType: providerTypeOf(row),
    endpoint: row.endpoint || "",
    defaultModel: defaultModelOf(row),
    availableModels: availableModelsOf(row).join(", "),
    authConfig: '{\n  "api_key": ""\n}',
    isDefault: booleanOf(row, "isDefault", "is_default"),
  };
}

async function save() {
  if (!props.orgId) return;
  isSaving.value = true;
  try {
    const payload = {
      name: form.value.name,
      providerType: form.value.providerType,
      endpoint: form.value.endpoint || null,
      defaultModel: form.value.defaultModel,
      availableModels: splitCsv(form.value.availableModels),
      authConfig: parseJson(form.value.authConfig, t("onlineEvals.provider.authConfigLabel")),
      isDefault: form.value.isDefault,
    };

    if (props.mode === "edit" && props.row) {
      await onlineEvalsService.providers.update(props.orgId, props.row.id, payload);
    } else {
      await onlineEvalsService.providers.create(props.orgId, payload);
    }
    toast({
      variant: "success",
      message: t("onlineEvals.saved", { label: t("onlineEvals.singular.providers") }),
    });
    emit("saved");
  } catch (err: any) {
    showError(err, t("onlineEvals.provider.saveError"));
  } finally {
    isSaving.value = false;
  }
}
</script>
