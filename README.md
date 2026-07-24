# 🍜 Makan Split — Lunch Bill Splitter (PWA)

A tiny **installable web app** for the classic problem: one friend pays the whole
lunch bill, and everyone pays them back. The payer snaps the receipt, punches in
each line, marks who had what (with **shared** items split equally), and the app
adds **service charge + SST** and tells each person exactly what they owe.

Built as a **Progressive Web App** — pure HTML/CSS/JavaScript, **no build step,
no server**. All data is saved on the device (localStorage), and it works offline
once installed.

---

## ✨ Features

- **Home** — a big **Create an event** button, with all your events listed below.
- **Create an event** — pick participants from a fixed group of **16 people**,
  set the **event name** and **date**, and choose **who paid** (defaults to you).
- **Punch in each line** — add every item with a **unit price** and **quantity**.
- **Itemise & assign** — each item is **Individual** or **Shared**; tap the people
  who had it. A **Shared** item is split equally among the people you pick. Tap
  **＋ More** on an item to include a friend who wasn’t in the event (e.g. you’re
  buying someone a meal) — they’re folded into the split automatically.
- **Pick who you are** — when the app opens you choose your name first; each person
  then taps the items they had, and shared items they’re part of show up
  automatically. Switch person anytime from the top bar. No accounts or emails.
- **Service charge + SST** — the **payer** toggles each on/off and **confirms the
  rate**. Malaysia defaults: **10% service charge** and **6% SST**, with SST charged
  on the **items subtotal (before service charge)**. Both are configurable per event.
- **One payer per event** — each meal is paid by **one person** (pick them when you
  create the event, or change it later; tap **＋ More** to choose someone who wasn’t
  in the event).
- **Combine events to settle** — group several meals (**Lunch + Tea + Dinner**, each
  with its own payer) and the app nets everyone **across all of them** into the
  fewest payments.
- **Add to cart & checkout** — each diner taps **🛒 Add to cart** on what they had;
  the **cart icon** (top-right) opens a checkout with their total and who to pay, and
  a **Mark paid** button that sends them back to the home page.
- **Summary tab** — a single **who-owes-who** table across every event, with mark-paid
  that syncs back to each event.
- **Settle up (who owes whom)** — the app works out each person’s **net** (paid −
  eaten) and reduces it to the **fewest transfers**, automatically cancelling mutual
  debts. Tick each transfer as **paid** and it greys out; a person shows **Settled ✓**
  once they’ve cleared what they owe.
- **Live totals** — your share, a per-person net breakdown, the **grand total**, and
  a warning if any item is still unassigned.
- **Delete events** — remove any event from the list (✕ on the card) or its own page.
- **Installable & offline** — add to your home screen and open it like a native app.

---

## 💰 How the maths works

For each person:

```
their subtotal = Σ (item price ÷ number of people sharing that item)   // only items they’re on
service charge = subtotal × service-charge %   (if enabled)
SST            = subtotal × SST %               (on the subtotal, before service charge)
they owe       = subtotal + service charge + SST
```

Because every step is proportional, the sum of everyone’s totals equals the grand
total on the receipt.

**Settling up.** Each person’s **net** is what they *paid* minus what they *ate*.
A positive net means they’re owed money; a negative net means they owe. The app
repeatedly matches the biggest debtor to the biggest creditor, producing the fewest
“X pays Y” transfers — so if two people owe each other, only the **difference**
remains.

**Combining meals.** When you settle several events together, each person’s *paid*
and *eaten* totals are summed **across the events** first, then the same netting runs
once — so lunch, tea and dinner (with different payers) collapse into a single set of
payments.

---

## 🗂 Project structure

```
makan-split/
├── index.html            # App shell + styles (inline CSS)
├── app.js                # All app logic (vanilla JS, localStorage)
├── manifest.json         # PWA manifest (name, icons, colours)
├── service-worker.js     # Offline caching (app shell)
├── icons/                # App icons (SVG + PNG, incl. maskable)
├── README.md
├── LICENSE               # MIT
└── .nojekyll             # Tell GitHub Pages to serve files as-is
```

---

## ▶️ Run it locally

A service worker needs `http://` or `https://` — it will **not** register from a
`file://` path — so serve the folder with any static server:

```bash
# Option A: Python (already on most machines)
cd makan-split
python3 -m http.server 8080
# then open http://localhost:8080

# Option B: Node
npx serve .
```

You can also just double-click `index.html` to try the UI — everything works
except offline install (the service worker stays inactive on `file://`).

---

## 🚀 Publish to GitHub Pages (free)

1. **Create a repo** on GitHub, e.g. `makan-split`.
2. **Push these files** to the `main` branch:
   ```bash
   cd makan-split
   git init
   git add .
   git commit -m "Makan Split PWA"
   git branch -M main
   git remote add origin https://github.com/<your-username>/makan-split.git
   git push -u origin main
   ```
3. In the repo, go to **Settings → Pages**.
4. Under **Build and deployment → Source**, choose **Deploy from a branch**,
   set the branch to **`main`** and the folder to **`/ (root)`**, then **Save**.
5. Wait ~1 minute. Your app is live at:
   ```
   https://<your-username>.github.io/makan-split/
   ```

> All paths in this project are **relative**, and the service worker registers
> from a relative path, so it works correctly under the `/makan-split/` sub-path
> that GitHub Pages uses. GitHub Pages serves over HTTPS, which is required for
> PWAs. The `.nojekyll` file stops GitHub from reprocessing the files.

### Updating after you publish
When you change a cached file, bump the cache name in `service-worker.js`
(`makan-split-v1` → `-v2`) so devices pick up the new version.

---

## 📱 Install on a phone

- **Android / Chrome:** open the Pages URL → menu **⋮** → **Install app** /
  **Add to Home screen** (or tap the ⬇︎ button in the app bar).
- **iPhone / Safari:** open the URL → **Share** → **Add to Home Screen**.

It then launches full-screen with its own icon, and works offline.

---

## 🛣 Roadmap (turning the prototype into a real product)

This build is a **fully working single-device prototype**. To make it a true
multi-user product you’d add a small backend:

- **Receipt OCR** — snap the receipt and auto-extract the line items (e.g. via Azure
  AI Document Intelligence / Google Vision) to pre-fill the list instead of typing.
- **Real accounts & sync** — replace the name-switcher “login” with email sign-in
  (e.g. Firebase Auth / Supabase / Azure) and store events in a shared database so
  each person uses their **own** phone and sees live updates.
- **Settle-up / payments** — generate a DuitNow QR or payment link per person.
- **Notifications** — remind people who still owe the payer.

The app is structured so the data model (`events`, `items`, `users`) maps cleanly
onto database tables when you’re ready.

---

## 🔧 Tech

Vanilla JavaScript · HTML · CSS · Web App Manifest · Service Worker.
No frameworks, no dependencies, no build tools.

## 📄 License

MIT — see [LICENSE](LICENSE).
