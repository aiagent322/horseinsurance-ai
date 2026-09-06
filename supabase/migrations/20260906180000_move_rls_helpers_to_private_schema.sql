-- Move internal RLS helpers out of the exposed public schema.
-- Does not recreate the functions. Does not rewrite RLS policies.
-- PostgreSQL dependency tracking preserves policy references.

create schema if not exists private;

alter function public.app_is_account_member(uuid) set schema private;
alter function public.app_has_role(uuid, text) set schema private;
alter function public.app_is_staff(text) set schema private;

comment on schema private is
  'Non-exposed schema for internal authorization helpers used by RLS policies.';
