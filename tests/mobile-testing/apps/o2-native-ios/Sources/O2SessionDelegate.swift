import Foundation

// URLSession delegate class registered with URLSessionInstrumentation. Requests made on a URLSession
// created with this delegate are captured by the OpenObserve SDK as RUM `resource` events. The body
// can be empty — instrumentation is by delegate-class registration, not by overriding methods.
final class O2SessionDelegate: NSObject, URLSessionDataDelegate {}
