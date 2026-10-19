const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

test.describe("Ingestion Setup Cards — eBPF Tracing testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await navigateToBase(page);
    pm = new PageManager(page);

    await page.waitForLoadState('domcontentloaded');
    testLogger.info('eBPF tracing setup card test setup completed');
  });

  test("should reveal trace inputs and append ordered single-quoted --trace flags on the Linux install step", {
    tag: ['@ingestion-setup-card-ebpf-tracing', '@all', '@P0']
  }, async () => {
    const orgId = getOrgIdentifier();
    await pm.ingestionConfigPage.navigateToIntegration('/ingestion/recommended/linux', orgId);
    await pm.ingestionConfigPage.expectStepVisible('install');

    // Default "Logs & metrics" variant: no trace inputs and no --trace- flags.
    await pm.ingestionConfigPage.expectVariantInputAbsent('ports');
    let code = await pm.ingestionConfigPage.getStepCodeText('install');
    expect(code).toContain('install.sh');
    expect(code).not.toContain('--trace-');

    // Switch to "Logs, metrics & eBPF traces": four inputs appear, ports defaults to 8080.
    await pm.ingestionConfigPage.selectStepVariant('install', 'traces');
    expect(await pm.ingestionConfigPage.getVariantInputValue('ports')).toBe('8080');
    expect(await pm.ingestionConfigPage.getVariantInputValue('exe')).toBe('');
    expect(await pm.ingestionConfigPage.getVariantInputValue('cmd')).toBe('');
    expect(await pm.ingestionConfigPage.getVariantInputValue('serviceName')).toBe('');
    code = await pm.ingestionConfigPage.getStepCodeText('install');
    expect(code).toContain("--trace-ports '8080'");
    expect(code).not.toContain('--trace-exe');
    expect(code).not.toContain('--trace-cmd');
    expect(code).not.toContain('--service-name');

    await pm.ingestionConfigPage.fillVariantInput('ports', '80,443');
    await pm.ingestionConfigPage.fillVariantInput('exe', '/opt/app*');
    await pm.ingestionConfigPage.fillVariantInput('cmd', '*reports.py*');
    await pm.ingestionConfigPage.fillVariantInput('serviceName', 'checkout');
    code = await pm.ingestionConfigPage.getStepCodeText('install');
    expect(code).toContain(
      "--trace-ports '80,443' --trace-exe '/opt/app*' --trace-cmd '*reports.py*' --service-name 'checkout'"
    );

    // Reverting to the default variant drops the inputs and flags.
    await pm.ingestionConfigPage.selectStepVariant('install', 'logs-metrics');
    await pm.ingestionConfigPage.expectVariantInputAbsent('ports');
    code = await pm.ingestionConfigPage.getStepCodeText('install');
    expect(code).not.toContain('--trace-');

    testLogger.info('Linux eBPF traces variant toggles inputs and appends flags correctly');
  });

  test("should swap nested language tabs for eBPF inputs and emit Helm --set-string flags", {
    tag: ['@ingestion-setup-card-ebpf-tracing', '@all', '@P0']
  }, async () => {
    const orgId = getOrgIdentifier();
    await pm.ingestionConfigPage.navigateToIntegration('/ingestion/recommended/kubernetes', orgId);
    await pm.ingestionConfigPage.expectStepVisible('instrument');

    // Default: "Language libraries" top-level with the nested java/dotnet/nodejs/python toggle.
    await pm.ingestionConfigPage.expectSubvariantTabsVisible('instrument');
    let code = await pm.ingestionConfigPage.getStepCodeText('instrument');
    expect(code).toContain('kubectl annotate');

    // Select "eBPF": nested toggle hidden, three blank inputs, warning visible, code hidden.
    await pm.ingestionConfigPage.selectStepVariant('instrument', 'ebpf');
    await pm.ingestionConfigPage.expectSubvariantTabsHidden('instrument');
    expect(await pm.ingestionConfigPage.getVariantInputValue('ebpfPorts')).toBe('');
    expect(await pm.ingestionConfigPage.getVariantInputValue('ebpfExe')).toBe('');
    expect(await pm.ingestionConfigPage.getVariantInputValue('ebpfCmd')).toBe('');
    await pm.ingestionConfigPage.expectVariantWarning('instrument', true);
    await pm.ingestionConfigPage.expectStepCodePresent('instrument', false);

    await pm.ingestionConfigPage.fillVariantInput('ebpfPorts', '8080,9000-9100');
    await pm.ingestionConfigPage.expectVariantWarning('instrument', false);
    code = await pm.ingestionConfigPage.getStepCodeText('instrument');
    expect(code).toContain('helm');
    expect(code).toContain('upgrade o2c');
    expect(code).toContain('--set ebpf.enabled=true');
    expect(code).toContain("--set-string 'ebpf.trace.ports={8080,9000-9100}'");
    expect(code).toContain('--set ebpf.trace.exePaths=null');
    expect(code).toContain('--set ebpf.trace.cmdLines=null');

    testLogger.info('Kubernetes eBPF variant emits Helm --set-string flags correctly');
  });

  test("should gate the Linux trace command on requireOneOf and restore it once a selector is filled", {
    tag: ['@ingestion-setup-card-ebpf-tracing', '@all', '@P1']
  }, async () => {
    const orgId = getOrgIdentifier();
    await pm.ingestionConfigPage.navigateToIntegration('/ingestion/recommended/linux', orgId);
    await pm.ingestionConfigPage.selectStepVariant('install', 'traces');

    // Clear the default ports and fill only serviceName — excluded from requireOneOf.
    await pm.ingestionConfigPage.fillVariantInput('ports', '');
    await pm.ingestionConfigPage.fillVariantInput('serviceName', 'checkout');
    await pm.ingestionConfigPage.expectVariantWarning('install', true);
    await pm.ingestionConfigPage.expectStepCodePresent('install', false);

    await pm.ingestionConfigPage.fillVariantInput('exe', '/opt/bin');
    await pm.ingestionConfigPage.expectVariantWarning('install', false);
    await pm.ingestionConfigPage.expectStepCodePresent('install', true);
    const code = await pm.ingestionConfigPage.getStepCodeText('install');
    expect(code).toContain("--trace-exe '/opt/bin'");

    testLogger.info('Linux requireOneOf guard gates and restores the trace command');
  });

  test("should gate the eBPF command on requireOneOf and emit one --set-string per filled selector", {
    tag: ['@ingestion-setup-card-ebpf-tracing', '@all', '@P1']
  }, async () => {
    const orgId = getOrgIdentifier();
    await pm.ingestionConfigPage.navigateToIntegration('/ingestion/recommended/kubernetes', orgId);
    await pm.ingestionConfigPage.selectStepVariant('instrument', 'ebpf');

    // All blank → warning visible and code hidden.
    await pm.ingestionConfigPage.expectVariantWarning('instrument', true);
    await pm.ingestionConfigPage.expectStepCodePresent('instrument', false);

    await pm.ingestionConfigPage.fillVariantInput('ebpfExe', '/opt/app*');
    await pm.ingestionConfigPage.fillVariantInput('ebpfCmd', '*worker.py*');
    await pm.ingestionConfigPage.expectVariantWarning('instrument', false);
    const code = await pm.ingestionConfigPage.getStepCodeText('instrument');
    expect(code).toContain('--set ebpf.trace.ports=null');
    expect(code).toContain("--set-string 'ebpf.trace.exePaths={/opt/app*}'");
    expect(code).toContain("--set-string 'ebpf.trace.cmdLines={*worker.py*}'");
    // Deterministic order: ports (null) → exe → cmd.
    expect(code.indexOf('ebpf.trace.ports')).toBeLessThan(code.indexOf('ebpf.trace.exePaths'));
    expect(code.indexOf('ebpf.trace.exePaths')).toBeLessThan(code.indexOf('ebpf.trace.cmdLines'));

    testLogger.info('Kubernetes eBPF requireOneOf guard emits ordered --set-string flags');
  });

  test("should render no eBPF traces toggle or trace inputs on Windows and macOS host agents", {
    tag: ['@ingestion-setup-card-ebpf-tracing', '@all', '@P1']
  }, async () => {
    const orgId = getOrgIdentifier();
    for (const platform of ['windows', 'macos']) {
      await pm.ingestionConfigPage.navigateToIntegration(`/ingestion/recommended/${platform}`, orgId);
      await pm.ingestionConfigPage.expectStepVisible('install');
      const code = await pm.ingestionConfigPage.getStepCodeText('install');
      expect(code.length).toBeGreaterThan(0);
      await pm.ingestionConfigPage.expectVariantTabsAbsent('install');
      await pm.ingestionConfigPage.expectVariantInputAbsent('ports');
    }

    testLogger.info('Windows and macOS host agents render no eBPF traces toggle');
  });

  test("should expose the eBPF tracing guide link on Linux and Kubernetes cards", {
    tag: ['@ingestion-setup-card-ebpf-tracing', '@all', '@P2']
  }, async () => {
    const orgId = getOrgIdentifier();

    await pm.ingestionConfigPage.navigateToIntegration('/ingestion/recommended/linux', orgId);
    await pm.ingestionConfigPage.expectStepVisible('install');
    let hrefs = await pm.ingestionConfigPage.getDocumentationLinkHrefs();
    expect(hrefs.some((h) => h.endsWith('obi.md'))).toBe(true);

    await pm.ingestionConfigPage.navigateToIntegration('/ingestion/recommended/kubernetes', orgId);
    await pm.ingestionConfigPage.expectStepVisible('install');
    hrefs = await pm.ingestionConfigPage.getDocumentationLinkHrefs();
    expect(hrefs.some((h) => h.endsWith('docs/traces.md#ebpf-tracing'))).toBe(true);

    testLogger.info('eBPF tracing guide footer link present on both cards');
  });

  test.afterEach(async () => {
    testLogger.info('eBPF tracing setup card test completed');
  });
});
