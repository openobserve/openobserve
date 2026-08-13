/**
 * O2 RUM Tester — a minimal React Native app wired with the OpenObserve
 * Mobile RUM SDK (alpha.5) to exercise the test cases the ShopSphere demo
 * could not: network/resource tracking, handled errors, crashes, and
 * Session Replay privacy masking.
 */
import React, {useEffect, useState} from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  OpenObserveProvider,
  OpenObserveProviderConfiguration,
  TrackingConsent,
  O2Rum,
  O2SdkReactNative,
  RumActionType,
  ErrorSource,
} from '@openobserve/mobile-react-native';
import {
  SessionReplay,
  TextAndInputPrivacyLevel,
  ImagePrivacyLevel,
  TouchPrivacyLevel,
} from '@openobserve/mobile-react-native-session-replay';

// Build-time RUM target as INLINE constants. CI text-substitutes these literals
// (scripts/gen-config.js seds them from O2_RUM_* env). The committed values are PLACEHOLDERS —
// set O2_RUM_HOST/ORG/TOKEN/ENV (see docs/CI-NOTES.md and .env.example) before building for a real
// target; CI mints its own token per run. NB: do NOT move these into an imported JSON module — a
// `import x from './x.json'` here silently breaks RUM upload in the Hermes release build
// (verified: JSON-import → 0 uploads; inline consts → uploads work).
const RUM_HOST = 'https://openobserve.example.com'; // @gen:host
const RUM_ORG = 'REPLACE_ME'; // @gen:org
const RUM_TOKEN = 'REPLACE_ME'; // @gen:token
const RUM_ENV = 'production'; // @gen:env
const RUM_INTAKE = `${RUM_HOST}/rum/v1/${RUM_ORG}`;

// --- SDK configuration ---
const config = new OpenObserveProviderConfiguration(
  RUM_TOKEN, // clientToken
  RUM_ENV, // env
  TrackingConsent.GRANTED,
  {
    rumConfiguration: {
      applicationId: 'o2-rum-tester',
      customEndpoint: RUM_INTAKE,
      sessionSampleRate: 100,
      trackInteractions: true,
      trackResources: true, // A4 — network/resource tracking
      trackErrors: true, // A5 — error tracking
      nativeCrashReportEnabled: true,
    },
    logsConfiguration: {customEndpoint: RUM_INTAKE},
    // The SDK's OkHttp client rejects cleartext by default ("CLEARTEXT communication not enabled")
    // — so an http:// endpoint (e.g. a self-contained OpenObserve on a CI runner) gets ZERO uploads.
    // This internal flag adds the CLEARTEXT connection spec. Only enabled for http:// targets; an
    // https:// endpoint (e.g. introspect) needs neither and stays strict.
    additionalConfiguration: RUM_HOST.startsWith('http://')
      ? {'_o2.needsClearTextHttp': true}
      : {},
  },
);
config.service = 'o2-rum-tester';

// helper: manual view tracking so screens show up as RUM views
function useTrackView(key: string, name: string, active: boolean) {
  useEffect(() => {
    if (active) {
      O2Rum.startView(key, name);
      return () => {
        O2Rum.stopView(key);
      };
    }
  }, [active, key, name]);
}

function Btn({
  label,
  onPress,
  tone = 'default',
}: {
  label: string;
  onPress: () => void;
  tone?: string;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.btn,
        tone === 'danger' && styles.btnDanger,
        tone === 'warn' && styles.btnWarn,
      ]}
      onPress={onPress}
      accessibilityLabel={label}>
      <Text style={styles.btnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function HomeScreen({go}: {go: (s: string) => void}) {
  useTrackView('home', 'Home', true);
  const [status, setStatus] = useState('idle');

  const fetchOk = async () => {
    setStatus('fetching…');
    try {
      const r = await fetch('https://jsonplaceholder.typicode.com/todos/1');
      const j = await r.json();
      setStatus('OK: ' + JSON.stringify(j).slice(0, 40));
    } catch (e: any) {
      setStatus('fetch failed: ' + e?.message);
    }
  };

  const fetch404 = async () => {
    setStatus('fetching 404…');
    try {
      const r = await fetch(
        'https://jsonplaceholder.typicode.com/todos/99999999',
      );
      setStatus('status ' + r.status);
    } catch (e: any) {
      setStatus('fetch error: ' + e?.message);
    }
  };

  const handledError = () => {
    try {
      throw new Error('O2 Tester — handled error from Home');
    } catch (e: any) {
      O2Rum.addError(e.message, ErrorSource.SOURCE, e.stack ?? '', {
        screen: 'Home',
        handled: true,
      });
      setStatus('handled error reported to RUM');
    }
  };

  const crash = () => {
    O2Rum.addAction(RumActionType.TAP, 'Trigger crash');
    // uncaught -> native crash report on next launch
    throw new Error('O2 Tester — intentional uncaught crash');
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.h1}>O2 RUM Tester</Text>
      <Text style={styles.sub}>Home · env=production · service=o2-rum-tester</Text>
      <Btn label="Fetch data (success)" onPress={fetchOk} />
      <Btn label="Fetch data (404 error)" onPress={fetch404} tone="warn" />
      <Btn label="Trigger handled error" onPress={handledError} tone="warn" />
      <Btn label="Trigger native crash" onPress={crash} tone="danger" />
      <Btn label="Go to Details →" onPress={() => go('details')} />
      <Btn label="Go to Checkout form →" onPress={() => go('form')} />
      <Text style={styles.status}>{status}</Text>
    </View>
  );
}

