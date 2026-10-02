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
// so nothing else would notice the other locales keeping the wrong sentence.
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
  "alerts.anomaly.level",
  "alerts.anomaly.sensitivityBudgetTooltip",
  "alerts.anomaly.budgetHintPerDay",
  "alerts.anomaly.budgetHintPerWeek",
  "alerts.anomaly.budgetLabel",
  "alerts.anomaly.budgetPerDay",
  "alerts.anomaly.budgetPerWeek",
  "alerts.anomaly.budgetRange",
  "alerts.anomaly.summaryBudgetPerDay",
  "alerts.anomaly.summaryBudgetPerWeek",
  "alerts.anomaly.summaryThresholdPercentile",
  "alerts.anomaly.seriesScoreDeviation",
  "alerts.anomaly.seriesDropDeviation",
  "alerts.anomaly.seriesExpected",
  "alerts.anomaly.seriesExpectedRange",
  "alerts.anomaly.seriesDropAbsence",
  "alerts.anomaly.detectorInternals",
  "alerts.anomaly.noDetectionResults",
  "alerts.anomaly.tooltipAnomalyAbove",
  "alerts.anomaly.tooltipAnomalyBelow",
  "alerts.anomaly.bandWidthHint",
  "alerts.anomaly.bandWidthRange",
  "alerts.anomaly.bandGroupingHourOfWeek",
  "alerts.anomaly.bandGroupingHourOfDay",
  "alerts.anomaly.bandGroupingGlobal",
  "alerts.anomaly.alertDirection",
  "alerts.anomaly.alertDirectionTooltip",
  "alerts.anomaly.directionBoth",
  "alerts.anomaly.directionAbove",
  "alerts.anomaly.directionBelow",
  "alerts.anomaly.windowShare",
  "alerts.anomaly.windowShareTooltip",
  "alerts.anomaly.windowBuckets",
  "alerts.anomaly.windowFirePct",
  "alerts.anomaly.windowRecoverPct",
  "alerts.anomaly.windowRecoverSameAsFire",
  "alerts.anomaly.windowShareHint",
  "alerts.anomaly.windowBucketsRange",
  "alerts.anomaly.windowFireRange",
  "alerts.anomaly.windowRecoverRange",
  "alerts.anomaly.bandGrouping",
  "alerts.anomaly.trainingSpan",
  "alerts.anomaly.trainingSpanValue",
  "alerts.anomaly.summaryBandWidthAuto",
  "alerts.anomaly.bandCaption",
  "alerts.anomaly.trainingWindowFloorHint",
  "alerts.anomaly.windowBucketsSpan",
  "alerts.anomaly.bandGroupingHourOfWeekIfData",
  "alerts.anomaly.detectionAlreadyRunning",
  "alerts.anomaly.daysUnit",
  "alerts.anomaly.windowShareCompact",
  "alerts.anomaly.summaryDirection",
  "alerts.anomaly.summaryWindowShare",
];

// Keys orphaned by retired UI; a locale still carrying one is dead copy nothing else would flag.
const REMOVED = [
  "alerts.anomaly.anomalyScoreRange",
  "alerts.anomaly.maxThresholdMarkLine",
  "alerts.anomaly.minThresholdMarkLine",
  "alerts.anomaly.dataPreview",
  "alerts.anomaly.loadData",
  "alerts.anomaly.clickLoadDataHint",
  "alerts.anomaly.selectStreamFirstTooltip",
  "alerts.anomaly.enterSqlFirst",
  "alerts.anomaly.sensitivityHintPerDay",
  "alerts.anomaly.sensitivityHintEveryNDays",
  "alerts.anomaly.summaryThresholdRate",
  "alerts.anomaly.seriesDeviation",
  "alerts.anomaly.seasonalityWeekly",
  "alerts.anomaly.noticeHybridFallback",
  "alerts.anomaly.noticeHybridFallbackTooltip",
  "alerts.anomaly.sensitivityRange",
  "alerts.anomaly.sensitivityHintPercentile",
  "alerts.anomaly.sensitivityNotDataPercentile",
  "alerts.anomaly.bandWidth",
  "alerts.anomaly.bandWidthAuto",
  "alerts.anomaly.bandWidthK",
  "alerts.anomaly.summaryBandWidthManual",
  "alerts.anomaly.trainingWindowSeasonality",
  "alerts.anomaly.percentile",
];

