export interface Session {
  user?: { id: string; email?: string; name?: string; display_name?: string };
  user_id?: string;
  email?: string;
  csrf_token?: string;
  memberships?: Membership[];
}
export interface Membership {
  organization_id: string;
  role: string;
  permissions?: string[];
}
export interface Organization {
  id: string;
  display_name?: string;
  name?: string;
  timezone?: string;
  currency?: string;
  lifecycle?: string;
  state?: string;
  subscription_state?: string;
  version?: number;
  role?: string;
}
export interface Unit {
  id: string;
  name: string;
  property_id?: string;
  property_name?: string;
  capacity?: number;
  capacity_adults?: number;
  capacity_children?: number;
  base_rate_minor?: string;
  currency?: string;
  state?: string;
}
export interface Property {
  id: string;
  name: string;
  timezone?: string;
  units?: Unit[];
  version?: number;
  address?: string;
}
export interface Stay {
  unit_id: string;
  checkin: string;
  checkout: string;
  adults?: number;
  children?: number;
}
export interface Reservation {
  id: string;
  reference?: string;
  version?: number;
  status: string;
  stays?: Stay[];
  unit_id?: string;
  checkin?: string;
  checkout?: string;
  guest?: { id?: string; display_name?: string; name?: string };
  guest_name?: string;
  source?: string;
  total_minor?: string;
  paid_minor?: string;
  deposit_held_minor?: string;
  currency?: string;
  sync_state?: string;
  updated_at?: string;
  archived_at?: string | null;
}
export interface CalendarPayload {
  units: Unit[];
  reservations: Reservation[];
  blocks: Array<{ id: string; unit_id: string; from?: string; to?: string; checkin?: string; checkout?: string; reason?: string }>;
  as_of?: string;
}
export interface Quote {
  id: string;
  expires_at: string;
  total_minor: string;
  currency: string;
  lines?: Array<{ kind: string; description: string; total_minor: string; date?: string }>;
  restrictions?: string[];
}
export interface Problem {
  status: number;
  code: string;
  title: string;
  detail?: string;
  correlation_id?: string;
  field_errors?: Array<{ path: string; code: string; message: string }> | Record<string,string>;
  current_version?: number;
  conflicts?: Array<{ unit_id: string; from: string; to: string; kind: string }>;
}
export interface Paged<T> {
  items: T[];
  next_cursor?: string | null;
}
export type GenericRecord = Record<string, unknown> & { id?: string; version?: number; name?: string; status?: string; state?: string };
