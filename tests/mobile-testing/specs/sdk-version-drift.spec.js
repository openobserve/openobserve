// SDK install-doc version drift — does the SDK version the OpenObserve UI documents stay in sync
// with the LATEST published SDK? (Product finding: the RUM install cards pin alpha.4 while the SDKs
// ship alpha.5/alpha.6 — see docs/COVERAGE-MATRIX.md.)
//
// SKIPPED (test.fixme) for now: the mobile-RUM install docs are still under active development, so
// the pinned versions move. Enable once the docs are version-synced (dev to update). The logic below
// is real and ready — it fetches the latest published version per registry and compares it to what
// the docs pin.
const { test, expect } = require('@playwright/test');

// Latest published version, per registry (the source of truth the UI docs should track).
async function latestPublished(kind) {
  if (kind === 'react-native') {
    const r = await fetch('https://registry.npmjs.org/@openobserve/mobile-react-native/latest');
    return (await r.json()).version;
  }
  if (kind === 'ios') {
    const r = await fetch('https://api.github.com/repos/openobserve/openobserve-sdk-ios/releases/latest');
    // GitHub release tags are conventionally `v`-prefixed; strip it so the compare isn't a guaranteed
    // miss when the versions are actually in sync.
    return ((await r.json()).tag_name || '').replace(/^v/, '');
  }
  if (kind === 'android') {
    const r = await fetch('https://repo1.maven.org/maven2/ai/openobserve/o2-sdk-android-rum/maven-metadata.xml');
    const xml = await r.text();
    return (xml.match(/<release>([^<]+)<\/release>/) || xml.match(/<latest>([^<]+)<\/latest>/) || [])[1];
  }
  throw new Error(`unknown SDK kind: ${kind}`);
}

// What each platform's install card currently documents (update as the docs move; Android/iOS cards
// are enterprise-surfaced, React Native is OSS `RUM_RN_SDK_VERSION`).
const DOCUMENTED = {
  'react-native': '0.1.0-alpha.4',
  android: '0.1.0-alpha4',
  ios: '0.1.0-alpha.4',
};

test.describe('SDK install-doc version drift (o2-enterprise#2289)', () => {
  for (const kind of ['react-native', 'android', 'ios']) {
    // Enable (remove .fixme) once the docs are kept version-synced.
    test.fixme(
      `the ${kind} install card documents the latest published SDK version`,
      { tag: ['@docs', '@sdk-drift', '@known-bug'] },
      async () => {
        const published = await latestPublished(kind);
        expect(
          DOCUMENTED[kind],
          `the ${kind} install doc pins ${DOCUMENTED[kind]} but the latest published is ${published}`,
        ).toBe(published);
      },
    );
  }
});
