// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// The sensitivity control's copy is half the defect: the old tooltip described
// the opposite of what the detector does. `no-missing-keys` reads en-US alone,
// so nothing else would notice the other 14 locales keeping the wrong sentence.
//
// Placeholder parity is NOT checked here — localeMessages.spec.ts already does
// it compiler-accurately, and allows the legitimate subset case this file's
// naive regex would have failed.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type Json = Record<string, unknown>;

const dir = ["locales/languages", "src/locales/languages", "web/src/locales/languages"]
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));

if (!dir) throw new Error(`locale directory not found from ${process.cwd()}`);

const read = (file: string): Json => JSON.parse(readFileSync(resolve(dir, file), "utf8")) as Json;

const ALL_LOCALES: Array<[string, Json]> = readdirSync(dir)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => [file.replace(/\.json$/, ""), read(file)]);

const en = read("en-US.json");

const at = (root: Json, path: string): unknown =>
  path.split(".").reduce<unknown>((node, key) => (node as Json | undefined)?.[key], root);

const isText = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;

const ADDED = [
  "alerts.anomaly.sensitivityConservative",
  "alerts.anomaly.sensitivityBalanced",
  "alerts.anomaly.sensitivityAggressive",
  "alerts.anomaly.percentile",
  "alerts.anomaly.sensitivityRange",
  "alerts.anomaly.sensitivityHintPerDay",
  "alerts.anomaly.sensitivityHintEveryNDays",
];

// Orphaned with the slider and its mark lines, then with the Load data button
// when the chart moved to the right-hand Preview card and became automatic.
const REMOVED = [
  "alerts.anomaly.anomalyScoreRange",
  "alerts.anomaly.maxThresholdMarkLine",
  "alerts.anomaly.minThresholdMarkLine",
  "alerts.anomaly.dataPreview",
  "alerts.anomaly.loadData",
  "alerts.anomaly.clickLoadDataHint",
  "alerts.anomaly.selectStreamFirstTooltip",
  "alerts.anomaly.enterSqlFirst",
];

// Still read by AlertConfigSummary.vue — it sits one paragraph from the
// deletion list in the spec, so it is the one to delete by accident.
const KEPT = ["alerts.sensitivity", "alerts.anomaly.sensitivityTooltip"];

// The backwards copy, frozen per locale. Asserting each locale MOVED off its own
// stale sentence is the only mechanical way to catch a translation pass that
// updated English and left the other 14 describing behaviour that never existed.
const STALE_TOOLTIPS: Record<string, string> = {
  "de-DE":
    "Passen Sie den Bereich für die Anomaliebewertung an, um die Empfindlichkeit zu kontrollieren. Punkte, deren Werte außerhalb dieses Bereichs liegen, lösen keine Warnmeldungen aus. Verwenden Sie das Diagramm, um historische Daten zu visualisieren und entsprechend anzupassen.",
  "en-US":
    "Adjust the anomaly score range to control sensitivity. Points with scores outside this range will not trigger alerts. Use the chart to visualize historical data and tune accordingly.",
  "es-ES":
    "Ajuste el rango de puntuación de anomalías para controlar la sensibilidad. Los puntos con puntuaciones fuera de este rango no activarán alertas. Usa el gráfico para visualizar los datos históricos y ajustarlos en consecuencia.",
  "fr-FR":
    "Ajustez la plage de score d'anomalie pour contrôler la sensibilité. Les points dont le score se situe en dehors de cette fourchette ne déclencheront pas d'alerte. Utilisez le graphique pour visualiser les données historiques et ajuster en conséquence.",
  "it-IT":
    "Regola l'intervallo del punteggio di anomalia per controllare la sensibilità. I punti con punteggi al di fuori di questo intervallo non attiveranno gli avvisi. Usa il grafico per visualizzare i dati storici e regolarli di conseguenza.",
  "ja-JP":
    "異常スコアの範囲を調整して感度を制御します。スコアがこの範囲外のポイントではアラートは発生しません。チャートを使用して履歴データを視覚化し、それに応じて調整してください。",
  "ko-KR":
    "예외 점수 범위를 조정하여 민감도를 제어합니다.점수가 이 범위를 벗어나는 포인트는 경고를 트리거하지 않습니다.차트를 사용하여 과거 데이터를 시각화하고 그에 따라 조정하십시오.",
  "nl-NL":
    "Pas het bereik van de anomaliescore aan om de gevoeligheid te regelen. Punten met scores buiten dit bereik zullen geen waarschuwingen activeren. Gebruik de grafiek om historische gegevens te visualiseren en daarop af te stemmen.",
  "pl-PL":
    "Dostosuj zakres wyniku anomalii, aby kontrolować czułość. Punkty z wynikami poza tym zakresem nie wywołają alertów. Użyj wykresu do wizualizacji danych historycznych i odpowiedniego dostrojenia.",
  "pt-PT":
    "Ajuste a faixa de pontuação da anomalia para controlar a sensibilidade. Pontos com pontuações fora dessa faixa não acionarão alertas. Use o gráfico para visualizar dados históricos e ajustá-los adequadamente.",
  "ru-RU":
    "Настройте диапазон оценки аномалий для управления чувствительностью. Точки с оценками вне этого диапазона не будут вызывать оповещения. Используйте график для визуализации исторических данных и настройки.",
  "tr-TR":
    "Hassasiyeti kontrol etmek için anormallik puan aralığını ayarlayın. Bu aralığın dışında puan alan puanlar uyarıları tetiklemeyecektir. Geçmiş verileri görselleştirmek ve buna göre ayarlamak için grafiği kullanın.",
  "vi-VN":
    "Điều chỉnh phạm vi điểm bất thường để kiểm soát độ nhạy. Các điểm có điểm số ngoài phạm vi này sẽ không kích hoạt cảnh báo. Sử dụng biểu đồ để xem dữ liệu lịch sử và tinh chỉnh phù hợp.",
  "zh-CN":
    "调整异常分数范围以控制灵敏度。分数超出此范围的点不会触发告警。使用图表查看历史数据并进行相应调整。",
  "zh-TW":
    "調整異常分數範圍以控制敏感度。分數超出此範圍的點不會觸發警示。使用圖表視覺化歷史資料並相應調整。",
};

