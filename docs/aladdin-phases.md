# Aladdin delivery phases

This is the working checklist for the personal Aladdin app. A checked item means it has been verified, not merely started. The icon must be shown to the user and approved before it replaces app assets.

## Phase 1 — usable core

- [x] Complete the Qwen3-ASR 1.7B local model download and verify a voice message transcribes into editable composer text. Do not download or use Parakeet.
- [x] Make goals and task lists durable across turns, compaction, and restart; verify pause/resume and guarded completion behavior.
- [x] Create and show a polished Aladdin icon concept; the user approved the brass lamp design on 2026-09-20. The approved source, development Dock PNG, and valid macOS ICNS are in `packages/desktop/icons/dev/`.
- [x] Package the macOS app with the approved icon and install it in Applications; make Qwen ASR start when the app opens. The installed app launched at 08:24 PKT on 2026-09-20 and its log reports the local ASR model warmed.
- [x] Run focused tests, type checks, production build, packaging, and direct installed-app runtime checks for the Phase 1 features.

### Current Phase 1 evidence

- Voice: Qwen-only defaults and API validation are implemented. The Qwen3-ASR 1.7B 8-bit model was copied into the Git-ignored local model directory and its SHA-256 matches the Hugging Face blob (`bf304b009cc7eca79283056f787b39732bba3c23c13c`). The installed app starts and warms that model. Runtime UI verification on 2026-09-20 confirmed the microphone appears in the active composer, changes to Stop recording, sends a known local recording through Aladdin's real transcription route, and inserts `Create a new task and test voice input.` as editable composer text. The duplicate direct-curl fragment and incomplete 8-bit TTS downloads were removed. The complete 1.7B CustomVoice 4-bit TTS model and speech tokenizer are also copied into the Git-ignored local model directory and checksum verified.
- Images: deferred to Phase 2 at the user's request. UI and adapters exist, but no configured provider has completed a live generation through Aladdin.
- Goals: session objectives, status, and completion evidence now persist in SQLite alongside the existing durable session todos. Both session engines expose the goal to the model on each provider turn. Tests cover tool registration, pause/resume, evidence and unfinished-task guards, SQLite close/reopen, legacy prompt context, and V2 context after compaction. The visible todo dock continues to show the task list; goals are managed through the agent's `goal` tool.
- Icon: approved and applied to development PNG/ICNS assets; `iconutil` decoded the ICNS successfully. Packaging belongs to Phase 2.
- OpenCode parity: Aladdin keeps OpenCode's existing config, data, and auth locations. The installed CLI discovered 43 skills and reported both configured MCP servers (`chrome-devtools` and `context7`) connected on 2026-09-20.
- Focused app, image-adapter, and server-route tests pass; app and backend type checks pass. These checks do not prove live model inference or image generation.

## Phase 2 — complete personal deployment

- [ ] Finish and verify image generation through a configured provider and the intended attachment flow, including Draw Things when its local API and model are available.
- [ ] Complete Qwen3-TTS output using the copied, Git-ignored CustomVoice 4-bit model in this repository, then the call cycle: silence detection, submit, final-answer playback, repeat listening, and immediate stop. No TTS model download is needed.
- [ ] Finish password-protected HTTPS access on the same Wi-Fi and verify phone microphone, image controls, and permission approvals.
- [ ] Run final end-to-end checks, including ordinary coding, voice, images, goals, restart recovery, phone access, and the installed app.

Current source of requirements: `docs/superpowers/specs/2026-09-20-aladdin-system.md`. The user's Qwen-only decision on 2026-09-20 supersedes the initial Parakeet proposal.

## Phase 3 — visual templates

- [ ] Add three to four distinct, high-contrast app templates and let the user choose between them.
