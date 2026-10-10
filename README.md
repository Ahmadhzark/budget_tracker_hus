# Budget Tracker

🔗 **Live:** https://ahmadhzark.github.io/budget-tracker/

A simple, static budget tracker: log income and expenses, see monthly totals, and view a spending-by-category chart. No backend, no build step — pure HTML/CSS/JS. Data is stored in your browser's `localStorage`.

## Features
- **Projects** — keep separate books for e.g. Personal and Business (or any custom project). Switch with the pills at the top; add, rename, or delete projects via "⚙ Manage". Each project has its own transactions, totals, and chart.
- Add income/expense transactions with description, amount, category, and date
- Monthly view with prev/next navigation
- Income, expense, and balance summary cards
- Doughnut chart of expenses by category (Chart.js)
- Filter transactions by category and search descriptions, categories, dates, and transaction types
- Attach a receipt, screenshot, or PDF (up to 10 MB) to a transaction; preview or download it later
- Receipt files are stored in browser IndexedDB; transaction details remain in localStorage
- Export transaction/project metadata as JSON (attachment file contents are not included in this export)
- Responsive mobile layout, touch-sized controls, accessible focus states, and reduced-motion support
- Chart updates in place where possible to reduce unnecessary redraws
- Data persists locally on this browser/device — nothing is sent to a server and data does not automatically sync between devices

## Run locally
Just open [index.html](index.html) in a browser, or serve the folder:

```
npx serve .
```

## Host on GitHub Pages
1. Create a new GitHub repo and push this folder to it:
   ```
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git branch -M main
   git push -u origin main
   ```
2. On GitHub: **Settings → Pages → Source → Deploy from a branch**, pick `main` and `/ (root)`.
3. Your app will be live at `https://<your-username>.github.io/<repo-name>/` within a minute or two.

## Notes
- Data lives only in the browser/device you use — it won't sync across devices. Use "Export JSON" periodically to back it up.

## Shared deployment (Supabase + Vercel)

See [`README-SHARED-SETUP.md`](README-SHARED-SETUP.md) for the PostgreSQL/RLS schema, private receipt bucket, role model, Vercel deployment, and safe migration checklist. **The current app still uses browser-local storage; do not invite users until the frontend Supabase integration described in that guide is completed and tested.**
