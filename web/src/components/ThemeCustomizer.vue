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
  <q-dialog v-model="dialogOpen" position="right" maximized>
    <q-card class="theme-customizer-card">
      <q-card-section class="row items-center q-pb-none sticky-header">
        <div class="text-h6">Theme Customization</div>
        <q-space />
        <q-btn icon="close" flat round dense v-close-popup />
      </q-card-section>

      <q-card-section class="q-pt-md scroll-content">
        <div v-for="colorVar in colorVariables" :key="colorVar.name" class="color-item q-mb-lg">
          <div class="text-subtitle2 q-mb-sm">{{ colorVar.label }}</div>

          <div class="row items-center q-gutter-sm q-mb-sm">
            <q-input
              :model-value="getDisplayColor(colorVar)"
              dense
              outlined
              readonly
              style="flex: 1; font-family: monospace; font-size: 12px;"
            />

            <q-btn
              icon="colorize"
              round
              color="primary"
              size="sm"
              @click="openColorPicker(colorVar.name)"
            >
              <q-tooltip>Pick Color</q-tooltip>
            </q-btn>
          </div>

          <div class="row items-center q-gutter-sm">
            <div class="text-caption" style="min-width: 60px;">Opacity:</div>
            <q-slider
              :model-value="colorVar.opacity"
              @update:model-value="(val) => updateOpacity(colorVar.name, val)"
              :min="1"
              :max="10"
              :step="1"
              label
              :label-value="colorVar.opacity"
              color="primary"
              style="flex: 1"
            />
          </div>
        </div>
      </q-card-section>

      <q-dialog v-model="showColorPicker">
        <q-card style="min-width: 300px">
          <q-card-section>
            <div class="text-h6">{{ currentColorLabel }}</div>
          </q-card-section>
          <q-card-section>
            <q-color v-model="currentColorValue" @update:model-value="applyColor" />
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="Close" color="primary" v-close-popup />
          </q-card-actions>
        </q-card>
      </q-dialog>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch, reactive } from "vue";
import { useThemeCustomizer } from "@/composables/useThemeCustomizer";

const { isOpen } = useThemeCustomizer();
const dialogOpen = ref(false);
const showColorPicker = ref(false);
const currentColorName = ref("");
const currentColorLabel = ref("");
const currentColorValue = ref("");

// Define all color variables with original opacity levels
const colorVariables = reactive([
  {
    name: "--o2-theme-color",
    label: "Theme Color",
    value: "#3F7994",
    opacity: 10, // 1.0 alpha (fully opaque)
  },
  {
    name: "--o2-dark-theme-color",
    label: "Dark Theme Color",
    value: "#112027",
    opacity: 10, // 1.0 alpha
  },
  {
    name: "--o2-body-primary-bg",
    label: "Body Primary Background",
    value: "#599BAE",
    opacity: 1, // 0.01 alpha (original)
  },
  {
    name: "--o2-body-secondary-bg",
    label: "Body Secondary Background",
    value: "#599BAE",
    opacity: 4, // 0.4 alpha (original)
  },
  {
    name: "--o2-menu-gradient-start",
    label: "Menu Gradient Start",
    value: "#599BAE",
    opacity: 1, // 0.04 alpha (original, closest to 1)
  },
  {
    name: "--o2-menu-gradient-end",
    label: "Menu Gradient End",
    value: "#599BAE",
    opacity: 1, // 0.08 alpha (original, closest to 1)
  },
  {
    name: "--o2-menu-border-color",
    label: "Menu Border Color",
    value: "#599BAE",
    opacity: 6, // 0.6 alpha (original)
  },
  {
    name: "--o2-actions-column-shawdow",
    label: "Actions Column Shadow",
    value: "#000000",
    opacity: 1, // 0.1 alpha (original)
  },
]);

// Watch isOpen from composable
watch(isOpen, (val) => {
  dialogOpen.value = val;
});

// Watch dialogOpen to sync back
watch(dialogOpen, (val) => {
  isOpen.value = val;
});

const openColorPicker = (colorName: string) => {
  const colorVar = colorVariables.find(c => c.name === colorName);
  if (colorVar) {
    currentColorName.value = colorName;
    currentColorLabel.value = colorVar.label;
    currentColorValue.value = colorVar.value;
    showColorPicker.value = true;
  }
};

