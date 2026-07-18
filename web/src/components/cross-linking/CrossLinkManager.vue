<template>
  <div class="cross-link-manager">
    <!-- Header -->
    <div class="flex justify-between items-center mb-3">
      <div>
        <div class="text-base font-bold">{{ title }}</div>
        <div v-if="subtitle" class="text-xs text-text-muted">
          {{ subtitle }}
        </div>
      </div>
      <OButton
        v-if="!readonly"
        variant="outline"
        size="sm-action"
        icon-left="add"
        @click="onAddClick"
        data-test="add-cross-link-btn"
      >
        {{ t('crossLinks.addCrossLink') }}
      </OButton>
    </div>

    <!-- Links List -->
    <div v-if="links.length > 0" class="cross-link-list" data-test="cross-link-list">
      <div
        v-for="(link, idx) in links"
        :key="link.name"
        class="cross-link-item border border-card-glass-border rounded-default mb-1 p-2"
        :data-test="`cross-link-item-${idx}`"
      >
        <div class="flex justify-between items-start">
          <div class="flex-1 min-w-0">
            <!-- Name -->
            <div
              class="text-sm font-medium font-bold truncate text-text-heading"
              :title="link.name"
              :data-test="`cross-link-item-name-${idx}`"
            >
              {{ link.name }}
              <OTag
                v-if="link._source"
                type="crossLinkSource"
                :value="link._source"
                class="ml-1"
              />
            </div>
            <!-- URL -->
            <div
              class="text-xs truncate mt-1 text-text-muted"
              :title="link.url"
              :data-test="`cross-link-item-url-${idx}`"
            >
              {{ link.url }}
            </div>
            <!-- Fields -->
            <div v-if="link.fields?.length" class="flex flex-wrap gap-1 mt-1">
              <OTag
                v-for="(field, fIdx) in link.fields"
                :key="fIdx"
                type="fieldTag"
                class="max-w-50"
                :data-test="`cross-link-field-chip-${fIdx}`"
              >
                <span class="truncate text-xs" :title="field.name">{{ field.name }}</span>
              </OTag>
            </div>
          </div>
          <!-- Actions -->
          <div v-if="!readonly" class="flex items-center gap-1 ml-2 shrink-0">
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="edit"
              @click="editLink(link)"
              :data-test="`cross-link-edit-${idx}`"
            />
            <OButton
              variant="ghost-destructive"
              size="icon-sm"
              icon-left="delete"
              @click="removeLink(idx)"
              :data-test="`cross-link-delete-${idx}`"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-else
      class="text-center py-4 text-sm text-text-muted"
      data-test="cross-link-empty"
    >
      {{ t("crossLinks.emptyState", { addLabel: t("crossLinks.addCrossLink") }) }}
    </div>

    <!-- Add/Edit Dialog -->
    <CrossLinkDialog
      v-model="showAddDialog"
      :link="editingLink"
      :availableFields="availableFields"
      @save="onSaveLink"
      @cancel="showAddDialog = false"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, type PropType } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import CrossLinkDialog from "./CrossLinkDialog.vue";
import OButton from '@/lib/core/Button/OButton.vue';
import OTag from '@/lib/core/Badge/OTag.vue';


export interface CrossLink {
  name: string;
  url: string;
  fields: Array<{ name: string }>;
  _source?: string;
}

export default defineComponent({
  name: "CrossLinkManager",
  components: { CrossLinkDialog, OButton, OTag },
  props: {
    modelValue: {
      type: Array as PropType<CrossLink[]>,
      default: () => [],
    },
    title: {
      type: String,
      default: "Cross-Links",
    },
    subtitle: {
      type: String,
      default: "",
    },
    readonly: {
      type: Boolean,
      default: false,
    },
    showSourceColumn: {
      type: Boolean,
      default: false,
    },
    availableFields: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
  },
  emits: ["update:modelValue", "change"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const showAddDialog = ref(false);
    const editingLink = ref<CrossLink | null>(null);
    const editingOriginalName = ref("");

    const links = computed(() => props.modelValue);

    function onAddClick() {
      editingLink.value = null;
      editingOriginalName.value = "";
      showAddDialog.value = true;
    }

    function editLink(link: CrossLink) {
      editingLink.value = { ...link };
      editingOriginalName.value = link.name;
      showAddDialog.value = true;
    }

    function removeLink(idx: number) {
      const updated = props.modelValue.filter((_, i) => i !== idx);
      emit("update:modelValue", updated);
      emit("change");
    }

    function onSaveLink(link: CrossLink) {
      let updated: CrossLink[];

      if (editingOriginalName.value) {
        const idx = props.modelValue.findIndex(
          (l) => l.name === editingOriginalName.value,
        );
        if (idx >= 0) {
          updated = [...props.modelValue];
          updated[idx] = link;
        } else {
          updated = [...props.modelValue, link];
        }
      } else {
        updated = [...props.modelValue, link];
      }

      emit("update:modelValue", updated);
      emit("change");
      showAddDialog.value = false;
      editingLink.value = null;
      editingOriginalName.value = "";
    }

    return {
      t,
      store,
      links,
      showAddDialog,
      editingLink,
      onAddClick,
      editLink,
      removeLink,
      onSaveLink,
    };
  },
});
</script>
