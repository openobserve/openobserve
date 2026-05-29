<template>
  <div class="cross-link-manager">
    <!-- Header -->
    <div class="tw:flex tw:justify-between tw:items-center tw:mb-3">
      <div>
        <div class="tw:text-base tw:font-bold">{{ title }}</div>
        <div v-if="subtitle" class="tw:text-xs" style="color: var(--o2-text-muted)">
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
        class="cross-link-item el-border tw:rounded-md tw:mb-1 tw:p-2"
        :data-test="`cross-link-item-${idx}`"
      >
        <div class="tw:flex tw:justify-between tw:items-start">
          <div class="tw:flex-1 tw:min-w-0">
            <!-- Name -->
            <div
              class="tw:text-sm tw:font-medium tw:font-bold tw:truncate"
              :title="link.name"
              style="color: var(--o2-text-primary)"
              :data-test="`cross-link-item-name-${idx}`"
            >
              {{ link.name }}
              <OBadge
                v-if="link._source"
                :variant="link._source === 'stream' ? 'primary' : 'default'"
                class="tw:ml-1"
              >
                {{ link._source === 'stream' ? 'Stream' : 'Global' }}
              </OBadge>
            </div>
            <!-- URL -->
            <div
              class="tw:text-xs tw:truncate tw:mt-1"
              :title="link.url"
              style="color: var(--o2-text-muted)"
              :data-test="`cross-link-item-url-${idx}`"
            >
              {{ link.url }}
            </div>
            <!-- Fields -->
            <div v-if="link.fields?.length" class="tw:flex tw:flex-wrap tw:gap-1 tw:mt-1">
              <OBadge
                v-for="(field, fIdx) in link.fields"
                :key="fIdx"
                class="tw:max-w-[200px]"
                :data-test="`cross-link-field-chip-${fIdx}`"
              >
                <span class="tw:truncate tw:text-xs" :title="field.name">{{ field.name }}</span>
              </OBadge>
            </div>
          </div>
          <!-- Actions -->
          <div v-if="!readonly" class="tw:flex tw:items-center tw:gap-1 tw:ml-2 tw:shrink-0">
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
      class="tw:text-center tw:py-4 tw:text-sm"
      style="color: var(--o2-text-muted)"
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
import OBadge from '@/lib/core/Badge/OBadge.vue';


export interface CrossLink {
  name: string;
  url: string;
  fields: Array<{ name: string }>;
  _source?: string;
}

export default defineComponent({
  name: "CrossLinkManager",
  components: { CrossLinkDialog, OButton, OBadge },
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
