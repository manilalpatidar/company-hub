-- Company Hub: full database schema with row-level security.
-- Run once in Supabase: SQL Editor > New query > paste > Run.

create type app_role as enum ('admin','hr','accountant','employee');
create type leave_status as enum ('pending','approved','rejected');
create type convo_type as enum ('announcement','group','dm');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  role app_role not null default 'employee',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- helpers ----------
create function public.my_role() returns app_role language sql stable security definer set search_path=public as
$$ select role from profiles where id = auth.uid() and active $$;

create function public.has_role(variadic roles text[]) returns boolean language sql stable security definer set search_path=public as
$$ select coalesce(my_role()::text = any(roles), false) $$;

-- Company time zone used for "today" in attendance. Change if not India.
create function public.today_local() returns date language sql stable as
$$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- First person to sign in becomes admin; everyone after is an employee.
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into profiles(id,email,full_name,role) values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    case when exists(select 1 from profiles) then 'employee'::app_role else 'admin'::app_role end);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table profiles enable row level security;
create policy profiles_read on profiles for select using (my_role() is not null);
create policy profiles_admin_update on profiles for update using (has_role('admin')) with check (has_role('admin'));

-- ---------- messaging ----------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  type convo_type not null,
  name text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create table public.conversation_members (
  conversation_id uuid references conversations(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  primary key (conversation_id, user_id)
);
create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null default auth.uid() references profiles(id),
  body text not null default '',
  file_path text, file_name text,
  created_at timestamptz not null default now(),
  check (body <> '' or file_path is not null)
);
create index on messages (conversation_id, created_at);

create function public.is_member(cid uuid) returns boolean language sql stable security definer set search_path=public as
$$ select my_role() is not null and exists(select 1 from conversation_members where conversation_id=cid and user_id=auth.uid()) $$;
create function public.can_read_convo(cid uuid) returns boolean language sql stable security definer set search_path=public as
$$ select my_role() is not null and (exists(select 1 from conversations where id=cid and type='announcement') or is_member(cid)) $$;
create function public.can_post(cid uuid) returns boolean language sql stable security definer set search_path=public as
$$ select my_role() is not null and (
     (exists(select 1 from conversations where id=cid and type='announcement') and has_role('admin','hr'))
  or (exists(select 1 from conversations where id=cid and type<>'announcement') and is_member(cid))) $$;

alter table conversations enable row level security;
alter table conversation_members enable row level security;
alter table messages enable row level security;
create policy convo_read on conversations for select using (can_read_convo(id));
create policy members_read on conversation_members for select using (user_id = auth.uid() or is_member(conversation_id));
create policy msg_read on messages for select using (can_read_convo(conversation_id));
create policy msg_insert on messages for insert with check (sender_id = auth.uid() and can_post(conversation_id));
-- Admins are NOT given access to other people's DMs or groups.

create function public.start_dm(other uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  if my_role() is null then raise exception 'not allowed'; end if;
  if other = auth.uid() then raise exception 'cannot message yourself'; end if;
  if not exists(select 1 from profiles where id=other and active) then raise exception 'unknown user'; end if;
  select c.id into cid from conversations c where c.type='dm'
    and exists(select 1 from conversation_members m where m.conversation_id=c.id and m.user_id=auth.uid())
    and exists(select 1 from conversation_members m where m.conversation_id=c.id and m.user_id=other) limit 1;
  if cid is null then
    insert into conversations(type,created_by) values ('dm',auth.uid()) returning id into cid;
    insert into conversation_members values (cid,auth.uid()),(cid,other);
  end if;
  return cid;
end $$;

create function public.create_group(group_name text, member_ids uuid[]) returns uuid language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  if not has_role('admin','hr') then raise exception 'only admin or HR can create groups'; end if;
  insert into conversations(type,name,created_by) values ('group',group_name,auth.uid()) returning id into cid;
  insert into conversation_members select cid, u from (select distinct unnest(member_ids || auth.uid()) u) s
    where exists(select 1 from profiles where id=u and active);
  return cid;
end $$;

insert into conversations(type,name) values ('announcement','Announcements');
alter publication supabase_realtime add table public.messages;

-- ---------- attendance (server time, cannot be faked by the phone clock) ----------
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references profiles(id),
  work_date date not null,
  check_in timestamptz, check_out timestamptz,
  unique (user_id, work_date)
);
alter table attendance enable row level security;
create policy att_read on attendance for select using (user_id = auth.uid() or has_role('admin','hr'));

create function public.check_in() returns void language plpgsql security definer set search_path=public as $$
begin
  if my_role() is null then raise exception 'not allowed'; end if;
  insert into attendance(user_id,work_date,check_in) values (auth.uid(), today_local(), now()) on conflict (user_id,work_date) do nothing;
