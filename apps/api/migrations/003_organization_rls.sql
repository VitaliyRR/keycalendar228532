DROP POLICY tenant_context ON organizations;
CREATE POLICY tenant_context ON organizations
USING (
  organizations.id = nullif(current_setting('app.organization_id',true),'')::uuid
  OR EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = organizations.id
      AND m.user_id = nullif(current_setting('app.user_id',true),'')::uuid
      AND m.status='active'
  )
)
WITH CHECK (organizations.id = nullif(current_setting('app.organization_id',true),'')::uuid);
