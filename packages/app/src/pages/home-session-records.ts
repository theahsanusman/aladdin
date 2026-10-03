import type { Session } from "@opencode-ai/sdk/v2/client"
import type { LocalProject } from "@/context/layout"
import { compareSessionTime, displayName, projectForSession } from "@/pages/layout/helpers"
import { pathKey } from "@/utils/path-key"

export function homeSessionRecords(input: {
  sessions: Session[]
  directories: string[]
  projects: LocalProject[]
  showAll: boolean
}) {
  const directories = new Set(input.directories.map(pathKey))
  return [
    ...new Map(
      input.sessions
        .filter((session) => input.showAll || directories.has(pathKey(session.directory)))
        .map((session) => [session.id, session]),
    ).values(),
  ]
    .sort(compareSessionTime)
    .flatMap((session) => {
      const project =
        input.projects.find(
          (project) =>
            pathKey(project.worktree) === pathKey(session.directory) ||
            project.sandboxes?.some((directory) => pathKey(directory) === pathKey(session.directory)),
        ) ??
        projectForSession(session, input.projects) ??
        (input.showAll ? { worktree: session.directory, expanded: false } : undefined)
      return project ? [{ session, project, projectName: displayName(project) }] : []
    })
}
