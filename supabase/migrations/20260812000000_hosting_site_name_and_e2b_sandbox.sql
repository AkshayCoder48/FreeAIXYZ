-- Rename cf_pages_project_name to hosting_site_name (provider-neutral column).
-- This supports Puter.js hosting instead of Cloudflare Pages.
alter table public.projects
  rename column cf_pages_project_name to hosting_site_name;

-- Create table for E2B sandbox results (background execution state).
create table if not exists public.sandbox_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sandbox_id text not null,
  command text not null,
  result jsonb,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  created_at timestamptz not null default now()
);

-- Enable RLS on sandbox_results
alter table public.sandbox_results enable row level security;

-- Users can only read their own sandbox results
create policy "Users can read own sandbox results"
  on public.sandbox_results
  for select
  using (auth.uid() = user_id);
