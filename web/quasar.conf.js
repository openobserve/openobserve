module.exports = function (ctx) {
  return {
    framework: {
      directives: ["table-resizable"],
    },
    build: {
      chainWebpack (chain) {
        const nodePolyfillWebpackPlugin = require('node-polyfill-webpack-plugin')
        chain.plugin('node-polyfill').use(nodePolyfillWebpackPlugin)
      },
      vitePlugins: [
        [ 'vite-plugin-monaco-editor', { /* ..options.. */ } ]
      ]
    },
  },
}