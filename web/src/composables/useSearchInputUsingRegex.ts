import { ref, watch, type Ref } from "vue";

export const useSearchInputUsingRegex = (
  options: Ref<any>,
  searchKey: string,
  searchRegex: string
) => {
  const filteredOptions = ref([...options.value]);

  watch(options, (newValue) => {
    if (!filteredOptions.value.length) {
      filteredOptions.value = [...newValue];
    }
  });

  const filterFn = (val: any) => {
    if (val === "") {
      filteredOptions.value = [...options.value];
      return;
    }

    const regex = new RegExp(searchRegex, "gi");
    let match = regex.exec(val)
    
    if(!match) {
      filteredOptions.value = [];
      return;
    }

    let needle: any = null;
    for (let i = 1; i < match.length; i++) {
      if (match[i] !== undefined) {
        needle = match[i];
        break;
      }
    }

    filteredOptions.value = options.value?.filter((option: any) => {
      const value =
        typeof option === "object" ? option[searchKey] : option.toString();
      const lowerCaseValue = value.toLowerCase();
      return lowerCaseValue.includes(needle);
    });
  };

  return { filteredOptions, filterFn };
};
