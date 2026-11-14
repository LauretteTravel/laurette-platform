# Laurette Workspace implementation plan

## Audit
The application is a dependency-free Node HTTP server, SQLite (`lib/db.js`), Arabic SSR public pages and vanilla JS employee SPA. Staff sessions and role definitions already support organization, branch, department and assigned scopes. Existing persistent entities: customers, requests, request_events, request_quotes, request_follow_ups, bookings, booking_payments. Public `offers` are marketing catalogue entries, not personalized proposals. VoucherGenerator already prints and exports personalized travel documents; VoucherStudio is a separate manual editor. WhatsApp has an opt-in notification outbox; manual proposal sharing will use editable deep links and will never silently send messages.

Existing uncommitted public/account changes and audit documents belong to prior work and must not be included in Workspace commits.

## Implementation
1. Add versioned, transactional Workspace migration. Reuse requests, customers, follow-ups, bookings, payments and request events. Add personalized proposals/templates, notifications and stored voucher snapshots. Extend booking status check to allow pending while preserving IDs and foreign keys.
2. Mount `/workspace` and `/o/:token` through a small server integration. Retain `/admin` and existing modules. Scope every employee query on the server, explicitly project public proposal fields and restrict financial cost fields to reporting-authorized roles.
3. Implement quick customer intake, editable requests/offers and templates, secure 192-bit links, activity/interest notifications, follow-ups, idempotent booking conversion, confirmation/payments and voucher reuse.
4. Build responsive navy/white/gold Arabic employee cards and mobile proposal pages with existing destination photos. Include real database metrics, search, travel widgets, customer history and manager filters/funnel.
5. Verify isolated end-to-end API journey, scope boundaries, public redaction, replay behavior, migration preservation, existing tests and browser behavior where available. Commit only this change, push feature branch and open PR if repository credentials permit.

## Release
No production database is opened during development or tests. Migration runs automatically on application startup; back up the production SQLite file before release. Existing routes remain available. Public links are bearer capabilities and may be revoked by staff. PDF uses existing browser voucher tooling; proposal uses browser print/save PDF.
