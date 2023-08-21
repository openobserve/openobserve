// Copyright 2023 Zinc Labs Inc.

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License. 


import { createI18n } from "vue-i18n"; // import from runtime only
import { getLanguage } from "../utils/cookies";

// User defined lang
import zhLocale from "./languages/zh.json";
import enLocale from "./languages/en.json";
import trLocale from "./languages/tr.json";
import deLocale from "./languages/de.json";
import esLocale from "./languages/es.json";
import frLocale from "./languages/fr.json";
import itLocale from "./languages/it.json";
import jaLocale from "./languages/ja.json";
import koLocale from "./languages/ko.json";
import nlLocale from "./languages/nl.json";
import ptLocale from "./languages/pt.json";


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
  "de": {
    ...deLocale,
  },
  "es": {
    ...esLocale,
  },
  "fr": {
    ...frLocale,
  },
  "it": {
    ...itLocale,
  },
  "ja": {
    ...jaLocale,
  },
  "ko": {
    ...koLocale,
  },
  "nl": {
    ...nlLocale,
  },
  "pt": {
    ...ptLocale,
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
