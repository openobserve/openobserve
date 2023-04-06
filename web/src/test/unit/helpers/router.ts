import routes from "@/router/routes";
import { createRouter, createWebHistory } from "vue-router";

interface RouterMap {
  history: any;
  routes: any;
}
const routerMap: RouterMap = {
  history: createWebHistory(),
  routes: routes,
};

export default createRouter(routerMap);
