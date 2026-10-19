# Roulette

Instant conversations, inserted anywhere. Windows 10/11.

Roulette is a resident desktop app: hold a mouse gesture to open a radial menu, pick text / screenshot / voice, talk to your configured model, and insert the answer at the cursor of whatever app you were using.

## Status

M2–M4 done: wheel overlay, hold + click selection, panel, settings, the OpenAI-compatible streaming engine, cursor insertion, persistent history, screenshot capture, and offline voice input. A first version of the local knowledge base (v1.1) is also in place. Packaging is next.

Pick 截图 on the wheel to freeze the display under the cursor, drag a region, and the crop opens in a new session; screenshots are attached to the turn, use the configured vision model, and stay available to follow-up turns. The composer's camera button captures into the current session instead.

Pick 语音 (or press the mic in the composer) and the panel records from the microphone. Stopping sends the audio to the local SenseVoice model and puts the transcript in the input, where it can be edited before sending; Settings has an "auto-send" switch. The speech model (~228 MB) is downloaded on first use from Settings and never sends audio off the machine. See [ADR 0007](docs/adr/0007-local-asr-with-sherpa-onnx.md).

The database icon in the panel header opens the knowledge base. Use Upload documents or Create document; documents are chunked and embedded locally with `bge-small-zh-v1.5` (~24 MB) and indexed with `sqlite-vec`. The embedding model download and the "use knowledge base in chat" switch live in Settings. When the switch is on, the host retrieves the top passages and sends only those snippets to your configured provider; replies show their sources. See [ADR 0009](docs/adr/0009-local-knowledge-base.md).

Insertion writes the result to the clipboard and then asks the native helper to paste. The target is re-resolved to whatever app is foreground after the panel hides. Native edit controls receive `WM_PASTE` at their caret; custom editors (Chromium, Electron, terminals) get a click at the wheel's invocation point to restore keyboard focus, then a simulated Ctrl+V. The clipboard is restored only after the helper confirms the paste. See [ADR 0004](docs/adr/0004-wm-paste-for-edit-controls.md).

