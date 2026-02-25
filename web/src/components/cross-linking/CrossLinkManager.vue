<template>
  <div class="cross-link-manager">
    <!-- Header -->
    <div class="tw:flex tw:justify-between tw:items-center tw:mb-3">
      <div>
        <div class="tw:font-semibold tw:text-sm">{{ title }}</div>
        <div v-if="subtitle" class="tw:text-xs" style="color: var(--o2-text-muted)">
          {{ subtitle }}
        </div>
      </div>
      <q-btn
        v-if="!readonly"
        dense
        flat
        no-caps
        icon="add"
        label="Add Cross-Link"
        color="primary"
        size="sm"
        @click="onAddClick"
        data-test="add-cross-link-btn"
      />
    </div>

    <!-- Links Table -->
    <q-table
      v-if="links.length > 0"
      :rows="links"
      :columns="columns"
      row-key="name"
      dense
      flat
      bordered
      hide-bottom
      :pagination="{ rowsPerPage: 0 }"
      class="cross-link-table"
      data-test="cross-link-table"
    >
      <template v-slot:body-cell-fields="props">
        <q-td :props="props">
          <q-chip
            v-for="(field, idx) in props.row.fields"
            :key="idx"
            dense
            size="sm"
            class="q-mr-xs"
          >
            {{ field.name }}
          </q-chip>
        </q-td>
      </template>

      <template v-slot:body-cell-actions="props">
        <q-td :props="props" v-if="!readonly">
          <q-btn
            dense
            flat
            round
            icon="edit"
            size="sm"
            @click="editLink(props.row)"
            :data-test="`cross-link-edit-${props.rowIndex}`"
          />
          <q-btn
            dense
            flat
            round
            icon="delete"
            size="sm"
            color="negative"
            @click="removeLink(props.row)"
            :data-test="`cross-link-delete-${props.rowIndex}`"
          />
        </q-td>
      </template>

      <template v-slot:body-cell-source="props">
        <q-td :props="props">
          <q-badge
            :color="props.row._source === 'stream' ? 'primary' : 'grey'"
            :label="props.row._source === 'stream' ? 'Stream' : 'Global'"
          />
        </q-td>
      </template>
    </q-table>

    <!-- Empty State -->
    <div
      v-else
      class="tw:text-center tw:py-6 tw:text-sm"
      style="color: var(--o2-text-muted)"
      data-test="cross-link-empty"
    >
      No cross-links configured. Click "Add Cross-Link" to create one.
    </div>

    <!-- Add/Edit Dialog -->
    <CrossLinkDialog
      v-model="showAddDialog"
      :link="editingLink"
      @save="onSaveLink"
      @cancel="showAddDialog = false"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, type PropType } from "vue";
import CrossLinkDialog from "./CrossLinkDialog.vue";

export interface CrossLink {
  name: string;
  url: string;
  fields: Array<{ name: string }>;
  _source?: string;
}

export default defineComponent({
  name: "CrossLinkManager",
  components: { CrossLinkDialog },
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
  },
  emits: ["update:modelValue", "change"],
  setup(props, { emit }) {
    const showAddDialog = ref(false);
    const editingLink = ref<CrossLink | null>(null);
    const editingOriginalName = ref("");

    const links = computed(() => props.modelValue);

    const columns = computed(() => {
      const cols: any[] = [
        {
          name: "name",
          label: "Name",
          align: "left",
          field: "name",
          sortable: true,
        },
        {
          name: "url",
          label: "URL Template",
          align: "left",
          field: "url",
          style:
            "max-width: 300px; overflow: hidden; text-overflow: ellipsis;",
        },
        {
          name: "fields",
          label: "Fields",
          align: "left",
          field: "fields",
        },
      ];

      if (props.showSourceColumn) {
        cols.push({
          name: "source",
          label: "Source",
          align: "center",
          field: "_source",
        });
      }

      if (!props.readonly) {
        cols.push({
          name: "actions",
          label: "Actions",
          align: "center",
        });
      }

      return cols;
    });

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

    function removeLink(link: CrossLink) {
      const updated = props.modelValue.filter((l) => l.name !== link.name);
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
      links,
      columns,
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
