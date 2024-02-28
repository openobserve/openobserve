import { ref, onUnmounted, watch, onDeactivated } from "vue";

/**
 * Custom hook to debounce a value
 * @param {any} initialValue - The initial value to debounce
 * @param {number} delay - The delay in milliseconds for debouncing
 * @returns {Object} - Object containing the debounced value and methods to set the value immediately or with debounce
 */
export const useDebouncer = (initialValue: any, delay: any) => {
  const value = ref(initialValue);
  let timeout: any = null;

  /**
   * Set the value immediately without any delay
   * @param {any} newValue - The new value to set immediately
   */
  const setImmediate = (newValue: any) => {
    resetTimeout();
    console.log("setImmediate", newValue);

    value.value = newValue;
  };

  const resetTimeout = () => {
    if (timeout) {
      clearTimeout(timeout);
    }
  }

  watch(value, () => {
    console.log('isDashboardVariablesAndPanelsDataLoading: useDebouncer: ', value.value)
  })


  /**
   * Set the value with debounce
   * @param {any} newValue - The new value to set with debounce
   */
  const setDebounce = (newValue: any) => {
    resetTimeout();
    console.log("setDebounce", newValue);

    timeout = setTimeout(() => {
      value.value = newValue;
    }, delay);
    console.log("timeout", timeout);
  };

  onDeactivated(() => {
    console.log("onUnmounted", value.value);

    resetTimeout();
  });

  onUnmounted(() => {
    resetTimeout();
  })

  return { value, setImmediate, setDebounce };
};
