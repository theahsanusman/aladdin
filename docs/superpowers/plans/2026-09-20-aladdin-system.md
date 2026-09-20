# Aladdin System Implementation Plan

> **Execution:** Work directly in this repository without subagents. Apply test-driven changes in small slices and verify each subsystem before integration.

**Goal:** Deliver a branded OpenCode-based macOS and mobile-web system with shared existing configuration, local voice input/output, configurable image generation, secure LAN access, approvals, and durable goals/tasks.

**Architecture:** Preserve OpenCode's server/client split. Add typed Aladdin configuration and media adapters server-side; keep audio capture and settings UI in the Solid app; expose narrow authenticated APIs through the existing server; reuse the responsive UI and permission transport; integrate goals at the session/plugin boundary.

**Stack:** Bun, TypeScript, Effect, SolidJS, Electron, MLX-backed local Python services, Draw Things, existing OpenCode SDK/API generation.

---

## Task 1: Establish baselines and contracts

- [ ] Record branch/status, package versions, current tests, and production benchmark baseline where session behavior will change.
- [ ] Add failing contract tests for Aladdin settings defaults, validation, secret redaction, and adapter selection.
- [ ] Define typed voice, image, LAN, and goal configuration without duplicating OpenCode credentials.
- [ ] Run focused tests and type checks.

## Task 2: Settings and secure configuration

- [ ] Add an Aladdin settings tab with Voice input, Voice output, Images, Mobile access, and Goals sections.
- [ ] Show selected local input/output models and voice.
- [ ] Add image default provider/model and server-side credential connection flows.
- [ ] Add Draw Things discovery, refresh, and manual-model controls.
- [ ] Verify persistence, migration defaults, keyboard access, responsive layout, and secret non-exposure.

## Task 3: Local voice input

- [ ] Add a loopback-only transcription adapter and health/model APIs.
- [ ] Implement browser/Electron recording with permission, format negotiation, cancellation, size/time limits, and cleanup.
- [ ] Add message-mode microphone control and editable transcription insertion.
- [ ] Download Qwen3-ASR 1.7B and verify transcription on the user's Mac/voice; do not download or offer Parakeet.
- [ ] Verify audio stays local and error/retry states are clear.

## Task 4: Local voice output and call mode

- [ ] Add Qwen3-TTS MLX adapter, model/voice discovery, import, preview, and synthesis APIs.
- [ ] Require explicit acknowledgement for imported/cloned voices and store references safely.
- [ ] Add call-mode state machine: listen, transcribe, submit, wait, speak, listen; include barge-in and stop.
- [ ] Speak only final assistant output, not tool logs or hidden reasoning.
- [ ] Verify interruption, cleanup, mobile playback restrictions, and repeated cycles.

## Task 5: Image generation

- [ ] Define a normalized image request/result contract and failing adapter tests.
- [ ] Implement OpenAI, Gemini, OpenRouter, and Draw Things adapters with bounded timeouts and useful errors.
- [ ] Discover Draw Things models from supported local interfaces and documented storage, with manual fallback.
- [ ] Add composer image action, progress, result preview, attachment/save behavior, and cancellation.
- [ ] Verify credentials are server-side and generated files are handled safely.

## Task 6: Durable goals and tasks

- [ ] Pin or implement a goal workflow against this exact OpenCode revision after compatibility tests.
- [ ] Persist objective, status, budgets, evidence, and task-list state across compaction/restart.
- [ ] Add goal create/view/pause/resume/complete/blocked UI and tools.
- [ ] Ensure user steering and permission rejection stop unsafe auto-continuation.
- [ ] Verify no checkpoint feature or checkpoint state was introduced.

## Task 7: Secure LAN mobile mode

- [ ] Add an explicit LAN-mode command/settings flow with generated strong password.
- [ ] Add trusted local HTTPS setup and clear phone certificate onboarding.
- [ ] Restrict binding/origin behavior to the intended LAN and keep loopback-only media services inaccessible directly.
- [ ] Verify responsive voice/image controls and permission approve/deny from a real mobile-sized browser.
- [ ] Document safe start/stop and Wi-Fi assumptions.

## Task 8: Branding and macOS app

- [ ] Rename user-facing desktop/app surfaces to Aladdin without changing OpenCode compatibility identifiers unnecessarily.
- [ ] Generate and obtain user approval for the genie icon before replacing app assets.
- [ ] Package the macOS app and verify launch, microphone permission, local services, updates behavior, and Applications installation.

## Task 9: Release verification

- [ ] Run relevant package unit/integration/browser tests, type checks, lint, and production builds.
- [ ] Compare session performance to the recorded baseline.
- [ ] Exercise text, voice message, call, image, goal, mobile approval, restart recovery, and failure paths.
- [ ] Inspect the final diff for credentials, generated junk, unintended config changes, and checkpoint code.
- [ ] Produce a concise installation and daily-use handoff with current limitations.
