/**
 * Language Page - Translation Testing Page Object
 *
 * Handles all language translation coverage testing functionality.
 * Tests translation across main pages, sub-tabs, and modals.
 */

const testLogger = require('../../playwright-tests/utils/test-logger.js');

class LanguagePage {
  // ============================================================================
  // LOCATORS (at top per framework rules)
  // ============================================================================

  // Alerts page tabs
  alertsAlertsTab = '[data-test="alerts-alerts-tab"]';
  alertsDestinationsTab = '[data-test="alerts-destinations-tab"]';
  alertsTemplatesTab = '[data-test="alerts-templates-tab"]';

  // Logs page
  sqlModeToggle = '[data-test="logs-search-bar-sql-mode-toggle-btn"]';

  // Dashboard
  addDashboardBtn = '[data-test="dashboard-add"]';

  // Text extraction selectors
  textSelectors = [
    'button', 'a', 'label', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'input[placeholder]', 'textarea[placeholder]',
    '.q-item__label', '.q-tab__label', '.q-btn__content',
    '.q-field__label', '.q-card__section', '.q-toolbar__title',
    '[class*="menu"]', '[class*="nav"]', '[class*="sidebar"]',
    '[data-test]', '.q-dialog', '.q-modal', '.q-drawer',
    '[role="tab"]', '[role="tabpanel"]', '[role="dialog"]',
  ];

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  MIN_TRANSLATION_COVERAGE = 80;
  ACCEPTABLE_DELTA = 10; // Tests pass with warning if within delta below minimum

  // All sidebar modules from frontend source code
  MAIN_PAGES = [
    { name: 'Home', path: '/', menuKey: 'home' },
    { name: 'Logs', path: '/logs', menuKey: 'search' },
    { name: 'Metrics', path: '/metrics', menuKey: 'metrics' },
    { name: 'Traces', path: '/traces', menuKey: 'traces' },
    { name: 'RUM', path: '/rum/sessions', menuKey: 'rum' },
    { name: 'Pipelines', path: '/pipeline/functions', menuKey: 'pipeline' },
    { name: 'Dashboards', path: '/dashboards', menuKey: 'dashboard' },
    { name: 'Streams', path: '/streams', menuKey: 'index' },
    { name: 'Reports', path: '/reports', menuKey: 'reports' },
    { name: 'Alerts', path: '/alerts', menuKey: 'alerts' },
    { name: 'Data Sources', path: '/ingestion/custom/logs', menuKey: 'ingestion' },
    { name: 'IAM', path: '/iam/users', menuKey: 'iam' },
  ];

  // Sub-tabs/sub-pages for each module (from frontend routes)
  SUB_PAGES = {
    Logs: [
      { name: 'SQL Mode', action: 'toggleSqlMode' },
    ],
    RUM: [
      { name: 'Sessions', path: '/rum/sessions' },
      { name: 'Errors', path: '/rum/errors' },
      { name: 'Performance', path: '/rum/performance/overview' },
      { name: 'Web Vitals', path: '/rum/performance/web-vitals' },
    ],
    Pipelines: [
      { name: 'Functions', path: '/pipeline/functions' },
      { name: 'Enrichment Tables', path: '/pipeline/enrichment-tables' },
      { name: 'Pipelines List', path: '/pipeline/pipelines' },
    ],
    Streams: [
      { name: 'Stream Explorer', path: '/streams/stream-explore' },
    ],
    Reports: [
      { name: 'Create Report', path: '/reports/create' },
    ],
    Alerts: [
      { name: 'Alerts Tab', tabSelector: '[data-test="alerts-alerts-tab"]' },
      { name: 'Destinations Tab', tabSelector: '[data-test="alerts-destinations-tab"]' },
      { name: 'Templates Tab', tabSelector: '[data-test="alerts-templates-tab"]' },
      { name: 'Alert History', path: '/alerts/history' },
    ],
    'Data Sources': [
      { name: 'Logs Ingestion', path: '/ingestion/custom/logs' },
      { name: 'Metrics Ingestion', path: '/ingestion/custom/metrics' },
      { name: 'Traces Ingestion', path: '/ingestion/custom/traces' },
      { name: 'Recommended', path: '/ingestion/recommended' },
    ],
    IAM: [
      { name: 'Users', path: '/iam/users' },
      { name: 'Service Accounts', path: '/iam/serviceAccounts' },
      { name: 'Organizations', path: '/iam/organizations' },
      { name: 'Groups', path: '/iam/groups' },
      { name: 'Roles', path: '/iam/roles' },
    ],
  };

