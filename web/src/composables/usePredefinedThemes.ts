import { ref } from 'vue';

const isOpen = ref(false);

export function usePredefinedThemes() {
  const toggleThemes = () => {
    isOpen.value = !isOpen.value;
  };

  return {
    isOpen,
    toggleThemes,
  };
}
