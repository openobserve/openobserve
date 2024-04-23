import { ref, watch, type Ref } from "vue";

export const useSearchInputUsingRegex = (
  options: Ref<any>,
  searchKey: string,
  searchRegex: string
) => {
  const filteredOptions = ref(options.value);

  watch(options, (newValue) => {
    filteredOptions.value = newValue;
  });

  const filterFn = (val: any) => {
    if (val === "") {
      filteredOptions.value = options.value;
      return;
    }

    const regex = new RegExp(searchRegex, "gi");
    let matchesArray = [];
    let match;
    while ((match = regex.exec(val)) !== null) {
      let needle: any = null;
      for (let i = 1; i < match.length; i++) {
        if (match[i] !== undefined) {
          needle = match[i];
          break;
        }
      }
      if (needle !== null) {
        matchesArray.push(needle);
      }
    }

    filteredOptions.value = options.value?.filter((option: any) => {
      const value =
        typeof option === "object" ? option[searchKey] : option.toString();
      const lowerCaseValue = value.toLowerCase();
      return matchesArray.some((match) =>
        lowerCaseValue.includes(match.toLowerCase())
      );
    });
  };

  return { filteredOptions, filterFn };
};
