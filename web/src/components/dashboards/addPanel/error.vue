<template>
    <div >
        <q-expansion-item
        expand-separator
        @after-show="layoutExpandUpdated"
        @after-hide="layoutExpandUpdated"
        v-for="item in props.errorArray"
        icon="error"
        label="Errors"
      >
        <q-card>
          <q-card-section>
           {{ item }}
          </q-card-section>
        </q-card>
      </q-expansion-item>


    </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
export default defineComponent({
    name: "ErrorComponent",
    props: ["errorArray"],
    emits: [],

    setup (props) {
        
        const layoutExpandUpdated = () => {
            window.dispatchEvent(new Event("resize"))
        }

        return {
            props,
            layoutExpandUpdated
         }
    }
})
</script>

<style lang="scss" scoped>

</style>