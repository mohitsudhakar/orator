# ORATOR

An elite executive public-speaking coach: a **live Gemini voice coach** that hears
you and pushes back in real time, plus a **12-module MBA-level curriculum** with
scenarios, exercises, graded assessments, and measured progress.

Built for founders and executives who speak in high-stakes rooms.

---

## What it does

| Capability | How |
|---|---|
| **Live voice coach** | Gemini Live API (`gemini-3.1-flash-live-preview`) over a WebSocket bridge. It hears your pace, pauses, pitch, and volume — not just your words — and coaches you in real time with audio. |
| **Speech metrics** | A from-scratch DSP engine: YIN pitch tracking, FFT spectral analysis, pause structure, filler density, pace, vocabulary richness, sentence-variance monotony detection. Seven scored dimensions with explainable thresholds. |
| **MBA-level curriculum** | 12 modules, each with 5-8 concepts (250-450 words each), named frameworks, branching business scenarios with graded options, 5-7 exercises (recorded + real-world), a weighted rubric, reading list, and a mastery checklist. |
| **Visual explanations** | Every concept can be rendered as a generated instructional diagram (`gemini-3.1-flash-image`, Nano Banana 2) in a consistent house style. |
| **Streaming tutor** | SSE-streamed coaching answers grounded in the learner's actual curriculum, progress, and measured metrics. Every answer ends with a concrete next action. |
| **Progress tracking** | SQLite persistence of concepts, exercises, scenarios, sessions, assessments, streaks, and per-dimension trend data. |

---

## Quick start

```bash
cd ~/Code/orator
npm install
npm start
# -> http://localhost:4173
```

The Gemini key is read from `GEMINI_API_KEY` / `GOOGLE_API_KEY`, falling back to
`~/.hermes/.env`. **The key never reaches the browser** — the browser talks to
this server, and this server talks to Google.

```bash
# Optional: point at a different key file / data dir
GEMINI_API_KEY=... ORATOR_DATA_DIR=./data npm start
```

---

## Verified model matrix

All confirmed live against this account (2026-10-21):

| Role | Model | Notes |
|---|---|---|
| Live voice coach | `gemini-3.1-flash-live-preview` | **AUDIO-only response modality.** TEXT-only and AUDIO+TEXT both return error 1007. |
| Tutor / grading | `gemini-3.8-flash` | SSE streaming, JSON mode for grading. |
| Concept diagrams | `gemini-3.1-flash-image` | Nano Banana 2. `gemini-3.1-flash-lite-image` is the cheaper variant. |

### Two Live API gotchas that cost real debugging time

Both were silent failures — no error payload, just missing output:

1. **`contextWindowCompression` closes the socket with no error.** The API rejects
   the token values and the WebSocket closes immediately, which is indistinguishable
   from a network drop. It is deliberately not set; see the comment in
   `server/live.js`.
2. **Without an explicit `speechConfig` voice, audio output is unreliable.**
   Measured: with `speechConfig.voiceConfig.prebuiltVoiceConfig`, the model
   returned audio on **6/6** runs; without it, **1/6**. The failures returned a
   transcript with zero audio bytes and no error. `DEFAULT_VOICE` is always set.

---

## Architecture

```
Browser (vanilla ES modules)
  ├── REST  ──────────► Express API ──────────► SQLite (node:sqlite)
  ├── SSE   ◄────────── tutor stream ◄─────────  gemini-3.8-flash
  └── WS    ◄──────────► /live bridge ◄────────► Gemini Live API
                              │
                              └──► speech metrics engine (YIN + FFT)
```

```
server/
  index.js        Express routes, SSE tutor, static serving
  live.js         WebSocket bridge to the Gemini Live API
  metrics.js      Speech analysis + scoring (the DSP core)
  fft.js          Radix-2 FFT / IFFT
  gemini.js       Model matrix, image generation, grading, debriefs
  db.js           SQLite schema and queries
  curriculum.js   Module loading + validation
content/modules/  m01..m12.json  (the curriculum)
public/           index.html, app.js, styles.css
server/test/      metrics, fft, live e2e, browser e2e
```

