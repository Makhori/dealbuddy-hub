-- Roles
create type public.app_role as enum ('admin','manager');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "own roles readable" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "admins manage roles" on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Employees
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,
  full_name text not null,
  email text,
  position_title text not null default 'Менеджер по продажам',
  salary numeric not null default 0,
  base_rate numeric not null default 5,
  min_coef numeric not null default 1.2,
  target_coef numeric not null default 1.5,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.employees to authenticated;
grant all on public.employees to service_role;
alter table public.employees enable row level security;

create or replace function public.current_employee_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.employees where user_id = auth.uid() limit 1
$$;

create policy "employees readable" on public.employees for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "admins manage employees" on public.employees for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Leads
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_date date,
  client_name text not null,
  phone text,
  telegram text,
  income text,
  request text,
  status text not null default 'new',
  source_status text,
  tariff text,
  amount numeric,
  net_amount numeric,
  payment_method text,
  payment_date date,
  comment text,
  next_action text,
  manager_id uuid references public.employees(id) on delete set null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.leads (manager_id);
create index on public.leads (status);
grant select, insert, update, delete on public.leads to authenticated;
grant all on public.leads to service_role;
alter table public.leads enable row level security;

create policy "leads read" on public.leads for select to authenticated
  using (public.has_role(auth.uid(),'admin') or manager_id = public.current_employee_id());
create policy "leads insert" on public.leads for insert to authenticated
  with check (public.has_role(auth.uid(),'admin') or manager_id = public.current_employee_id());
create policy "leads update" on public.leads for update to authenticated
  using (public.has_role(auth.uid(),'admin') or manager_id = public.current_employee_id())
  with check (public.has_role(auth.uid(),'admin') or manager_id = public.current_employee_id());
create policy "leads delete" on public.leads for delete to authenticated
  using (public.has_role(auth.uid(),'admin'));

-- Payments
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_no integer,
  client_name text not null,
  contact text,
  tariff text,
  revenue numeric not null default 0,
  net_profit numeric not null default 0,
  receivable numeric,
  payment_method text,
  payment_date date not null default current_date,
  manager_id uuid references public.employees(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  schedule_note text,
  created_at timestamptz not null default now()
);
create index on public.payments (manager_id);
create index on public.payments (payment_date);
grant select, insert, update, delete on public.payments to authenticated;
grant all on public.payments to service_role;
alter table public.payments enable row level security;

create policy "payments read" on public.payments for select to authenticated
  using (public.has_role(auth.uid(),'admin') or manager_id = public.current_employee_id());
create policy "payments insert" on public.payments for insert to authenticated
  with check (public.has_role(auth.uid(),'admin') or manager_id = public.current_employee_id());
create policy "payments update" on public.payments for update to authenticated
  using (public.has_role(auth.uid(),'admin') or manager_id = public.current_employee_id())
  with check (public.has_role(auth.uid(),'admin') or manager_id = public.current_employee_id());
create policy "payments delete" on public.payments for delete to authenticated
  using (public.has_role(auth.uid(),'admin'));

-- Plans
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  period date not null,
  employee_id uuid references public.employees(id) on delete cascade,
  plan_min numeric not null default 0,
  plan_target numeric not null default 0,
  plan_max numeric not null default 0,
  created_at timestamptz not null default now()
);
create unique index plans_period_employee_uidx on public.plans (period, coalesce(employee_id,'00000000-0000-0000-0000-000000000000'::uuid));
grant select, insert, update, delete on public.plans to authenticated;
grant all on public.plans to service_role;
alter table public.plans enable row level security;

create policy "plans read" on public.plans for select to authenticated
  using (public.has_role(auth.uid(),'admin') or employee_id = public.current_employee_id() or employee_id is null);
create policy "admins manage plans" on public.plans for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

insert into public.employees (id, full_name, position_title, salary, base_rate, min_coef, target_coef) values
 ('11111111-1111-1111-1111-111111111111','Алина','Менеджер по продажам',60000,5,1.2,1.5),
 ('22222222-2222-2222-2222-222222222222','Паша','Менеджер по продажам',60000,5,1.2,1.5),
 ('33333333-3333-3333-3333-333333333333','Вася','Руководитель отдела продаж',100000,3,1.2,1.5);

insert into public.plans (period, employee_id, plan_min, plan_target, plan_max) values
 ('2026-02-01','11111111-1111-1111-1111-111111111111',1000000,1500000,2000000),
 ('2026-02-01','22222222-2222-2222-2222-222222222222',1000000,1500000,2000000),
 ('2026-02-01','33333333-3333-3333-3333-333333333333',300000,500000,700000),
 ('2026-02-01',null,2000000,3000000,4000000);