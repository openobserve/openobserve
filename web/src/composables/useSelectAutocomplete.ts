import { ref, watch, type Ref } from "vue";

export const useSelectAutoComplete = (options: Ref<any>, searchKey: string) => {

  const filteredOptions = ref(options.value);

  watch(options, () => {
    filteredOptions.value = options.value;
  });

  const filterFn = (val: any, update: any) => {
    if (val === "") {
      update(() => {
        filteredOptions.value = options.value;
      });
      return;
    }

    update(() => {
      const needle = val.toLowerCase();
      filteredOptions.value = options.value?.filter((option: any) => {
        const value =
          typeof option === "object" ? option[searchKey] : option.toString();
        const lowerCaseValue = value.toLowerCase();
        const lowerCaseNeedle = needle.toLowerCase();
        return lowerCaseValue.indexOf(lowerCaseNeedle) > -1;
      });
    });
  };

  return { filteredOptions, filterFn };
};
