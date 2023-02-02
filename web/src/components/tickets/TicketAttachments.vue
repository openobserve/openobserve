<template>
  <div id="app">Upload file</div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";

export default defineComponent({
  setup() {
    const allFiles = ref([]);

    const documentList: any = ref([
      {
        projectSub: {
          projectSubId: null,
        },
        fileBean: [],
      },
    ]);

    const addFiles = (files: []) => {
      console.log(files);
      if (files.length > 0) {
        allFiles.value.push(...files);
      }
    };

    const removeFiles = (files: any[]) => {
      console.log(files);
      if (files.length > 0) {
        files.forEach((v) => {
          const idx = allFiles.value.findIndex((f: any) => f.name === v.name);
          idx > -1 && allFiles.value.splice(idx, 1);
        });
      }
    };

    const upload = (projectSubId: any) => {
      // const finalFormData = new FormData();
      documentList.value[0].projectSub.projectSubId = projectSubId;
      const formData: any = new FormData();
      allFiles.value.forEach((file) => {
        formData.append("fileBean", file);
      });
      documentList.value[0].fileBean.push(formData);

      for (var pair of formData.entries())
        console.log(pair[0] + ", " + pair[1]);

      console.log(documentList.value);

      // Axios POST request here...
    };

    return {
      addFiles,
      removeFiles,
      upload,
    };
  },
});
</script>
