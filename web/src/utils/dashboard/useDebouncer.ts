import { ref, onUnmounted } from "vue";

/**
 * Custom hook to debounce a value
 * @param {any} initialValue - The initial value to debounce
 * @param {number} delay - The delay in milliseconds for debouncing
 * @returns {Object} - Object containing the debounced value and methods to set the value immediately or with debounce
 */
export const useDebouncer = (initialValue: any, delay: any) => {
  const value = ref(initialValue.value);
  let timeout: any = null;

  /**
   * Set the value immediately without any delay
   * @param {any} newValue - The new value to set immediately
   */
  const setImmediate = (newValue: any) => {
    clearTimeout(timeout);
    console.log("setImmediate", newValue);

    value.value = newValue;
  };

  clearTimeout(timeout);

  /**
   * Set the value with debounce
   * @param {any} newValue - The new value to set with debounce
   */
  const setDebounce = (newValue: any) => {
    clearTimeout(timeout);
    console.log("setDebounce", newValue);

    timeout = setTimeout(() => {
      value.value = newValue;
    }, delay);
    console.log("timeout", timeout);
  };

  onUnmounted(() => {
    console.log("onUnmounted", value.value);

    clearTimeout(timeout);
  });

  return { value, setImmediate, setDebounce };
};
