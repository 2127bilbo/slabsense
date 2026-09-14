-- Public bucket for the card identification database (manifest + float16 shards).
-- Anyone can read; only the service role writes (the weekly update job).
insert into storage.buckets (id, name, public)
values ('card-db', 'card-db', true)
on conflict (id) do nothing;

drop policy if exists "public read card-db" on storage.objects;
create policy "public read card-db" on storage.objects
  for select using (bucket_id = 'card-db');
