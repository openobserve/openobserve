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

// Kept in step with sensitivityTiers in AnomalyDetectionConfig.vue.
const BALANCED_PERCENTILE = 97;

// The reverted retune's default; no locale may still quote it as the current one.
const RETIRED_PERCENTILE = 95;

const at = (root: Json, path: string): unknown =>
  path.split(".").reduce<unknown>((node, key) => (node as Json | undefined)?.[key], root);

const isText = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;

const ADDED = [
  "alerts.anomaly.sensitivityConservative",
  "alerts.anomaly.sensitivityBalanced",
  "alerts.anomaly.sensitivityAggressive",
  "alerts.anomaly.percentile",
  "alerts.anomaly.sensitivityRange",
  // Mode-aware copy: the honest percentile hint, the budget-mode strings, the per-kind deviation labels.
  "alerts.anomaly.sensitivityHintPercentile",
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
  "alerts.anomaly.bandWidth",
  "alerts.anomaly.bandWidthAuto",
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
  "alerts.anomaly.bandWidthK",
  "alerts.anomaly.summaryBandWidthAuto",
  "alerts.anomaly.summaryBandWidthManual",
  "alerts.anomaly.bandCaption",
  "alerts.anomaly.trainingWindowFloorHint",
  "alerts.anomaly.windowBucketsSpan",
  "alerts.anomaly.bandGroupingHourOfWeekIfData",
  "alerts.anomaly.detectionAlreadyRunning",
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
      "تحصل كل فترة على درجة: مدى بُعد قيمتها عن القيمة المتوقعة لتلك الساعة، مقيسًا بوحدات التشتت المعتاد. نصف عرض الشريط هو درجة التدريب عند هذا المئين (97 تعني أن 97٪ من فترات التدريب حصلت على درجة أقل)، ولا يقل أبدًا عن 3 وحدات تشتت معتاد. إذا حددت عرض شريط، فإنه يحل محل هذا العرض المشتق من المئين. تُطلق الفترة الواقعة خارج الشريط تنبيهًا. قد تختلف البيانات الفعلية عن بيانات التدريب، لذا فهذا ليس معدل تنبيهات. القيمة الأقل تضيّق الشريط وترسل عادة تنبيهات أكثر؛ وتباعد فترة التهدئة التنبيهات المتكررة.",
    budgetTooltip:
      "الحد الأقصى لعدد التنبيهات التي يمكن لهذا الإعداد إرسالها، ويُفرض عند الإرسال. يستمر الكشف في تقييم كل فترة؛ وعند استنفاد الميزانية تُمنع التنبيهات الإضافية حتى تتجدد.",
    hint: "تُطلق النافذة تنبيهًا عندما تبدو أكثر غرابة من {percentile}% مما رآه النموذج أثناء التدريب. ويعتمد عدد التنبيهات الناتجة على بياناتك.",
  },
  "de-DE": {
    tooltip:
      "Jeder Bucket erhält einen Score: wie weit sein Wert vom erwarteten Wert für diese Stunde entfernt liegt, gemessen in typischen Streuungen. Die halbe Breite des Bands ist der Trainings-Score bei diesem Perzentil (97 bedeutet, dass 97 % der Trainings-Buckets niedriger lagen), aber nie weniger als 3 typische Streuungen. Wenn Sie eine Bandbreite festlegen, ersetzt sie diese aus dem Perzentil abgeleitete Breite. Ein Bucket außerhalb des Bands löst eine Warnmeldung aus. Live-Daten können vom Training abweichen; dies ist also keine Alarmrate. Ein niedrigerer Wert verengt das Band und sendet in der Regel mehr Warnmeldungen; eine Abklingzeit begrenzt Wiederholungen.",
    budgetTooltip:
      "Die maximale Zahl von Warnmeldungen, die diese Konfiguration zustellen darf — bei der Zustellung erzwungen. Die Erkennung bewertet weiterhin jeden Bucket; ist das Budget aufgebraucht, werden weitere Warnmeldungen unterdrückt, bis es sich auffüllt.",
    hint: "Ein Bucket löst eine Warnmeldung aus, wenn er ungewöhnlicher erscheint als {percentile} % dessen, was das Modell im Training gesehen hat. Wie viele Warnmeldungen das bedeutet, hängt von Ihren Daten ab.",
  },
  "en-US": {
    tooltip:
      "Each bucket gets a score: how far its value sits from the expected value for that hour, in units of typical spread. The band's half-width is the training score at this percentile (97 means 97% of training buckets scored lower), and never less than 3 typical spreads. If you set a band width, it replaces this percentile-derived width. A bucket outside the band alerts. Live data can differ from training, so this is not an alert rate. A lower value narrows the band and generally sends more alerts; a cooldown spaces out repeats.",
    budgetTooltip:
      "The maximum number of alerts this configuration may deliver, enforced at delivery. Detection still scores every bucket; once the budget is spent, further alerts are suppressed until it refills.",
    hint: "A bucket alerts when it looks more unusual than {percentile}% of what the model saw in training. How many alerts that means depends on your data.",
  },
  "es-ES": {
    tooltip:
      "Cada bucket recibe una puntuación: lo lejos que está su valor del valor esperado para esa hora, en unidades de dispersión típica. La mitad del ancho de la banda es la puntuación de entrenamiento en este percentil (97 significa que el 97 % de los buckets de entrenamiento puntuaron por debajo), y nunca menos de 3 dispersiones típicas. Si estableces un ancho de banda, sustituye este ancho derivado del percentil. Un bucket fuera de la banda genera una alerta. Los datos reales pueden diferir del entrenamiento, así que esto no es una tasa de alertas. Un valor más bajo estrecha la banda y suele enviar más alertas; un periodo de enfriamiento espacia las repeticiones.",
    budgetTooltip:
      "El número máximo de alertas que esta configuración puede entregar, aplicado en la entrega. La detección sigue puntuando cada bucket; agotado el presupuesto, las alertas adicionales se suprimen hasta que se repone.",
    hint: "Un intervalo genera una alerta cuando parece más inusual que el {percentile}% de lo que el modelo vio durante el entrenamiento. Cuántas alertas supone eso depende de tus datos.",
  },
  "fr-FR": {
    tooltip:
      "Chaque intervalle reçoit un score : l'écart entre sa valeur et la valeur attendue pour cette heure, exprimé en dispersions typiques. La demi-largeur de la bande est le score d'entraînement à ce percentile (97 signifie que 97 % des intervalles d'entraînement ont obtenu un score inférieur), et jamais moins de 3 dispersions typiques. Si vous définissez une largeur de bande, elle remplace cette largeur dérivée du percentile. Un intervalle hors de la bande déclenche une alerte. Les données réelles peuvent différer de l'entraînement : ce n'est donc pas un taux d'alertes. Une valeur plus basse resserre la bande et envoie généralement plus d'alertes ; un délai de récupération espace les répétitions.",
    budgetTooltip:
      "Le nombre maximal d'alertes que cette configuration peut délivrer, appliqué à la livraison. La détection continue de noter chaque compartiment ; une fois le budget épuisé, les alertes supplémentaires sont supprimées jusqu'à ce qu'il se reconstitue.",
    hint: "Un intervalle déclenche une alerte lorsqu'il paraît plus inhabituel que {percentile}% de ce que le modèle a vu à l'entraînement. Le nombre d'alertes que cela représente dépend de vos données.",
  },
  "it-IT": {
    tooltip:
      "Ogni intervallo riceve un punteggio: quanto il suo valore si discosta dal valore previsto per quell'ora, in unità di dispersione tipica. La semi-ampiezza della fascia è il punteggio di addestramento a questo percentile (97 significa che il 97% degli intervalli di addestramento ha ottenuto un punteggio inferiore) e non è mai inferiore a 3 dispersioni tipiche. Se imposti un'ampiezza della fascia, sostituisce questa ampiezza ricavata dal percentile. Un intervallo fuori dalla fascia genera un avviso. I dati reali possono differire dall'addestramento, quindi questo non è un tasso di avvisi. Un valore più basso restringe la fascia e in genere invia più avvisi; un periodo di cooldown distanzia le ripetizioni.",
    budgetTooltip:
      "Il numero massimo di avvisi che questa configurazione può recapitare, applicato al recapito. Il rilevamento continua a valutare ogni bucket; esaurito il budget, gli avvisi ulteriori vengono soppressi finché non si ricarica.",
    hint: "Un intervallo genera un avviso quando appare più insolito del {percentile}% di ciò che il modello ha visto durante l'addestramento. Quanti avvisi comporti dipende dai tuoi dati.",
  },
  "ja-JP": {
    tooltip:
      "各バケットにはスコアが付きます。これは、値がその時間帯の予想値からどれだけ離れているかを、典型的なばらつきの単位で表したものです。帯の半幅はこのパーセンタイルでの学習スコアです（97 は学習バケットの 97% がそれより低いスコアだったことを意味します）。ただし、典型的なばらつきの 3 倍より狭くなることはありません。 帯の幅を設定した場合は、このパーセンタイルから求めた幅の代わりにその値が使われます。帯の外にあるバケットはアラートを発します。実データは学習時と異なる場合があるため、これはアラート率ではありません。値を下げると帯が狭まり、通常はアラートが増えます。クールダウンにより繰り返しの間隔が空きます。",
    budgetTooltip:
      "この設定が配信できるアラートの上限で、配信時に強制されます。検出はすべてのバケットをスコアリングし続けます。予算を使い切ると、回復するまで追加のアラートは抑制されます。",
    hint: "バケットは、モデルがトレーニングで見たものの {percentile}% よりも異常に見える場合にアラートを発します。それが何件のアラートになるかはデータ次第です。",
  },
  "ko-KR": {
    tooltip:
      "각 버킷에는 점수가 매겨집니다. 이는 값이 해당 시간대의 예상값에서 얼마나 떨어져 있는지를 일반적인 산포 단위로 나타낸 것입니다. 띠의 절반 폭은 이 백분위수에서의 학습 점수이며(97은 학습 버킷의 97%가 그보다 낮은 점수였다는 뜻), 일반적인 산포의 3배보다 좁아지지 않습니다. 띠 폭을 설정하면 이 백분위수 기반 폭 대신 그 값이 사용됩니다. 띠 밖에 있는 버킷은 알림을 보냅니다. 실제 데이터는 학습 데이터와 다를 수 있으므로 이는 알림 비율이 아닙니다. 값을 낮추면 띠가 좁아지고 일반적으로 더 많은 알림이 전송됩니다. 쿨다운은 반복 알림 사이에 간격을 둡니다.",
    budgetTooltip:
      "이 구성이 전달할 수 있는 알림의 최대 개수로, 전달 시점에 강제됩니다. 감지는 모든 버킷을 계속 채점하며, 예산이 소진되면 회복될 때까지 추가 알림이 억제됩니다.",
    hint: "버킷이 학습 중 모델이 확인한 데이터의 {percentile}%보다 더 이례적으로 보이면 알림이 발생합니다. 알림이 몇 건 발생하는지는 데이터에 따라 다릅니다.",
  },
  "nl-NL": {
    tooltip:
      "Elk interval krijgt een score: hoe ver de waarde afligt van de verwachte waarde voor dat uur, gemeten in typische spreidingen. De halve breedte van de band is de trainingsscore bij dit percentiel (97 betekent dat 97% van de trainingsintervallen lager scoorde), en nooit minder dan 3 typische spreidingen. Als u een bandbreedte instelt, vervangt die deze uit het percentiel afgeleide breedte. Een interval buiten de band geeft een waarschuwing. Live data kan afwijken van de training, dus dit is geen waarschuwingsfrequentie. Een lagere waarde maakt de band smaller en stuurt doorgaans meer waarschuwingen; een afkoelperiode spreidt herhalingen.",
    budgetTooltip:
      "Het maximale aantal meldingen dat deze configuratie mag bezorgen, afgedwongen bij bezorging. Detectie blijft elke bucket scoren; is het budget op, dan worden verdere meldingen onderdrukt tot het zich aanvult.",
    hint: "Een bucket geeft een alarm wanneer deze ongewoner lijkt dan {percentile}% van wat het model tijdens de training zag. Hoeveel alarmen dat oplevert, hangt af van uw gegevens.",
  },
  "pl-PL": {
    tooltip:
      "Każdy przedział otrzymuje wynik: jak daleko jego wartość odbiega od wartości oczekiwanej dla danej godziny, mierzony w typowych rozrzutach. Połowa szerokości pasa to wynik treningowy przy tym percentylu (97 oznacza, że 97% przedziałów treningowych uzyskało niższy wynik), ale nigdy mniej niż 3 typowe rozrzuty. Jeśli ustawisz szerokość pasa, zastępuje ona tę szerokość wyznaczoną z percentyla. Przedział poza pasem wywołuje alert. Dane bieżące mogą różnić się od treningowych, więc nie jest to częstotliwość alertów. Niższa wartość zawęża pas i zwykle wysyła więcej alertów; okres wyciszenia rozkłada powtórzenia w czasie.",
    budgetTooltip:
      "Maksymalna liczba alertów, jaką ta konfiguracja może dostarczyć, egzekwowana przy dostarczaniu. Wykrywanie nadal ocenia każdy przedział; po wyczerpaniu budżetu kolejne alerty są wstrzymywane, aż budżet się odnowi.",
    hint: "Przedział generuje alert, gdy wygląda na bardziej nietypowy niż {percentile}% tego, co model widział podczas uczenia. To, ile to oznacza alertów, zależy od Twoich danych.",
  },
  "pt-PT": {
    tooltip:
      "Cada intervalo recebe uma pontuação: a distância entre o seu valor e o valor esperado para essa hora, em unidades de dispersão típica. A meia-largura da faixa é a pontuação de treino neste percentil (97 significa que 97% dos intervalos de treino tiveram pontuação inferior) e nunca menos de 3 dispersões típicas. Se definir uma largura de faixa, esta substitui a largura derivada do percentil. Um intervalo fora da faixa gera um alerta. Os dados reais podem diferir do treino, por isso isto não é uma taxa de alertas. Um valor mais baixo estreita a faixa e geralmente envia mais alertas; um período de espera espaça as repetições.",
    budgetTooltip:
      "O número máximo de alertas que esta configuração pode entregar, aplicado na entrega. A deteção continua a pontuar todos os buckets; esgotado o orçamento, os alertas adicionais são suprimidos até ele se repor.",
    hint: "Um bucket gera alerta quando parece mais incomum do que {percentile}% do que o modelo viu no treinamento. Quantos alertas isso significa depende dos seus dados.",
  },
  "ru-RU": {
    tooltip:
      "Каждый интервал получает оценку: насколько его значение отклоняется от ожидаемого для этого часа, в единицах типичного разброса. Полуширина полосы — это оценка обучения на этом процентиле (97 означает, что у 97% интервалов обучения оценка была ниже), но не меньше 3 типичных разбросов. Если задать ширину полосы, она заменяет эту ширину, полученную из процентиля. Интервал за пределами полосы вызывает оповещение. Реальные данные могут отличаться от обучающих, поэтому это не частота оповещений. Меньшее значение сужает полосу и обычно приводит к большему числу оповещений; период ожидания разносит повторы.",
    budgetTooltip:
      "Максимальное число оповещений, которое эта конфигурация может доставить; ограничение применяется при доставке. Обнаружение продолжает оценивать каждый бакет; когда бюджет исчерпан, дальнейшие оповещения подавляются, пока он не восстановится.",
    hint: "Интервал срабатывает, когда выглядит необычнее, чем {percentile}% увиденного моделью при обучении. Сколько это даст оповещений, зависит от ваших данных.",
  },
  "tr-TR": {
    tooltip:
      "Her aralık bir puan alır: değerinin o saat için beklenen değerden ne kadar uzak olduğu, tipik yayılım biriminde. Bandın yarı genişliği bu yüzdelikteki eğitim puanıdır (97, eğitim aralıklarının %97'sinin daha düşük puan aldığı anlamına gelir) ve hiçbir zaman 3 tipik yayılımdan az değildir. Bir bant genişliği ayarlarsanız, yüzdelikten türetilen bu genişliğin yerini alır. Bandın dışındaki bir aralık uyarı tetikler. Canlı veriler eğitimden farklı olabilir, bu nedenle bu bir uyarı oranı değildir. Daha düşük bir değer bandı daraltır ve genellikle daha fazla uyarı gönderir; bekleme süresi tekrarları aralıklandırır.",
    budgetTooltip:
      "Bu yapılandırmanın teslim edebileceği en fazla uyarı sayısı; teslimde uygulanır. Algılama her aralığı puanlamaya devam eder; bütçe tükenince, yenilenene kadar ek uyarılar bastırılır.",
    hint: "Bir zaman aralığı, modelin eğitimde gördüklerinin %{percentile}'inden daha sıra dışı göründüğünde uyarı verir. Bunun kaç uyarıya karşılık geldiği verinize bağlıdır.",
  },
  "vi-VN": {
    tooltip:
      "Mỗi khoảng được tính một điểm: giá trị của nó lệch bao xa so với giá trị dự kiến của giờ đó, tính theo đơn vị độ phân tán điển hình. Nửa độ rộng của dải là điểm huấn luyện tại phân vị này (97 nghĩa là 97% khoảng huấn luyện có điểm thấp hơn) và không bao giờ nhỏ hơn 3 độ phân tán điển hình. Nếu bạn đặt độ rộng dải, giá trị đó sẽ thay thế độ rộng suy ra từ phân vị này. Một khoảng nằm ngoài dải sẽ kích hoạt cảnh báo. Dữ liệu thực tế có thể khác dữ liệu huấn luyện, nên đây không phải là tỷ lệ cảnh báo. Giá trị thấp hơn sẽ thu hẹp dải và thường gửi nhiều cảnh báo hơn; thời gian chờ giúp giãn cách các lần lặp lại.",
    budgetTooltip:
      "Số cảnh báo tối đa mà cấu hình này được phép gửi, được áp đặt khi gửi. Việc phát hiện vẫn chấm điểm mọi bucket; khi ngân sách cạn, các cảnh báo tiếp theo bị chặn cho đến khi ngân sách hồi phục.",
    hint: "Một khung thời gian sẽ phát cảnh báo khi nó trông bất thường hơn {percentile}% những gì mô hình đã thấy trong quá trình huấn luyện. Số lượng cảnh báo cụ thể phụ thuộc vào dữ liệu của bạn.",
  },
  "zh-CN": {
    tooltip:
      "每个时间桶都会得到一个分数：其值与该小时预期值的偏离程度，以典型离散度为单位。带的半宽是该百分位上的训练分数（97 表示 97% 的训练时间桶分数更低），且绝不小于 3 个典型离散度。 如果设置了带宽，它将取代这个由百分位数得出的宽度。落在带外的时间桶会触发告警。实时数据可能与训练数据不同，因此这不是告警率。数值越低，带越窄，通常会发送更多告警；冷却期会拉开重复告警的间隔。",
    budgetTooltip:
      "此配置可投递告警的上限，在投递时强制执行。检测仍会为每个数据桶评分；预算用尽后，多余的告警将被抑制，直到预算恢复。",
    hint: "当某个时间桶看起来比模型在训练中见到的 {percentile}% 更异常时，就会触发告警。具体会产生多少条告警取决于你的数据。",
  },
  "zh-TW": {
    tooltip:
      "每個時間桶都會得到一個分數：其值與該小時預期值的偏離程度，以典型離散度為單位。帶的半寬是此百分位數上的訓練分數（97 表示 97% 的訓練時間桶分數較低），且絕不小於 3 個典型離散度。 如果設定了帶寬，它會取代這個由百分位數得出的寬度。落在帶外的時間桶會觸發警示。即時資料可能與訓練資料不同，因此這不是警示率。數值越低，帶越窄，通常會傳送更多警示；冷卻期會拉開重複警示的間隔。",
    budgetTooltip:
      "此設定可傳送警示的上限，於傳送時強制執行。偵測仍會為每個區間評分；預算用盡後，多餘的警示會被抑制，直到預算回復。",
    hint: "當某個時間桶看起來比模型在訓練中見過的 {percentile}% 更不尋常時，就會觸發警示。這代表多少個警示取決於你的資料。",
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
      hint: at(locale, "alerts.anomaly.sensitivityHintPercentile"),
    }).toEqual(PINNED_COPY[name]);
  });

  it.each(ALL_LOCALES)("%s quotes the current Balanced default in the tooltip", (_name, locale) => {
    const tooltip = String(at(locale, "alerts.anomaly.sensitivityTooltip"));
    expect(tooltip).toContain(String(BALANCED_PERCENTILE));
    // Bounded so a percentile is matched as a whole number, not as a digit inside a longer one.
    expect(tooltip).not.toMatch(new RegExp(`(?<!\\d)${RETIRED_PERCENTILE}(?!\\d)`));
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

  // The tooltip and the hint below it describe the same direction: looser percentile, more of both.
  it("en-US ties a lower percentile to more alerts, matching the hint underneath", () => {
    const tooltip = String(at(en, "alerts.anomaly.sensitivityTooltip")).toLowerCase();
    expect(tooltip).toContain("alert");
    expect(tooltip).toMatch(/lower value|lowering/);
    expect(tooltip).toContain("more alerts");
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

  // The stored percentile indexes TRAINING scores; any live count, rate, or flag share derived from it is fiction.
  it("en-US percentile-mode copy promises no alert rate or flag share", () => {
    for (const key of [
      "alerts.anomaly.sensitivityTooltip",
      "alerts.anomaly.sensitivityHintPercentile",
    ]) {
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
    const label = String(at(en, "alerts.anomaly.percentile")).toLowerCase();
    expect(label).not.toContain("percentile");
    expect(label).not.toMatch(/\bp\d{2}\b/);
    // Still a label, not a sentence — it sits in a 21.75rem-wide field column.
    expect(label.split(/\s+/).length).toBeLessThanOrEqual(3);
  });

  // The collision is only resolved if the tooltip on the number says, in words,
  // that it is not the Detection Function's percentile.
  it("en-US disowns the detection-function meaning beside the sensitivity number", () => {
    const tooltip = String(at(en, "alerts.anomaly.sensitivityNotDataPercentile")).toLowerCase();
    expect(tooltip).toContain("detection function");
    expect(tooltip).toContain("unrelated");
    // It has to name what it ranks instead, or "unrelated" tells the reader nothing.
    expect(tooltip).toMatch(/model's confidence|model's scores/);
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
