# Private SQLite migration rehearsal tool

`tools/rehearse-private-db.mjs` opens its source read-only, creates consistent SQLite snapshots in an owner-only directory, upgrades only an isolated copy, compares historical values, and checks an isolated restore. It does not start an application, send notifications, export records, switch a live database, or delete backups.

Run only in the owner's private environment with explicit source and private-root paths. Source versions, size and free-space guards are enforced. The command emits a summary rather than row contents. Treat the source, generated copies and operational summaries as private; never commit them to a public repository.

`tests/preflight.test.js` uses a synthetic fixture to verify source preservation, upgrade/restore checks and rejection of unsafe inputs. This repository intentionally contains no production rehearsal results or hosting-account screenshots for this change.

Phase 3 extends the tool to existing source versions 2 or 5 and candidate version 6. It retains a source-version restore copy and requires one snapshot for every newly applied migration. Migration 6 adds voucher tables without expanding existing role grants. Tests retain exact checks on the historical schemas and migration checksums; changing the expected latest version does not permit rewriting earlier migrations.

This tool alone is not approval to migrate production, merge changes, deploy or change paid hosting resources. Retain private backups and reconcile any later writes before a rollback.
