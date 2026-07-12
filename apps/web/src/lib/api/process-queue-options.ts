/** undefined = DB default (archive cold sales on Sunday UTC). */
export function resolveArchiveSales(request: Request): boolean | undefined {
  const url = new URL(request.url);
  const param = url.searchParams.get("archive_sales");
  if (param === "1" || param === "true") return true;
  if (param === "0" || param === "false") return false;
  if (request.headers.get("x-archive-sales") === "1") return true;
  if (process.env.FORCE_SALES_ARCHIVE === "true") return true;
  if (process.env.SKIP_SALES_ARCHIVE === "true") return false;
  return undefined;
}
