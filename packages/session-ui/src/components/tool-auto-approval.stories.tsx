import { For } from "solid-js"
import type { AssistantMessage, ToolPart } from "@opencode-ai/sdk/v2"
import { DataProvider } from "../context/data"
import { ContextToolGroup, Part } from "./message-part"
import { ToolAutoApproval } from "./tool-auto-approval"
import { readAutoApprovals } from "./tool-auto-approvals"

const message: AssistantMessage = {
  id: "message-auto-approval",
  sessionID: "session-auto-approval",
  role: "assistant",
  time: { created: 1, completed: 2 },
  parentID: "message-user",
  modelID: "example",
  providerID: "example",
  mode: "build",
  agent: "build",
  path: { cwd: "/project", root: "/project" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
}

const confirmed = { autoApprovals: [{ action: "shell", resources: ["bun test"], reason: "auto" }] }
const input = { command: "bun test", description: "Run tests" }
const states: ToolPart["state"][] = [
  { status: "running", input, metadata: confirmed, time: { start: 1 } },
  {
    status: "completed",
    input,
    metadata: confirmed,
    title: "Run tests",
    output: "43 tests passed",
    time: { start: 1, end: 2 },
  },
  { status: "error", input, metadata: confirmed, error: "Command exited with code 1", time: { start: 1, end: 2 } },
]

function tool(id: string, name: string, state: ToolPart["state"]): ToolPart {
  return {
    id,
    sessionID: message.sessionID,
    messageID: message.id,
    callID: id,
    type: "tool",
    tool: name,
    state,
  }
}

const contextParts = [
  tool("read-recorded", "read", {
    status: "completed",
    input: { filePath: "/tmp/review/README.md" },
    title: "Read README",
    output: "Read file",
    metadata: {
      autoApprovals: [{ action: "external_directory", resources: ["/tmp/review/README.md"], reason: "rule" }],
    },
    time: { start: 1, end: 2 },
  }),
  tool("glob-unrecorded", "glob", {
    status: "completed",
    input: { pattern: "**/*.ts", path: "/project" },
    title: "Find source files",
    output: "src/index.ts",
    metadata: {},
    time: { start: 1, end: 2 },
  }),
]

export default {
  title: "UI/ToolAutoApproval",
  id: "components-tool-auto-approval",
  component: ToolAutoApproval,
  parameters: {
    docs: {
      description: {
        component:
          "Server-recorded approvals only. Tab to Auto-approved and use Enter or Space to reveal actions and resources. Details are scrollable by keyboard; tool failure does not remove the notice. Context-group notices remain visible when the group is collapsed.",
      },
    },
  },
}

export const RecordedStatesAndContext = {
  render: () => (
    <DataProvider
      directory="/project"
      data={{ session: [], session_status: {}, session_diff: {}, message: {}, part: {} }}
    >
      <div style={{ display: "grid", gap: "24px", "max-inline-size": "640px" }}>
        <For each={states}>
          {(state) => (
            <section>
              <h3 style={{ "margin-block-end": "8px" }}>{state.status}</h3>
              <Part message={message} part={tool(state.status, "shell", state)} />
            </section>
          )}
        </For>
        <section>
          <h3 style={{ "margin-block-end": "8px" }}>Grouped context, initially collapsed</h3>
          <ContextToolGroup parts={contextParts} />
        </section>
      </div>
    </DataProvider>
  ),
}

export const NoRecordedApproval = {
  render: () => (
    <DataProvider
      directory="/project"
      data={{ session: [], session_status: {}, session_diff: {}, message: {}, part: {} }}
    >
      <div style={{ "max-inline-size": "640px" }}>
        <Part
          message={message}
          part={tool("unrecorded", "shell", {
            status: "completed",
            input,
            title: "Run tests",
            output: "43 tests passed",
            metadata: { permissionMode: "auto" },
            time: { start: 1, end: 2 },
          })}
        />
      </div>
    </DataProvider>
  ),
}

export const MixedDirectionAndLongResources = {
  render: () => (
    <div style={{ display: "grid", gap: "24px", "max-inline-size": "320px" }}>
      <For each={["ltr", "rtl"] as const}>
        {(direction) => (
          <section dir={direction} lang={direction === "rtl" ? "ar" : "en"}>
            <h3 style={{ "margin-block-end": "8px" }}>{direction.toUpperCase()}</h3>
            <ToolAutoApproval
              approvals={readAutoApprovals({
                autoApprovals: [
                  {
                    action: "قراءة / read",
                    resources: ["C:\\work\\تقرير.txt", `/project/${"long-directory/".repeat(20)}README.md`],
                    reason: "rule",
                  },
                  ...Array.from({ length: 20 }, (_, index) => ({
                    action: "read",
                    resources: [`/project/src/file-${index}.ts`],
                    reason: "auto",
                  })),
                ],
              })}
            />
          </section>
        )}
      </For>
    </div>
  ),
}
