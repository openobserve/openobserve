// Copyright 2026 OpenObserve Inc.

// Pins the menu wording so a translation-pipeline rewrite shows up as a failing spec.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (code: string): string =>
  readFileSync(resolve(__dirname, `./languages/${code}.json`), "utf8");
const load = (code: string): any => JSON.parse(read(code));
const at = (messages: any, path: string): unknown =>
  path.split(".").reduce((node, key) => node?.[key], messages);

// Pins from the o2-enterprise#2985 review; `banned` lists the everyday-sense renderings it removed.
const REVIEWED: Record<string, { pins: Record<string, string>; banned: RegExp }> = {
  "ar-SA": {
    pins: {
      "menu.index": "التدفقات",
      "menu.traces": "التتبعات",
      "menu.downtimes": "فترات الصيانة",
      "menu.synthetic": "المراقبة الاصطناعية",
      "menu.billings": "الفوترة",
      "menu.ingestionText": "الاستيعاب",
      "function.streamPipeline": "مسارات المعالجة",
    },
    banned:
      /الصناعات الاصطناعية|(خط|خطوط) (ال)?أنابيب|(فترة|فترات) (ال)?توقف|معدل الاحتراق|الأخشاب|الابتلاع|اللجنة|الزناد|الشيك|السيرة الذاتية|الأسطورة|آثار|الفعاليات|المباراة|المحاكمة|إطلاق النار/,
  },
  "de-DE": {
    pins: {
      "menu.pipeline": "Pipelines",
      "menu.rum": "RUM",
      "menu.search": "Logs",
      "menu.downtimes": "Wartungsfenster",
      "aiObservability.nav.scorers": "Scorer",
      "slos.chart.burnRate": "Burn-Rate",
      "oncall.pagesNav": "Alarmierungen",
    },
    banned:
      /[Rr]ohrleitung|Ausfallzeit|Torsch[üu]tze|Holzversender|Benutzerüberwachung|Verbrennungsrate|Warnmeldung|\b(?:du|dein|deine|deinen|deinem|deiner|dich|dir)\b/,
  },
  "es-ES": {
    pins: {
      "menu.pipeline": "Pipelines",
      "menu.rum": "RUM",
      "menu.search": "Logs",
      "common.logs": "Logs",
      "menu.index": "Streams",
      "menu.downtimes": "Periodos de mantenimiento",
      "aiObservability.nav.scorers": "Evaluadores",
    },
    banned:
      /[Tt]uber[ií]a|[Cc]analizaci|[Oo]leoduct|[Gg]asoduct|[Gg]oleador|[Pp]untuador|[Aa]notador|[Ee]mpleos|[Aa]rroyo|[Tt]ransportista|Tiempos? de inactividad|\b[Rr]eport(?:e|es|ar)\b/,
  },
  "it-IT": {
    pins: {
      "menu.rum": "RUM",
      "menu.search": "Log",
      "menu.pipeline": "Pipeline",
      "menu.downtimes": "Downtime",
      "oncall.pagesNav": "Notifiche",
      "aiObservability.nav.scorers": "Valutatori",
      "settings.lightMode": "Modalità chiara",
    },
    banned:
      /[Tt]elecomando|[Pp]artitura|[Ss]egnapunti|[Ss]pedizionier|[Pp]eriod[oi] di inattivit|[Oo]fferte di lavoro|[Gg]ettoni|[Pp]agine di reperibilit|[Ll]eggend[ae]\b|Curriculum/,
  },
  "pt-PT": {
    pins: {
      "menu.pipeline": "Pipelines",
      "menu.search": "Logs",
      "menu.traces": "Traces",
      "menu.rum": "RUM",
      "menu.help": "Ajuda",
      "menu.onCall": "Piquete",
      "menu.downtimes": "Janelas de manutenção",
      "menu.dashboard": "Dashboards",
    },
    banned:
      /[Oo]leodut|[Gg]asodut|[Gg]oleador|Socorro|\btoras\b|\btroncos\b|Doutor Num|[Tt]axa de queima|\b[Rr]astros?\b|Monitoramento de usuários reais|ao vivo|\bvocê\b|Tem certeza|\bsalvar\b|\busuário|\btela\b|\bequipe\b|[Pp]lantão/,
  },
  "nl-NL": {
    pins: {
      "menu.pipeline": "Pipelines",
      "menu.search": "Logs",
      "common.logs": "Logs",
      "menu.rum": "RUM",
      "menu.downtimes": "Onderhoudsperiodes",
      "menu.docs": "Documentatie",
      "slos.column.burnRate": "Burn rate",
    },
    banned:
      /[Pp]ijpleiding|[Pp]ijplijn|[Ll]ogboek|[Dd]okters|[Vv]acature|[Ss]ollicit|[Vv]erbrandingssnelheid|[Jj]urylid|[Ss]patscherm|[Ii]nslikken/,
  },
  "pl-PL": {
    pins: {
      "menu.downtimes": "Okna serwisowe",
      "alerts.downtimes.title": "Okna serwisowe",
      "menu.traces": "Trace",
      "menu.dashboard": "Pulpity",
      "dashboard.header": "Pulpity",
      "aiObservability.nav.scorers": "Ewaluatory",
      "serviceAccounts.header": "Konta usługi",
    },
    banned:
      /[Oo]ceniacz|[Pp]unktator|[Ss]korer|[Pp]rzest[oó]j|[Pp]ulpit\w* nawigacyjn|wypalani|[Kk]ont\w* serwisow/,
  },
  "tr-TR": {
    pins: {
      "menu.pipeline": "İşlem hatları",
      "menu.downtimes": "Bakım pencereleri",
      "menu.rum": "RUM",
      "menu.search": "Günlükler",
      "slos.column.burnRate": "Tükenme hızı",
      "aiObservability.nav.scorers": "Puanlayıcılar",
      "function.streamPipeline": "Veri İşlem Hatları",
      "menu.incidents": "Vakalar",
    },
    banned:
      /[Bb]oru [Hh]att|[Gg]olcü|[Yy]utma|[Ee]fsane|[Kk]ütük|İthalat|İhracat|[Jj]eton|İş İlanları/,
  },
  "ru-RU": {
    pins: {
      "menu.downtimes": "Окна обслуживания",
      "alerts.downtimes.title": "Окна обслуживания",
      "menu.dashboard": "Дашборды",
      "menu.pipeline": "Конвейеры",
      "menu.traces": "Трейсы",
      "menu.search": "Логи",
      "iam.serviceAccounts": "Сервисные аккаунты",
    },
    banned:
      /Простои|простоев|скорр?ер|скоринг|[Аа]лерт|панел[а-яё]* мониторинга|Скорость сгорания|Пейджинг|учетн[а-яё]* запис[а-яё]* служб|Поисковый конвейер|Роль поиска/,
  },
  "ja-JP": {
    pins: {
      "menu.pipeline": "パイプライン",
      "function.header": "関数",
      "oncall.pagesNav": "呼び出し",
      "oncall.responsesTitle": "オンコール呼び出し",
      "menu.downtimes": "ダウンタイム",
      "emptyState.noScorers.action": "新しいスコアラー",
      "function.addFunction": "関数を追加",
    },
    banned: /ページ通知|得点|ファンクション|事件|履歴書|輸入|応募|崩壊|発報/,
  },
  "ko-KR": {
    pins: {
      "menu.rum": "RUM",
      "menu.metrics": "메트릭",
      "shortcuts.modules.rum": "RUM",
      "aiObservability.nav.scorers": "스코어러",
      "oncall.pagesNav": "호출",
      "function.streamPipeline": "파이프라인",
      "menu.downtimes": "다운타임",
    },
    banned:
      /득점자|채점자|화주|통나무|민첩한|신분증|장애인|미터법|이력서|주파수|발화|측정항목|인제스트/,
  },
  "vi-VN": {
    pins: {
      "menu.pipeline": "Pipeline",
      "function.streamPipeline": "Pipeline",
      "menu.index": "Stream",
      "menu.search": "Nhật ký",
      "menu.rum": "RUM",
      "menu.downtimes": "Thời gian bảo trì",
      "slos.column.burnRate": "Tốc độ tiêu hao",
      "oncall.pagesNav": "Thông báo trực",
    },
    banned:
      /[Đđ]ường ống|[Tt]hời gian (tạm )?ngừng|[Kk]hoảng (tạm )?ngừng|[Tt]ốc độ (đốt|cháy)|[Tt]ỷ lệ đốt|[Nn]gười chấm điểm|[Cc]háy (nhanh|vừa|chậm)|[Đđ]ào tạo/,
  },
};

