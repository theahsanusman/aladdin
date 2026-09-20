# Aladdin System Specification

## Objective

Turn this OpenCode fork into Aladdin: a daily-use macOS app and responsive mobile web client that keep the existing OpenCode configuration and authentication while adding local voice interaction, configurable image generation, and durable goal-driven work.

## Confirmed scope

- Keep the existing OpenCode data/config locations. Do not create a second credentials store.
- English-first local speech-to-text with two UI modes:
  - message mode records, transcribes, and leaves editable text in the composer;
  - call mode records, submits after end-of-speech, waits for the agent, speaks the final answer, and listens again.
- Local, free text-to-speech with model and voice selection. Support presets and user-authorized imported/cloned voices.
- Image generation settings with a default provider, provider model, provider key setup, Draw Things local mode, best-effort local model discovery, and manual model entry.
- Same-Wi-Fi mobile web access with password authentication, trusted HTTPS for microphone access, the same voice/image controls, and the existing permission approval UI.
- Durable goals and task lists that survive compaction and restart. No checkpoint feature.
- Aladdin name and later a user-approved genie app icon; produce a signed/installable macOS build only after functionality and visual assets are ready.

## Technical decisions

### Shared configuration

Aladdin will continue using OpenCode's existing global config and auth locations. Aladdin-specific non-secret UI preferences may live in the existing persisted app settings. API keys remain in the existing server credential mechanisms rather than browser local storage.

### Voice input

Use Qwen3-ASR 1.7B for English voice messages. Do not download or offer Parakeet. Browser and Electron capture audio with `MediaRecorder`; inference runs on the Mac through a loopback-only local service.

### Voice output

Default to Qwen3-TTS 1.7B through an Apple-Silicon MLX service. Expose the model, preset voice, voice design, and authorized reference-voice selection in settings. The model and upstream implementation are Apache-2.0; imported voice consent remains the user's responsibility.

### Images

Use one adapter contract for OpenAI, Gemini, OpenRouter, and Draw Things. Cloud credentials are stored server-side. Draw Things discovery first uses its supported local catalog/CLI interface and otherwise falls back to scanning its documented model directory; manual entries remain available because Draw Things also supports external model folders.

### Mobile security

LAN mode binds deliberately to the local network, requires a password, and is served through trusted local HTTPS. Plain LAN HTTP is insufficient because browsers expose microphone capture only in secure contexts. The existing responsive UI and permission events provide phone approval without a separate approval service.

### Goals

Integrate a durable, guarded goal workflow compatible with this exact OpenCode revision: objective and task state persist across compaction/restart, user messages pause or steer safely, and completion requires evidence. Do not add checkpoint semantics.

## Acceptance criteria

1. Settings visibly show and persist the selected STT model, TTS model and voice, image provider/model, and Draw Things configuration.
2. Message-mode recording produces editable English text locally and never uploads audio.
3. Call mode completes a listen → submit → agent response → local speech → listen cycle and can be stopped immediately.
4. Image generation works through at least one configured cloud adapter and Draw Things; discovered and manual Draw Things models are selectable.
5. A phone on the same Wi-Fi can load the authenticated HTTPS UI, use its microphone, and approve/deny OpenCode permission requests.
6. Goals and task lists survive compaction and restart; no checkpoint UI or storage exists.
7. Existing OpenCode providers, configuration, authentication, and ordinary text workflows continue to work.
8. Relevant unit/integration tests, type checks, production builds, runtime UI checks, and macOS packaging checks pass before completion is claimed.

## Explicit exclusions

- Checkpoints.
- Tailscale or public internet exposure.
- Paid speech APIs.
- Parakeet models.
- Silent credential migration or duplication.
- Voice cloning without user authorization.