  LANGUAGES = {
    'de': { code: 'de', label: 'Deutsch', nativeSample: 'Startseite' },
    'es': { code: 'es', label: 'Español', nativeSample: 'Inicio' },
    'fr': { code: 'fr', label: 'Français', nativeSample: 'Accueil' },
    'it': { code: 'it', label: 'Italiano', nativeSample: 'Home' },
    'ja': { code: 'ja', label: '日本語', nativeSample: 'ホーム' },
    'ko': { code: 'ko', label: '한국어', nativeSample: '홈' },
    'nl': { code: 'nl', label: 'Nederlands', nativeSample: 'Home' },
    'pt': { code: 'pt', label: 'Português', nativeSample: 'Início' },
    'tr-turk': { code: 'tr-turk', label: 'Türkçe', nativeSample: 'Ana Sayfa' },
    'zh-cn': { code: 'zh-cn', label: '简体中文', nativeSample: '主页' },
  };

  ENGLISH_PHRASES = new Set([
    'Close', 'Cancel', 'OK', 'Apply', 'Save', 'Update', 'Delete', 'Edit', 'Add',
    'Search', 'Refresh', 'Back', 'Next', 'Previous', 'Confirm', 'Submit',
    'Home', 'Logs', 'Metrics', 'Traces', 'Dashboards', 'Streams', 'Alerts',
    'Data sources', 'Ingestion', 'Settings', 'Management', 'Help', 'About',
    'Sign Out', 'Language', 'Reports', 'IAM', 'Functions', 'Pipelines',
    'Query', 'Fields', 'Results', 'Filter', 'Filters', 'Name', 'Type', 'Value',
    'Description', 'Status', 'Actions', 'Duration', 'Date', 'Time',
    'Start time', 'End time', 'Timestamp', 'Source', 'Details',
    'Search Results', 'No results found', 'Records per page', 'Showing',
    'SQL Mode', 'Quick Mode', 'Syntax guide', 'Run query', 'Export logs',
    'Histogram', 'Editors', 'Patterns', 'Search Stream', 'Select Stream',
    'Select metric', 'Add metric', 'Aggregation', 'Group by', 'Legend',
    'Add Dashboard', 'Add Panel', 'Dashboard', 'Panel', 'Variables',
    'Import', 'Export', 'Clone', 'Folder', 'Add Folder',
    'Stream', 'Schema', 'Settings', 'Retention', 'Storage', 'Index',
    'Add Stream', 'Delete Stream', 'Partition',
    'Alert', 'Destination', 'Template', 'Trigger', 'Condition', 'Threshold',
    'Create Alert', 'Edit Alert', 'Add Destination', 'Add Template',
    'Real Time', 'Scheduled', 'Enabled', 'Disabled',
    'Data Sources', 'Custom', 'Recommended', 'Logs', 'Metrics', 'Traces',
    'FluentBit', 'Fluentd', 'Vector', 'OTEL', 'Prometheus', 'Kubernetes',
    'Total', 'Count', 'Average', 'Sum', 'Min', 'Max', 'Percentage',
    'Enable', 'Disable', 'Active', 'Inactive', 'Loading', 'Error',
    'Success', 'Warning', 'Info', 'No data', 'Empty', 'All', 'None',
    'Select', 'Selected', 'Clear', 'Reset', 'Copy', 'Download', 'Upload',
    'Create', 'View', 'List', 'Table', 'Chart', 'Graph',
  ]);

  // Language vocabulary dictionaries
  GERMAN_WORDS = new Set([
    'und', 'oder', 'nicht', 'mit', 'von', 'zu', 'zum', 'zur', 'für', 'auf', 'aus',
    'bei', 'nach', 'über', 'unter', 'vor', 'hinter', 'zwischen', 'neben',
    'hinzufügen', 'löschen', 'bearbeiten', 'speichern', 'suchen', 'durchsuchen',
    'anzeigen', 'erstellen', 'öffnen', 'schließen', 'abbrechen', 'bestätigen',
    'alle', 'keine', 'einige', 'andere', 'neue', 'neuer', 'neues',
    'wählen', 'auswählen', 'duplizieren', 'kopieren', 'einfügen',
    'seite', 'liste', 'tabelle', 'feld', 'felder', 'wert', 'werte',
    'aktiviert', 'deaktiviert', 'aktiv', 'inaktiv', 'erfolg', 'fehler',
    'warnung', 'warnmeldungen', 'einstellungen', 'verwaltung', 'hilfe',
    'startseite', 'protokolle', 'metriken', 'armaturenbrett', 'ströme',
  ]);

