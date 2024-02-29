import { ref, onUnmounted, onDeactivated } from "vue";

/**
 * Custom hook to debounce a value
 * @param {any} initialValue - The initial value to debounce
 * @param {number} delay - The delay in milliseconds for debouncing
 * @returns {Object} - Object containing the debounced value and methods to set the value immediately or with debounce
 */
export const useCustomDebouncer = (initialValue: any, delay: any) => {
  const valueRef = ref(initialValue);
  let timeout: any = null;

  /**
   * Set the value immediately without any delay
   * @param {any} newValue - The new value to set immediately
   */
  const setImmediateValue = (newValue: any) => {
    // Reset the timeout before setting the value
    resetTimeout();

    // Immediately set the value
    valueRef.value = newValue;
  };

  const resetTimeout = () => {
    // Reset the timeout
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  /**
   * Set the value with debounce
   * @param {any} newValue - The new value to set with debounce
   */
  const setDebounceValue = (newValue: any) => {
    // first, clear any existing timeout
    resetTimeout();

    // assign a new timeout
    timeout = setTimeout(() => {
      valueRef.value = newValue;
    }, delay);
  };

  // clear any existing timeout on deactivation
  onDeactivated(() => {
    resetTimeout();
  });

  // clear any existing timeout on unmount
  onUnmounted(() => {
    resetTimeout();
  });

  return { valueRef, setImmediateValue, setDebounceValue };
};
