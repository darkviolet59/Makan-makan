# ☁️ Turn on cloud sync with Supabase

Follow these once, and everyone's phones share the same live events, people, and
payments. Free tier is plenty for a group of 16.

---

## 1. Create a Supabase project
1. Go to **[supabase.com](https://supabase.com)** → **Sign up** (free).
2. **New project** → give it a name (e.g. `makan-split`), set a **database
   password** (save it somewhere), pick a region near you (**Southeast Asia
   (Singapore)** is closest to Malaysia) → **Create new project**.
3. Wait ~2 minutes for it to finish setting up.

## 2. Create the table (copy-paste SQL)
1. Left sidebar → **SQL Editor** → **New query**.
2. Paste this and click **Run**:

```sql
-- One row per entity (a person, an event, or an item) so concurrent edits merge.
create table if not exists public.makan_entities (
  kind        text not null,          -- 'user' | 'event' | 'item'
  id          text not null,
  doc         jsonb,
  deleted     boolean not null default false,
  by          text,                   -- which device wrote it (to ignore our own echo)
  updated_at  timestamptz not null default now(),
  primary key (kind, id)
);

-- Let the app (publishable/anon key) read & write this table.
alter table public.makan_entities enable row level security;
create policy "read"   on public.makan_entities for select using (true);
create policy "insert" on public.makan_entities for insert with check (true);
create policy "update" on public.makan_entities for update using (true) with check (true);

-- Turn on realtime so every device updates live.
alter publication supabase_realtime add table public.makan_entities;
```

*(If you already ran an earlier version that created a `makan_state` table, you can
ignore or drop it — this app now uses `makan_entities`.)*

## 3. Get your two keys
1. Left sidebar → **Project Settings** (gear) → **API**.
2. Copy these two values:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **Project API keys → `anon` `public`** — a long string starting with `eyJ...`

## 4. Paste them into the app
Open the app file you deploy and find these two lines near the top (in `app.js`,
or in the single-file `index.html`):

```js
var SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
var SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";
```

Replace them with **your** Project URL and anon public key, e.g.:

```js
var SUPABASE_URL = "https://abcdefgh.supabase.co";
var SUPABASE_ANON_KEY = "eyJhbGciOi...your-long-key...";
```

Save the file.

## 5. Deploy & test
1. Re-upload the file (GitHub / Cloudflare) and open it on **two devices**.
2. Add an event or rename a person on one → it appears on the other within a
   second. 🎉

*(Leave the placeholders unchanged and the app just stays local-only — nothing
breaks.)*

---

## Good to know
- **Privacy:** the `anon` key is public (it ships inside the app), and the rules
  above let anyone **with your app link** read/write the data. Fine for a private
  group — just don't post the link publicly. We can add a passphrase or proper
  sign-in later to lock it down.
- **Conflicts:** each event, item, and person syncs as its **own row**, so people
  editing *different* things at the same time merge fine. Only if two people edit the
  **exact same item** in the same instant does the later save win — rare, and easily
  re-done.
- **Your identity stays on your device** — the "You are …" choice and which screen
  you're on are per-device; only the shared events/people/payments sync.
