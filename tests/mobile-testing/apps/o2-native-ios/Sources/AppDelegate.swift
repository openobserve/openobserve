import UIKit
import OpenObserveCore
import OpenObserveRUM
import OpenObserveLogs
import OpenObserveCrashReporting
import OpenObserveSessionReplay

// RUM target comes from GeneratedConfig (committed defaults = dev cluster; CI regenerates it via
// gen-config.sh to point at a local instance).
private let ORG = GeneratedConfig.org
private let BASE = "\(GeneratedConfig.host)/rum/v1/\(ORG)"

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let configuration = OpenObserve.Configuration(
            clientToken: GeneratedConfig.token,
            env: GeneratedConfig.env,
            service: "o2-native-ios"
        )
        OpenObserve.initialize(with: configuration, trackingConsent: .granted)

        CrashReporting.enable()

        RUM.enable(
            with: RUM.Configuration(
                applicationID: "o2-native-ios",
                sessionSampleRate: 100,
                uiKitViewsPredicate: DefaultUIKitRUMViewsPredicate(),
                urlSessionTracking: .init(
                    firstPartyHostsTracing: .trace(hosts: ["jsonplaceholder.typicode.com"])
                ),
                customEndpoint: URL(string: "\(BASE)/rum")
            )
        )

        // Instrument URLSessions built with O2SessionDelegate so their requests land as RUM resources.
        URLSessionInstrumentation.enable(with: .init(delegateClass: O2SessionDelegate.self))

        // Attribute all RUM events to a known user (mirrors android-native SampleApplication) so the
        // iOS-native user-identity test can assert usr_* fields.
        OpenObserve.setUserInfo(id: "native-ios-001", name: "Alex Morgan", email: "alex.morgan@example.com")

        Logs.enable(
            with: Logs.Configuration(
                customEndpoint: URL(string: "\(BASE)/logs")
            )
        )

        SessionReplay.enable(
            with: SessionReplay.Configuration(
                replaySampleRate: 100,
                textAndInputPrivacyLevel: .maskAll, // mask ALL text so the masking test can assert no PII leaks
                imagePrivacyLevel: .maskAll,
                touchPrivacyLevel: .show,
                customEndpoint: URL(string: "\(BASE)/replay")
            )
        )

        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = UINavigationController(rootViewController: MainViewController())
        window?.makeKeyAndVisible()
        return true
    }
}
