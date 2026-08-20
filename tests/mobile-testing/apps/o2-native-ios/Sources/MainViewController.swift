import UIKit
import OpenObserveRUM

class MainViewController: UIViewController {
    // A URLSession built with the instrumented delegate → its requests are tracked as RUM resources.
    private let session = URLSession(configuration: .default, delegate: O2SessionDelegate(), delegateQueue: nil)

    private func fetch(_ url: String) {
        guard let u = URL(string: url) else { return }
        session.dataTask(with: u).resume()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "O2 Native iOS"
        view.backgroundColor = .systemBackground

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
        ])

        func button(_ title: String, _ action: Selector) -> UIButton {
            var cfg = UIButton.Configuration.filled()
            cfg.title = title
            let b = UIButton(configuration: cfg, primaryAction: nil)
            b.addTarget(self, action: action, for: .touchUpInside)
            b.accessibilityLabel = title
            return b
        }

        stack.addArrangedSubview(button("Trigger handled error", #selector(handledError)))
        stack.addArrangedSubview(button("Custom action", #selector(customAction)))
        stack.addArrangedSubview(button("Go to Details", #selector(goToDetails)))
        stack.addArrangedSubview(button("Go to Checkout", #selector(goToCheckout)))
        stack.addArrangedSubview(button("Fetch resource 200", #selector(fetch200)))
        stack.addArrangedSubview(button("Fetch resource 404", #selector(fetch404)))
        stack.addArrangedSubview(button("Trigger native crash", #selector(triggerCrash)))
    }

    @objc func goToCheckout() {
        navigationController?.pushViewController(CheckoutViewController(), animated: true)
    }

    @objc func fetch200() { fetch("https://jsonplaceholder.typicode.com/todos/1") }
    @objc func fetch404() { fetch("https://jsonplaceholder.typicode.com/this-path-does-not-exist-404") }

    @objc func handledError() {
        RUMMonitor.shared().addError(
            error: NSError(domain: "O2NativeIOS", code: 1,
                           userInfo: [NSLocalizedDescriptionKey: "O2 Native iOS — handled error from Main"]),
            source: .source,
            attributes: [:]
        )
    }

    @objc func customAction() {
        RUMMonitor.shared().addAction(type: .custom, name: "Native iOS custom action", attributes: [:])
    }

    @objc func goToDetails() {
        navigationController?.pushViewController(DetailsViewController(), animated: true)
    }

    @objc func triggerCrash() {
        let empty: [Int] = []
        _ = empty[10] // index out of range -> crash
    }
}