end $$;
create function public.check_out() returns void language plpgsql security definer set search_path=public as $$
begin
  if my_role() is null then raise exception 'not allowed'; end if;
  update attendance set check_out = now() where user_id=auth.uid() and work_date=today_local() and check_in is not null and check_out is null;
end $$;

-- ---------- leave ----------
create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references profiles(id),
  start_date date not null, end_date date not null,
  reason text not null default '',
  status leave_status not null default 'pending',
  decided_by uuid references profiles(id), decided_at timestamptz, note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
alter table leave_requests enable row level security;
create policy leave_read on leave_requests for select using (user_id = auth.uid() or has_role('admin','hr'));
create policy leave_insert on leave_requests for insert with check (user_id = auth.uid() and status = 'pending' and my_role() is not null);
create policy leave_decide on leave_requests for update using (has_role('admin','hr')) with check (has_role('admin','hr'));

-- ---------- accounting (admin + accountant only) ----------
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null, description text not null, category text not null,
  amount numeric(14,2) not null,   -- positive = income, negative = expense
  created_by uuid default auth.uid() references profiles(id),
  created_at timestamptz not null default now()
);
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique, client text not null,
  issue_date date not null, due_date date not null,
  amount numeric(14,2) not null check (amount >= 0),
  status text not null default 'unpaid' check (status in ('unpaid','paid')),  -- "overdue" = unpaid and past due_date
  created_by uuid default auth.uid() references profiles(id),
  created_at timestamptz not null default now()
);
alter table ledger_entries enable row level security;
alter table invoices enable row level security;
create policy ledger_all on ledger_entries for all using (has_role('admin','accountant')) with check (has_role('admin','accountant'));
create policy invoices_all on invoices for all using (has_role('admin','accountant')) with check (has_role('admin','accountant'));

create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text, action text, row_id text, actor uuid, at timestamptz not null default now(),
  old_data jsonb, new_data jsonb
);
alter table audit_log enable row level security;
create policy audit_read on audit_log for select using (has_role('admin'));
create function public.audit() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'INSERT' then insert into audit_log(table_name,action,row_id,actor,new_data) values (tg_table_name,tg_op,new.id::text,auth.uid(),to_jsonb(new));
  elsif tg_op = 'UPDATE' then insert into audit_log(table_name,action,row_id,actor,old_data,new_data) values (tg_table_name,tg_op,new.id::text,auth.uid(),to_jsonb(old),to_jsonb(new));
  else insert into audit_log(table_name,action,row_id,actor,old_data) values (tg_table_name,tg_op,old.id::text,auth.uid(),to_jsonb(old)); end if;
  return null;
end $$;
create trigger audit_ledger after insert or update or delete on ledger_entries for each row execute function public.audit();
create trigger audit_invoices after insert or update or delete on invoices for each row execute function public.audit();

-- ---------- documents (folder-level access) ----------
create function public.can_access_folder(f text) returns boolean language sql stable security definer set search_path=public as $$
  select case f
    when 'General' then my_role() is not null
    when 'Finance' then has_role('admin','accountant')
    when 'HR'      then has_role('admin','hr')
    when 'Legal'   then has_role('admin')
    else false end $$;
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  folder text not null check (folder in ('General','Finance','HR','Legal')),
  name text not null, path text not null, size bigint, description text,
  uploaded_by uuid not null default auth.uid() references profiles(id),
  created_at timestamptz not null default now()
);
alter table documents enable row level security;
create policy docs_read on documents for select using (can_access_folder(folder));
create policy docs_insert on documents for insert with check (can_access_folder(folder) and uploaded_by = auth.uid());
create policy docs_delete on documents for delete using (uploaded_by = auth.uid() or has_role('admin'));

-- ---------- file storage (private buckets) ----------
insert into storage.buckets (id,name,public) values ('files','files',false),('chat','chat',false) on conflict do nothing;
-- documents: path = <Folder>/<file>
create policy files_read   on storage.objects for select using (bucket_id='files' and can_access_folder((storage.foldername(name))[1]));
create policy files_insert on storage.objects for insert with check (bucket_id='files' and can_access_folder((storage.foldername(name))[1]));
create policy files_delete on storage.objects for delete using (bucket_id='files' and (owner_id = auth.uid()::text or has_role('admin')));
-- chat attachments: path = <conversation id>/<file>
create policy chat_read   on storage.objects for select using (bucket_id='chat' and can_read_convo(((storage.foldername(name))[1])::uuid));
create policy chat_insert on storage.objects for insert with check (bucket_id='chat' and can_post(((storage.foldername(name))[1])::uuid));
