/** Build daily buckets between from/to (inclusive) for charting. */
export function dailyBuckets(from: string, to: string): string[] {
  const keys: string[] = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return keys;
  const cur = new Date(start);
  while (cur <= end) {
    keys.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return keys;
}

export function bucketDailyTotals(
  from: string,
  to: string,
  items: { date: string; value: number }[]
): { date: string; label: string; value: number }[] {
  const map = new Map<string, number>();
  for (const key of dailyBuckets(from, to)) map.set(key, 0);
  for (const item of items) {
    const key = item.date.slice(0, 10);
    if (map.has(key)) map.set(key, (map.get(key) ?? 0) + item.value);
  }
  return [...map.entries()].map(([date, value]) => ({
    date,
    label: new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    value,
  }));
}

export function groupByField<T>(
  items: T[],
  getKey: (item: T) => string,
  getValue: (item: T) => number
): { name: string; value: number }[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item) || "Other";
    map.set(key, (map.get(key) ?? 0) + getValue(item));
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}
