UPDATE public.payments SET payment_method='рассрочка' WHERE payment_method IN ('рассчрока','рассрчока');

CREATE TABLE public.employee_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period date NOT NULL,
  salary numeric NOT NULL DEFAULT 0,
  base_rate numeric NOT NULL DEFAULT 5,
  min_coef numeric NOT NULL DEFAULT 1.2,
  target_coef numeric NOT NULL DEFAULT 1.5,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, period)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_terms TO authenticated;
GRANT ALL ON public.employee_terms TO service_role;

ALTER TABLE public.employee_terms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage employee terms" ON public.employee_terms FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "employee terms readable" ON public.employee_terms FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR employee_id = current_employee_id());

INSERT INTO public.employee_terms (employee_id, period, salary, base_rate, min_coef, target_coef)
SELECT e.id, p.period, e.salary, e.base_rate, e.min_coef, e.target_coef
FROM public.employees e
CROSS JOIN (VALUES (DATE '2025-12-01'), (DATE '2026-01-01'), (DATE '2026-02-01'), (DATE '2026-03-01')) AS p(period)
ON CONFLICT (employee_id, period) DO NOTHING;

INSERT INTO public.plans (period, employee_id, plan_min, plan_target, plan_max)
SELECT p.period, e.id,
  CASE WHEN e.full_name = 'Вася' THEN 300000 ELSE 700000 END,
  CASE WHEN e.full_name = 'Вася' THEN 500000 ELSE 1000000 END,
  CASE WHEN e.full_name = 'Вася' THEN 700000 ELSE 1400000 END
FROM public.employees e
CROSS JOIN (VALUES (DATE '2025-12-01'), (DATE '2026-01-01'), (DATE '2026-03-01')) AS p(period)
WHERE NOT EXISTS (
  SELECT 1 FROM public.plans x WHERE x.period = p.period AND x.employee_id = e.id
);

INSERT INTO public.plans (period, employee_id, plan_min, plan_target, plan_max)
SELECT p.period, NULL, 1200000, 2000000, 2800000
FROM (VALUES (DATE '2025-12-01'), (DATE '2026-01-01'), (DATE '2026-03-01')) AS p(period)
WHERE NOT EXISTS (
  SELECT 1 FROM public.plans x WHERE x.period = p.period AND x.employee_id IS NULL
);