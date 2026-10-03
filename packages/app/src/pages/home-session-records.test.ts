import { expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { homeSessionRecords } from "./home-session-records"

const session = (id: string, directory: string): Session => ({
  id,
  directory,
  projectID: "project",
  title: id,
  slug: id,
  version: "1",
  time: { created: 1, updated: 2 },
})

test("a fresh browser shows server chats without importing the Mac's local project preferences", () => {
  const sessions = [session("analytics", "/local/biodata"), session("agency", "/local/agency")]
  expect(
    homeSessionRecords({ sessions, projects: [], directories: [], showAll: true }).map((r) => r.session.id),
  ).toEqual(["agency", "analytics"])
})

test("desktop and selected-project views retain their directory filter", () => {
  const sessions = [session("analytics", "/local/biodata"), session("agency", "/local/agency")]
  const projects = [{ worktree: "/local/biodata", expanded: true }]
  expect(
    homeSessionRecords({ sessions, projects, directories: ["/local/biodata"], showAll: false }).map(
      (r) => r.session.id,
    ),
  ).toEqual(["analytics"])
})
