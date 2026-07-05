# 444Music Broadcast Backend

Admin email broadcasting backend for **444Music Distribution**. This is a standalone service that reads your existing Firebase Authentication / Firestore `users` collection (read-only, no schema changes) and sends personalized bulk email campaigns through any email provider you choose to connect later.

It does **not** touch, replace, or duplicate any part of your existing site — no auth flow, no dashboards, no payment integration. It's a separate internal tool.

---

## What this does

- Reads users from your existing Firestore `users` collection
- Filters recipients by `emailOptIn === true` and by audience (`all`, `premium`, `free`, or a selected list of user IDs)
- Personalizes emails with `{{name}}`, `{{email}}`, `{{country}}`
- Sends in batches (default: 50 emails every few seconds) to avoid provider rate limits
- Saves every campaign (subject, recipient count, successful/failed sends, status, timestamps) to a new Firestore collection called `emailCampaigns`
- Exposes admin-only REST endpoints, protected by a shared secret header
- Ships with **no email provider connected** — it runs in a safe "dry-run" mode until you add one

---

## Folder structure