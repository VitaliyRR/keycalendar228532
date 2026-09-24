CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  csrf_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  auth_level text NOT NULL DEFAULT 'password' CHECK(auth_level IN ('password','mfa'))
);
CREATE INDEX IF NOT EXISTS sessions_user_active_idx ON sessions(user_id,expires_at) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS identity_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('verify_email','password_reset','invitation')),
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS onboarding_requests (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  request_hash bytea NOT NULL,
  organization_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,key)
);

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  legal_name text,
  timezone text NOT NULL DEFAULT 'Europe/Moscow',
  currency char(3) NOT NULL DEFAULT 'RUB',
  state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','suspended','deleting')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id)
);
CREATE TABLE IF NOT EXISTS memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK(role IN ('owner','admin','manager','accountant','housekeeper','viewer')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','invited','revoked')),
  permissions text[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,user_id), UNIQUE(organization_id,id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id,organization_id);
CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  email citext NOT NULL,
  role text NOT NULL CHECK(role IN ('admin','manager','accountant','housekeeper','viewer')),
  token_hash bytea NOT NULL UNIQUE,
  property_ids uuid[] NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  version integer NOT NULL,
  active_unit_limit integer,
  active_member_limit integer,
  monthly_price_minor bigint,
  currency char(3) NOT NULL DEFAULT 'RUB',
  effective_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(code,version)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id),
  plan_id uuid REFERENCES subscription_plans(id),
  state text NOT NULL CHECK(state IN ('trial','active','grace','read_only')),
  trial_ends_at timestamptz,
  paid_through timestamptz,
  grace_ends_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id)
);

CREATE TABLE IF NOT EXISTS properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  address_private text,
  timezone text NOT NULL DEFAULT 'Europe/Moscow',
  checkin_time time NOT NULL DEFAULT '15:00',
  checkout_time time NOT NULL DEFAULT '11:00',
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS property_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  property_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,membership_id,property_id),
  FOREIGN KEY(organization_id,membership_id) REFERENCES memberships(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,property_id) REFERENCES properties(organization_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS unit_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  property_id uuid NOT NULL,
  name text NOT NULL,
  capacity_adults integer NOT NULL CHECK(capacity_adults>0),
  capacity_children integer NOT NULL DEFAULT 0 CHECK(capacity_children>=0),
  version integer NOT NULL DEFAULT 1,
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,property_id) REFERENCES properties(organization_id,id)
);
CREATE TABLE IF NOT EXISTS units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  property_id uuid NOT NULL,
  category_id uuid,
  name text NOT NULL,
  capacity_adults integer NOT NULL DEFAULT 2 CHECK(capacity_adults>0),
  capacity_children integer NOT NULL DEFAULT 0 CHECK(capacity_children>=0),
  base_rate_minor bigint NOT NULL DEFAULT 0 CHECK(base_rate_minor>=0),
  currency char(3) NOT NULL DEFAULT 'RUB',
  state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','paused','archived')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,property_id) REFERENCES properties(organization_id,id),
  FOREIGN KEY(organization_id,category_id) REFERENCES unit_categories(organization_id,id)
);
CREATE INDEX IF NOT EXISTS units_property_idx ON units(organization_id,property_id);

