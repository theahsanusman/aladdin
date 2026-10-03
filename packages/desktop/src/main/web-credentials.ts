import { randomUUID } from "node:crypto"
import { chmod, link, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

export const webPasswordPath = (directory: string) => join(directory, "aladdin-web-password")
export const webPasswordDisabledPath = (directory: string) => join(directory, "aladdin-web-no-password")

export async function loadWebPassword(directory: string) {
  const disabled = await readPrivateFile(webPasswordDisabledPath(directory))
  if (disabled !== undefined) {
    if (disabled !== "disabled") throw new Error("Invalid Aladdin passwordless preference")
    return ""
  }
  const existing = await readPassword(directory)
  if (existing !== undefined) return existing
  await savePassword(directory, randomUUID(), false)
  const saved = await readPassword(directory)
  if (saved === undefined) throw new Error("Aladdin web credentials were not saved")
  return saved
}

export async function resetWebPassword(directory: string, password = randomUUID()) {
  validate(password)
  await savePassword(directory, password, true)
  await rm(webPasswordDisabledPath(directory), { force: true })
  return password
}

export async function disableWebPassword(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.aladdin-web-no-password-${randomUUID()}`)
  await writeFile(temporary, "disabled", { flag: "wx", mode: 0o600 })
  await rename(temporary, webPasswordDisabledPath(directory)).finally(() => rm(temporary, { force: true }))
}

async function readPrivateFile(file: string) {
  const info = await lstat(file).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    throw error
  })
  if (!info) return
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Aladdin web credentials must be a private regular file")
  await chmod(file, 0o600)
  return readFile(file, "utf8")
}

async function readPassword(directory: string) {
  const password = await readPrivateFile(webPasswordPath(directory))
  if (password === undefined) return
  validate(password)
  return password
}

function validate(password: string) {
  if (password.length < 12 || password.length > 1024 || /[\r\n\0]/.test(password))
    throw new Error("Aladdin web password must contain at least 12 characters without control characters")
}

async function savePassword(directory: string, password: string, replace: boolean) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.aladdin-web-password-${randomUUID()}`)
  await writeFile(temporary, password, { flag: "wx", mode: 0o600 })
  // Linking a fully written file elects one credential across concurrent starts.
  // A reset uses rename so readers observe either the old or the new password.
  await (
    replace
      ? rename(temporary, webPasswordPath(directory))
      : link(temporary, webPasswordPath(directory)).catch((error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "EEXIST") return
          throw error
        })
  ).finally(() => rm(temporary, { force: true }))
}
