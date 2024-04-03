import { ref, watch, type Ref } from "vue";

export const useSelectAutoComplete2 = (
  options: Ref<any>,
  searchKey: string
) => {
  const filteredOptions = ref(options.value);
  console.log(filteredOptions.value, "filteredOptions");

  watch(options, () => {
    console.log(options.value, "options.value");
    filteredOptions.value = options.value;
  });

  const filterFn = (val: string, update: (callback: () => void) => void) => {
    if (val === "") {
      update(() => {
        filteredOptions.value = options.value;
      });
      return;
    }

    update(() => {
      const regex = /\$\{(\w+)/g;

      const match = regex.exec(val);
      if (match) {
        console.log(match, "match");

        const placeholder = match[1];
        const needle = val.replace(regex, "").toLowerCase();
        console.log(needle, "needle");

        filteredOptions.value = options.value?.filter((option: any) => {
          const value =
            typeof option === "object" ? option[searchKey] : option.toString();
          const lowerCaseValue = value.toLowerCase();
          const lowerCaseNeedle = needle.toLowerCase();
          console.log(
            lowerCaseValue.indexOf(lowerCaseNeedle) > -1 &&
              (lowerCaseValue.startsWith(placeholder) || !placeholder),
            "value"
          );
          return (
            lowerCaseValue.indexOf(lowerCaseNeedle) > -1 &&
            (lowerCaseValue.startsWith(placeholder) || !placeholder)
          );
        });
      } else {
        const needle = val.toLowerCase();
        filteredOptions.value = options.value?.filter((option: any) => {
          const value =
            typeof option === "object" ? option[searchKey] : option.toString();
          const lowerCaseValue = value.toLowerCase();
          return lowerCaseValue.indexOf(needle) > -1;
        });
      }
    });
  };

  return { filteredOptions, filterFn };
};
