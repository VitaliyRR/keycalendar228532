# KeyCalendar delivery roadmap

## Slice 1 — operational calendar

Delivered foundation:

- original responsive visual system;
- grouped property and unit calendar;
- representative reservation and payment states;
- booking details and new booking form;
- daily operational focus;
- production architecture and initial database schema.

## Slice 2 — real MVP data

- organization onboarding and employee invitations;
- property and unit CRUD;
- reservation CRUD with conflict protection;
- guest profiles and reservation participants;
- charges, payments, refunds and expenses;
- audit events;
- server-driven calendar filters and cursor pagination.

Current prototype progress:

- financial dashboard with period, property, source and accounting-method filters;
- property profitability, expense structure and individual owner settlements;
- public direct-booking experience with availability search and payment-provider selection.

Acceptance criteria:

- two organizations cannot access each other's data;
- overlapping blocking reservations for the same unit cannot be committed;
- cancellation immediately releases availability;
- booking balance equals charges minus payments and refunds;
- every mutation records actor, time and before/after context;
- calendar remains navigable on desktop and tablet.

## Slice 3 — finance and operations

- profitability dashboard with saved filters;
- ADR, RevPAR, occupancy, net income and channel commissions;
- cleaning and maintenance assignments;
- notifications and scheduled reminders;
- CSV/XLSX exports and management reports;
- configurable rate plans and additional services.
- owner agreements with versioned fixed, percentage, hybrid and custom formulas;
- accrual and cash accounting views;
- public booking page, short-lived availability holds and payment links;
- YooKassa, T-Bank, SBP and CloudPayments adapters.

## Slice 4 — channel manager

- channel account setup and health monitoring;
- iCal import/export as fallback;
- Avito, Sutochno.ru and Booking adapters as partner access becomes available;
- webhook inbox, transactional outbox and replay tools;
- reconciliation dashboard for conflicts and failed deliveries.

## Slice 5 — scale and enterprise controls

- SSO and advanced access policies;
- configurable approval workflows;
- public API and webhooks for customers;
- partitions and read replicas based on measured volume;
- data retention, export and deletion workflows;
- mobile-optimized operational mode.
