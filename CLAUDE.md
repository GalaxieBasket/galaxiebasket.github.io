# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Static website for the Galaxie Basket basketball club (French, https://galaxiebasket.ca), built with [Pelican](https://getpelican.com). Pushing to `main` triggers `.github/workflows/pelican.yml`, which builds with `publishconf.py` and deploys `output/` to GitHub Pages. There are no tests or linters.

## Commands

```
pip install -r requirements.txt          # pelican[markdown]; a local venv/ exists (git-ignored)
git submodule update --init              # themes/flex is a submodule (required to build)
pelican content -s pelicanconf.py        # dev build into output/
pelican --listen --autoreload content    # build + serve on http://localhost:8000
pelican content -s publishconf.py        # production build (what CI runs; SITEURL set, wipes output/)
```

## Architecture

- `pelicanconf.py` – dev config; `publishconf.py` imports it and overrides `SITEURL`, feeds, `RELATIVE_URLS`. Site is French, timezone `EST`.
- `content/pages/*.md` – the only content (index, about, teams, contact, calendar). Pages are output as `/{slug}.html`; there are no articles. The top menu is the hand-written `MENUITEMS` in `pelicanconf.py` (`DISPLAY_PAGES_ON_MENU`/`MAIN_MENU` are off), so a new page must be added there too.
- `themes/flex` – git submodule pointing to the `basket-theme` branch of the `GalaxieBasket/Flex` fork. Theme changes must be committed and pushed in that repo, then the submodule pointer updated here.
- `content/extra/` – static files copied to the site root via `STATIC_PATHS` + `EXTRA_PATH_METADATA` (e.g. `extra/calendar.js` → `/calendar.js`, plus `CNAME`, favicon). A new root-level static file needs an `EXTRA_PATH_METADATA` entry.

### Calendar

The calendar page (`content/pages/calendar.md`) loads FullCalendar from cdnjs and the local `calendar.js`/`calendar.css`. `calendar.js` fetches `/extra/events.json` and builds events client-side. Note that `events.json` is served at `/extra/events.json` (it is not remapped like the other extra files).

`content/extra/events.json` is the data file that is edited most often (most commits are "Update calendar"). Top-level keys:
- `season`
- `matches` – `date`, `time`, `location`, `opponent`, `team`, optional `result` (e.g. `"28-9"`), `home` boolean
- `trainings` – recurring weekly rules: `dayOfWeek` (0=Sunday), `startDate`/`endDate`, `time`, `duration` (`"H:MM"`), `except` (skipped dates), `team`, `location`, `description`. `calendar.js` expands these into occurrences.
- `special_events` – `date`, optional `time`, `type` (`tournament`/`event`), `title`, `description`, `location`, optional `url`

Keep `events.json` UTF-8 encoded; it contains French accents.

### Participation planner (private coaches' tool)

`/participation.html` (`content/pages/participation.md`, `Status: hidden`, not in the menu) helps coaches respect the Quebec youth participation rule (`participation.pdf`): max 4 and, for at least 8 players, min 2 half-quarters in Q1-Q3; injury/disqualification subs credit both players; Q4 is free. Files in `content/extra/` (all mapped to the site root in `EXTRA_PATH_METADATA`):
- `participation-rules.js` – pure ES module (no DOM/Firebase): `validateGame`, `suggestLineups`, `creditedHalves`, `parseRosterCsv`/`mergeRoster` (roster CSV import), ... Halves are indices 0..5 (Q1.1 ... Q3.2). To test in Node, `await import(pathToFileURL('content/extra/participation-rules.js').href)` and run `validateGame`/`suggestLineups` on a game object `{players, present, halves, locked, injurySubs}`.
  `suggestLineups` first spreads halves evenly (counts differ by at most 1), then `balanceWeights` evens out each half's total skill `weight` (1-5, default 3) with swaps/hand-overs that keep the multiset of counts unchanged; weights come from the team's live roster.
- `participation.js` – UI (plain JS module, French, mobile-first) + Firebase (modular SDK 10.12.2 from gstatic: Google sign-in, Firestore with `onSnapshot` and persistent cache). `firebaseConfig` and `ALLOWED_EMAILS` constants at the top hold `REPLACE_ME`/`COACH_EMAIL_*` placeholders; until replaced the page shows a setup message.
- `participation.css` – dark/gold styles.
- `firestore.rules` (repo root, reference only) – real access control: only the 2 coach emails (verified) can read/write. Firestore data: `teams/{id}` (`name, category, halfMinutes, players[]` with `{id, name, number, weight, active}`) and `teams/{id}/games/{id}` (`absent` list — a game always uses the team's live roster, resolved by `resolveGame` in `participation.js`; `players` is only a name/number copy used to display deleted players still in old lineups; `present` is written for reference, `halves`/`locked` stored as `[{ids: []}]` because Firestore forbids nested arrays, `q4`, `injurySubs`).

Firebase setup: create a project, enable Firestore and Authentication > Google, add `galaxiebasket.ca` and `localhost` to Authorized domains, paste the web config into `participation.js`, replace the emails in `firestore.rules` and paste it in the Firestore console.