CREATE TABLE IF NOT EXISTS rate_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  cancellation_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS rate_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  rate_plan_id uuid NOT NULL,
  stay_date date NOT NULL,
  price_minor bigint NOT NULL CHECK(price_minor>=0),
  min_nights integer CHECK(min_nights>0),
  max_nights integer CHECK(max_nights>0),
  stop_sell boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  UNIQUE(organization_id,rate_plan_id,unit_id,stay_date), UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,unit_id) REFERENCES units(organization_id,id),
  FOREIGN KEY(organization_id,rate_plan_id) REFERENCES rate_plans(organization_id,id)
);
CREATE TABLE IF NOT EXISTS rate_change_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  input_hash bytea NOT NULL,
  input jsonb NOT NULL,
  rate_snapshot jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  committed_at timestamptz,
  UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  display_name text NOT NULL,
  email text,
  phone text,
  note text,
  legal_basis text NOT NULL DEFAULT 'contract' CHECK(legal_basis IN ('contract','consent')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  rate_plan_id uuid NOT NULL,
  checkin date NOT NULL,
  checkout date NOT NULL,
  adults integer NOT NULL,
  children integer NOT NULL DEFAULT 0,
  currency char(3) NOT NULL,
  total_minor bigint NOT NULL CHECK(total_minor>=0),
  lines jsonb NOT NULL,
  input_hash bytea NOT NULL,
  rate_version_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(checkout>checkin), UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,unit_id) REFERENCES units(organization_id,id),
  FOREIGN KEY(organization_id,rate_plan_id) REFERENCES rate_plans(organization_id,id)
);
CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  reference text NOT NULL,
  guest_id uuid,
  guest_display_name text,
  status text NOT NULL CHECK(status IN ('request','confirmed','checked_in','checked_out','no_show','cancelled')),
  archived_at timestamptz,
  source text NOT NULL DEFAULT 'direct',
  accepted_quote_id uuid,
  total_minor bigint NOT NULL DEFAULT 0 CHECK(total_minor>=0),
  currency char(3) NOT NULL DEFAULT 'RUB',
  sync_state text NOT NULL DEFAULT 'local_only' CHECK(sync_state IN ('local_only','queued','delivered','partial','conflict')),
  actual_checkin_at timestamptz,
  actual_checkout_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id), UNIQUE(organization_id,reference),
  FOREIGN KEY(organization_id,guest_id) REFERENCES guests(organization_id,id),
  FOREIGN KEY(organization_id,accepted_quote_id) REFERENCES quotes(organization_id,id)
);
CREATE TABLE IF NOT EXISTS reservation_stays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  checkin date NOT NULL,
  checkout date NOT NULL,
  adults integer NOT NULL DEFAULT 1,
  children integer NOT NULL DEFAULT 0,
  CHECK(checkout>checkin), UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,reservation_id) REFERENCES reservations(organization_id,id),
  FOREIGN KEY(organization_id,unit_id) REFERENCES units(organization_id,id)
);
CREATE INDEX IF NOT EXISTS reservation_stays_window_idx ON reservation_stays(organization_id,unit_id,checkin,checkout);
CREATE TABLE IF NOT EXISTS availability_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  reservation_id uuid,
  kind text NOT NULL CHECK(kind IN ('reservation','block','hold','buffer')),
  checkin date NOT NULL,
  checkout date NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','released')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(checkout>checkin), UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,unit_id) REFERENCES units(organization_id,id),
  FOREIGN KEY(organization_id,reservation_id) REFERENCES reservations(organization_id,id),
  CONSTRAINT no_double_booking EXCLUDE USING gist
    (organization_id WITH =, unit_id WITH =, daterange(checkin,checkout,'[)') WITH &&)
    WHERE (state='active')
);
CREATE INDEX IF NOT EXISTS allocation_window_idx ON availability_allocations USING gist(organization_id,unit_id,daterange(checkin,checkout,'[)'));

