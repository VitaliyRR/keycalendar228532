CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE membership_role AS ENUM ('owner', 'admin', 'manager', 'accountant', 'housekeeper');
CREATE TYPE reservation_status AS ENUM ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'blocked');
CREATE TYPE reservation_source AS ENUM ('direct', 'avito', 'sutochno', 'booking', 'ical', 'other');
CREATE TYPE money_entry_kind AS ENUM ('charge', 'payment', 'refund', 'commission', 'expense', 'tax', 'reversal');

CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Europe/Moscow',
  base_currency char(3) NOT NULL DEFAULT 'RUB',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role membership_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE properties (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  address text,
  timezone text NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE TABLE units (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  property_id uuid NOT NULL,
  name text NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, property_id) REFERENCES properties(organization_id, id)
);

CREATE TABLE guests (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  full_name text NOT NULL,
  phone text,
  email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE TABLE reservations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  unit_id uuid NOT NULL,
  primary_guest_id uuid,
  status reservation_status NOT NULL,
  source reservation_source NOT NULL DEFAULT 'direct',
  check_in date NOT NULL,
  check_out date NOT NULL,
  external_reference text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (check_out > check_in),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, unit_id) REFERENCES units(organization_id, id),
  FOREIGN KEY (organization_id, primary_guest_id) REFERENCES guests(organization_id, id),
  EXCLUDE USING gist (
    organization_id WITH =,
    unit_id WITH =,
    daterange(check_in, check_out, '[)') WITH &&
  ) WHERE (status IN ('pending', 'confirmed', 'checked_in', 'blocked'))
);

CREATE TABLE money_entries (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  reservation_id uuid,
  kind money_entry_kind NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL,
  occurred_at timestamptz NOT NULL,
  reversed_entry_id uuid,
  note text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, reservation_id) REFERENCES reservations(organization_id, id),
  FOREIGN KEY (organization_id, reversed_entry_id) REFERENCES money_entries(organization_id, id)
);

CREATE TABLE integration_inbox (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  channel reservation_source NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text,
  UNIQUE (organization_id, channel, idempotency_key)
);

CREATE TABLE integration_outbox (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  topic text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  actor_user_id uuid REFERENCES users(id),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  action text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reservations_calendar_idx ON reservations (organization_id, unit_id, check_in, check_out);
CREATE INDEX reservations_guest_idx ON reservations (organization_id, primary_guest_id);
CREATE INDEX money_entries_report_idx ON money_entries (organization_id, occurred_at, kind);
CREATE INDEX integration_outbox_pending_idx ON integration_outbox (available_at) WHERE delivered_at IS NULL;
CREATE INDEX audit_events_aggregate_idx ON audit_events (organization_id, aggregate_type, aggregate_id, occurred_at DESC);