describe("anomaly sensitivity locale parity", () => {
  it("reads every locale file", () => {
    // An exact count: a glob that silently matched fewer would make every
    // per-locale assertion below vacuous.
    expect(ALL_LOCALES.map(([name]) => name)).toHaveLength(15);
  });

  it("knows the stale tooltip for every locale it will check", () => {
    const unknown = ALL_LOCALES.map(([name]) => name).filter((name) => !STALE_TOOLTIPS[name]);
    expect(unknown).toEqual([]);
  });

  it.each(ALL_LOCALES)("%s carries the sensitivity key set", (_name, locale) => {
    expect({
      missing: ADDED.filter((path) => !isText(at(locale, path))),
      lingering: REMOVED.filter((path) => at(locale, path) !== undefined),
      dropped: KEPT.filter((path) => !isText(at(locale, path))),
    }).toEqual({ missing: [], lingering: [], dropped: [] });
  });

  it.each(ALL_LOCALES)("%s stops describing the old two-sided range", (name, locale) => {
    expect(at(locale, "alerts.anomaly.sensitivityTooltip")).not.toBe(STALE_TOOLTIPS[name]);
  });

  // Only en-US is required to ship both plural forms: it is the source locale
  // whose shape defines the message API. A language that does not inflect here
  // (zh, ja, ko, vi) is correct to supply one form, and vue-i18n renders it.
  // Only the per-day hint can render count === 1. The every-N-days branch runs
  // solely when perDay < 0.5, so N >= 2 and a singular form is unreachable.
  it("en-US ships both plural forms of the per-day hint", () => {
    expect(String(at(en, "alerts.anomaly.sensitivityHintPerDay")).split("|")).toHaveLength(2);
  });

  it.each(ALL_LOCALES)("%s keeps the every-N-days hint a single form", (_name, locale) => {
    expect(String(at(locale, "alerts.anomaly.sensitivityHintEveryNDays")).split("|")).toHaveLength(
      1,
    );
  });

  it("en-US no longer says scores outside the range are ignored", () => {
    const tooltip = String(at(en, "alerts.anomaly.sensitivityTooltip")).toLowerCase();
    // The old copy inverted the detector: it alerts ON the extremes.
    expect(tooltip).not.toContain("outside this range");
  });
});
