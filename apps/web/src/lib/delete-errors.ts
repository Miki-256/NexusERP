/** User-friendly message when Postgres blocks delete due to foreign keys. */
export function deleteBlockedMessage(error: { message: string; code?: string }) {
  if (error.code === "23503" || /foreign key|violates foreign key/i.test(error.message)) {
    return "This record is linked to other data (sales, orders, payroll, etc.) and cannot be deleted. Try deactivating or archiving instead.";
  }
  return error.message;
}