// Still read by AlertConfigSummary.vue — it sits one paragraph from the
// deletion list in the spec, so it is the one to delete by accident.
const KEPT = ["alerts.sensitivity", "alerts.anomaly.sensitivityTooltip"];

// The backwards copy, frozen per locale. Asserting each locale MOVED off its own
// stale sentence is the only mechanical way to catch a translation pass that
// updated English and left the other locales describing behaviour that never existed.
const STALE_TOOLTIPS: Record<string, string> = {
  "ar-SA":
    "اضبط نطاق نقاط الشذوذ للتحكم في الحساسية. النقاط التي تكون خارج هذا النطاق لن تفعل التنبيهات. استخدم المخطط لعرض البيانات التاريخية وضبط المؤشر وفقا لذلك.",
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

// The SECOND falsified generation, frozen per locale: "97 flags the most
// unusual 3%" promised a live flag share the deployed configs measurably do
// not deliver (63.9% under the bar on the worst config), and under the hybrid
// gate clearing the percentile alone flags nothing. Every locale must stay
// off this sentence too.
const STALE_PERCENTILE_PROMISE_TOOLTIPS: Record<string, string> = {
  "ar-SA":
    "تحدد الحساسية مدى غرابة المجموعة قبل اعتبارها شاذة، كنسبة مئينية من نتائج تدريب النموذج. القيمة 97 ترصد أكثر 3٪ غرابة. كلما ارتفعت القيمة قلت التنبيهات وزادت موثوقيتها.",
  "de-DE":
    "Wie ungewöhnlich ein Bucket sein muss, bevor es markiert wird, als Perzentil der Trainingswerte des Modells. 97 markiert die ungewöhnlichsten 3 %. Jedes markierte Bucket löst eine Warnmeldung aus, daher markiert ein niedrigerer Wert mehr Buckets und sendet mehr Warnmeldungen.",
  "en-US":
    "How unusual a bucket must be before it is flagged, as a percentile of the model's training scores. 97 flags the most unusual 3%. Every flagged bucket sends an alert, so a lower value flags more buckets and sends more alerts.",
  "es-ES":
    "Cuán inusual debe ser un bucket para que se marque, como percentil de las puntuaciones de entrenamiento del modelo. 97 marca el 3 % más inusual. Cada bucket marcado envía una alerta, así que un valor más bajo marca más buckets y envía más alertas.",
  "fr-FR":
    "À quel point un compartiment doit être inhabituel avant d'être signalé, en tant que percentile des scores d'entraînement du modèle. 97 signale les 3 % les plus inhabituels. Chaque compartiment signalé déclenche une alerte : une valeur plus basse signale donc davantage de compartiments et envoie davantage d'alertes.",
  "it-IT":
    "Quanto insolito deve essere un bucket prima di essere segnalato, come percentile dei punteggi di addestramento del modello. 97 segnala il 3 % più insolito. Ogni bucket segnalato invia un avviso, quindi un valore più basso segnala più bucket e invia più avvisi.",
  "ja-JP":
    "バケットがフラグされるために必要な異常度を、モデルのトレーニングスコアのパーセンタイルとして示します。97 は最も異常な上位 3% をフラグします。フラグされたバケットごとにアラートが送信されるため、値を下げるほど多くのバケットがフラグされ、アラートも多くなります。",
  "ko-KR":
    "플래그가 지정되기 전에 버킷이 얼마나 비정상적이어야 하는지를 모델 훈련 점수의 백분위수로 나타냅니다. 97은 가장 비정상적인 3%를 플래그합니다. 플래그된 버킷마다 알림이 전송되므로, 값이 낮을수록 더 많은 버킷이 플래그되고 알림도 더 많이 보냅니다.",
  "nl-NL":
    "Hoe ongebruikelijk een bucket moet zijn voordat deze wordt gemarkeerd, als een percentiel van de trainingsscores van het model. 97 markeert de meest ongebruikelijke 3%. Elke gemarkeerde bucket verstuurt een melding, dus een lagere waarde markeert meer buckets en verstuurt meer meldingen.",
  "pl-PL":
    "Jak nietypowy musi być przedział, zanim zostanie oznaczony, jako percentyl wyników treningowych modelu. 97 oznacza najbardziej nietypowe 3%. Każdy oznaczony przedział wysyła alert, więc niższa wartość powoduje oznaczenie większej liczby przedziałów i wysłanie większej liczby alertów.",
  "pt-PT":
    "O quão incomum um bucket deve ser antes de ser sinalizado, como um percentil das pontuações de treinamento do modelo. 97 sinaliza os 3% mais incomuns. Cada bucket sinalizado envia um alerta, por isso um valor mais baixo sinaliza mais buckets e envia mais alertas.",
  "ru-RU":
    "Насколько необычным должен быть бакет, чтобы его пометили, в виде процентиля обучающих оценок модели. 97 помечает самые необычные 3%. Каждый помеченный бакет отправляет оповещение, поэтому меньшее значение помечает больше бакетов и отправляет больше оповещений.",
  "tr-TR":
    "Bir aralığın işaretlenmeden önce ne kadar olağandışı olması gerektiği, modelin eğitim puanlarının bir yüzdelik dilimi olarak ifade edilir. 97, en olağandışı %3'ü işaretler. İşaretlenen her aralık bir uyarı gönderir; bu nedenle daha düşük bir değer daha fazla aralığı işaretler ve daha fazla uyarı gönderir.",
  "vi-VN":
    "Mức độ bất thường mà một bucket phải đạt để bị gắn cờ, được tính theo phân vị của điểm số huấn luyện của mô hình. 97 gắn cờ 3% bất thường nhất. Mỗi bucket bị gắn cờ đều gửi một cảnh báo, nên giá trị thấp hơn gắn cờ nhiều bucket hơn và gửi nhiều cảnh báo hơn.",
  "zh-CN":
    "一个数据桶在被标记前需要有多异常，以模型训练分数的百分位数表示。97 会标记最异常的 3%。每个被标记的数据桶都会发送告警，因此取值越低，被标记的数据桶越多，发出的告警也越多。",
  "zh-TW":
    "一個區間在被標記為異常前必須有多不尋常，以模型訓練分數的百分位數表示。97 會標記最不尋常的 3%。每個被標記的區間都會發送警示，因此數值越低，被標記的區間越多，發出的警示也越多。",
};

// The truthful copy, pinned VERBATIM per locale. "Moved off the stale
// sentence" alone would pass any wording, including a new false one — this
// table is what makes a drifted retranslation fail until it is re-verified
// and re-pinned here.
const PINNED_COPY: Record<string, { tooltip: string; budgetTooltip: string; hint: string }> = {
  "ar-SA": {
    tooltip:
      "تُقارن كل فترة بشريط يساوي القيمة المتوقعة ± المستوى × σ، حيث σ هو التشتت المعتاد لتلك الساعة. تُعلَّم الفترة الواقعة خارج الشريط على أنها شاذة. الشريط الأعرض (مستوى أعلى) يرسل تنبيهات أقل، والأضيق يرسل أكثر. تُطبَّق التغييرات دون إعادة تدريب.",
    budgetTooltip:
      "الحد الأقصى لعدد التنبيهات التي يمكن لهذا الإعداد إرسالها، ويُفرض عند الإرسال. يستمر الكشف في تقييم كل فترة؛ وعند استنفاد الميزانية تُمنع التنبيهات الإضافية حتى تتجدد.",
    hint: "تُعلَّم الفترة على أنها شاذة عندما تقع خارج القيمة المتوقعة ± {k}σ.",
  },
  "de-DE": {
    tooltip:
      "Jeder Bucket wird mit einem Band aus Erwartungswert ± Stufe × σ verglichen, wobei σ die typische Streuung für diese Stunde ist. Ein Bucket außerhalb des Bands wird als Anomalie markiert. Ein breiteres Band (höhere Stufe) sendet weniger Warnmeldungen, ein schmaleres mehr. Änderungen gelten ohne erneutes Training.",
    budgetTooltip:
      "Die maximale Zahl von Warnmeldungen, die diese Konfiguration zustellen darf — bei der Zustellung erzwungen. Die Erkennung bewertet weiterhin jeden Bucket; ist das Budget aufgebraucht, werden weitere Warnmeldungen unterdrückt, bis es sich auffüllt.",
    hint: "Ein Bucket wird markiert, wenn er außerhalb von Erwartungswert ± {k}σ liegt.",
  },
  "en-US": {
    tooltip:
      "Each bucket is compared with a band of expected ± level × σ, where σ is the typical spread for that hour. A bucket outside the band is flagged as anomalous. A wider band (higher level) sends fewer alerts; a narrower one sends more. Changes apply without retraining.",
    budgetTooltip:
      "The maximum number of alerts this configuration may deliver, enforced at delivery. Detection still scores every bucket; once the budget is spent, further alerts are suppressed until it refills.",
    hint: "A bucket is flagged when it falls outside expected ± {k}σ.",
  },
  "es-ES": {
    tooltip:
      "Cada bucket se compara con una banda de esperado ± nivel × σ, donde σ es la dispersión típica de esa hora. Un bucket fuera de la banda se marca como anómalo. Una banda más ancha (nivel más alto) envía menos alertas; una más estrecha, más. Los cambios se aplican sin reentrenar.",
    budgetTooltip:
      "El número máximo de alertas que esta configuración puede entregar, aplicado en la entrega. La detección sigue puntuando cada bucket; agotado el presupuesto, las alertas adicionales se suprimen hasta que se repone.",
    hint: "Un bucket se marca cuando queda fuera de esperado ± {k}σ.",
  },
  "fr-FR": {
    tooltip:
      "Chaque intervalle est comparé à une bande égale à la valeur attendue ± niveau × σ, où σ est la dispersion typique pour cette heure. Un intervalle hors de la bande est signalé comme anormal. Une bande plus large (niveau plus élevé) envoie moins d'alertes ; une bande plus étroite en envoie plus. Les modifications s'appliquent sans réentraînement.",
    budgetTooltip:
      "Le nombre maximal d'alertes que cette configuration peut délivrer, appliqué à la livraison. La détection continue de noter chaque compartiment ; une fois le budget épuisé, les alertes supplémentaires sont supprimées jusqu'à ce qu'il se reconstitue.",
    hint: "Un intervalle est signalé lorsqu'il sort de la valeur attendue ± {k}σ.",
  },
  "it-IT": {
    tooltip:
      "Ogni intervallo viene confrontato con una fascia pari al valore previsto ± livello × σ, dove σ è la dispersione tipica per quell'ora. Un intervallo fuori dalla fascia viene segnalato come anomalo. Una fascia più ampia (livello più alto) invia meno avvisi; una più stretta ne invia di più. Le modifiche si applicano senza riaddestramento.",
    budgetTooltip:
      "Il numero massimo di avvisi che questa configurazione può recapitare, applicato al recapito. Il rilevamento continua a valutare ogni bucket; esaurito il budget, gli avvisi ulteriori vengono soppressi finché non si ricarica.",
    hint: "Un intervallo viene segnalato quando esce dal valore previsto ± {k}σ.",
  },
  "ja-JP": {
    tooltip:
      "各バケットは予想値 ± レベル × σ の帯と比較されます。σ はその時間帯の典型的なばらつきです。帯の外にあるバケットは異常としてフラグされます。帯を広く (レベルを高く) するとアラートは減り、狭くすると増えます。変更は再学習なしで適用されます。",
    budgetTooltip:
      "この設定が配信できるアラートの上限で、配信時に強制されます。検出はすべてのバケットをスコアリングし続けます。予算を使い切ると、回復するまで追加のアラートは抑制されます。",
    hint: "バケットが予想値 ± {k}σ の外に出ると異常としてフラグされます。",
  },
  "ko-KR": {
    tooltip:
      "각 버킷은 예상값 ± 수준 × σ 띠와 비교되며, σ는 해당 시간대의 일반적인 산포입니다. 띠 밖에 있는 버킷은 이상으로 표시됩니다. 띠가 넓을수록(수준이 높을수록) 알림이 줄고, 좁을수록 늘어납니다. 변경 사항은 재학습 없이 적용됩니다.",
    budgetTooltip:
      "이 구성이 전달할 수 있는 알림의 최대 개수로, 전달 시점에 강제됩니다. 감지는 모든 버킷을 계속 채점하며, 예산이 소진되면 회복될 때까지 추가 알림이 억제됩니다.",
    hint: "버킷이 예상값 ± {k}σ를 벗어나면 이상으로 표시됩니다.",
  },
  "nl-NL": {
    tooltip:
      "Elk interval wordt vergeleken met een band van verwachte waarde ± niveau × σ, waarbij σ de typische spreiding voor dat uur is. Een interval buiten de band wordt als afwijkend gemarkeerd. Een bredere band (hoger niveau) stuurt minder waarschuwingen, een smallere meer. Wijzigingen gelden zonder opnieuw te trainen.",
    budgetTooltip:
      "Het maximale aantal meldingen dat deze configuratie mag bezorgen, afgedwongen bij bezorging. Detectie blijft elke bucket scoren; is het budget op, dan worden verdere meldingen onderdrukt tot het zich aanvult.",
    hint: "Een interval wordt gemarkeerd als het buiten verwachte waarde ± {k}σ valt.",
  },
  "pl-PL": {
    tooltip:
      "Każdy przedział jest porównywany z pasem wartość oczekiwana ± poziom × σ, gdzie σ to typowy rozrzut dla danej godziny. Przedział poza pasem jest oznaczany jako anomalia. Szerszy pas (wyższy poziom) wysyła mniej alertów, węższy więcej. Zmiany obowiązują bez ponownego trenowania.",
    budgetTooltip:
      "Maksymalna liczba alertów, jaką ta konfiguracja może dostarczyć, egzekwowana przy dostarczaniu. Wykrywanie nadal ocenia każdy przedział; po wyczerpaniu budżetu kolejne alerty są wstrzymywane, aż budżet się odnowi.",
    hint: "Przedział jest oznaczany, gdy wychodzi poza wartość oczekiwaną ± {k}σ.",
  },
  "pt-PT": {
    tooltip:
      "Cada intervalo é comparado com uma faixa de valor esperado ± nível × σ, em que σ é a dispersão típica dessa hora. Um intervalo fora da faixa é assinalado como anómalo. Uma faixa mais larga (nível mais alto) envia menos alertas; uma mais estreita envia mais. As alterações aplicam-se sem novo treino.",
    budgetTooltip:
      "O número máximo de alertas que esta configuração pode entregar, aplicado na entrega. A deteção continua a pontuar todos os buckets; esgotado o orçamento, os alertas adicionais são suprimidos até ele se repor.",
    hint: "Um intervalo é assinalado quando sai do valor esperado ± {k}σ.",
  },
  "ru-RU": {
    tooltip:
      "Каждый интервал сравнивается с полосой «ожидаемое значение ± уровень × σ», где σ — типичный разброс для этого часа. Интервал за пределами полосы помечается как аномальный. Более широкая полоса (более высокий уровень) даёт меньше оповещений, более узкая — больше. Изменения применяются без переобучения.",
    budgetTooltip:
      "Максимальное число оповещений, которое эта конфигурация может доставить; ограничение применяется при доставке. Обнаружение продолжает оценивать каждый бакет; когда бюджет исчерпан, дальнейшие оповещения подавляются, пока он не восстановится.",
    hint: "Интервал помечается, когда выходит за пределы ожидаемого значения ± {k}σ.",
  },
  "tr-TR": {
    tooltip:
      "Her aralık, beklenen ± seviye × σ bandıyla karşılaştırılır; σ o saat için tipik yayılımdır. Bandın dışındaki bir aralık anormal olarak işaretlenir. Daha geniş bir bant (daha yüksek seviye) daha az uyarı, daha dar bir bant daha fazla uyarı gönderir. Değişiklikler yeniden eğitim olmadan uygulanır.",
    budgetTooltip:
      "Bu yapılandırmanın teslim edebileceği en fazla uyarı sayısı; teslimde uygulanır. Algılama her aralığı puanlamaya devam eder; bütçe tükenince, yenilenene kadar ek uyarılar bastırılır.",
    hint: "Bir aralık beklenen ± {k}σ dışına çıktığında işaretlenir.",
  },
  "vi-VN": {
    tooltip:
      "Mỗi khoảng được so sánh với dải giá trị dự kiến ± mức × σ, trong đó σ là độ phân tán điển hình của giờ đó. Khoảng nằm ngoài dải sẽ được gắn cờ là bất thường. Dải rộng hơn (mức cao hơn) gửi ít cảnh báo hơn; dải hẹp hơn gửi nhiều hơn. Thay đổi được áp dụng mà không cần huấn luyện lại.",
    budgetTooltip:
      "Số cảnh báo tối đa mà cấu hình này được phép gửi, được áp đặt khi gửi. Việc phát hiện vẫn chấm điểm mọi bucket; khi ngân sách cạn, các cảnh báo tiếp theo bị chặn cho đến khi ngân sách hồi phục.",
    hint: "Một khoảng sẽ được gắn cờ khi nằm ngoài giá trị dự kiến ± {k}σ.",
  },
  "zh-CN": {
    tooltip:
      "每个时间桶都会与“预期值 ± 级别 × σ”的带进行比较，其中 σ 是该小时的典型离散度。落在带外的时间桶会被标记为异常。带越宽（级别越高），告警越少；带越窄，告警越多。更改无需重新训练即可生效。",
    budgetTooltip:
      "此配置可投递告警的上限，在投递时强制执行。检测仍会为每个数据桶评分；预算用尽后，多余的告警将被抑制，直到预算恢复。",
    hint: "当时间桶超出预期值 ± {k}σ 时会被标记为异常。",
  },
  "zh-TW": {
    tooltip:
      "每個時間桶都會與「預期值 ± 級別 × σ」的帶比較，其中 σ 是該小時的典型離散度。落在帶外的時間桶會被標記為異常。帶越寬（級別越高），警示越少；帶越窄，警示越多。變更不需重新訓練即可生效。",
    budgetTooltip:
      "此設定可傳送警示的上限，於傳送時強制執行。偵測仍會為每個區間評分；預算用盡後，多餘的警示會被抑制，直到預算回復。",
    hint: "當時間桶超出預期值 ± {k}σ 時會被標記為異常。",
  },
};

describe("anomaly sensitivity locale parity", () => {
  it("reads every locale file", () => {
    // An exact count: a glob that silently matched fewer would make every
    // per-locale assertion below vacuous.
    expect(ALL_LOCALES.map(([name]) => name)).toHaveLength(16);
  });

  it("knows the stale tooltips and the pinned copy for every locale it will check", () => {
    expect({
      staleV1: ALL_LOCALES.map(([name]) => name).filter((name) => !STALE_TOOLTIPS[name]),
      staleV2: ALL_LOCALES.map(([name]) => name).filter(
        (name) => !STALE_PERCENTILE_PROMISE_TOOLTIPS[name],
      ),
      pinned: ALL_LOCALES.map(([name]) => name).filter((name) => !PINNED_COPY[name]),
    }).toEqual({ staleV1: [], staleV2: [], pinned: [] });
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

  it.each(ALL_LOCALES)(
    "%s stops promising a live flag share from the percentile",
    (name, locale) => {
      expect(at(locale, "alerts.anomaly.sensitivityTooltip")).not.toBe(
        STALE_PERCENTILE_PROMISE_TOOLTIPS[name],
      );
    },
  );

  // Not "moved off the old sentence" — the exact new sentence, per locale and
  // per mode. Any rewording fails until it is verified truthful and re-pinned.
  it.each(ALL_LOCALES)("%s ships exactly the pinned truthful copy", (name, locale) => {
    expect({
      tooltip: at(locale, "alerts.anomaly.sensitivityTooltip"),
      budgetTooltip: at(locale, "alerts.anomaly.sensitivityBudgetTooltip"),
      hint: at(locale, "alerts.anomaly.bandWidthHint"),
    }).toEqual(PINNED_COPY[name]);
  });

  // The control sets k directly, so its tooltip speaks in σ and quotes no percentile preset.
  it.each(ALL_LOCALES)("%s describes the band in σ, not a training percentile", (_name, locale) => {
    const tooltip = String(at(locale, "alerts.anomaly.sensitivityTooltip"));
    expect(tooltip).toContain("σ");
    expect(tooltip).not.toMatch(/(?<!\d)9[579](?!\d)/);
  });

  it("en-US no longer says scores outside the range are ignored", () => {
    const tooltip = String(at(en, "alerts.anomaly.sensitivityTooltip")).toLowerCase();
    // The old copy inverted the detector: it alerts ON the extremes.
    expect(tooltip).not.toContain("outside this range");
  });

  // The only spacing mechanism is the alert cooldown; no hysteresis exists to promise.
  it("en-US does not claim flagged buckets are suppressed before alerting", () => {
    const tooltip = String(at(en, "alerts.anomaly.sensitivityTooltip")).toLowerCase();
    for (const claim of [
      "isolated flag",
      "does not open",
      "barely changes",
      "barely move",
      "stays flat",
      "without alerting",
      "hysteresis",
    ]) {
      expect(tooltip).not.toContain(claim);
    }
  });

  it("en-US ties a wider band to fewer alerts and states it needs no retrain", () => {
    const tooltip = String(at(en, "alerts.anomaly.sensitivityTooltip")).toLowerCase();
    expect(tooltip).toContain("wider band");
    expect(tooltip).toContain("fewer alerts");
    expect(tooltip).toContain("without retraining");
  });

  // A threshold sweep found recall flat across p90-p97, so lowering flags more, it detects no more.
  it("en-US does not claim a lower percentile catches more incidents", () => {
    const tooltip = String(at(en, "alerts.anomaly.sensitivityTooltip")).toLowerCase();
    for (const claim of [
      "catches more",
      "catch more",
      "more incidents",
      "more real incidents",
      "detects more",
      "detect more",
      "finds more",
      "find more",
      "miss fewer",
      "misses fewer",
    ]) {
      expect(tooltip).not.toContain(claim);
    }
  });

  // A band width is no rate; any live count or flag share promised from it would be fiction.
  it("en-US band-mode copy promises no alert rate or flag share", () => {
    for (const key of ["alerts.anomaly.sensitivityTooltip", "alerts.anomaly.bandWidthHint"]) {
      const text = String(at(en, key)).toLowerCase();
      for (const promise of [
        "about ",
        " per day",
        " per week",
        "% of buckets",
        "flags the most unusual",
        "anomaly rate",
      ]) {
        expect(text, `${key} must not contain "${promise}"`).not.toContain(promise);
      }
    }
  });

  // The budget is a CEILING: measured at tight budgets, the cap is spent on
  // whatever fires first (1/week on fixtures bought zero labelled events). No
  // ranking, priority, or "your N most important" promise is defensible.
  it("en-US budget-mode copy promises a ceiling, never a ranking", () => {
    for (const key of [
      "alerts.anomaly.sensitivityBudgetTooltip",
      "alerts.anomaly.budgetHintPerDay",
      "alerts.anomaly.budgetHintPerWeek",
      "alerts.anomaly.summaryBudgetPerDay",
      "alerts.anomaly.summaryBudgetPerWeek",
    ]) {
      const text = String(at(en, key)).toLowerCase();
      for (const claim of [
        "most important",
        "most unusual",
        "most anomalous",
        "highest-scoring",
        "highest scoring",
        "top ",
        "worst ",
        "best ",
        "prioriti",
        "ranked",
        "ranking",
        "win",
        "guarantee",
      ]) {
        expect(text, `${key} must not contain "${claim}"`).not.toContain(claim);
      }
    }
  });

  // "Percentile" named two unrelated things: the Sensitivity number and the
  // Detection Function's p50/p95/p99. The label is what a reader sees first, so
  // it must not reach for the Detection Function's vocabulary to name itself.
  it("en-US labels the sensitivity number without detection-function vocabulary", () => {
    const label = String(at(en, "alerts.anomaly.level")).toLowerCase();
    expect(label).not.toContain("percentile");
    expect(label).not.toMatch(/\bp\d{2}\b/);
    // Still a label, not a sentence — it sits in a 21.75rem-wide field column.
    expect(label.split(/\s+/).length).toBeLessThanOrEqual(3);
  });

  // The other half of the same collision: the Detection Function's p-levels rank
  // the FIELD's values, and must never read as an alerting/sensitivity control.
  it("en-US keeps the detection-function tooltip in data space, not alert space", () => {
    const tooltip = String(at(en, "alerts.anomaly.detectionFunctionTooltip")).toLowerCase();
    expect(tooltip).toMatch(/\bp50\b/);
    expect(tooltip).toMatch(/\bp95\b/);
    // Names the thing being measured, so p95 reads as "of a field", not "of scores".
    expect(tooltip).toMatch(/field/);
    for (const claim of ["sensitivity", "how unusual", "training score", "alerts when"]) {
      expect(tooltip, `detectionFunctionTooltip must not contain "${claim}"`).not.toContain(claim);
    }
  });

  // Anomalies are marked in score space by a trained model, so they cannot appear
  // on the config-time value preview. The caption has to send the reader somewhere
  // REAL — pinned against the rendered label, not a phrase no screen shows.
  it("en-US points the preview reader at a destination the app actually renders", () => {
    const caption = String(at(en, "alerts.anomaly.previewCaption")).toLowerCase();
    expect(caption).toContain("training");
    const destination = String(at(en, "alerts.anomaly.detectionCharts")).toLowerCase();
    expect(destination.length).toBeGreaterThan(0);
    expect(caption).toContain(destination);
  });
});
