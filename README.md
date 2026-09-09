# UAH Cazador de Plazas (v9 — SPA Retry)

A [Violentmonkey](https://violentmonkey.github.io/) userscript that watches Universidad de Alcalá's (UAH) online enrollment system (`automatricula.uah.es`) and alerts you the moment a spot opens up in specific courses.

It also works with Tampermonkey and Greasemonkey — the script only uses the standard `GM_notification` API, which all three support.

## What it does

- Walks through the automatrícula wizard on its own: starts enrollment, confirms your personal data, selects "a tiempo completo", answers the "No" prompts, clicks "Continuar"
- Opens **Curso 4** and checks the subjects you've configured
- If a subject is no longer marked as full, it **stops everything** — highlights the course card, plays a sound, fires a `GM_notification`, and pops an `alert()` telling you to go enroll
- If UAH throws its "too many connections" error, it backs off and retries automatically after a cooldown
- Otherwise, it retries roughly once a minute by resetting the app's internal route (just the URL hash — no full page reload, so you never get a "leave site?" prompt)

## It does not enroll you automatically

When a spot is found, the script deliberately **stops and waits for you**. It's a watcher/alert tool, not an auto-submit bot — you still have to click through and confirm the enrollment yourself.

## Requirements

- A Chromium- or Firefox-based browser
- [Violentmonkey](https://violentmonkey.github.io/) (or Tampermonkey / Greasemonkey) installed
- A UAH account with access to automatrícula

## Installation

1. Install Violentmonkey for your browser.
2. Open the Violentmonkey dashboard → **+** (new script), or use **Install from URL**.
3. Paste in the contents of [`uah-matricula-watcher.user.js`](./uah-matricula-watcher.user.js), or point Violentmonkey at the raw file URL from this repo.
4. Save. Visit `https://automatricula.uah.es/` — the script matches the whole site and starts on its own.

## Configuring it for your own courses

Edit the `TARGETS` array near the top of the script:

```js
const TARGETS = [
    { code: '000362011', name: 'ECONOMÍA REGIONAL' },
    { code: '000360027', name: 'ECONOMÍA AMBIENTAL' },
    { code: '000362016', name: 'PYTHON PARA ECONOMÍA Y EMPRESA' },
    { code: '000340093', name: 'CREACIÓN, CRECIMIENTO Y GESTIÓN DE PYMES' }
];
```

- `code` — the subject's internal code, as it appears in automatrícula's subject list
- `name` — whatever label you want in notifications and the console log

Other constants worth tuning:

| Constant | Default | What it controls |
|---|---|---|
| `REFRESH_MS` | 60,000 (60s) | How long to wait before restarting the check once all target subjects are confirmed full |
| `MAX_CONNECTIONS_RETRY_MS` | 60,000 (60s) | Cooldown after a "too many connections" error from UAH |
| `NAVIGATION_POLL_MS` | 800ms | How often the script re-checks the page to decide its next click |
| `START_HASH` | `#/acceso/bienvenida` | The route it resets back to between attempts |

## How it works

The script is a small polling state machine:

1. Reads the visible page text to figure out which step of the wizard you're on
2. Clicks the next expected control for that step
3. Once it reaches subject selection, opens **Curso 4** and scans for your configured codes
4. A subject card lacking the text *"no es seleccionable porque no quedan plazas libres"* is treated as a possible opening → triggers the alert flow
5. If nothing's open, it waits out the cooldown, changes the URL hash back to the start screen (not a full reload), and starts over

## A heads-up before you run it

This automates repeated interaction with your university's live enrollment system, on your own account. It's worth checking UAH's terms of use for automatrícula before leaving this running unattended, especially during peak registration windows — automated polling can be treated differently from a person manually refreshing.

## License

MIT — see [`LICENSE`](./LICENSE). Change it if you'd rather use something else.
