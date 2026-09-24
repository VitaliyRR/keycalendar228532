CREATE OR REPLACE FUNCTION pending_ical_connections(limit_count integer)
RETURNS TABLE(organization_id uuid, connection_id uuid, actor_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT c.organization_id,c.id,c.created_by FROM connections c
  WHERE c.mechanism='ical' AND c.created_by IS NOT NULL
    AND c.status IN ('verification_pending','healthy','degraded','conflict')
    AND (c.next_poll_at IS NULL OR c.next_poll_at<=now())
    AND (c.poll_lease_until IS NULL OR c.poll_lease_until<=now())
  ORDER BY c.next_poll_at NULLS FIRST,c.id LIMIT LEAST(GREATEST(limit_count,1),20)
$$;
REVOKE ALL ON FUNCTION pending_ical_connections(integer) FROM PUBLIC;