---

## Tests

```bash
npm test                                        # metrics engine (45 checks)
node server/test/fft.test.js                    # FFT correctness (4 checks)
node server/test/live.e2e.mjs                   # live coach over WS
python3 server/test/browser_e2e.py              # full browser E2E (34 checks)
```

The browser E2E drives real Chrome over CDP and asserts on live behaviour:
the coach actually speaks audio in the browser, diagrams really render, the tutor
really streams, and progress really persists across a reload.

```bash
# Chrome with remote debugging for the browser tests
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 "--remote-allow-origins=*" \
  --user-data-dir=/tmp/orator-chrome --headless=new about:blank
```

---

## The speech metrics engine

Scores are 0-100 with thresholds a coach can defend out loud.

| Dimension | Measured from | What it catches |
|---|---|---|
| **Pace** | words per minute | running over the room, or dragging |
| **Clarity** | filler rate + sentence-length variance | "um/so/actually" and monotonous rhythm |
| **Delivery** | RMS dynamics, clipping, spectral centroid | flat volume, harsh clipping, mumbling |
| **Pitch** | YIN f0, range in semitones, movement ratio | monotone drift vs active modulation |
| **Pause control** | word-timing gaps | no strategic silence, or dead air |
| **Vocabulary** | type-token ratio, hapax ratio | repetitive language |
| **Structure** | contrast/causal markers, question rate | no argument, no progression |

YIN (de Cheveigne & Kawahara) is used rather than plain autocorrelation because
autocorrelation has a well-known octave error: a 120 Hz voice often reports
240 Hz. YIN's absolute-threshold step always takes the *first* dip below
threshold, so a harmonic peak at 2T can never win.

---

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Model matrix, curriculum validation |
| GET | `/api/catalogue` | All modules + progress + stats |
| GET | `/api/modules/:id` | Full module + learner progress |
| POST | `/api/progress/:id` | Update concepts/exercises/scenarios |
| POST | `/api/sessions` | Analyse a recorded take (PCM + transcript) |
| GET | `/api/sessions` | Session history |
| POST | `/api/tutor/stream` | SSE streaming tutor answer |
| POST | `/api/images/generate` | Generate a concept diagram |
| GET | `/api/images/existing` | Find an already-generated diagram |
| POST | `/api/scenarios/:m/:s/respond` | Grade a scenario choice |
| POST | `/api/assessments/:m/submit` | Grade against the module rubric |
| POST | `/api/debrief` | Written coaching debrief for a session |
| POST | `/api/live/instruction` | Build the live coach system prompt |
| GET | `/api/dashboard` | Stats, streak, activity, trends |

---

## Deployment

App Runner (fits Mohit's existing stack — Express + App Runner + Supabase):

```bash
aws apprunner create-service \
  --service-name orator \
  --source-configuration-path .apprunner.yaml \
  --region us-east-1
```

`content/` and `assets/generated/` must ship with the image (they are read at
runtime). SQLite lives on the container filesystem, so point `ORATOR_DATA_DIR`
at a mounted volume for persistence across deploys, or swap `server/db.js` for a
hosted Postgres adapter.

---

## Notes and limits

- The live coach needs **headphones** — otherwise the coach hears its own voice
  through the speakers and talks over you.
- Voice activity detection has a ~700 ms tail; short interjections can be
  missed. Use the "Send note to coach" box for precise direction.
- Image generation takes ~15-30 s per diagram. Diagrams are cached on disk and
  reused, so the second view is instant.
- The tutor's markdown is rendered by a small hand-rolled converter, not a full
  CommonMark implementation. It handles headings, lists, bold, italic, code and
  blockquotes — not tables.