function DetailsScreen({go}: {go: (s: string) => void}) {
  useTrackView('details', 'Details', true);
  return (
    <View style={styles.screen}>
      <Text style={styles.h1}>Details</Text>
      <Text style={styles.sub}>A second screen to verify view tracking.</Text>
      <Btn
        label="Custom action (tap)"
        onPress={() =>
          O2Rum.addAction(RumActionType.TAP, 'Details custom action')
        }
      />
      <Btn label="← Back to Home" onPress={() => go('home')} />
    </View>
  );
}

function FormScreen({go}: {go: (s: string) => void}) {
  useTrackView('checkout', 'Checkout', true);
  const [email, setEmail] = useState('alex.morgan@example.com');
  const [card, setCard] = useState('4242 4242 4242 4242');
  const [pwd, setPwd] = useState('SuperSecret#123');
  return (
    <View style={styles.screen}>
      <Text style={styles.h1}>Checkout (masking test)</Text>
      <Text style={styles.sub}>
        These fields hold PII — check the replay masks them.
      </Text>
      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
      />
      <Text style={styles.label}>Card number</Text>
      <TextInput
        style={styles.input}
        value={card}
        onChangeText={setCard}
        keyboardType="numeric"
      />
      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        value={pwd}
        onChangeText={setPwd}
        secureTextEntry
      />
      <Btn
        label="Place order"
        onPress={() => O2Rum.addAction(RumActionType.TAP, 'Place order')}
      />
      <Btn label="← Back to Home" onPress={() => go('home')} />
    </View>
  );
}

function App(): React.JSX.Element {
  const [screen, setScreen] = useState('home');
  return (
    <OpenObserveProvider
      configuration={config}
      onInitialization={() => {
        SessionReplay.enable({
          replaySampleRate: 100,
          startRecordingImmediately: true,
          // Replay does NOT inherit the RUM endpoint and needs the full /replay path.
          customEndpoint: RUM_INTAKE + '/replay',
          // Test the SDK's strict default masking posture.
          textAndInputPrivacyLevel: TextAndInputPrivacyLevel.MASK_ALL,
          imagePrivacyLevel: ImagePrivacyLevel.MASK_ALL,
          touchPrivacyLevel: TouchPrivacyLevel.SHOW,
        }).catch(() => {});
        // Attach a user identity so sessions are attributable (usr_* fields).
        O2SdkReactNative.setUserInfo({
          id: 'tester-001',
          name: 'Alex Morgan',
          email: 'alex.morgan@example.com',
        });
      }}>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor="#1b1533" />
        <ScrollView contentContainerStyle={styles.scroll}>
          {screen === 'home' && <HomeScreen go={setScreen} />}
          {screen === 'details' && <DetailsScreen go={setScreen} />}
          {screen === 'form' && <FormScreen go={setScreen} />}
        </ScrollView>
      </SafeAreaView>
    </OpenObserveProvider>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#f4f4fb'},
  scroll: {padding: 20},
  screen: {gap: 12},
  h1: {fontSize: 26, fontWeight: '700', color: '#1b1533'},
  sub: {fontSize: 13, color: '#5a5670', marginBottom: 8},
  label: {fontSize: 13, color: '#3a3550', marginTop: 6},
  input: {
    borderWidth: 1,
    borderColor: '#c9c6dd',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fff',
    fontSize: 15,
  },
  btn: {
    backgroundColor: '#4f46e5',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnWarn: {backgroundColor: '#d97706'},
  btnDanger: {backgroundColor: '#dc2626'},
  btnText: {color: '#fff', fontSize: 15, fontWeight: '600'},
  status: {marginTop: 10, fontSize: 12, color: '#3a3550'},
});

export default App;