  SPANISH_WORDS = new Set([
    'y', 'o', 'no', 'con', 'de', 'a', 'para', 'por', 'en', 'sobre', 'bajo',
    'buscar', 'añadir', 'eliminar', 'editar', 'guardar', 'cerrar', 'abrir',
    'todos', 'ninguno', 'algunos', 'otros', 'nuevo', 'nueva', 'nuevos',
    'seleccionar', 'duplicar', 'copiar', 'pegar', 'inicio', 'paneles',
    'alertas', 'índices', 'trazas', 'métricas', 'fuentes', 'datos',
    'configuración', 'gestión', 'ayuda', 'acerca', 'registros', 'flujos',
  ]);

  FRENCH_WORDS = new Set([
    'et', 'ou', 'non', 'avec', 'de', 'à', 'pour', 'par', 'en', 'sur', 'sous',
    'chercher', 'ajouter', 'supprimer', 'modifier', 'enregistrer', 'fermer', 'ouvrir',
    'tous', 'aucun', 'quelques', 'autres', 'nouveau', 'nouvelle', 'nouveaux',
    'sélectionner', 'dupliquer', 'copier', 'coller', 'accueil', 'tableaux',
    'alertes', 'flux', 'traces', 'métriques', 'sources', 'données',
    'paramètres', 'gestion', 'aide', 'journaux', 'bord',
  ]);

  ITALIAN_WORDS = new Set([
    'e', 'o', 'non', 'con', 'di', 'a', 'per', 'da', 'in', 'su', 'sotto',
    'cerca', 'aggiungi', 'elimina', 'modifica', 'salva', 'chiudi', 'apri',
    'tutti', 'nessuno', 'alcuni', 'altri', 'nuovo', 'nuova', 'nuovi',
    'seleziona', 'duplica', 'copia', 'incolla', 'pannelli', 'cruscotto',
    'avvisi', 'flussi', 'tracce', 'metriche', 'sorgenti', 'dati',
    'impostazioni', 'gestione', 'aiuto', 'registri',
  ]);

  DUTCH_WORDS = new Set([
    'en', 'of', 'niet', 'met', 'van', 'naar', 'voor', 'door', 'op', 'onder',
    'zoeken', 'toevoegen', 'verwijderen', 'bewerken', 'opslaan', 'sluiten', 'openen',
    'alle', 'geen', 'sommige', 'andere', 'nieuw', 'nieuwe',
    'selecteren', 'dupliceren', 'kopiëren', 'plakken', 'startpagina', 'panelen',
    'waarschuwingen', 'stromen', 'sporen', 'metrieken', 'bronnen', 'gegevens',
    'instellingen', 'beheer', 'hulp', 'logboeken', 'dashboards',
  ]);

  PORTUGUESE_WORDS = new Set([
    'e', 'ou', 'não', 'com', 'de', 'a', 'para', 'por', 'em', 'sobre', 'sob',
    'buscar', 'adicionar', 'excluir', 'editar', 'salvar', 'fechar', 'abrir',
    'todos', 'nenhum', 'alguns', 'outros', 'novo', 'nova', 'novos',
    'selecionar', 'duplicar', 'copiar', 'colar', 'início', 'painéis',
    'alertas', 'fluxos', 'rastros', 'métricas', 'fontes', 'dados',
    'configurações', 'gerenciamento', 'ajuda', 'registros',
  ]);

  TURKISH_WORDS = new Set([
    've', 'veya', 'değil', 'ile', 'için', 'üzerinde', 'altında',
    'ara', 'ekle', 'sil', 'düzenle', 'kaydet', 'kapat', 'aç',
    'tümü', 'hiçbiri', 'bazı', 'diğer', 'yeni',
    'seç', 'kopyala', 'yapıştır', 'anasayfa', 'paneller',
    'uyarılar', 'akışlar', 'izler', 'metrikler', 'kaynaklar', 'veriler',
    'ayarlar', 'yönetim', 'yardım', 'günlükler', 'gösterge',
  ]);

  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================

  constructor(page) {
    this.page = page;
  }

