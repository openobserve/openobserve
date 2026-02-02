<!-- Copyright 2023 OpenObserve Inc.

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
  <span class="collapsible-projection">
    <span v-if="!isCollapsible">{{ fieldsText }}</span>
    <span v-else>
      <span v-if="!expanded">
        {{ visibleFields }}
        <span
          class="expand-link"
          @click="expanded = true"
        >
          ... {{ hiddenCount }} more ▼
        </span>
      </span>
      <span v-else>
        {{ fieldsText }}
        <span
          class="expand-link"
          @click="expanded = false"
        >
          ▲ collapse
        </span>
      </span>
    </span>
  </span>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";

export default defineComponent({
  name: "CollapsibleProjection",
  props: {
    fieldsText: {
      type: String,
      required: true,
    },
    threshold: {
      type: Number,
      default: 5,
    },
  },
  setup(props) {
    const expanded = ref(false);

    const fields = computed(() => {
      // Parse fields from text like "[field1, field2, field3]"
      const match = props.fieldsText.match(/\[([^\]]+)\]/);
      if (!match) return [];

      const fieldsList = match[1];
      const parsed: string[] = [];
      let current = '';
      let depth = 0;
      let inQuotes = false;

      for (const char of fieldsList) {
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes;
        } else if (!inQuotes && (char === '(' || char === '[' || char === '{')) {
          depth++;
        } else if (!inQuotes && (char === ')' || char === ']' || char === '}')) {
          depth--;
        } else if (!inQuotes && depth === 0 && char === ',') {
          parsed.push(current.trim());
          current = '';
          continue;
        }
        current += char;
      }
      if (current.trim()) {
        parsed.push(current.trim());
      }

      return parsed;
    });

    const isCollapsible = computed(() => {
      return fields.value.length > props.threshold;
    });

    const visibleFields = computed(() => {
      if (!isCollapsible.value) return props.fieldsText;

      const prefix = props.fieldsText.substring(0, props.fieldsText.indexOf('[') + 1);
      const suffix = props.fieldsText.substring(props.fieldsText.lastIndexOf(']'));
      const visible = fields.value.slice(0, 3).join(', ');

      return `${prefix}${visible}`;
    });

    const hiddenCount = computed(() => {
      return fields.value.length - 3;
    });

    return {
      expanded,
      isCollapsible,
      visibleFields,
      hiddenCount,
    };
  },
});
</script>

<style lang="scss" scoped>
.collapsible-projection {
  .expand-link {
    color: var(--q-primary);
    cursor: pointer;
    font-weight: 500;
    text-decoration: none;
    padding: 0 4px;

    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
