-- Budget Tracker shared backend. Run in Supabase SQL Editor as project owner.
create extension if not exists pgcrypto;

create type public.member_role as enum ('admin', 'editor', 'viewer');
create type public.transaction_type as enum ('income', 'expense');

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'viewer',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type public.transaction_type not null,
  description text not null check (length(trim(description)) between 1 and 300),
  amount numeric(14,2) not null check (amount > 0),
  category text not null check (length(trim(category)) between 1 and 100),
  transaction_date date not null,
  attachment_path text,
  attachment_name text,
  attachment_type text,
  attachment_size bigint check (attachment_size is null or attachment_size <= 10485760),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.audit_logs (
  id bigint generated always as identity primary key,
  project_id uuid references public.projects(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index transactions_project_date_idx on public.transactions(project_id, transaction_date desc);
create index audit_logs_project_time_idx on public.audit_logs(project_id, created_at desc);
create index project_members_user_idx on public.project_members(user_id);

create or replace function public.has_project_role(p_project_id uuid, allowed public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.project_members pm where pm.project_id = p_project_id and pm.user_id = (select auth.uid()) and pm.role = any(allowed));
$$;
revoke all on function public.has_project_role(uuid, public.member_role[]) from public;
grant execute on function public.has_project_role(uuid, public.member_role[]) to authenticated;

-- Only project admins can change memberships. Initial admin membership is created by create_project().
create or replace function public.create_project(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(trim(p_name)) not between 1 and 100 then raise exception 'Project name must be 1-100 characters'; end if;
  insert into public.projects(name, created_by) values(trim(p_name), auth.uid()) returning id into new_id;
  insert into public.project_members(project_id, user_id, role) values(new_id, auth.uid(), 'admin');
  insert into public.audit_logs(project_id, actor_id, action, entity_type, entity_id) values(new_id, auth.uid(), 'project.created', 'project', new_id::text);
  return new_id;
end; $$;
grant execute on function public.create_project(text) to authenticated;

-- Audit changes at the database layer so clients cannot forge actor or timestamp.
create or replace function public.audit_transaction_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare action_name text; project_key uuid; entity_key text; payload jsonb;
begin
  if tg_op = 'INSERT' then action_name := 'transaction.created'; project_key := new.project_id; entity_key := new.id::text; payload := jsonb_build_object('description', new.description, 'type', new.type, 'amount', new.amount, 'category', new.category, 'date', new.transaction_date); return new;
  elsif tg_op = 'UPDATE' then action_name := 'transaction.updated'; project_key := new.project_id; entity_key := new.id::text; payload := jsonb_build_object('before', jsonb_build_object('description', old.description, 'type', old.type, 'amount', old.amount, 'category', old.category, 'date', old.transaction_date), 'after', jsonb_build_object('description', new.description, 'type', new.type, 'amount', new.amount, 'category', new.category, 'date', new.transaction_date)); return new;
  else action_name := 'transaction.deleted'; project_key := old.project_id; entity_key := old.id::text; payload := jsonb_build_object('description', old.description, 'type', old.type, 'amount', old.amount, 'category', old.category, 'date', old.transaction_date); return old;
  end if;
  insert into public.audit_logs(project_id, actor_id, action, entity_type, entity_id, details) values(project_key, auth.uid(), action_name, 'transaction', entity_key, payload);
end; $$;
-- Trigger needs audit insert before return; separate correct implementation for all operation types.
create or replace function public.audit_transaction_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare action_name text; project_key uuid; entity_key text; payload jsonb;
begin
  if tg_op = 'INSERT' then action_name := 'transaction.created'; project_key := new.project_id; entity_key := new.id::text; payload := jsonb_build_object('description', new.description, 'type', new.type, 'amount', new.amount, 'category', new.category, 'date', new.transaction_date);
  elsif tg_op = 'UPDATE' then action_name := 'transaction.updated'; project_key := new.project_id; entity_key := new.id::text; payload := jsonb_build_object('before', jsonb_build_object('description', old.description, 'type', old.type, 'amount', old.amount, 'category', old.category, 'date', old.transaction_date), 'after', jsonb_build_object('description', new.description, 'type', new.type, 'amount', new.amount, 'category', new.category, 'date', new.transaction_date));
  else action_name := 'transaction.deleted'; project_key := old.project_id; entity_key := old.id::text; payload := jsonb_build_object('description', old.description, 'type', old.type, 'amount', old.amount, 'category', old.category, 'date', old.transaction_date); end if;
  insert into public.audit_logs(project_id, actor_id, action, entity_type, entity_id, details) values(project_key, auth.uid(), action_name, 'transaction', entity_key, payload);
  if tg_op = 'DELETE' then return old; else return new; end if;
end; $$;
create trigger transactions_audit after insert or update or delete on public.transactions for each row execute function public.audit_transaction_change();

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.transactions enable row level security;
alter table public.audit_logs enable row level security;

create policy "members read projects" on public.projects for select to authenticated using (exists(select 1 from public.project_members pm where pm.project_id = id and pm.user_id = (select auth.uid())));
create policy "admins update projects" on public.projects for update to authenticated using (public.has_project_role(id, array['admin']::public.member_role[])) with check (public.has_project_role(id, array['admin']::public.member_role[]));
create policy "members read own memberships" on public.project_members for select to authenticated using (user_id = (select auth.uid()) or public.has_project_role(project_id, array['admin']::public.member_role[]));
create policy "admins add memberships" on public.project_members for insert to authenticated with check (public.has_project_role(project_id, array['admin']::public.member_role[]));
create policy "admins change memberships" on public.project_members for update to authenticated using (public.has_project_role(project_id, array['admin']::public.member_role[])) with check (public.has_project_role(project_id, array['admin']::public.member_role[]));
create policy "admins remove memberships" on public.project_members for delete to authenticated using (public.has_project_role(project_id, array['admin']::public.member_role[]));
create policy "members read transactions" on public.transactions for select to authenticated using (public.has_project_role(project_id, array['admin','editor','viewer']::public.member_role[]));
create policy "admins and editors add transactions" on public.transactions for insert to authenticated with check (public.has_project_role(project_id, array['admin','editor']::public.member_role[]) and created_by = (select auth.uid()));
create policy "admins and editors update transactions" on public.transactions for update to authenticated using (public.has_project_role(project_id, array['admin','editor']::public.member_role[])) with check (public.has_project_role(project_id, array['admin','editor']::public.member_role[]) and updated_by = (select auth.uid()));
create policy "admins delete transactions" on public.transactions for delete to authenticated using (public.has_project_role(project_id, array['admin']::public.member_role[]));
create policy "members read audit logs" on public.audit_logs for select to authenticated using (public.has_project_role(project_id, array['admin','editor','viewer']::public.member_role[]));
-- No client insert/update/delete policies for audit_logs: rows are created by trusted triggers/functions only.

grant select, update on public.projects to authenticated;
grant select, insert, update, delete on public.project_members to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select on public.audit_logs to authenticated;

-- Private object bucket; object names must begin with project UUID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;
create policy "members read project receipts" on storage.objects for select to authenticated using (bucket_id = 'receipts' and public.has_project_role(((storage.foldername(name))[1])::uuid, array['admin','editor','viewer']::public.member_role[]));
create policy "editors upload project receipts" on storage.objects for insert to authenticated with check (bucket_id = 'receipts' and public.has_project_role(((storage.foldername(name))[1])::uuid, array['admin','editor']::public.member_role[]));
create policy "editors update project receipts" on storage.objects for update to authenticated using (bucket_id = 'receipts' and public.has_project_role(((storage.foldername(name))[1])::uuid, array['admin','editor']::public.member_role[])) with check (bucket_id = 'receipts' and public.has_project_role(((storage.foldername(name))[1])::uuid, array['admin','editor']::public.member_role[]));
create policy "admins delete project receipts" on storage.objects for delete to authenticated using (bucket_id = 'receipts' and public.has_project_role(((storage.foldername(name))[1])::uuid, array['admin']::public.member_role[]));
