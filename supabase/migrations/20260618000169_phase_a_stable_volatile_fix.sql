-- Phase A: STABLE functions must not perform writes (correctness + read-replica safety)

ALTER FUNCTION public.resolve_org_api_key(text) VOLATILE;
ALTER FUNCTION public.list_leave_types(uuid) VOLATILE;
ALTER FUNCTION public.get_employee_leave_balances(uuid, uuid, int) VOLATILE;
ALTER FUNCTION public.list_holiday_dates(uuid, int) VOLATILE;
ALTER FUNCTION public.calculate_employee_payroll(uuid, uuid) VOLATILE;
ALTER FUNCTION public.list_pay_components(uuid) VOLATILE;
ALTER FUNCTION public.get_hr_gl_account_code(uuid, text) VOLATILE;
ALTER FUNCTION public.list_hr_payroll_gl_mappings(uuid) VOLATILE;
ALTER FUNCTION public.list_ar_dunning_policies(uuid) VOLATILE;
