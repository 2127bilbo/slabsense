-- Identification outcomes: what the matcher suggested, what the user confirmed or picked.
-- Measures the identification change in production and becomes training data for a
-- card-specific model later. Rows are written by signed-in users from CardIdentifier.jsx.
create table if not exists public.card_identifications (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  db_version int,
  variant text not null,              -- current | margin | ocr | pixel | both
  status text not null,               -- high | medium | unknown | manual
  top5 jsonb not null,                -- [{ id, similarity }]
  chosen_id text,                     -- id the user confirmed/picked; null = skipped
  ocr_read text                       -- set number read on device, if any
);

alter table public.card_identifications enable row level security;

drop policy if exists "insert own identifications" on public.card_identifications;
create policy "insert own identifications" on public.card_identifications
  for insert with check (auth.uid() = user_id);

drop policy if exists "read own identifications" on public.card_identifications;
create policy "read own identifications" on public.card_identifications
  for select using (auth.uid() = user_id);

create index if not exists card_identifications_created_at_idx on public.card_identifications (created_at desc);