  // ============================================================================
  // PUBLIC ACTIONS
  // ============================================================================

  /**
   * Test translation coverage for a specific language
   * @param {Object} pm - PageManager instance
   * @param {string} langCode - Language code (e.g., 'de', 'es', 'fr')
   * @param {boolean} includeDepth - Whether to test sub-tabs and modals
   * @returns {Object} Test results with percentage and pass/fail status
   */
  async testLanguageTranslation(pm, langCode, includeDepth = true) {
    const langConfig = this.LANGUAGES[langCode];
    const results = {
      langCode,
      langLabel: langConfig.label,
      mainPageResults: {},
      subPageResults: {},
      modalResults: {},
      totalElements: 0,
      totalTranslated: 0,
      allUntranslated: [],
      overallPercentage: 0,
      passed: false,
      status: 'fail', // 'ideal', 'acceptable', or 'fail'
    };

    testLogger.info('\n' + '═'.repeat(60));
    testLogger.info(`TESTING: ${langConfig.label} (${langCode})`);
    testLogger.info('═'.repeat(60));

    // Change language
    testLogger.info(`Changing language to ${langConfig.label}...`);
    await pm.homePage.changeLanguage(langCode);
    await this.page.waitForTimeout(800);

    // Test main pages
    for (const pageConfig of this.MAIN_PAGES) {
      testLogger.info(`\n  Testing: ${pageConfig.name}`);

      const mainAnalysis = await this._testSinglePage(pageConfig, langCode);
      results.mainPageResults[pageConfig.name] = mainAnalysis;
      results.totalElements += mainAnalysis.total;
      results.totalTranslated += mainAnalysis.translatedCount;

      const status = mainAnalysis.passed ? '✓' : '✗';
      testLogger.info(`    Main: ${mainAnalysis.percentage}% (${mainAnalysis.translatedCount}/${mainAnalysis.total}) ${status}`);

      if (mainAnalysis.untranslated.length > 0) {
        results.allUntranslated.push({
          location: `${pageConfig.name} (Main)`,
          phrases: mainAnalysis.untranslated,
        });
      }

      // Sub-tabs (if depth enabled)
      if (includeDepth && this.SUB_PAGES[pageConfig.name]) {
        const subResults = await this._testSubTabs(pageConfig.name, langCode);
        for (const subResult of subResults) {
          results.subPageResults[`${pageConfig.name} > ${subResult.name}`] = subResult.analysis;
          results.totalElements += subResult.analysis.total;
          results.totalTranslated += subResult.analysis.translatedCount;

          const subStatus = subResult.analysis.passed ? '✓' : '✗';
          testLogger.info(`    ${subResult.name}: ${subResult.analysis.percentage}% ${subStatus}`);

          if (subResult.analysis.untranslated.length > 0) {
            results.allUntranslated.push({
              location: `${pageConfig.name} > ${subResult.name}`,
              phrases: subResult.analysis.untranslated,
            });
          }
        }
      }
    }

    // Test modals (if depth enabled)
    if (includeDepth) {
      await this._testDashboardModal(results, langCode);
    }

    // Calculate overall percentage
    results.overallPercentage = results.totalElements > 0
      ? Math.round((results.totalTranslated / results.totalElements) * 100)
      : 100;

    // Determine status: ideal (>=80%), acceptable (70-79%), fail (<70%)
    const minAcceptable = this.MIN_TRANSLATION_COVERAGE - this.ACCEPTABLE_DELTA;

    if (results.overallPercentage >= this.MIN_TRANSLATION_COVERAGE) {
      results.status = 'ideal';
      results.passed = true;
      testLogger.info(`\n  OVERALL: ${results.overallPercentage}% - PASS ✓ (ideal)`);
    } else if (results.overallPercentage >= minAcceptable) {
      results.status = 'acceptable';
      results.passed = true;
      testLogger.warn(`\n  OVERALL: ${results.overallPercentage}% - ACCEPTABLE ⚠️ (needs work - target: ${this.MIN_TRANSLATION_COVERAGE}%)`);
    } else {
      results.status = 'fail';
      results.passed = false;
      testLogger.info(`\n  OVERALL: ${results.overallPercentage}% - FAIL ✗ (below ${minAcceptable}% minimum)`);
    }

    return results;
  }

