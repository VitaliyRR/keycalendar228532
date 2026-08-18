# KeyCalendar production architecture

## Direction

KeyCalendar starts as a modular monolith. This keeps booking, availability, payments, and audit updates transactional while preserving module boundaries that can later become services.

```text
Browser
  -> Web application (React + TypeScript)
  -> Node.js API
       -> PostgreSQL (source of truth)
       -> Redis (cache, locks, rate limits)
       -> BullMQ workers (notifications, reports, channel sync)
       -> S3-compatible object storage (documents and exports)
       -> Channel adapters (Avito, Sutochno.ru, Booking, iCal)
```

## Repository target

```text
apps/
  web/             browser application
  api/             Node.js HTTP API and OpenAPI contract
  worker/          scheduled jobs and external synchronization
packages/
  contracts/       request, response, and event schemas
  domain/          shared business rules and money/date primitives
  ui/              design system
  config/          typed environment configuration
infra/
  docker/          local PostgreSQL and Redis
  migrations/      production database migrations
```

The current root application is the first UI slice. The folders above should be introduced when the API implementation starts, without changing the user-facing design.

## Tenant isolation

`organization_id` is present on every tenant-owned aggregate. A request obtains its organization from the authenticated membership, never from an unrestricted client field. Database indexes begin with `organization_id`, and audit entries retain both organization and actor.

Suggested roles:

- `owner`: billing, integrations, all data and staff;
- `admin`: operational and configuration access;
- `manager`: bookings, guests, payments and assigned properties;
- `accountant`: finance, exports and read-only booking context;
- `housekeeper`: assigned turnovers and limited guest context.

Property-level assignments supplement roles. They do not create new global roles.

## Core modules

### Identity and organizations

Organizations, users, memberships, invitations, roles, property assignments, sessions and login audit.

### Inventory

A `property` represents an address or complex. A `unit` is the smallest independently rentable resource. Apartments and whole houses usually have one unit; a house or complex may also expose several rooms or guest houses as independent units.

### Reservations and availability

Reservations cover confirmed bookings, pending holds, owner blocks and maintenance blocks. Date intervals use `[check_in, check_out)`, so a new guest can arrive on the previous guest's checkout date.

The API first validates the request, then PostgreSQL enforces a GiST exclusion constraint for every blocking status. This is the final protection against races and double selling.

### Guests

Guest profiles are organization-scoped. A reservation can have a primary guest and additional guests. Searchable personal data is kept separate from public reservation references, with access logging and retention rules.

### Finance

The booking total is not treated as the payment balance. Charges, payments, refunds, platform commissions, cleaning costs, taxes and manual expenses are separate immutable transactions. Corrections are reversals rather than destructive edits.

This supports revenue, net operating income, occupancy, ADR, RevPAR, average booking value, channel cost, outstanding balance, property profitability and cash-flow reports.

### Channel integrations

Each channel implements a shared adapter contract:

```text
pullReservations -> normalize -> deduplicate -> apply transactionally
pushAvailability -> channel request -> delivery log -> retry/dead-letter
```

Inbound events first enter an inbox table with a unique idempotency key. Outbound changes enter an outbox in the same database transaction as the booking change. Workers perform delivery and exponential retries. External identifiers are unique per channel account.

Full API adapters for Avito, Sutochno.ru and Booking depend on official partner access. iCal can be added as a lower-fidelity fallback but does not replace real-time APIs.

### Analytics

Operational screens query normalized tables. Heavy reports query daily aggregates and materialized views. Filters share a common contract: period, organization, property, unit, booking source, status, payment status, manager and tags.

There are no artificial product limits in the domain model. Large portfolios require cursor pagination, virtualized calendar rows/columns, background exports, partitioned event history and read replicas when measured load justifies them.

## Reliability and security

- short-lived access sessions with secure rotation;
- password hashing with a modern memory-hard algorithm or an external identity provider;
- authorization enforced in API policies and queries;
- encrypted transport and encrypted backups;
- immutable audit trail for booking, payment, role and integration changes;
- idempotency keys for booking and payment writes;
- structured logs, metrics, traces and error reporting;
- point-in-time PostgreSQL recovery and regularly tested restore procedures;
- secrets stored outside Git and rotated independently.

## Deployment shape

Start with independently deployable web, API and worker processes backed by managed PostgreSQL and Redis. Scale stateless API and worker replicas horizontally. Do not split databases or services until production measurements identify a concrete bottleneck or ownership boundary.