const hexToRgba = (hex: string, opacity: number): string => {
  // Remove # if present
  hex = hex.replace('#', '');

  // Parse hex to RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Convert opacity scale (1-10) to alpha (0.1-1.0)
  const alpha = opacity / 10;

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const getDisplayColor = (colorVar: any): string => {
  return hexToRgba(colorVar.value, colorVar.opacity);
};

const updateOpacity = (colorName: string, newOpacity: number) => {
  const colorVar = colorVariables.find(c => c.name === colorName);
  if (colorVar) {
    colorVar.opacity = newOpacity;
    const rgbaColor = hexToRgba(colorVar.value, newOpacity);
    document.documentElement.style.setProperty(colorName, rgbaColor);
    console.log(`Updated ${colorName} opacity to ${newOpacity}: ${rgbaColor}`);

    // If changing body backgrounds, force update the gradient
    if (colorName === '--o2-body-primary-bg' || colorName === '--o2-body-secondary-bg') {
      updateBodyGradient();
    }
  }
};

const updateBodyGradient = () => {
  const primaryBg = document.documentElement.style.getPropertyValue('--o2-body-primary-bg') ||
                    getComputedStyle(document.documentElement).getPropertyValue('--o2-body-primary-bg').trim();
  const secondaryBg = document.documentElement.style.getPropertyValue('--o2-body-secondary-bg') ||
                      getComputedStyle(document.documentElement).getPropertyValue('--o2-body-secondary-bg').trim();

  const gradient = `linear-gradient(to bottom right, ${primaryBg}, ${secondaryBg})`;
  document.body.style.setProperty('background', gradient, 'important');
  console.log('Updated body gradient:', gradient);
};

const applyColor = () => {
  const colorVar = colorVariables.find(c => c.name === currentColorName.value);
  if (colorVar) {
    colorVar.value = currentColorValue.value;
    const rgbaColor = hexToRgba(colorVar.value, colorVar.opacity);
    document.documentElement.style.setProperty(currentColorName.value, rgbaColor);
    console.log(`Applied ${currentColorName.value}: ${rgbaColor}`);

    // If changing body backgrounds, force update the gradient
    if (currentColorName.value === '--o2-body-primary-bg' || currentColorName.value === '--o2-body-secondary-bg') {
      updateBodyGradient();
    }
  }
};
</script>

<style scoped lang="scss">
.theme-customizer-card {
  width: 450px;
  max-width: 90vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #ffffff;
  color: rgba(0, 0, 0, 0.87);

  body.body--dark & {
    background: #1d1d1d;
    color: rgba(255, 255, 255, 0.87);
  }
}

.sticky-header {
  position: sticky;
  top: 0;
  background: inherit;
  z-index: 1;
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);

  body.body--dark & {
    border-bottom-color: rgba(255, 255, 255, 0.28);
  }
}

.scroll-content {
  flex: 1;
  overflow-y: auto;
}

.color-item {
  padding: 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.05);

  body.body--dark & {
    background: rgba(255, 255, 255, 0.05);
  }
}

// Ensure proper text colors for all elements in light mode
:deep(.text-subtitle2),
:deep(.text-body2),
:deep(.q-field__label),
:deep(.q-field__native) {
  color: rgba(0, 0, 0, 0.87);
}

:deep(.q-input) {
  .q-field__control {
    color: rgba(0, 0, 0, 0.87);

    &:before {
      border-color: rgba(0, 0, 0, 0.28);
    }
  }
}

// Dark mode overrides
body.body--dark {
  .theme-customizer-card {
    :deep(.text-subtitle2),
    :deep(.text-body2),
    :deep(.q-field__label),
    :deep(.q-field__native) {
      color: rgba(255, 255, 255, 0.87);
    }

    :deep(.q-input) {
      .q-field__control {
        color: rgba(255, 255, 255, 0.87);

        &:before {
          border-color: rgba(255, 255, 255, 0.28);
        }
      }
    }

    :deep(.q-btn__content) {
      color: rgba(255, 255, 255, 0.87);
    }
  }
}
</style>
