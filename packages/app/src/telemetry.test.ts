import { expect, test } from "bun:test"

// Do not start the app or a build with telemetry credentials to verify these boundaries.
test("web entry does not initialize Sentry, including automatic sessions", async () => {
  const source = await Bun.file(new URL("./entry.tsx", import.meta.url)).text()
  expect(source).not.toMatch(/@sentry\/|Sentry\.init\b|VITE_SENTRY_/)
})

test("web build has no Sentry plugin or credential-driven upload path", async () => {
  const source = await Bun.file(new URL("../vite.config.ts", import.meta.url)).text()
  expect(source).not.toMatch(/@sentry\/|sentryVitePlugin|SENTRY_/)
})
