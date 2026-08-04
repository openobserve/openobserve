import UIKit
import OpenObserveCore
import OpenObserveRUM
import OpenObserveLogs
import OpenObserveCrashReporting
import OpenObserveSessionReplay

// reactnativeapp org on the migrated cluster (same org as the RN app).
private let ORG = "3HOStgiihM8H43cMLWY3BUfXV5r"
private let BASE = "https://dev.common-dev.internal.zinclabs.dev/rum/v1/\(ORG)"

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let configuration = OpenObserve.Configuration(
            clientToken: "rumtbJXyJcgC8jB9Otu",
            env: "testing",
            service: "o2-native-ios"
        )
        OpenObserve.initialize(with: configuration, trackingConsent: .granted)

        CrashReporting.enable()

        RUM.enable(
            with: RUM.Configuration(
                applicationID: "o2-native-ios",
                sessionSampleRate: 100,
                uiKitViewsPredicate: DefaultUIKitRUMViewsPredicate(),
                customEndpoint: URL(string: "\(BASE)/rum")
            )
        )

        Logs.enable(
            with: Logs.Configuration(
                customEndpoint: URL(string: "\(BASE)/logs")
            )
        )

        SessionReplay.enable(
            with: SessionReplay.Configuration(
                replaySampleRate: 100,
                textAndInputPrivacyLevel: .maskSensitiveInputs,
                imagePrivacyLevel: .maskNone,
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
