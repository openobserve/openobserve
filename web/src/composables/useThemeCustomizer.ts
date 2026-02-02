import { ref } from "vue";

// Shared state (singleton)
const isOpen = ref(false);

// Function reference to update theme from external sources
let updateThemeFromExternal: ((themeConfig: any) => void) | null = null;

// Toggle customizer panel
const toggleCustomizer = () => {
  isOpen.value = !isOpen.value;
  // console.log("Toggle customizer:", isOpen.value);
};

// Register the update function (called by ThemeCustomizer on mount)
const registerUpdateFunction = (fn: (themeConfig: any) => void) => {
  updateThemeFromExternal = fn;
};

// Apply theme from predefined themes or other external sources
const applyTheme = (themeConfig: any) => {
  if (updateThemeFromExternal) {
    updateThemeFromExternal(themeConfig);
  }
};

export function useThemeCustomizer() {
  return {
    isOpen,
    toggleCustomizer,
    registerUpdateFunction,
    applyTheme,
  };
}
