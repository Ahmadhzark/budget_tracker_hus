# Budget Tracker — shared deployment setup

This repository is a static HTML/CSS/JavaScript app. Vercel can host it without a build command. The `supabase/schema.sql` file provides the PostgreSQL schema, role policies, private receipt bucket, and database-side transaction audit trigger.

**Important:** SQL alone does not convert the existing `app.js` localStorage/IndexedDB data layer into a shared app. Before inviting users or entering real financial data, wire the UI to Supabase Auth and replace the local persistence calls with Supabase queries. Do not present this deployment as multi-user until that integration and the tests below are complete.

## 1. Create Supabase backend

1. Create a project at https://supabase.com/dashboard.
2. Open **SQL Editor → New query**.
3. Paste and run `supabase/schema.sql`.
4. In **Project Settings → API**, copy the Project URL and publishable/anon key. The anon/publishable key is safe for browser use only when RLS is correctly configured. Never use `service_role` in frontend code or commit it to Git.
5. In **Authentication → URL Configuration**, set the Site URL to the eventual Vercel URL and add that URL to Redirect URLs.
6. In **Authentication → Providers**, enable Email. Disable public sign-ups if only invited users should enter; invitations can be sent by an existing project admin through a trusted admin workflow/Supabase Dashboard.

## 2. Database model and roles

- `projects`: separate books such as Personal or Business.
- `project_members`: membership and `admin`, `editor`, or `viewer` role.
- `transactions`: typed income/expense rows and receipt metadata.
- `audit_logs`: database-triggered transaction create/update/delete events visible to all project members.
- `receipts` Storage bucket: private; object path must start with the project UUID, e.g. `<project-uuid>/<transaction-uuid>/<safe-filename>`.

The first project must be created with `select public.create_project('Workshop');` while signed in, via an authenticated Supabase client/RPC. This adds the caller as admin. Admin invitations must be performed through a server-side function using the Supabase service role, or manually in the Supabase Dashboard followed by inserting the invited user's `project_members` row as admin. Never expose the service role in the browser.

## 3. Deploy to Vercel

1. Push this folder to GitHub.
2. In https://vercel.com/new, import the repository.
3. Framework preset: **Other**; Build Command: leave empty; Output Directory: `.`; Install Command: leave empty.
4. Deploy. Add your Vercel URL to Supabase Auth Site URL and Redirect URLs.
5. A push to the connected branch redeploys automatically.

`vercel.json` adds basic browser security headers. Since this is a static app, Vercel environment variables are not automatically injected into plain JavaScript. If adding Supabase browser config, use a committed `supabase-config.js` containing only the project URL and publishable/anon key, or add a build step to generate it. Never put a service-role key in a public file.

## 4. Required frontend integration before use

The current `app.js` still saves transactions to `localStorage` and attachment blobs to IndexedDB. To finish the shared migration:

1. Add an authentication screen using `@supabase/supabase-js` (CDN module or npm build) and require a valid session before showing the app.
2. Load projects through `projects`/`project_members`, and transactions through `transactions`; map `transaction_date` to the UI's `date` field and UUID `project_id` to project objects.
3. Determine each user's role from `project_members`. Viewers must not see add/edit/delete controls. Editors may add/update transactions; only admins may delete transactions, manage memberships, or delete receipts. RLS is the authoritative enforcement even if the UI is bypassed.
4. Upload attachments to the private `receipts` bucket and store the object path and metadata in `transactions`. For preview/download, request a short-lived signed URL after the user's access has been checked. Keep the 10 MB cap and validate file MIME type on both client and storage policy.
5. Fetch audit rows from `audit_logs`; use a database trigger for transaction changes. Add server-side logging for login/logout and receipt upload/download if those events must appear in the audit history; do not trust browser-supplied actor IDs or timestamps.
6. Build a one-time migration tool that previews local `localStorage` transactions/projects and IndexedDB blobs, uploads files, writes rows only after confirmation, and reports every success/failure. Do not silently delete local data. Export and preserve the JSON and original browser data until migration is verified.
7. Add an edit form (the current app only has add/delete), membership administration/invites, and an audit-history screen.

## 5. Safe local-data migration checklist

- Keep the original browser and do not clear site data.
- Export the current project/transaction JSON.
- Export or upload each IndexedDB blob; JSON export does not include file bytes.
- Preview counts and totals before importing.
- Import into a new test project first and compare income, expenses, dates, categories, project labels, and attachments.
- Reconcile totals and open each sample receipt from a second device/account.
- Only after verification, migrate the real project. Keep a dated backup.

## 6. Acceptance tests

- Unauthenticated visitor cannot see project data.
- Viewer can read authorized project records and attachments but cannot insert/update/delete rows or upload/delete files (test RLS directly).
- Editor can create/update transactions and upload receipts but cannot delete rows or manage membership.
- Admin can manage memberships and delete transactions.
- A user from another project cannot read records or files by guessing UUIDs/paths.
- Transaction changes create immutable audit rows with database timestamps and actor identity.
- Data and receipts load on a second browser/device after sign-in.
- Refresh, logout/login, and mobile viewport all work.

## Security note

This starter schema is a foundation, not a completed production integration. Review policies and run the acceptance tests before storing real financial records. For a real invitation workflow and auth/file access audit, deploy trusted server-side functions and keep service credentials server-only.
