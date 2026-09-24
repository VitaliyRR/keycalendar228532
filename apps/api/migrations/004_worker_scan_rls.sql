-- The scheduler returns only routing IDs across tenants. FORCE RLS also applies to
-- the function owner when the migration role is not a superuser/BYPASSRLS role.
-- Only the trusted function owner receives this SELECT policy. Runtime callers
-- cannot impersonate that role and receive only the function's routing IDs.
CREATE POLICY worker_scan_connections ON public.connections FOR SELECT
USING (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT p.proowner FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.pending_ical_connections(integer)'::pg_catalog.regprocedure
  ))
);

CREATE OR REPLACE FUNCTION public.pending_ical_connections(limit_count integer)
RETURNS TABLE(organization_id uuid, connection_id uuid, actor_id uuid)
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT c.organization_id,c.id,c.created_by FROM public.connections c
  WHERE c.mechanism='ical' AND c.created_by IS NOT NULL
    AND c.status IN ('verification_pending','healthy','degraded','conflict')
    AND (c.next_poll_at IS NULL OR c.next_poll_at<=now())
    AND (c.poll_lease_until IS NULL OR c.poll_lease_until<=now())
  ORDER BY c.next_poll_at NULLS FIRST,c.id LIMIT LEAST(GREATEST(limit_count,1),20)
$$;
REVOKE ALL ON FUNCTION public.pending_ical_connections(integer) FROM PUBLIC;
-- migrate.ts grants EXECUTE to the dedicated application role after migrations.
