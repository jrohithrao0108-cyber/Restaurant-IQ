-- Fix: "new row violates row-level security policy for table table_sections"
--
-- Why this happens: table_sections has Row-Level Security (RLS) turned on,
-- but no policy exists yet that allows a logged-in user to read or write
-- rows in it — so every request is correctly denied by default. Your
-- restaurant_tables/orders tables already work because they have policies
-- like this; table_sections just never got one.
--
-- This mirrors the auth_user_id -> restaurant_id link already used by
-- ModernLogin.tsx (users.auth_user_id = auth.uid(), users.restaurant_id
-- scopes what that user can touch), so it matches how the rest of the app
-- is scoped per-restaurant.
--
-- Safe to run more than once: every CREATE POLICY is preceded by a
-- matching DROP POLICY IF EXISTS, so re-running this script just
-- recreates the same policies instead of erroring on "already exists".

-- 0. Confirm RLS is on (harmless if it already is).
alter table table_sections enable row level security;

-- 1. Let a user see their own restaurant's sections.
drop policy if exists "Users can view their restaurant's table sections" on table_sections;
create policy "Users can view their restaurant's table sections"
on table_sections for select
using (
  restaurant_id in (
    select restaurant_id from users where auth_user_id = auth.uid()
  )
);

-- 2. Let a user create sections for their own restaurant (this is the
--    one that's failing right now).
drop policy if exists "Users can create table sections for their restaurant" on table_sections;
create policy "Users can create table sections for their restaurant"
on table_sections for insert
with check (
  restaurant_id in (
    select restaurant_id from users where auth_user_id = auth.uid()
  )
);

-- 3. Rename/reorder support (not built into the app UI yet, but the
--    policy is here ready for when it is — harmless to add now).
drop policy if exists "Users can update their restaurant's table sections" on table_sections;
create policy "Users can update their restaurant's table sections"
on table_sections for update
using (
  restaurant_id in (
    select restaurant_id from users where auth_user_id = auth.uid()
  )
)
with check (
  restaurant_id in (
    select restaurant_id from users where auth_user_id = auth.uid()
  )
);

-- 4. Delete support (also not in the UI yet, same reasoning as #3).
drop policy if exists "Users can delete their restaurant's table sections" on table_sections;
create policy "Users can delete their restaurant's table sections"
on table_sections for delete
using (
  restaurant_id in (
    select restaurant_id from users where auth_user_id = auth.uid()
  )
);

-- 5. Verify: this should now list 4 policies on table_sections (select,
--    insert, update, delete), each restricted to matching restaurant_id.
select policyname, cmd, qual, with_check
from pg_policies
where tablename = 'table_sections';
