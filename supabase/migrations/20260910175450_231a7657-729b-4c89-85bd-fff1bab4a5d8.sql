revoke all on function public.has_role(uuid, public.app_role) from public, anon;
revoke all on function public.current_employee_id() from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function public.current_employee_id() to authenticated, service_role;