CREATE TABLE IF NOT EXISTS charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  original_charge_id uuid,
  kind text NOT NULL CHECK(kind IN ('night','service','fee','discount','credit_note')),
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  service_date date,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,reservation_id) REFERENCES reservations(organization_id,id),
  FOREIGN KEY(organization_id,original_charge_id) REFERENCES charges(organization_id,id)
);
CREATE TABLE IF NOT EXISTS cancellation_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  reservation_version integer NOT NULL,
  preview_hash text NOT NULL,
  preview jsonb NOT NULL,
  effective_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,reservation_id) REFERENCES reservations(organization_id,id)
);
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  property_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  currency char(3) NOT NULL DEFAULT 'RUB',
  category text NOT NULL,
  description text NOT NULL,
  incurred_on date NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,property_id) REFERENCES properties(organization_id,id)
);
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  provider text NOT NULL,
  kind text NOT NULL DEFAULT 'stay' CHECK(kind IN ('stay','deposit')),
  provider_ref text,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  currency char(3) NOT NULL,
  state text NOT NULL CHECK(state IN ('pending','unknown','succeeded','failed','reversed')),
  method text NOT NULL,
  evidence_ref text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,reservation_id) REFERENCES reservations(organization_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref_idx ON payments(organization_id,provider,provider_ref) WHERE provider_ref IS NOT NULL;
CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  currency char(3) NOT NULL,
  state text NOT NULL CHECK(state IN ('pending','unknown','succeeded','failed')),
  provider_ref text,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,payment_id) REFERENCES payments(organization_id,id)
);
CREATE TABLE IF NOT EXISTS deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  payment_id uuid,
  mode text NOT NULL CHECK(mode IN ('authorization','transfer','manual_capture')),
  state text NOT NULL,
  authorized_minor bigint NOT NULL DEFAULT 0 CHECK(authorized_minor>=0),
  captured_minor bigint NOT NULL DEFAULT 0 CHECK(captured_minor>=0),
  returned_minor bigint NOT NULL DEFAULT 0 CHECK(returned_minor>=0),
  retained_minor bigint NOT NULL DEFAULT 0 CHECK(retained_minor>=0),
  currency char(3) NOT NULL,
  expires_at timestamptz,
  evidence_ref text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(captured_minor>=returned_minor+retained_minor), UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,reservation_id) REFERENCES reservations(organization_id,id),
  FOREIGN KEY(organization_id,payment_id) REFERENCES payments(organization_id,id)
);
CREATE TABLE IF NOT EXISTS deposit_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  deposit_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('capture','return','retain')),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  evidence_ref text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,deposit_id) REFERENCES deposits(organization_id,id)
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  currency char(3) NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  reversal_of uuid,
  description text NOT NULL,
  UNIQUE(organization_id,id), UNIQUE(organization_id,source_type,source_id),
  FOREIGN KEY(organization_id,reversal_of) REFERENCES journal_entries(organization_id,id)
);
CREATE TABLE IF NOT EXISTS journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  account text NOT NULL,
  debit_minor bigint NOT NULL DEFAULT 0 CHECK(debit_minor>=0),
  credit_minor bigint NOT NULL DEFAULT 0 CHECK(credit_minor>=0),
  CHECK((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0)),
  FOREIGN KEY(organization_id,entry_id) REFERENCES journal_entries(organization_id,id)
);

CREATE TABLE IF NOT EXISTS connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  service_code text NOT NULL,
  mechanism text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'access_required',
  capability_version text,
  secret_ref text,
  secret_ciphertext text,
  created_by uuid REFERENCES users(id),
  poll_interval_seconds integer NOT NULL DEFAULT 900 CHECK(poll_interval_seconds>=300),
  poll_version bigint NOT NULL DEFAULT 0,
  poll_lease_token uuid,
  poll_lease_until timestamptz,
  last_attempt_at timestamptz,
  next_poll_at timestamptz,
  last_error_code text,
  last_success_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS ical_sync_states (
  organization_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  etag text,
  last_modified text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,connection_id),
  FOREIGN KEY(organization_id,connection_id) REFERENCES connections(organization_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ical_occupancies (
  organization_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  event_key text NOT NULL,
  allocation_id uuid,
  from_date date NOT NULL,
  to_date date NOT NULL,
  PRIMARY KEY(organization_id,connection_id,event_key),
  FOREIGN KEY(organization_id,connection_id) REFERENCES connections(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,allocation_id) REFERENCES availability_allocations(organization_id,id),
  CHECK(to_date>from_date)
);
CREATE TABLE IF NOT EXISTS connection_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  external_id text NOT NULL,
  UNIQUE(organization_id,connection_id,external_id), UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,connection_id) REFERENCES connections(organization_id,id),
  FOREIGN KEY(organization_id,unit_id) REFERENCES units(organization_id,id)
);
CREATE TABLE IF NOT EXISTS inbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  external_event_key text NOT NULL,
  payload_ref text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(organization_id,connection_id,external_event_key), UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,connection_id) REFERENCES connections(organization_id,id)
);
CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version integer NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id), UNIQUE(organization_id,aggregate_type,aggregate_id,aggregate_version,kind)
);
CREATE INDEX IF NOT EXISTS outbox_due_idx ON outbox_events(next_attempt_at,id) WHERE state='pending';
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  connection_id uuid,
  reservation_id uuid,
  kind text NOT NULL,
  dedupe_key text,
  safe_summary text NOT NULL,
  state text NOT NULL DEFAULT 'open',
  decision text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,connection_id) REFERENCES connections(organization_id,id),
  FOREIGN KEY(organization_id,reservation_id) REFERENCES reservations(organization_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS sync_conflicts_open_dedupe_idx ON sync_conflicts(organization_id,connection_id,dedupe_key) WHERE dedupe_key IS NOT NULL AND state='open';
CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  state text NOT NULL DEFAULT 'uploaded',
  source_name text NOT NULL,
  source_checksum text NOT NULL,
  row_count integer,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  property_id uuid NOT NULL,
  unit_id uuid,
  reservation_id uuid,
  assignee_id uuid REFERENCES users(id),
  kind text NOT NULL,
  title text NOT NULL,
  due_at timestamptz,
  state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','assigned','in_progress','review','done','cancelled')),
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,property_id) REFERENCES properties(organization_id,id),
  FOREIGN KEY(organization_id,unit_id) REFERENCES units(organization_id,id),
  FOREIGN KEY(organization_id,reservation_id) REFERENCES reservations(organization_id,id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  safe_title text NOT NULL,
  state text NOT NULL DEFAULT 'unread',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  reason text,
  safe_diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id)
);
CREATE INDEX IF NOT EXISTS audit_events_time_idx ON audit_events(organization_id,occurred_at DESC);
CREATE TABLE IF NOT EXISTS idempotency_records (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  operation text NOT NULL,
  key text NOT NULL,
  request_hash bytea NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
  PRIMARY KEY(organization_id,actor_id,operation,key)
);

