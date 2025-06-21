export default {
  namespaced: true,
  state: {
    logs: {},
    isInitialized: false
  },
  getters: {
    getLogs(state: any) {
      return state.logs;
    },
    getIsInitialized(state: any) {
      return state.isInitialized;
    },
  },
  mutations: {
    setLogs(state: any, logs: any) {
      state.logs = logs;
    },
    setIsInitialized(state: any, isInitialized: boolean) {
      state.isInitialized = isInitialized;
    },
  },
  actions: {
    setLogs(context: any, logs: any) {
      context.commit('setLogs', logs);
    },
    setIsInitialized(context: any, isInitialized: boolean) {
      context.commit('setIsInitialized', isInitialized);
    },
  },
};
