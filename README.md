# KeyCalendar

KeyCalendar is a multi-tenant SaaS workspace for property managers: availability calendar, reservations, guests, payments, financial analytics, staff permissions, and channel synchronization.

## Current product slice

The current implementation establishes the visual system and the main operational screen:

- responsive occupancy calendar for properties and rentable units;
- booking and payment statuses;
- today's arrivals, departures, and outstanding payments;
- booking details drawer and a new-reservation form;
- company and staff navigation ready for multi-tenant data.

Representative data is deliberately local in this first interface slice. The production data and service design is documented in [`docs/architecture.md`](docs/architecture.md).

## Product principles

- Every business record belongs to an organization.
- A property may contain any number of rentable units.
- Availability conflicts are rejected by PostgreSQL, not only by the UI.
- Payments and expenses are recorded as separate ledger entries.
- External channel events are idempotent and auditable.
- The UI remains usable with large portfolios through pagination and calendar virtualization.

## Local development

The project uses React, TypeScript, and Vinext. Install dependencies and run the development server with the package manager recorded in the lockfile.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — production architecture and module boundaries.
- [`docs/product-roadmap.md`](docs/product-roadmap.md) — staged delivery plan and MVP acceptance criteria.
- [`docs/postgres-schema.sql`](docs/postgres-schema.sql) — initial PostgreSQL domain schema.
