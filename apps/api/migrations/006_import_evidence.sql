-- Stage-0 RealtyCalendar evidence is deliberately separate from live bookings,
-- payments, allocations and the outbox. The encrypted payload is immutable.
CREATE UNIQUE INDEX IF NOT EXISTS import_batches_snapshot_key
  ON public.import_batches(organization_id,source_name,source_checksum);
CREATE UNIQUE INDEX IF NOT EXISTS import_batches_evidence_parent_key
  ON public.import_batches(organization_id,id,source_checksum);

CREATE TABLE IF NOT EXISTS public.import_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  source_checksum text NOT NULL CHECK(source_checksum ~ '^[a-f0-9]{64}$'),
  source_locator text NOT NULL,
  source_row_number integer NOT NULL CHECK(source_row_number>0),
  row_hash text NOT NULL CHECK(row_hash ~ '^[a-f0-9]{64}$'),
  payload_nonce bytea NOT NULL CHECK(octet_length(payload_nonce)=12),
  payload_ciphertext bytea NOT NULL CHECK(octet_length(payload_ciphertext)>0),
  payload_tag bytea NOT NULL CHECK(octet_length(payload_tag)=16),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,batch_id,source_locator),
  FOREIGN KEY(organization_id,batch_id,source_checksum)
    REFERENCES public.import_batches(organization_id,id,source_checksum)
);
CREATE INDEX IF NOT EXISTS import_records_batch_idx
  ON public.import_records(organization_id,batch_id,source_row_number);

ALTER TABLE public.import_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_records FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='import_records' AND policyname='import_records_tenant_read') THEN
    CREATE POLICY import_records_tenant_read ON public.import_records FOR SELECT
      USING (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='import_records' AND policyname='import_records_tenant_insert') THEN
    CREATE POLICY import_records_tenant_insert ON public.import_records FOR INSERT
      WITH CHECK (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reject_import_evidence_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Import evidence is immutable' USING ERRCODE='55000';
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
      WHERE tgrelid='public.import_records'::regclass AND tgname='import_records_immutable') THEN
    CREATE TRIGGER import_records_immutable
      BEFORE UPDATE OR DELETE ON public.import_records
      FOR EACH ROW EXECUTE FUNCTION public.reject_import_evidence_change();
  END IF;
END $$;

-- A peer-authenticated migration can run before the app runner's general GRANT.
-- Keep this narrow: the runtime role cannot update or delete evidence.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='keycalendar_app') THEN
    EXECUTE 'GRANT SELECT, INSERT ON public.import_records TO keycalendar_app';
  END IF;
END $$;
