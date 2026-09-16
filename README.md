# Tactics Map

A real-time, persistent map board for coordinating tactics with a gaming
group. Someone uploads a screenshot (e.g. an aerial/recon photo), and your
team draws pins, arrows, freehand lines, and labels on top of it — live,
synced to everyone connected.

## Roles

- **Recon** — can upload/replace the map image
- **Squad Leader** — can draw
- **Platoon Leader** — can draw, upload the map, manage everyone's role,
  and clear the board
- **FOB Designer** — can draw
- **Viewer** (default for everyone new) — can only watch

## One-time setup (about 10–15 minutes)

### 1. Create a Firebase project
Go to https://console.firebase.google.com, click **Add project**, and
follow the prompts (you can decline Google Analytics, it's not needed).
This is free — no credit card required for what this app uses.

### 2. Enable Anonymous Authentication
In the Firebase console: **Build → Authentication → Get started →
Sign-in method → Anonymous → Enable**.

This lets each teammate get a stable identity without creating accounts
or passwords — they just enter a callsign the first time they open the
app.

### 3. Create a Firestore database
**Build → Firestore Database → Create database**. Choose **Start in
production mode** (the rules file below replaces the defaults anyway).
Pick any region close to your group.

### 4. Set your admin passcode
This is the passcode whoever wants to become **Platoon Leader** will
enter in the app.

In the Firestore console, manually create:
- Collection: `config`
- Document ID: `adminPasscode`
- Field: `code` (string) → set it to whatever passcode you want, e.g. `"raven7"`

This document is deliberately unreadable and unwritable from the app
itself (see `firestore.rules`) — it only exists for the security rules
to check against.

### 5. Paste in the security rules
Firestore console → **Rules** tab → replace the contents with
`firestore.rules` from this repo → **Publish**.

### 6. Get your web config
Firebase console → **Project settings** (gear icon) → scroll to
**Your apps** → click the web icon (`</>`) → register an app (nickname
doesn't matter, no need for Hosting here) → copy the `firebaseConfig`
object it shows you.

Paste those values into `firebase-config.js` in this repo, replacing the
placeholders.

### 7. Push to GitHub and enable Pages
```
git init
git add .
git commit -m "Initial tactics map app"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```
Then on GitHub: **Settings → Pages → Source: Deploy from a branch →
Branch: main, folder: / (root) → Save**.

GitHub will give you a URL like
`https://<your-username>.github.io/<your-repo>/` — that's the link your
whole group uses.

## Using it

1. Everyone opens the link and enters a callsign.
2. Everyone starts as **Viewer**.
3. Whoever should be Platoon Leader enters the passcode from step 4
   above in the "Claim Platoon Leader" box.
4. The Platoon Leader opens the **Roster & Roles** panel and assigns
   Recon / Squad Leader / FOB Designer to the right people.
5. Recon (or the Platoon Leader) pastes or uploads the map screenshot.
6. Anyone with a drawing role can start marking it up — pen, arrows,
   text labels, and an eraser (you can only erase your own marks unless
   you're the Platoon Leader).
7. The Platoon Leader can **Clear Map** at any point to wipe the image
   and all markings for a fresh session — everything else persists
   indefinitely otherwise.

## Notes and limitations

- **Strokes sync when you finish drawing**, not mid-stroke — this keeps
  Firestore writes low (free-tier friendly) and is more than fast enough
  for tactical marking. If you want true live pen-tracing later, that's
  an upgradeable piece.
- Anonymous auth means identity is per-browser. If someone clears their
  browser storage or switches devices, they'll be prompted for their
  callsign again and start over as Viewer.
- **No Firebase Storage, no billing account, ever.** Map images are
  compressed client-side and stored directly inside a Firestore
  document, which has a 1 MiB size limit. The app auto-reduces
  resolution/quality until the image fits — for a tactical map
  screenshot this still looks sharp, it just won't be a huge
  full-resolution aerial photo. If you paste something very large
  and detailed, expect it to come out around 1500–2000px on the long
  edge after compression.
- This app is intentionally simple/trust-based (fitting a private
  friend group) rather than enterprise-hardened. The Firestore rules
  do enforce real permission boundaries, but the source code is public
  if your repo is public — nothing sensitive is stored, so this is a
  reasonable tradeoff.
