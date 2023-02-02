import { createI18n } from "vue-i18n"; // import from runtime only
import { getLanguage } from "../utils/cookies";

// User defined lang
import zhLocale from "./languages/zh.json";
import enLocale from "./languages/en.json";
import trLocale from "./languages/tr.json";


const messages = {
  "en-gb": {
    ...enLocale,
  },
  "zh-cn": {
    ...zhLocale,
  },
  "tr-turk": {
    ...trLocale,
  },
};

export const getLocale = () => {
  const cookieLanguage = getLanguage();
  if (cookieLanguage) {
    return cookieLanguage;
  }
  const language = navigator.language.toLowerCase();
  const locales = Object.keys(messages);
  for (const locale of locales) {
    if (language.indexOf(locale) > -1) {
      return locale;
    }
  }

  // Default language is English
  return "en-gb";
};

const i18n = createI18n({
  locale: getLocale(),
  fallbackLocale: "en-gb",
  messages: messages,
});

export default i18n;
