# Aladdin local services

Aladdin keeps speech engines on loopback and exposes only the password-protected app through Caddy HTTPS.

- Qwen3-ASR 1.7B 8-bit: `python -m mlx_audio.server --host 127.0.0.1 --port 43121`; requests select `mlx-community/Qwen3-ASR-1.7B-8bit`.
- Qwen3-TTS 1.7B CustomVoice 4-bit: use the copied model in `packages/opencode/script/aladdin-speech/.models/`; `tts_server.py` serves it on `127.0.0.1:43122`. Model weights are ignored by Git. Set `ALADDIN_TTS_MODEL` to override its local path.
- Aladdin/OpenCode: HTTP on `127.0.0.1:4096` with `OPENCODE_SERVER_PASSWORD` enabled.
- Caddy: HTTPS on the Mac's private-LAN address, forwarding to `127.0.0.1:4096`.

The certificate private key and server password belong in `~/Library/Application Support/Aladdin/` with owner-only permissions. Only `rootCA.pem` should be copied to and trusted on a phone. Never copy `rootCA-key.pem` or the server certificate private key.
