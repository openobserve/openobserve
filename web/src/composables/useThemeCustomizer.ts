import { ref } from "vue";

// Shared state (singleton)
const isOpen = ref(false);

// Toggle customizer panel
const toggleCustomizer = () => {
  isOpen.value = !isOpen.value;
  console.log("Toggle customizer:", isOpen.value);
};

export function useThemeCustomizer() {
  return {
    isOpen,
    toggleCustomizer,
  };
}
