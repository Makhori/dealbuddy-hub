# Pulse CRM

CRM для отдела продаж: Kanban заявок, учёт оплат, планы и расчёт премий менеджеров.

## Возможности

- единая воронка заявок с разграничением доступа;
- рабочий стол менеджера;
- учёт оплат и дебиторской задолженности;
- планы минимум / цель / максимум;
- расчёт премий по персональным условиям;
- управленческий дашборд;
- роли руководителя и менеджера на основе Supabase RLS.

## Стек

- React 19 и TypeScript;
- TanStack Start, Router и Query;
- Vite 8 и Tailwind CSS 4;
- PostgreSQL, Supabase Auth и Row Level Security.

## Локальный запуск

Требуется Node.js 22 или новее.

```sh
npm install
npm run dev
```

Приложение будет доступно по адресу <http://127.0.0.1:8080>.

Для подключения к базе создайте `.env`:

```dotenv
SUPABASE_PROJECT_ID=your-project-id
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
VITE_SUPABASE_PROJECT_ID=your-project-id
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

## Команды

```sh
npm run dev        # сервер разработки
npm run build      # production-сборка
npm run preview    # просмотр production-сборки
npm run lint       # статический анализ
npm run format     # форматирование
```

SQL-миграции находятся в `supabase/migrations`, описание целевой модели данных — в `docs/DATABASE_SCHEMA.md`.
