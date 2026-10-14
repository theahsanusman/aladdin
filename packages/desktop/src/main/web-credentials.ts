import { randomBytes, randomUUID, scryptSync } from "node:crypto"
import { chmod, link, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

export const webPasswordPath = (directory: string) => join(directory, "aladdin-web-password")
export const webPasswordDisabledPath = (directory: string) => join(directory, "aladdin-web-no-password")

// Keep these in lockstep with @opencode-ai/server/auth: the sidecar hands this stored verifier to
// the server as OPENCODE_SERVER_PASSWORD, and the server re-derives with the same parameters to
// check a password the phone types. scrypt is memory-hard (16 MiB per guess), so a stolen file
// resists offline cracking; the desktop never needs the plaintext after this point.
const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 32, saltBytes: 16, maxmem: 64 * 1024 * 1024 }

export async function loadWebPassword(directory: string) {
  const disabled = await readPrivateFile(webPasswordDisabledPath(directory))
  if (disabled !== undefined) {
    if (disabled !== "disabled") throw new Error("Invalid Aladdin passwordless preference")
    return ""
  }
  const existing = await readStoredVerifier(directory)
  if (existing !== undefined) return existing
  await saveVerifier(directory, hashPassword(randomUUID()), false)
  const saved = await readStoredVerifier(directory)
  if (saved === undefined) throw new Error("Aladdin web credentials were not saved")
  return saved
}

// Returns the plaintext once, for the reset command to show the user, but stores only its hash.
// The agent and any later read of the file learn nothing usable.
export async function resetWebPassword(directory: string, password = randomUUID()) {
  validate(password)
  await saveVerifier(directory, hashPassword(password), true)
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

// Reads the stored verifier. A legacy plaintext file (anything that is not a scrypt record) is
// hashed in place so the app still starts, and every later read observes only the hash.
async function readStoredVerifier(directory: string) {
  const stored = await readPrivateFile(webPasswordPath(directory))
  if (stored === undefined) return
  if (isScryptRecord(stored)) return stored
  validate(stored)
  const hashed = hashPassword(stored)
  await saveVerifier(directory, hashed, true)
  return hashed
}

export function hashPassword(password: string) {
  const salt = randomBytes(SCRYPT.saltBytes)
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`
}

// Checks a typed password against the stored verifier. Used by tests to prove the hash actually
// authenticates the original password, and available to any caller that needs the same check.
export function verifyWebPassword(password: string, stored: string) {
  const parsed = parseScrypt(stored)
  if (!parsed) return false
  return scryptSync(password, parsed.salt, parsed.hash.length, parsed).equals(parsed.hash)
}

function parseScrypt(stored: string) {
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return
  const cost = Number(parts[1])
  const blockSize = Number(parts[2])
  const parallelization = Number(parts[3])
  const salt = Buffer.from(parts[4], "base64")
  const hash = Buffer.from(parts[5], "base64")
  if (!Number.isSafeInteger(cost) || cost < 2) return
  if (!Number.isSafeInteger(blockSize) || blockSize < 1) return
  if (!Number.isSafeInteger(parallelization) || parallelization < 1) return
  if (salt.length === 0 || hash.length === 0) return
  if (salt.toString("base64") !== parts[4] || hash.toString("base64") !== parts[5]) return
  return { N: cost, r: blockSize, p: parallelization, salt, hash }
}

// A phone re-sends its Basic credential on every request, and the server verifies each one against
// this scrypt record. Enforce printable ASCII at reset time so an iPhone keyboard can actually type
// the password; a legacy non-ASCII password is still migrated above rather than blocking startup.
function validate(password: string) {
  if (password.length < 12 || password.length > 1024 || /[\r\n\0]/.test(password))
    throw new Error("Aladdin web password must contain at least 12 characters without control characters")
  // Printable ASCII is exactly codepoints 0x20 (space) through 0x7E (~); anything outside that
  // range includes the smart quotes and accents an on-screen keyboard cannot reliably enter.
  for (const character of password) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code > 0x7e)
      throw new Error("Aladdin web password must contain only printable ASCII characters")
  }
}

function isScryptRecord(stored: string) {
  return /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(stored)
}

async function saveVerifier(directory: string, verifier: string, replace: boolean) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.aladdin-web-password-${randomUUID()}`)
  await writeFile(temporary, verifier, { flag: "wx", mode: 0o600 })
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
