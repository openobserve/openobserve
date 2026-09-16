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
      "يحدد حد الدرجات من درجات تدريب النموذج عند هذا المئين — القيمة 97 تضع الحد عند أعلى 3٪ من درجات التدريب. قد تختلف الدرجات الفعلية عن درجات التدريب، لذا فهذه ليست نسبة من الفترات القادمة وليست معدل تنبيهات. القيمة الأقل تخفض الحد وترسل عادة تنبيهات أكثر؛ وتباعد فترة التهدئة التنبيهات المتكررة.",
    budgetTooltip:
      "الحد الأقصى لعدد التنبيهات التي يمكن لهذا الإعداد إرسالها، ويُفرض عند الإرسال. يستمر الكشف في تقييم كل فترة؛ وعند استنفاد الميزانية تُمنع التنبيهات الإضافية حتى تتجدد.",
    hint: "تُقيَّم الفترات مقابل علامة المئين {percentile} من درجات تدريب النموذج — وعدد التنبيهات الناتج يعتمد على بياناتك.",
  },
  "de-DE": {
    tooltip:
      "Legt die Score-Schwelle aus den Trainingswerten des Modells bei diesem Perzentil fest — 97 setzt die Schwelle bei den obersten 3 % der Trainingswerte. Live-Werte können vom Training abweichen; dies ist also kein Anteil künftiger Buckets und keine Alarmrate. Ein niedrigerer Wert senkt die Schwelle und sendet in der Regel mehr Warnmeldungen; eine Abklingzeit begrenzt Wiederholungen.",
    budgetTooltip:
      "Die maximale Zahl von Warnmeldungen, die diese Konfiguration zustellen darf — bei der Zustellung erzwungen. Die Erkennung bewertet weiterhin jeden Bucket; ist das Budget aufgebraucht, werden weitere Warnmeldungen unterdrückt, bis es sich auffüllt.",
    hint: "Buckets werden am p{percentile}-Wert der Trainingswerte des Modells gemessen — wie viele Warnmeldungen das ergibt, hängt von Ihren Daten ab.",
  },
  "en-US": {
    tooltip:
      "Sets the score bar from the model's training scores at this percentile — 97 puts the bar at the top 3% of training scores. Live scores can differ from training, so this is not a share of future buckets and not an alert rate. A lower value lowers the bar and generally sends more alerts; a cooldown spaces out repeats.",
    budgetTooltip:
      "The maximum number of alerts this configuration may deliver, enforced at delivery. Detection still scores every bucket; once the budget is spent, further alerts are suppressed until it refills.",
    hint: "Buckets are judged against the p{percentile} mark of the model's training scores — how many alerts that yields depends on your data.",
  },
  "es-ES": {
    tooltip:
      "Fija el listón de puntuación a partir de las puntuaciones de entrenamiento del modelo en este percentil: 97 sitúa el listón en el 3 % superior de las puntuaciones de entrenamiento. Las puntuaciones reales pueden diferir del entrenamiento, así que esto no es una proporción de buckets futuros ni una tasa de alertas. Un valor más bajo baja el listón y suele enviar más alertas; un periodo de enfriamiento espacia las repeticiones.",
    budgetTooltip:
      "El número máximo de alertas que esta configuración puede entregar, aplicado en la entrega. La detección sigue puntuando cada bucket; agotado el presupuesto, las alertas adicionales se suprimen hasta que se repone.",
    hint: "Los buckets se comparan con la marca p{percentile} de las puntuaciones de entrenamiento del modelo; cuántas alertas produce depende de tus datos.",
  },
  "fr-FR": {
    tooltip:
      "Définit la barre de score à partir des scores d'entraînement du modèle à ce percentile — 97 place la barre au niveau des 3 % les plus élevés des scores d'entraînement. Les scores réels peuvent différer de l'entraînement : ce n'est donc ni une part des compartiments futurs ni un taux d'alertes. Une valeur plus basse abaisse la barre et envoie en général davantage d'alertes ; un délai de refroidissement espace les répétitions.",
    budgetTooltip:
      "Le nombre maximal d'alertes que cette configuration peut délivrer, appliqué à la livraison. La détection continue de noter chaque compartiment ; une fois le budget épuisé, les alertes supplémentaires sont supprimées jusqu'à ce qu'il se reconstitue.",
    hint: "Les compartiments sont évalués par rapport au repère p{percentile} des scores d'entraînement du modèle — le nombre d'alertes qui en résulte dépend de vos données.",
  },
  "it-IT": {
    tooltip:
      "Imposta l'asticella del punteggio dai punteggi di addestramento del modello a questo percentile: 97 colloca l'asticella nel 3 % più alto dei punteggi di addestramento. I punteggi reali possono differire dall'addestramento, quindi questa non è una quota dei bucket futuri né un tasso di avvisi. Un valore più basso abbassa l'asticella e in genere invia più avvisi; un periodo di attesa distanzia le ripetizioni.",
    budgetTooltip:
      "Il numero massimo di avvisi che questa configurazione può recapitare, applicato al recapito. Il rilevamento continua a valutare ogni bucket; esaurito il budget, gli avvisi ulteriori vengono soppressi finché non si ricarica.",
    hint: "I bucket sono valutati rispetto al riferimento p{percentile} dei punteggi di addestramento del modello: quanti avvisi ne derivino dipende dai tuoi dati.",
  },
  "ja-JP": {
    tooltip:
      "モデルのトレーニングスコアのこのパーセンタイルからスコアの基準線を設定します。97 はトレーニングスコアの上位 3% に基準線を置きます。実際のスコアはトレーニングと異なることがあるため、これは将来のバケットの割合でもアラート率でもありません。値を下げると基準線が下がり、通常はアラートが増えます。クールダウンにより連続するアラートは間隔が空きます。",
    budgetTooltip:
      "この設定が配信できるアラートの上限で、配信時に強制されます。検出はすべてのバケットをスコアリングし続けます。予算を使い切ると、回復するまで追加のアラートは抑制されます。",
    hint: "バケットはモデルのトレーニングスコアの p{percentile} 基準で判定されます。アラート件数はデータ次第です。",
  },
  "ko-KR": {
    tooltip:
      "모델 훈련 점수의 이 백분위수에서 점수 기준선을 설정합니다. 97은 훈련 점수 상위 3%에 기준선을 둡니다. 실제 점수는 훈련과 다를 수 있으므로 이는 미래 버킷의 비율도, 알림 비율도 아닙니다. 값을 낮추면 기준선이 낮아져 보통 더 많은 알림이 전송되며, 쿨다운이 반복 알림의 간격을 벌립니다.",
    budgetTooltip:
      "이 구성이 전달할 수 있는 알림의 최대 개수로, 전달 시점에 강제됩니다. 감지는 모든 버킷을 계속 채점하며, 예산이 소진되면 회복될 때까지 추가 알림이 억제됩니다.",
    hint: "버킷은 모델 훈련 점수의 p{percentile} 기준에 따라 판정됩니다. 알림 수는 데이터에 따라 달라집니다.",
  },
  "nl-NL": {
    tooltip:
      "Stelt de scorelat in op basis van de trainingsscores van het model bij dit percentiel — 97 legt de lat bij de hoogste 3% van de trainingsscores. Live scores kunnen afwijken van de training, dus dit is geen aandeel van toekomstige buckets en geen meldingsfrequentie. Een lagere waarde verlaagt de lat en verstuurt doorgaans meer meldingen; een afkoelperiode spreidt herhalingen.",
    budgetTooltip:
      "Het maximale aantal meldingen dat deze configuratie mag bezorgen, afgedwongen bij bezorging. Detectie blijft elke bucket scoren; is het budget op, dan worden verdere meldingen onderdrukt tot het zich aanvult.",
    hint: "Buckets worden beoordeeld tegen het p{percentile}-punt van de trainingsscores van het model — hoeveel meldingen dat oplevert, hangt af van je gegevens.",
  },
  "pl-PL": {
    tooltip:
      "Ustawia próg punktowy na podstawie wyników treningowych modelu przy tym percentylu — 97 umieszcza próg przy górnych 3% wyników treningowych. Wyniki na żywo mogą różnić się od treningowych, więc nie jest to udział przyszłych przedziałów ani częstość alertów. Niższa wartość obniża próg i zwykle wysyła więcej alertów; okres wyciszenia rozdziela powtórzenia.",
    budgetTooltip:
      "Maksymalna liczba alertów, jaką ta konfiguracja może dostarczyć, egzekwowana przy dostarczaniu. Wykrywanie nadal ocenia każdy przedział; po wyczerpaniu budżetu kolejne alerty są wstrzymywane, aż budżet się odnowi.",
    hint: "Przedziały są oceniane względem punktu p{percentile} wyników treningowych modelu — liczba alertów zależy od Twoich danych.",
  },
  "pt-PT": {
    tooltip:
      "Define a fasquia de pontuação a partir das pontuações de treino do modelo neste percentil — 97 coloca a fasquia nos 3 % superiores das pontuações de treino. As pontuações reais podem diferir do treino, pelo que isto não é uma fração dos buckets futuros nem uma taxa de alertas. Um valor mais baixo desce a fasquia e normalmente envia mais alertas; um período de espera espaça as repetições.",
    budgetTooltip:
      "O número máximo de alertas que esta configuração pode entregar, aplicado na entrega. A deteção continua a pontuar todos os buckets; esgotado o orçamento, os alertas adicionais são suprimidos até ele se repor.",
    hint: "Os buckets são avaliados face à marca p{percentile} das pontuações de treino do modelo — quantos alertas isso gera depende dos seus dados.",
  },
  "ru-RU": {
    tooltip:
      "Задаёт планку оценки по обучающим оценкам модели на этом процентиле — 97 ставит планку на верхних 3% обучающих оценок. Реальные оценки могут отличаться от обучающих, поэтому это не доля будущих бакетов и не частота оповещений. Меньшее значение опускает планку и обычно отправляет больше оповещений; период охлаждения разрежает повторы.",
    budgetTooltip:
      "Максимальное число оповещений, которое эта конфигурация может доставить; ограничение применяется при доставке. Обнаружение продолжает оценивать каждый бакет; когда бюджет исчерпан, дальнейшие оповещения подавляются, пока он не восстановится.",
    hint: "Бакеты оцениваются относительно отметки p{percentile} обучающих оценок модели — сколько оповещений это даст, зависит от ваших данных.",
  },
  "tr-TR": {
    tooltip:
      "Puan çıtasını, modelin eğitim puanlarının bu yüzdelik dilimine göre belirler — 97, çıtayı eğitim puanlarının en üst %3'üne yerleştirir. Canlı puanlar eğitimden farklı olabilir; bu nedenle bu, gelecekteki aralıkların bir payı ya da bir uyarı oranı değildir. Daha düşük bir değer çıtayı düşürür ve genellikle daha fazla uyarı gönderir; bekleme süresi tekrarları seyrekleştirir.",
    budgetTooltip:
      "Bu yapılandırmanın teslim edebileceği en fazla uyarı sayısı; teslimde uygulanır. Algılama her aralığı puanlamaya devam eder; bütçe tükenince, yenilenene kadar ek uyarılar bastırılır.",
    hint: "Aralıklar, modelin eğitim puanlarının p{percentile} işaretine göre değerlendirilir — kaç uyarı çıkacağı verilerinize bağlıdır.",
  },
  "vi-VN": {
    tooltip:
      "Đặt mức chuẩn điểm từ điểm huấn luyện của mô hình tại phân vị này — 97 đặt mức chuẩn ở 3% điểm huấn luyện cao nhất. Điểm thực tế có thể khác với huấn luyện, nên đây không phải tỷ lệ các bucket tương lai và không phải tần suất cảnh báo. Giá trị thấp hơn hạ mức chuẩn và thường gửi nhiều cảnh báo hơn; thời gian chờ giãn cách các cảnh báo lặp lại.",
    budgetTooltip:
      "Số cảnh báo tối đa mà cấu hình này được phép gửi, được áp đặt khi gửi. Việc phát hiện vẫn chấm điểm mọi bucket; khi ngân sách cạn, các cảnh báo tiếp theo bị chặn cho đến khi ngân sách hồi phục.",
    hint: "Các bucket được so với mốc p{percentile} của điểm huấn luyện mô hình — số cảnh báo tạo ra tùy thuộc vào dữ liệu của bạn.",
  },
  "zh-CN": {
    tooltip:
      "根据模型训练分数在该百分位处设定分数门槛——97 将门槛设在训练分数最高的 3% 处。实际分数可能与训练不同，因此这既不是未来数据桶的占比，也不是告警频率。取值越低门槛越低，通常发送的告警越多；冷却时间会拉开重复告警的间隔。",
    budgetTooltip:
      "此配置可投递告警的上限，在投递时强制执行。检测仍会为每个数据桶评分；预算用尽后，多余的告警将被抑制，直到预算恢复。",
    hint: "数据桶按模型训练分数的 p{percentile} 标记来判定——产生多少告警取决于你的数据。",
  },
  "zh-TW": {
    tooltip:
      "依模型訓練分數在此百分位處設定分數門檻——97 將門檻設在訓練分數最高的 3% 處。實際分數可能與訓練不同，因此這既不是未來區間的占比，也不是警示頻率。數值越低門檻越低，通常發送的警示越多；冷卻時間會拉開重複警示的間隔。",
    budgetTooltip:
      "此設定可傳送警示的上限，於傳送時強制執行。偵測仍會為每個區間評分；預算用盡後，多餘的警示會被抑制，直到預算回復。",
    hint: "區間依模型訓練分數的 p{percentile} 標記判定——產生多少警示取決於你的資料。",
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
});
