-- A catalog lot may become a Property only after its identity, stay times and
-- IANA timezone have been reviewed. This table preserves the immutable source
-- lot ID; it does not represent a Unit, channel connection or availability.
CREATE TABLE IF NOT EXISTS public.catalog_property_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  source_system text NOT NULL CHECK(source_system='RealtyCalendar'),
  source_lot_id text NOT NULL CHECK(source_lot_id ~ '^[0-9]{1,20}$'),
  property_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  source_checksum text NOT NULL CHECK(source_checksum ~ '^[a-f0-9]{64}$'),
  source_name_sha256 text NOT NULL CHECK(source_name_sha256 ~ '^[a-f0-9]{64}$'),
  approval_sha256 text NOT NULL CHECK(approval_sha256 ~ '^[a-f0-9]{64}$'),
  review_manifest_sha256 text NOT NULL CHECK(review_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,source_system,source_lot_id),
  UNIQUE(organization_id,property_id),
  FOREIGN KEY(organization_id,property_id)
    REFERENCES public.properties(organization_id,id),
  FOREIGN KEY(organization_id,batch_id,source_checksum)
    REFERENCES public.import_batches(organization_id,id,source_checksum),
  FOREIGN KEY(organization_id,reviewed_by)
    REFERENCES public.memberships(organization_id,user_id)
);
CREATE INDEX IF NOT EXISTS catalog_property_mappings_batch_idx
  ON public.catalog_property_mappings(organization_id,batch_id);

ALTER TABLE public.catalog_property_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_property_mappings FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_property_mappings_tenant_read
  ON public.catalog_property_mappings FOR SELECT
  USING (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY catalog_property_mappings_tenant_insert
  ON public.catalog_property_mappings FOR INSERT
  WITH CHECK (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);

CREATE TRIGGER catalog_property_mappings_immutable
  BEFORE UPDATE OR DELETE ON public.catalog_property_mappings
  FOR EACH ROW EXECUTE FUNCTION public.reject_import_evidence_change();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='keycalendar_app') THEN
    EXECUTE 'GRANT SELECT, INSERT ON public.catalog_property_mappings TO keycalendar_app';
  END IF;
END $$;
