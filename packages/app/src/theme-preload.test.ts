import { beforeEach, describe, expect, test } from "bun:test"

const src = await Bun.file(new URL("../public/oc-theme-preload.js", import.meta.url)).text()

const run = () => Function(src)()

beforeEach(() => {
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  document.documentElement.removeAttribute("data-look")
  localStorage.clear()
  Reflect.deleteProperty(window, "api")
  Object.defineProperty(window, "matchMedia", {
    value: () =>
      ({
        matches: false,
      }) as MediaQueryList,
    configurable: true,
  })
})

describe("theme preload", () => {
  test("migrates legacy oc-1 to oc-2 before mount", () => {
    localStorage.setItem("opencode-theme-id", "oc-1")
    localStorage.setItem("opencode-theme-css-light", "--background-base:#fff;")
    localStorage.setItem("opencode-theme-css-dark", "--background-base:#000;")

    run()

    expect(document.documentElement.dataset.theme).toBe("oc-2")
    expect(document.documentElement.dataset.colorScheme).toBe("light")
    expect(localStorage.getItem("opencode-theme-id")).toBe("oc-2")
    expect(localStorage.getItem("opencode-theme-css-light")).toBeNull()
    expect(localStorage.getItem("opencode-theme-css-dark")).toBeNull()
    expect(document.getElementById("oc-theme-preload")).toBeNull()
  })

  test("keeps cached css for non-default themes", () => {
    localStorage.setItem("opencode-theme-id", "nightowl")
    localStorage.setItem("opencode-theme-css-light", "--background-base:#fff;")

    run()

    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(document.getElementById("oc-theme-preload")?.textContent).toContain("--background-base:#fff;")
  })

  test("defaults the look to liquid glass before mount", () => {
    run()

    expect(document.documentElement.dataset.look).toBe("liquid-glass")
  })

  test("applies a stored classic look before mount", () => {
    localStorage.setItem("settings.v3", JSON.stringify({ appearance: { look: "classic" } }))

    run()

    expect(document.documentElement.dataset.look).toBe("classic")
  })

  test("prefers the desktop mirror key over stored settings", () => {
    localStorage.setItem("settings.v3", JSON.stringify({ appearance: { look: "liquid-glass" } }))
    localStorage.setItem("opencode-look", "classic")
    Object.defineProperty(window, "api", { value: {}, configurable: true })

    run()

    expect(document.documentElement.dataset.look).toBe("classic")
  })

  test("prefers web settings over a stale desktop mirror", () => {
    localStorage.setItem("settings.v3", JSON.stringify({ appearance: { look: "liquid-glass" } }))
    localStorage.setItem("opencode-look", "classic")

    run()

    expect(document.documentElement.dataset.look).toBe("liquid-glass")
  })

  test("falls back to stored settings when the mirror key is unknown", () => {
    localStorage.setItem("settings.v3", JSON.stringify({ appearance: { look: "classic" } }))
    localStorage.setItem("opencode-look", "neon")

    run()

    expect(document.documentElement.dataset.look).toBe("classic")
  })

  test("ignores unknown stored looks", () => {
    localStorage.setItem("settings.v3", JSON.stringify({ appearance: { look: "neon" } }))

    run()

    expect(document.documentElement.dataset.look).toBe("liquid-glass")
  })

  test("survives malformed stored settings", () => {
    localStorage.setItem("settings.v3", "{not json")

    run()

    expect(document.documentElement.dataset.look).toBe("liquid-glass")
  })
})
