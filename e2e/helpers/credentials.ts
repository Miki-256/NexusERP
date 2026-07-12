export function e2eCredentials() {
  return {
    email:
      process.env.E2E_EMAIL ??
      process.env.LOAD_TEST_EMAIL ??
      process.env.INTEGRATION_EMAIL ??
      "",
    password:
      process.env.E2E_PASSWORD ??
      process.env.LOAD_TEST_PASSWORD ??
      process.env.INTEGRATION_PASSWORD ??
      "",
  };
}

export function hasE2eCredentials() {
  const { email, password } = e2eCredentials();
  return Boolean(email && password);
}

/** Optional cashier user for permission-matrix E2E (defaults omit financials/team/settings). */
export function e2eCashierCredentials() {
  return {
    email: process.env.E2E_CASHIER_EMAIL ?? "",
    password: process.env.E2E_CASHIER_PASSWORD ?? "",
  };
}

export function hasE2eCashierCredentials() {
  const { email, password } = e2eCashierCredentials();
  return Boolean(email && password);
}