History lives in `%APPDATA%\roulette\roulette.db` (Node's built-in `node:sqlite`, see [ADR 0005](docs/adr/0005-node-sqlite-for-history.md)); screenshots are stored next to it under `images/`. Every panel open starts a new session; the history page lists earlier sessions and resumes them with their full context.

## Develop

```bash
npm install
npm run dev
```

The dev command builds the native mouse hook first. Building it needs the Rust toolchain.

### Renderer structure

- `src/renderer/src/panel/Panel.tsx` owns the conversation session state and switches between the chat, history, settings, and knowledge-base pages.
- `panel/components/` contains presentational pieces (header, chat flow, composer, pages).
- `panel/hooks/` contains the recorder, history, settings-draft, and knowledge-base state machines.
- `overlay/Overlay.tsx` is the radial wheel; `shot/Shot.tsx` is the screenshot selector.
- `styles/tokens.css` defines the shared cut-paper palette; `panel.css`, `overlay.css`, and `shot.css` style each window.

- Hold `Alt` and the right mouse button → wheel appears → drag → release to select.
- The wheel has four sectors: text (up), screenshot (left), voice (right), and history (down). History opens the panel with the history page already open.
- `Ctrl+Shift+Space` → click-mode wheel (falls back to `Alt+Shift+Space` / `Control+Alt+R` if taken).
- `Ctrl+Alt+H` → open the history drawer from anywhere (falls back to `Alt+Shift+H`).
- In the panel: `Enter` sends, empty `Enter` / `Ctrl+Enter` inserts at the cursor, `Shift+Enter` adds a newline. The header icons open history, the knowledge base, settings, minimize, and close; the camera and microphone live in the composer.

### Debug

```powershell
$env:ROULETTE_CAPTURE = '1'; npm run dev
```

With capture enabled, every wheel open writes `out/overlay-capture.png` and every panel open writes `out/panel-capture.png`, so the UI can be inspected without a screen recording.

Set `ROULETTE_PERF=1` to print `[perf]` timings for startup (bootstrap, window creation, hook, first render) and the chat image-history path:

```powershell
$env:ROULETTE_PERF = '1'; npm run dev
```

### Mock endpoint (no API key needed)

```bash
npm run mock
```

Then start the app with dev overrides:

```powershell
$env:ROULETTE_BASE_URL = 'http://127.0.0.1:8787/v1'
$env:ROULETTE_API_KEY = 'test'
$env:ROULETTE_TEXT_MODEL = 'mock'
npm run dev
```

`ROULETTE_BASE_URL`, `ROULETTE_API_KEY`, `ROULETTE_TEXT_MODEL`, and `ROULETTE_VISION_MODEL` take precedence over the settings file, which makes local testing possible without storing a key.

### Test hooks

These are development-only and gated by environment variables:

- `ROULETTE_TEST_MESSAGE`: after the panel opens, type this text and press Enter.
- `ROULETTE_TEST_INSERT`: after a streamed reply completes, insert it automatically.
- `ROULETTE_TEST_SIDEKEY`: after insertion, send the `a` key (input-delivery diagnostic).
- `ROULETTE_TEST_WMPASTE`: force the `WM_PASTE` path instead of auto-selecting.
- `ROULETTE_TEST_HISTORY`: after the test message completes, open the history page and resume the newest session.
- `ROULETTE_TEST_FOLLOWUP`: with the history test, send this follow-up after resuming. The mock log prints `turns=` so the restored context is visible.
- `ROULETTE_TEST_PANEL_SHOT`: click the composer's camera button two seconds after the panel opens (exercises the capture-into-current-session path).
- `ROULETTE_TEST_SETTINGS`: open the settings page two seconds after the panel opens.
- `ROULETTE_TEST_SETTINGS_EYE`: with the settings test, click the API-key eye toggle.
- `ROULETTE_TEST_SETTINGS_SAVE`: with the settings test, toggle the auto-send switch and save.
- `ROULETTE_TEST_HISTORY_ACTIONS`: exercise history search, filtering, rename, delete, and undo.
- `ROULETTE_TEST_OPEN_PANEL`: open the text panel directly after startup (no mouse injection).
- `ROULETTE_TEST_KB`: seed a knowledge-base document at startup.
- `ROULETTE_TEST_KB_OPEN`: open the knowledge-base page after the panel opens.
- `ROULETTE_TEST_KB_CREATE`: with the KB-open test, also open the create-document form.
- `ROULETTE_TEST_ASR_DOWNLOAD`: call the model downloader through the renderer IPC after the panel opens.
- `ROULETTE_TEST_MIC_WAV`: feed this WAV file to `getUserMedia` through Chromium's fake audio device, for testing the voice flow without a microphone.
- `ROULETTE_TEST_ASR_STOP_MS`: stop a voice recording this many milliseconds after the panel opens (used with the fake microphone).

`spike/test-inject.ps1` injects the wheel gesture, `spike/drag-select.ps1` performs a left-button drag for selecting a screenshot region, and `spike/send-esc.ps1` sends Escape. All are development helpers.

`scripts/test-asr.mjs` runs the local recognizer directly against a WAV file, and `scripts/mock-asr-model.mjs` serves small fixture files with Range support for testing the downloader.

The [spike](spike/) folder also contains the original mouse-hook proof of concept and the `insert-target.ps1` test window.

If the Electron binary download is slow:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

## Docs

- [v1 design](docs/v1-design.md)
- [ADR 0001: the wheel is the host, not an agent plugin](docs/adr/0001-roulette-is-host-not-agent-plugin.md)
- [ADR 0002: API-first, CLI deferred](docs/adr/0002-api-first-engine-cli-deferred.md)
- [ADR 0003: retrieval stays in the host](docs/adr/0003-retrieval-in-host.md)
- [ADR 0004: WM_PASTE for standard edit controls](docs/adr/0004-wm-paste-for-edit-controls.md)
- [ADR 0005: node:sqlite for history](docs/adr/0005-node-sqlite-for-history.md)
- [ADR 0006: desktopCapturer for screenshots (superseded)](docs/adr/0006-desktop-capturer-for-screenshots.md)
- [ADR 0007: local ASR with sherpa-onnx](docs/adr/0007-local-asr-with-sherpa-onnx.md)
- [ADR 0008: GDI-first screenshot capture](docs/adr/0008-gdi-screenshot-capture.md)
- [ADR 0009: local knowledge base](docs/adr/0009-local-knowledge-base.md)
- [Glossary](GLOSSARY.md)
- [Mouse-hook spike](spike/README.md)

## License

MIT