  /**
   * Navigate to home page
   */
  async navigateToHome() {
    const homeUrl = `/web/?org_identifier=${process.env["ORGNAME"]}`;
    await this.page.goto(homeUrl);
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  /**
   * Reset language to English
   * @param {Object} pm - PageManager instance
   */
  async resetToEnglish(pm) {
    await this.navigateToHome();
    await pm.homePage.changeLanguage('en-gb');
  }

  /**
   * Get language label for a language code
   * @param {string} langCode - Language code
   * @returns {string} Language label
   */
  getLanguageLabel(langCode) {
    return this.LANGUAGES[langCode]?.label || langCode;
  }

  /**
   * Get minimum translation coverage threshold (ideal)
   * @returns {number} Minimum coverage percentage
   */
  getMinCoverage() {
    return this.MIN_TRANSLATION_COVERAGE;
  }

  /**
   * Get acceptable minimum coverage (with delta)
   * @returns {number} Acceptable minimum percentage
   */
  getAcceptableMinCoverage() {
    return this.MIN_TRANSLATION_COVERAGE - this.ACCEPTABLE_DELTA;
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Extract all visible text from the current page
   */
  async _extractAllVisibleText() {
    const selectors = this.textSelectors;
    return await this.page.evaluate((sels) => {
      const texts = new Set();

      sels.forEach(selector => {
        try {
          document.querySelectorAll(selector).forEach(el => {
            const text = el.textContent?.trim();
            if (text && text.length > 0 && text.length < 100) {
              text.split(/[\n\r\t|:,\/]/).forEach(part => {
                const cleaned = part.trim();
                if (cleaned.length > 1 && cleaned.length < 50) {
                  texts.add(cleaned);
                }
              });
            }

            const placeholder = el.getAttribute('placeholder');
            if (placeholder) texts.add(placeholder.trim());

            const ariaLabel = el.getAttribute('aria-label');
            if (ariaLabel) texts.add(ariaLabel.trim());

            const title = el.getAttribute('title');
            if (title) texts.add(title.trim());
          });
        } catch (e) { /* ignore */ }
      });

      return Array.from(texts);
    }, selectors);
  }

  /**
   * Filter text elements to only include translatable strings
   */
  _filterTranslatableText(texts) {
    return texts.filter(text => {
      if (!text || text.length < 2) return false;
      if (/^\d+[\d,.\s]*$/.test(text)) return false;
      if (/^\d{4}-\d{2}-\d{2}/.test(text)) return false;
      if (/^\d{2}:\d{2}/.test(text)) return false;
      if (/^(https?:|\/|www\.)/.test(text)) return false;
      if (/^_\w+$/.test(text)) return false;
      if (/^\w+\.\w+/.test(text)) return false;
      if (/^[{}\[\]<>]/.test(text)) return false;
      if (/^\$\{/.test(text)) return false;
      if (/^[+\-*\/=<>!@#$%^&*()]+$/.test(text)) return false;

      const technicalTerms = ['JSON', 'SQL', 'API', 'HTTP', 'HTTPS', 'URL', 'ID', 'UUID',
        'CPU', 'RAM', 'GB', 'MB', 'KB', 'ms', 'ns', 'UTC', 'GMT', 'VRL'];
      if (technicalTerms.includes(text.toUpperCase())) return false;

      return true;
    });
  }

  /**
   * Get vocabulary dictionary for a language
   */
  _getLanguageVocabulary(langCode) {
    switch (langCode) {
      case 'de': return this.GERMAN_WORDS;
      case 'es': return this.SPANISH_WORDS;
      case 'fr': return this.FRENCH_WORDS;
      case 'it': return this.ITALIAN_WORDS;
      case 'nl': return this.DUTCH_WORDS;
      case 'pt': return this.PORTUGUESE_WORDS;
      case 'tr-turk': return this.TURKISH_WORDS;
      default: return new Set();
    }
  }

  /**
   * Check if a text string appears to be translated
   */
  _isTranslated(text, langCode) {
    const normalizedText = text.toLowerCase().trim();
    const words = normalizedText.split(/\s+/);

    // CJK characters = definitely translated
    if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(text)) {
      return true;
    }

    // Non-ASCII characters (accented letters) = translated
    if (/[À-ÿĀ-žÄÖÜäöüßÉéÈèÊêËëÀàÂâÃãÇçÑñİıĞğŞşÇçÖöÜü]/.test(text)) {
      return true;
    }

    // Check language-specific vocabulary
    const targetLangWords = this._getLanguageVocabulary(langCode);
    for (const word of words) {
      if (targetLangWords.has(word)) {
        return true;
      }
    }

    // Check if text matches known English phrases
    for (const englishPhrase of this.ENGLISH_PHRASES) {
      const normalizedEnglish = englishPhrase.toLowerCase();
      if (normalizedText === normalizedEnglish) return false;
    }

    // Check if ALL words are common English words
    const allWordsEnglish = words.every(word => {
      if (word.length <= 2) return true;
      for (const phrase of this.ENGLISH_PHRASES) {
        if (phrase.toLowerCase() === word) return true;
        if (phrase.toLowerCase().split(/\s+/).includes(word)) return true;
      }
      return false;
    });

    if (allWordsEnglish && words.length > 0) return false;

    return true;
  }

  /**
   * Analyze translation coverage for a set of text elements
   */
  _analyzeTranslation(texts, langCode) {
    const translatable = this._filterTranslatableText(texts);
    const translated = [];
    const untranslated = [];

    translatable.forEach(text => {
      if (this._isTranslated(text, langCode)) {
        translated.push(text);
      } else {
        untranslated.push(text);
      }
    });

    const percentage = translatable.length > 0
      ? Math.round((translated.length / translatable.length) * 100)
      : 100;

    return {
      total: translatable.length,
      translatedCount: translated.length,
      untranslatedCount: untranslated.length,
      percentage,
      translated,
      untranslated,
      passed: percentage >= this.MIN_TRANSLATION_COVERAGE,
    };
  }

  /**
   * Test a single page
   */
  async _testSinglePage(pageConfig, langCode) {
    const pageUrl = `/web${pageConfig.path}?org_identifier=${process.env["ORGNAME"]}`;
    await this.page.goto(pageUrl);
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(400);

    const allTexts = await this._extractAllVisibleText();
    return this._analyzeTranslation(allTexts, langCode);
  }

  /**
   * Test sub-tabs within a page
   */
  async _testSubTabs(pageName, langCode) {
    const subPages = this.SUB_PAGES[pageName];
    if (!subPages) return [];

    const results = [];

    for (const subPage of subPages) {
      try {
        if (subPage.action === 'toggleSqlMode') {
          // Special action: toggle SQL mode
          const sqlToggle = this.page.locator(this.sqlModeToggle);
          if (await sqlToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
            await sqlToggle.click();
            await this.page.waitForTimeout(300);
            const texts = await this._extractAllVisibleText();
            results.push({
              name: subPage.name,
              analysis: this._analyzeTranslation(texts, langCode),
            });
            await sqlToggle.click();
          }
        } else if (subPage.path) {
          // Navigate to sub-page URL
          const subPageUrl = `/web${subPage.path}?org_identifier=${process.env["ORGNAME"]}`;
          await this.page.goto(subPageUrl);
          await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
          await this.page.waitForTimeout(400);
          const texts = await this._extractAllVisibleText();
          results.push({
            name: subPage.name,
            analysis: this._analyzeTranslation(texts, langCode),
          });
        } else if (subPage.tabSelector) {
          // Click tab selector
          const tab = this.page.locator(subPage.tabSelector).first();
          if (await tab.isVisible({ timeout: 2000 }).catch(() => false)) {
            await tab.click();
            await this.page.waitForTimeout(500);
            const texts = await this._extractAllVisibleText();
            results.push({
              name: subPage.name,
              analysis: this._analyzeTranslation(texts, langCode),
            });
          }
        }
      } catch (e) {
        testLogger.warn(`Could not test sub-page ${subPage.name}: ${e.message}`);
      }
    }

    return results;
  }

  /**
   * Test Add Dashboard modal
   */
  async _testDashboardModal(results, langCode) {
    try {
      const addDashboardBtn = this.page.locator(this.addDashboardBtn);
      if (await addDashboardBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await addDashboardBtn.click();
        await this.page.waitForTimeout(500);

        const texts = await this._extractAllVisibleText();
        const analysis = this._analyzeTranslation(texts, langCode);

        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);

        results.modalResults['Add Dashboard Modal'] = analysis;
        results.totalElements += analysis.total;
        results.totalTranslated += analysis.translatedCount;
        testLogger.info(`    Modal (Add Dashboard): ${analysis.percentage}%`);
      }
    } catch (e) { /* ignore */ }
  }
}

module.exports = { LanguagePage };
