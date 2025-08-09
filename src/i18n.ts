// src/i18n.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// ---- Existing bundles ----
import common_en from './locales/en/common.json';
import timetable_en from './locales/en/timetable.json';
import teacher_en from './locales/en/teacher.json';
import common_he from './locales/he/common.json';
import timetable_he from './locales/he/timetable.json';
import teacher_he from './locales/he/teacher.json';

// ---- Admin bundles ----
import users_en from './locales/en/users.json';
import classes_en from './locales/en/classes.json';
import lessons_en from './locales/en/lessons.json';
import users_he from './locales/he/users.json';
import classes_he from './locales/he/classes.json';
import lessons_he from './locales/he/lessons.json';

// ---- NEW: dashboard namespace ----
import dashboard_en from './locales/en/dashboard.json';
import dashboard_he from './locales/he/dashboard.json';

const ns: string[] = [
  'common',
  'timetable',
  'teacher',
  'users',
  'classes',
  'lessons',
  'dashboard',
];

i18n
  .use(initReactI18next)
  .init({
    lng: 'he',
    fallbackLng: 'en',
    ns,
    defaultNS: 'common',
    resources: {
      en: {
        common: common_en,
        timetable: timetable_en,
        teacher: teacher_en,
        users: users_en,
        classes: classes_en,
        lessons: lessons_en,
        dashboard: dashboard_en,
      },
      he: {
        common: common_he,
        timetable: timetable_he,
        teacher: teacher_he,
        users: users_he,
        classes: classes_he,
        lessons: lessons_he,
        dashboard: dashboard_he,
      },
    },
    interpolation: { escapeValue: false },
    debug: false,
    returnEmptyString: false,
  })
  .then(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dir = i18n.dir();
      document.documentElement.lang = i18n.language;
    }
  });

i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') {
    document.documentElement.dir = i18n.dir(lng);
    document.documentElement.lang = lng;
  }
});

export default i18n;
