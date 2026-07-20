-- calculate_payroll_preview was STABLE but calls calculate_employee_payroll →
-- ensure_default_pay_components (INSERT). PostgREST runs STABLE RPCs in a
-- read-only transaction, causing: "cannot execute INSERT in a read-only transaction".
-- calculate_employee_payroll / list_pay_components were already flipped in 00169;
-- the preview entrypoint was missed.

ALTER FUNCTION public.calculate_payroll_preview(UUID, UUID[]) VOLATILE;
