import {
  ref,
  onUnmounted,
  onDeactivated,
  onActivated,
  onMounted,
  onBeforeUnmount,
} from "vue";

/**
 * Custom hook to debounce a value
 * @param {any} initialValue - The initial value to debounce
 * @param {number} delay - The delay in milliseconds for debouncing
 * @returns {Object} - Object containing the debounced value and methods to set the value immediately or with debounce
 */
export const useCustomDebouncer = (initialValue: any, delay: any) => {
  const valueRef = ref(initialValue);
  const isComponentActive = ref(true);

  let timeout: any = null;

  /**
   * Set the value immediately without any delay
   * @param {any} newValue - The new value to set immediately
   */
  const setImmediateValue = (newValue: any) => {
    // Reset the timeout before setting the value
    resetTimeout();

    if (isComponentActive.value) {
      // Immediately set the value
      valueRef.value = newValue;
    }
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
    // first, clear existing timeout
    resetTimeout();

    // assign a new timeout
    timeout = setTimeout(() => {
      if (isComponentActive.value) {
        // set the value
        valueRef.value = newValue;
      }
    }, delay);
  };

  // clear existing timeout onDeactivated
  onDeactivated(() => {
    resetTimeout();
    isComponentActive.value = false;
  });

  onActivated(() => {
    isComponentActive.value = true;
  });

  onMounted(() => {
    isComponentActive.value = true;
  });

  onBeforeUnmount(() => {
    resetTimeout();
    isComponentActive.value = false;
  });

  // clear existing timeout on unmount
  onUnmounted(() => {
    resetTimeout();
    isComponentActive.value = false;
  });

  return { valueRef, setImmediateValue, setDebounceValue };
};
