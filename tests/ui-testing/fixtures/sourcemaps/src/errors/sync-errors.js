// Deterministic error triggers for sourcemap E2E tests.
// Line numbers here are load-bearing: manifest.json pins the expected
// original line for every error below. Do not reformat this file.

export function readProfileName(user) {
  // user is undefined at the call site, so accessing .profile throws:
  // TypeError: Cannot read properties of undefined (reading 'profile')
  return user.profile.name;
}

export function useUndeclaredVariable() {
  // ReferenceError: undeclaredVariableThatDoesNotExist is not defined
  return undeclaredVariableThatDoesNotExist + 1;
}

export function createInvalidArray() {
  // RangeError: Invalid array length
  return new Array(-1);
}

export class PaymentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaymentError';
  }
}

export function chargeAccount() {
  throw new PaymentError('Insufficient funds in account');
}
