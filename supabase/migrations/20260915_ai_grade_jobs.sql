-- 20260915_ai_grade_jobs.sql
-- One row per paid AI grade request, tied to the user and the card (hash of the two photos).
-- The endpoint creates the row before calling the model and stores the result or error after,
-- so a result survives the user leaving the page, and a second tap on the same card while a
-- job is running is refused (partial unique index). Status 'queued' is reserved for a future
-- worker-based queue; today the endpoint runs the job inline (running → done | error).

create table if not exists ai_grade_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  grade_type text not null check (grade_type in ('ai', 'deep')),
  card_key text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'error')),
  transaction_id uuid references credit_transactions(id),
  request jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists idx_ai_grade_jobs_user_created on ai_grade_jobs (user_id, created_at desc);
create unique index if not exists uq_ai_grade_jobs_inflight
  on ai_grade_jobs (user_id, card_key, grade_type)
  where status in ('queued', 'running');

alter table ai_grade_jobs enable row level security;
drop policy if exists "users read own grade jobs" on ai_grade_jobs;
create policy "users read own grade jobs" on ai_grade_jobs
  for select using (auth.uid() = user_id);
-- Writes happen through the service role only (endpoints); no insert/update policies for users.
