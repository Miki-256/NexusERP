/** Area-scoped fetch helper for financials server page loader. */
export function skipScopedFetch<T>(
  enabled: boolean,
  value: PromiseLike<{ data: T }>
): PromiseLike<{ data: T }> {
  return enabled ? value : Promise.resolve({ data: null as T });
}
