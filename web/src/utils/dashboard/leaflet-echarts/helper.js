import { version } from "echarts/core"; //lib/echarts";

export const ecVer = version.split('.');

export function v2Equal(a, b) {
  return a && b && a[0] === b[0] && a[1] === b[1];
}

let logMap = {};

export function logWarn(tag, msg, once) {
  const log = `[ECharts][Extension][Leaflet]${tag ? ' ' + tag + ':' : ''} ${msg}`;
  once && logMap[log] || console.warn(log);
  once && (logMap[log] = true);
}

export function clearLogMap() {
  logMap = {};
}
