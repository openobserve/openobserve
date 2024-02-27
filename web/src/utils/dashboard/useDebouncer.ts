import { ref, watch, onUnmounted } from 'vue';

export const useDebouncer = (dependency: any, delay = 300) => {
  const value = ref(dependency.value);
  let timeoutId: any = null;

  const clearTimer = () => {
    clearTimeout(timeoutId);
  };

//   watch(dependency, () => {
//     clearTimer();
//     if (setImmediateValue) {
//       value.value = dependency.value;
//     } else {
//       timeoutId = setTimeout(() => {
//         value.value(dependency.value);
//       }, delay);
//     }
//   });

  const setImmediateValue = (newValue: any) => {
    value.value = newValue;
  }

  const setDebounceValue = (newValue: any) => {
    clearTimer();
    timeoutId = setTimeout(() => {
        value.value(dependency.value);
      }, delay);
  }

  onUnmounted(() => {
    clearTimer();
  });

  return { value, setImmediateValue, setDebounceValue };
}
