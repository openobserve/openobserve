import Logs from "./logs/Index.vue";
export default {
    install: (app:any, options:any) => {
        app.component("zinc-logs", Logs);
    }
}