import { expect, test } from "bun:test"

// Do not start Electron or run the sidecar-building prebuild script for this check.
test("desktop renderer does not initialize Sentry, including automatic sessions", async () => {
  const source = await Bun.file(new URL("./src/renderer/index.tsx", import.meta.url)).text()
  expect(source).not.toMatch(/@sentry\/|Sentry\.init\b|VITE_SENTRY_/)
})

test("desktop build has no Sentry plugin or credential-driven upload path", async () => {
  const source = await Bun.file(new URL("./electron.vite.config.ts", import.meta.url)).text()
  expect(source).not.toMatch(/@sentry\/|sentryVitePlugin|SENTRY_/)
})