describe("menu terms (AC-12)", () => {
  it("ar-SA uses the main-page and infrastructure senses for Home and Infra", () => {
    const ar = load("ar-SA");
    expect(ar.menu.home).toBe("الرئيسية");
    expect(ar.menu.infra).toBe("البنية التحتية");
    // The same term is already used for infrastructure elsewhere in the file.
    expect(read("ar-SA").split("البنية التحتية").length - 1).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ["fr-FR", "Pipelines de données"],
    ["es-ES", "Pipelines de datos"],
    ["pt-PT", "Pipelines de dados"],
    ["nl-NL", "Datapipelines"],
  ])("%s function.streamPipeline is a data pipeline, not a physical pipe", (code, value) => {
    expect(load(code).function.streamPipeline).toBe(value);
  });

  it("fr-FR keeps Pipelines, RUM and Logs, and calls a downtime a maintenance window", () => {
    const fr = load("fr-FR");
    expect(fr.menu.pipeline).toBe("Pipelines");
    expect(fr.menu.rum).toBe("RUM");
    expect(fr.menu.search).toBe("Logs");
    expect(fr.common.logs).toBe("Logs");
    expect(fr.menu.downtimes).toBe("Périodes de maintenance");
    expect(fr.settings.lightMode).toBe("Mode clair");
    expect(read("fr-FR")).not.toMatch(
      /[Cc]analisation|[Ii]ndisponibilit|[Bb]uteur|[Cc]ombustion|[Gg]rumes|[Ss]urveillance réelle|[Pp]ériode d'arrêt/,
    );
  });

  it("de-DE says Alarme in the header and the menu, like its items", () => {
    const de = load("de-DE");
    expect(de.menu.alerts).toBe("Alarme");
    expect(de.alerts.header).toBe("Alarme");
    expect(de.alerts.allAlerts).toBe("Alle Alarme");
  });

  it("nl-NL says alarm across the header, the menu and the library", () => {
    const nl = load("nl-NL");
    expect(nl.menu.alerts).toBe("Alarmen");
    expect(nl.alerts.header).toBe("Alarmen");
    expect(nl.alerts.allAlerts).toBe("Alle alarmen");
    expect(nl.alert_library.header).toBe("Alarmbibliotheek");
  });

  it.each(Object.entries(REVIEWED))(
    "%s keeps its reviewed terms and never brings back a removed mistranslation",
    (code, { pins, banned }) => {
      const messages = load(code);
      for (const [path, value] of Object.entries(pins)) {
        expect(at(messages, path), `${code} ${path}`).toBe(value);
      }
      expect(read(code)).not.toMatch(banned);
    },
  );

  it("en-US defines the trial copy the rail, flyout and toast read", () => {
    const en = load("en-US");
    expect(en.menu.trialEndedTitle).toBe("Your trial has ended");
    expect(en.menu.trialPageNeedsPlan).toBe("{page} needs a plan");
    expect(en.menu.trialPageNeedsPlanToast).toContain("{page} needs a plan");
    expect(en.menu.trialChoosePlanToast).toContain("{product}");
    expect(en.menu.trialFlyoutNote).toBe("Your trial has ended. Pages with a lock need a plan.");
  });
});
