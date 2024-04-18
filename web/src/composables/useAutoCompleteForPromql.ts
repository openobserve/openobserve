import { ref, watch, type Ref } from "vue";

export const useAutoCompleteForPromql = (
  options: Ref<any>,
  searchKey: string
) => {
  const filteredOptions = ref(options.value);

  watch(options, (newValue, oldValue) => {
    filteredOptions.value = newValue;
  });

  const filterFn = (val: any) => {
    if (val === "") {
      filteredOptions.value = options.value;
      return;
    }

    const regex = /{([^{}]*)$/;

    const dollarRegex = /\$([^{}]*)$/;

    const match = regex.exec(val);

    const dollarMatch = dollarRegex.exec(val);

    if (match) {
      const needle = match[1].toLowerCase();

      filteredOptions.value = options.value?.filter((option: any) => {
        const value =
          typeof option === "object" ? option[searchKey] : option.toString();
        const lowerCaseValue = value.toLowerCase();
        return lowerCaseValue.includes(needle);
      });
    } else if (dollarMatch) {
      const needle = dollarMatch[1].toLowerCase();
      filteredOptions.value = options.value?.filter((option: any) => {
        const value =
          typeof option === "object" ? option[searchKey] : option.toString();
        const lowerCaseValue = value.toLowerCase();
        return lowerCaseValue.includes(needle);
      });
    } else {
      const needle = val.toLowerCase();
      filteredOptions.value = options.value?.filter((option: any) => {
        const value =
          typeof option === "object" ? option[searchKey] : option.toString();
        const lowerCaseValue = value.toLowerCase();
        return lowerCaseValue.includes(needle);
      });
    }
  };

  return { filteredOptions, filterFn };
};
