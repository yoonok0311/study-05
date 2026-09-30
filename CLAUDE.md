# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- Created: 2026-09-29 18:33 -->

## Status

"AI 공감 다이어리": the user writes one line about their day; the AI names the emotion and replies with empathy and comfort. **Architecture override:** there is no Flask server. The deliverable is an `index.html` opened by double-click (`file://`) that calls OpenRouter directly from the browser. (The subagent files below still mention Flask; for this project, "backend" means the client-side `llm.js` layer.)

- `llm.js`: plain script (no modules/build) exposing `window.DiaryAI`. Its header comment documents the full API (`analyzeDiary(text, {signal})`, return shape, error codes, key helpers). Model IDs, timeouts, and retry settings live in its `CONFIG` constant.
- `build_config.py`: run `py build_config.py` to turn `.env`'s `OPENROUTER_API_KEY` into `config.js` (`window.DIARY_CONFIG = { apiKey }`). `config.js` holds the secret: never commit or share it. Key priority in `llm.js`: in-memory key (from `DiaryAI.setApiKey` when storage is blocked) → `localStorage` → `config.js`. `llm.js` never adds hotline text itself. Requests disable reasoning (`reasoning.enabled=false`), retry at most once, and stop at a 45s overall deadline.
- `index.html`: the whole UI (inline CSS + inline UI script, no build). Open it by double-click. Loads `config.js` (optional) then `llm.js`; renders all user/AI text with `textContent`. Shows a key-input panel on `NO_API_KEY`/`INVALID_KEY` (a user-entered key wins over config.js), shows the 109 / 1577-0199 help box (the only place the numbers appear) when `crisis` or `DiaryAI.detectCrisis(text)` is true, even on errors, and keeps diary history in `localStorage` under `diaryai.entries` (max 200, works in memory if storage is blocked). The only external resource is an optional Google Font.
- There are no automated tests in the repo. Mock-`fetch` tests (llm.js) and a fake-DOM harness (index.html's inline script with a stubbed `DiaryAI`) were run from a temp dir with Node 16 (no jsdom, no global fetch).
- Free models are rate-limited: OpenRouter free tier allows about 50 free-model requests per day on accounts with under $10 in credits, and upstream shared pools often return 429.

A second app, "PDF 문서 요약", lives in the same folder with the same no-server architecture. Its spec is `PRD_pdf.md` (IDs `P1-n`/`PN1-n`; the change-log lines at the top override older numbers in the body).

- `index_pdf.html`: the UI (inline CSS/JS). Load order: `config.js` (optional, shared with the diary) → pdf.js 3.11.174 from cdnjs with SRI → `pdf_extract.js` → `pdf_summarizer.js`. It handles one PDF at a time: drop or pick → extract → show the planned request count → [요약 시작] → result cards, copy, and .md/.txt download.
- `pdf_extract.js` (`window.PdfExtract`) validates the file (20MB, 100 pages) and extracts text. The pdf.js worker is fetched and run as a blob `Worker` passed via `workerPort`, because `workerSrc` silently falls back to the main thread under `file://`. Extractions run one at a time because documents share the worker port. CMaps and standard fonts load from jsDelivr.
- `pdf_summarizer.js` (`window.PdfSummarizer`) summarizes in Korean as JSON. The primary model is `nvidia/nemotron-3-super-120b-a12b:free`, with server-side fallback to gemma-4 free models through OpenRouter's `models` array. `nvidia/nemotron-3.5-lightning:free` was dropped because it took more than 100s per request.
  - A document of 30,000 characters or less takes 1 request. Longer ones take 2 chunks plus 1 merge, 3 requests at most, and text past 60,000 characters is truncated.
  - Timeouts and network errors are not retried automatically.
  - Its API key is stored in localStorage under `pdfsum.openrouterApiKey`.

PRDs will be written as `PRD_step1.md`, `PRD_step2.md`, and so on, by the `product-manager` subagent in `.claude/agents/`. The `backend-developer` subagent implements the Flask server from those PRDs, and the `frontend-developer` subagent builds the templates, CSS, and JS on top of the backend's routes. The `qa-engineer` subagent tests each step against the PRD's acceptance criteria and reports bugs for the developers to fix. The `ai-integration-specialist` subagent owns the OpenRouter integration: the client, the model choice (not tied to one model or vendor; set by config), the prompts, and the text generation and summarization pipelines. All five have all tools and inherit the parent model. Requirement IDs such as `F3-3` are referenced from code and config, so never renumber them.

## What `.env` implies

- `OPENROUTER_API_KEY`: the app will call LLMs through OpenRouter.
- `FLASK_SECRET_KEY`: signs Flask session cookies. `.env` cites this as requirement F3-3 of `PRD_step3.md`, which isn't in the folder yet. To make a new key, run `py -c "import secrets; print(secrets.token_hex(32))"`.
- Load these values from `.env` at runtime. Never hardcode or print them.

## Conventions

- The `# Created:` timestamp rule and the `py` launcher rule come from `C:\Users\DY\Desktop\CLAUDE.md` and apply here too.
- Write comments and user-facing notes in Korean when that matches the surrounding text (the `.env` comments are Korean).
