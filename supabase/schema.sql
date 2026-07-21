-- ============================================================================
--  Midori — Sync Schema
--  Paste this entire file into the Supabase SQL Editor and run it.
--
--  SAFE TO RUN ON THE EXISTING RUNAWAY PROJECT. This file is purely additive:
--  it creates one new table and never drops anything. Do NOT merge it into
--  run-club/schema.sql — that file opens with `drop table ... cascade` and
--  re-running it would destroy the Midori data created here.
--
--  Re-running this file is safe (idempotent): it drops and recreates only its
--  own policies and trigger, never the table or its rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Why the ledger is stored as one opaque encrypted blob
--
--  Midori already encrypts its state client-side with AES-GCM (see encryptData
--  in js/state.js) and that layer is kept, so this column holds ciphertext the
--  server can never read. Postgres therefore cannot index, query, or aggregate
--  a user's finances — which is the point. A leaked anon key, a policy mistake,
--  or a compromised database yields unreadable bytes without the user's sync
--  key, which is never transmitted.
--
--  The cost: no server-side merge. Conflict resolution happens on the client,
--  which is why `revision` below exists.
-- ---------------------------------------------------------------------------

create table if not exists public.midori_sync (
  -- One row per user. Ties the ledger to the Google account, so the same
  -- person signing into Midori, Runaway, or Life Balance Index is one identity.
  user_id uuid primary key references auth.users on delete cascade,

  encrypted_data text not null,

  -- Wall-clock time of the last edit, milliseconds since epoch, as reported by
  -- whichever device made it. Kept for display ("last synced at") ONLY.
  -- It is deliberately NOT the conflict-resolution mechanism: device clocks
  -- disagree, and a laptop running ten minutes slow would silently lose edits
  -- to an older change made on a phone.
  client_updated_at bigint not null default 0,

  -- The actual concurrency control. Incremented server-side on every write by
  -- the trigger below. A client must send the revision it last saw; if another
  -- device has written since, the numbers differ and the push is rejected
  -- rather than overwriting work the pushing device never saw.
  revision bigint not null default 1,

  -- Server-authoritative timestamp; unlike client_updated_at this cannot be
  -- skewed or spoofed by a device, so it is the trustworthy audit trail.
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.midori_sync enable row level security;

-- ---------------------------------------------------------------------------
--  Row Level Security: a user can only ever touch their own row.
--
--  There is no "select all" policy, so even an authenticated user hitting the
--  REST endpoint with no filter gets back only their own row. Enumerating other
--  users' rows is not possible; this is the specific failure the old kvdb.io
--  bucket had, where the bucket id sat in a public repo and any key in it could
--  be read or overwritten by anyone who knew or guessed the id.
-- ---------------------------------------------------------------------------

drop policy if exists "Read own ledger" on public.midori_sync;
create policy "Read own ledger" on public.midori_sync
  for select using (auth.uid() = user_id);

drop policy if exists "Create own ledger" on public.midori_sync;
create policy "Create own ledger" on public.midori_sync
  for insert with check (auth.uid() = user_id);

drop policy if exists "Update own ledger" on public.midori_sync;
create policy "Update own ledger" on public.midori_sync
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Delete own ledger" on public.midori_sync;
create policy "Delete own ledger" on public.midori_sync
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
--  Server-side revision bump.
--
--  Doing this in a trigger rather than in the client matters: if the client
--  supplied the new revision it could send a stale or duplicate number and
--  reintroduce the lost-update bug this is meant to prevent. Postgres holds a
--  row lock for the duration of the UPDATE, so two devices writing at the same
--  instant are serialised and the second one sees the first one's revision.
-- ---------------------------------------------------------------------------

create or replace function public.midori_bump_revision()
returns trigger
language plpgsql
as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists midori_sync_bump_revision on public.midori_sync;
create trigger midori_sync_bump_revision
  before update on public.midori_sync
  for each row execute function public.midori_bump_revision();

-- ---------------------------------------------------------------------------
--  Compare-and-swap push.
--
--  The client calls this instead of a bare UPDATE. It writes only if the
--  revision the client last saw is still the current one, and reports back
--  what happened so the app can merge and retry instead of clobbering.
--
--  Returning a status string rather than raising an exception keeps a conflict
--  a normal, expected outcome the UI can handle, not an error to swallow.
--
--  SECURITY INVOKER (the default) is deliberate: this function must run with
--  the caller's permissions so the RLS policies above still apply inside it.
--  Marking it SECURITY DEFINER would bypass them and let any signed-in user
--  overwrite any other user's ledger.
-- ---------------------------------------------------------------------------

create or replace function public.midori_push(
  p_encrypted_data text,
  p_client_updated_at bigint,
  p_expected_revision bigint
)
returns table (status text, revision bigint, encrypted_data text, client_updated_at bigint)
language plpgsql
as $$
declare
  v_current public.midori_sync%rowtype;
begin
  select * into v_current from public.midori_sync where user_id = auth.uid();

  -- First push from a brand-new account.
  if not found then
    insert into public.midori_sync (user_id, encrypted_data, client_updated_at, revision)
    values (auth.uid(), p_encrypted_data, p_client_updated_at, 1);
    return query select 'created'::text, 1::bigint, null::text, null::bigint;
    return;
  end if;

  -- Someone else wrote since this device last looked. Hand back the current
  -- row so the client can merge the two ledgers and push the result.
  if v_current.revision <> p_expected_revision then
    return query select 'conflict'::text, v_current.revision,
                        v_current.encrypted_data, v_current.client_updated_at;
    return;
  end if;

  update public.midori_sync
     set encrypted_data = p_encrypted_data,
         client_updated_at = p_client_updated_at
   where user_id = auth.uid();

  return query select 'ok'::text, v_current.revision + 1, null::text, null::bigint;
end;
$$;
