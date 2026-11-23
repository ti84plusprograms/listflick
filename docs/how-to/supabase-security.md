# Harden Supabase access

ListFlick uses Supabase in two server-only ways:

- FastAPI connects directly to PostgreSQL through `DATABASE_URL`.
- FastAPI uses `SUPABASE_SERVICE_ROLE_KEY` for the private `images` Storage
  bucket.

The mobile app does not receive Supabase credentials and does not query the
Supabase Data API or Storage directly. Firebase ID tokens terminate at FastAPI,
which enforces UID ownership before reading or changing item data.

## Database boundary

Migrations 7 and 8 in `backend/app/db/migrations.py` protect app-owned objects
from accidental Data API exposure:

- RLS is enabled on `items`, `analysis_jobs`, `ai_request_usage` when present,
  and `schema_migrations`.
- No RLS policies are created, so Data API roles have no row access.
- All table privileges are revoked from `PUBLIC`, `anon`, `authenticated`, and
  `service_role`.
- Migration 7 revokes default privileges for future tables and sequences in
  `public`, plus explicit function defaults for Data API roles.
- Migration 8 revokes the global default `PUBLIC` execution grant for future
  functions created by the migration role. PostgreSQL cannot remove that
  global grant with a schema-scoped revoke.

The direct PostgreSQL migration role continues to work because it owns the
objects and production's configured role has `BYPASSRLS`. Do not point
`DATABASE_URL` at `anon`, `authenticated`, or `service_role`.

For every future public-schema table, enable RLS and revoke client grants in
the same numbered migration. Do not add a permissive policy merely to silence
the Supabase Security Advisor. A direct-client feature needs separate policies
for each operation, UID ownership predicates, `USING` plus `WITH CHECK` for
updates, and both allow and deny tests.

## Storage boundary

Keep the `images` bucket private. No `storage.objects` client policies are
needed because uploads, reads, signed URLs, replacements, and deletes run only
through the backend's service-role client. Never expose the service-role key in
mobile configuration.

## Apply and verify

Deploying or starting the backend applies pending migrations. Before release,
query the database catalogs with an administrative SQL session:

```sql
select n.nspname as schema_name,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relname;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

begin;

create function public.listflick_privilege_probe()
returns integer
language sql
as $function$ select 1 $function$;

select rolname,
       has_function_privilege(
           rolname,
           'public.listflick_privilege_probe()',
           'EXECUTE'
       ) as can_execute
from pg_roles
where rolname in ('anon', 'authenticated', 'service_role')
order by rolname;

rollback;
```

Expected results:

- every app-owned `public` table reports `rls_enabled = true`;
- the grant query returns no rows for app-owned `public` tables;
- there are no client policies on app-owned tables or the private `images`
  bucket;
- the rollback-only function probe reports `can_execute = false` for every
  listed client role;
- authenticated FastAPI flows still work and `/health` remains healthy.

The global function default applies to future functions created by the
migration role in every schema. If a function is intentionally exposed, grant
`EXECUTE` to only the required role after creating it. Audit and revoke access
on existing functions separately because default privileges are not
retroactive.

Run the Supabase Security Advisor after deployment. Treat any remaining
`rls_disabled_in_public` result on an app-owned table as a release blocker.
