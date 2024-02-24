import { ref, type Ref } from "vue";

export const useLoading = (asyncFunction: any) => {
  const isLoading = ref(false);
  const error: Ref<any> = ref(null);

  const execute = async (...params: any[]) => {
    isLoading.value = true;
    error.value = null;

    try {
      return await asyncFunction(...params);
    } catch (err) {
      error.value = err;
    } finally {
      isLoading.value = false;
    }
  };

  return {
    isLoading,
    error,
    execute,
  };
};