-- A tenant context is required for every business query. A dedicated runtime role
-- must not own tables or have BYPASSRLS. Identity tables are used only by auth routes.
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY[
    'organizations','memberships','invitations','subscriptions','properties',
    'property_grants','unit_categories','units','rate_plans','rate_days','rate_change_previews','guests',
    'quotes','reservations','reservation_stays','availability_allocations',
    'charges','cancellation_previews','payments','refunds','deposits','deposit_actions','journal_entries','journal_lines',
    'expenses',
    'connections','connection_mappings','ical_sync_states','ical_occupancies','inbox_events','outbox_events',
    'sync_conflicts','import_batches','tasks','notifications','audit_events',
    'idempotency_records'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
    IF tab = 'organizations' THEN
      EXECUTE format('CREATE POLICY tenant_context ON %I USING (id = nullif(current_setting(''app.organization_id'',true),'''')::uuid OR EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id=id AND m.user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid AND m.status=''active'')) WITH CHECK (id = nullif(current_setting(''app.organization_id'',true),'''')::uuid)',tab);
    ELSIF tab = 'memberships' THEN
      EXECUTE format('CREATE POLICY tenant_context ON %I USING (organization_id = nullif(current_setting(''app.organization_id'',true),'''')::uuid OR user_id = nullif(current_setting(''app.user_id'',true),'''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.organization_id'',true),'''')::uuid)',tab);
    ELSE
      EXECUTE format('CREATE POLICY tenant_context ON %I USING (organization_id = nullif(current_setting(''app.organization_id'',true),'''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.organization_id'',true),'''')::uuid)',tab);
    END IF;
  END LOOP;
END $$;
ALTER TABLE onboarding_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY own_onboarding ON onboarding_requests USING (user_id = nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id',true),'')::uuid);
CREATE OR REPLACE FUNCTION pending_ical_connections(limit_count integer)
RETURNS TABLE(organization_id uuid, connection_id uuid, actor_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT c.organization_id,c.id,c.created_by FROM connections c
  WHERE c.mechanism='ical' AND c.created_by IS NOT NULL
    AND c.status IN ('verification_pending','active','degraded')
    AND (c.next_poll_at IS NULL OR c.next_poll_at<=now())
    AND (c.poll_lease_until IS NULL OR c.poll_lease_until<=now())
  ORDER BY c.next_poll_at NULLS FIRST,c.id LIMIT LEAST(GREATEST(limit_count,1),20)
$$;
REVOKE ALL ON FUNCTION pending_ical_connections(integer) FROM PUBLIC;
