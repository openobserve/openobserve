import UIKit

// A checkout form carrying PII (email + card). Session Replay is configured .maskAll, so NONE of this
// text may appear in the recorded replay — the ios-native masking test asserts exactly that.
class CheckoutViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Checkout"
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

        let heading = UILabel()
        heading.text = "Checkout (masking test)"
        heading.font = .boldSystemFont(ofSize: 22)
        heading.accessibilityLabel = "Checkout (masking test)"
        stack.addArrangedSubview(heading)

        func field(_ text: String) -> UITextField {
            let f = UITextField()
            f.text = text
            f.borderStyle = .roundedRect
            return f
        }
        stack.addArrangedSubview(field("alex.morgan@example.com"))
        stack.addArrangedSubview(field("4242 4242 4242 4242"))
    }
}
