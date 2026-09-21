import { Automation } from "@opencode-ai/core/automation"
import { Automation as AutomationSchema } from "@opencode-ai/schema/automation"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Context, Duration, Effect, Exit, Layer, Option, Scope } from "effect"
import { InstanceStore } from "@/project/instance-store"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Budget } from "./budget"
import { Claim } from "@/claim/registry"
import { Profiles } from "./profiles"
import { Unattended } from "./unattended"
import { Verification } from "./verification"
import { AutomationTrigger } from "./trigger"

export interface StartInput {
  automation: Automation.Info
  trigger: "schedule" | "manual"
  scheduledFor?: number
}

export interface Interface {
  readonly start: (input: StartInput) => Effect.Effect<Automation.Run>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AutomationEngine") {}

function startOfDay(now: number) {
  const date = new Date(now)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function errorSummary(cause: Cause.Cause<unknown>) {
  const errors = Cause.prettyErrors(cause)
  const first = errors[0]
  if (first) return first.message
  return Cause.hasInterruptsOnly(cause) ? "Run was interrupted" : "Run failed"
}

/** Extracts a human message from a serialized SessionV1 error object. */
function messageError(error: unknown) {
  if (!error || typeof error !== "object") return undefined
  const data = "data" in error ? (error as { data?: unknown }).data : undefined
  if (data && typeof data === "object" && "message" in data && typeof data.message === "string") return data.message
  return undefined
}

function preamble(input: Automation.Info) {
  const lines = [
    `You are running as an unattended scheduled automation named "${input.name}".`,
    "Nobody is available to answer questions or approve anything: never ask the user, never wait for input. Make reasonable decisions and continue.",
    `Permission profile: ${input.profile}.`,
  ]
  if (input.profile === "read-only") {
    lines.push("This profile blocks file edits. Do not attempt to modify the workspace; report findings instead.")
  }
  if (input.verification.length > 0) {
    lines.push(
      `The definition of done is enforced by the harness. These commands run after you finish and must pass: ${input.verification.map((check) => `\`${check.command}\``).join(", ")}.`,
    )
  }
  lines.push(
    "Work directly in the current project directory. When you finish, report concisely: what you did, what you verified, and anything the user needs to look at. If there was nothing to report, say so explicitly.",
  )
  return lines.join("\n")
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service
    const automation = yield* Automation.Service
    const sessions = yield* Session.Service
    const prompts = yield* SessionPrompt.Service
    const events = yield* EventV2Bridge.Service
    const scope = yield* Scope.Scope
    const active = new Set<string>()

    const publishRun = Effect.fnUntraced(function* (run: Automation.Run) {
      yield* events.publish(AutomationSchema.Event.RunUpdated, { run }).pipe(Effect.ignore)
    })

    const publishAutomation = Effect.fnUntraced(function* (info: Automation.Info | undefined) {
      yield* events.publish(AutomationSchema.Event.Updated, { automation: info ?? null }).pipe(Effect.ignore)
    })

    const finalize = Effect.fnUntraced(function* (runID: AutomationSchema.RunID, patch: Automation.UpdateRunInput) {
      const run = yield* automation.updateRun(runID, patch)
      if (!run) return yield* Effect.die(new Error(`Automation run not found: ${runID}`))
      yield* publishRun(run)
      return run
    })

    const skipped = Effect.fnUntraced(function* (input: StartInput, outcome: AutomationSchema.Outcome, summary: string) {
      const run = yield* store.provide({ directory: input.automation.directory }, Effect.gen(function* () {
        const created = yield* automation.createRun({
          automationID: input.automation.id,
          status: "skipped",
          trigger: input.trigger,
          scheduledFor: input.scheduledFor,
        })
        return yield* finalize(created.id, {
          status: "skipped",
          outcome,
          summary,
          unread: false,
          timeFinished: Date.now(),
        })
      }))
      return run
    })

    const lastAssistantText = Effect.fnUntraced(function* (sessionID: SessionID) {
      const found = yield* sessions
        .findMessage(sessionID, (message) => message.info.role === "assistant")
        .pipe(Effect.orElseSucceed(() => Option.none<SessionV1.WithParts>()))
      if (Option.isNone(found)) return ""
      const text = found.value.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .trim()
      return text.length > 800 ? `…${text.slice(-800)}` : text
    })

    const execute = Effect.fnUntraced(function* (automationID: AutomationSchema.ID, runID: AutomationSchema.RunID) {
      const initial = yield* automation.get(automationID)
      if (!initial) {
        yield* store.provide({ directory: "." }, finalize(runID, { status: "skipped", outcome: "cancelled" }))
        return
      }

      yield* store.provide({ directory: initial.directory }, Effect.gen(function* () {
        const current = yield* automation.get(automationID)
        if (!current) return yield* finalize(runID, { status: "skipped", outcome: "cancelled", unread: false })

        if (current.kind === "thread" && !current.targetSessionID) {
          return yield* finalize(runID, {
            status: "skipped",
            outcome: "session_unavailable",
            summary: "Thread automation has no target session",
            unread: true,
            timeFinished: Date.now(),
          })
        }

        let remainingDayTokens: number | undefined
        if (current.budgetPerDayTokens !== undefined) {
          const usedToday = yield* automation.tokensSince(current.id, startOfDay(Date.now()))
          remainingDayTokens = current.budgetPerDayTokens - usedToday
          if (remainingDayTokens <= 0) {
            return yield* finalize(runID, {
              status: "skipped",
              outcome: "budget_exhausted",
              summary: `Daily token budget exhausted (${usedToday}/${current.budgetPerDayTokens})`,
              unread: true,
              timeFinished: Date.now(),
            })
          }
        }

        const session =
          current.kind === "thread"
            ? yield* Effect.gen(function* () {
                const target = current.targetSessionID
                if (!target) return undefined
                return yield* sessions.get(SessionID.make(target)).pipe(Effect.orElseSucceed(() => undefined))
              })
            : yield* sessions.create({
                title: `[auto] ${current.name}`,
                agent: current.agent,
                model: current.model,
                permission: Profiles.ruleset(current.profile),
              })

        if (!session) {
          return yield* finalize(runID, {
            status: "skipped",
            outcome: "session_unavailable",
            summary: "Target session no longer exists",
            unread: true,
            timeFinished: Date.now(),
          })
        }

        yield* finalize(runID, { status: "running", sessionID: session.id, timeStarted: Date.now() })
        Budget.register({
          sessionID: session.id,
          runID,
          automationID: current.id,
          perRunTokens: current.budgetPerRunTokens,
          remainingDayTokens,
        })
        Unattended.mark(session.id)

        const exit = yield* prompts
          .prompt({
            sessionID: session.id,
            agent: current.agent,
            model: current.model ? { providerID: current.model.providerID, modelID: current.model.id } : undefined,
            system: preamble(current),
            parts: [{ type: "text", text: current.prompt }],
          })
          .pipe(
            Effect.timeoutOption(Duration.minutes(current.timeoutMinutes)),
            Effect.ensuring(
              Effect.sync(() => {
                Unattended.unmark(session.id)
                Claim.releaseSession(session.id)
              }),
            ),
            Effect.exit,
          )

        const usage = Budget.finish(session.id)
        const timedOut = Exit.isSuccess(exit) && Option.isNone(exit.value)
        const message = Exit.isSuccess(exit) && Option.isSome(exit.value) ? exit.value.value : undefined
        const interrupted = Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
        const reported =
          message && message.info.role === "assistant" ? messageError(message.info.error) : undefined

        let status: AutomationSchema.RunStatus = "done"
        let outcome: AutomationSchema.Outcome = "reported"
        let evidence: string | undefined
        let summary: string | undefined

        if (usage?.exceeded) {
          status = "failed"
          outcome = "budget_exceeded"
          summary = `Token budget exceeded (${usage.exceeded.scope}: used ${Math.round(usage.exceeded.used)} of ${Math.round(usage.exceeded.limit)})`
        } else if (timedOut) {
          status = "failed"
          outcome = "timed_out"
          summary = `Run exceeded the ${current.timeoutMinutes} minute limit`
        } else if (interrupted) {
          status = "failed"
          outcome = "cancelled"
          summary = "Run was interrupted"
        } else if (reported) {
          status = "failed"
          outcome = "provider_error"
          summary = reported
        } else if (message) {
          if (current.verification.length > 0) {
            const report = yield* Verification.run({ directory: current.directory, checks: current.verification })
            evidence = Verification.evidence(report)
            status = report.passed ? "done" : "failed"
            outcome = report.passed ? "verified" : "verification_failed"
            summary = report.passed
              ? `Verification passed (${report.results.length} check${report.results.length === 1 ? "" : "s"})`
              : `Verification failed (${report.results.filter((item) => item.exitCode !== 0).length} of ${report.results.length} checks)`
          } else {
            summary = (yield* lastAssistantText(session.id)) || undefined
          }
        } else {
          status = "failed"
          outcome = "provider_error"
          summary = Exit.isFailure(exit) ? errorSummary(exit.cause) : "Run failed"
        }

        const paused = outcome === "budget_exceeded"
        const finished = yield* finalize(runID, {
          status,
          outcome,
          ...(summary ? { summary } : {}),
          ...(evidence ? { evidence } : {}),
          tokensTotal: usage?.tokensTotal ?? 0,
          cost: usage?.cost ?? 0,
          unread: true,
          timeFinished: Date.now(),
        })
        const updated = yield* automation.update(current.id, {
          lastRunAt: Date.now(),
          ...(paused ? { status: "paused" as const } : {}),
        })
        yield* publishAutomation(updated ?? current)
        yield* Effect.logInfo("automation run finished", {
          automation: current.id,
          run: finished?.id,
          status,
          outcome,
        })
      }))
    })

    const start = Effect.fn("AutomationEngine.start")(function* (input: StartInput) {
      const id = input.automation.id
      if (active.has(id)) {
        return yield* skipped(input, "previous_run_active", "Previous run is still active")
      }
      active.add(id)

      const created = yield* store.provide(
        { directory: input.automation.directory },
        Effect.gen(function* () {
          const run = yield* automation.createRun({
            automationID: id,
            status: "queued",
            trigger: input.trigger,
            scheduledFor: input.scheduledFor,
          })
          yield* events.publish(AutomationSchema.Event.RunUpdated, { run }).pipe(Effect.ignore)
          return run
        }),
      )

      yield* execute(id, created.id).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("automation run crashed", { automation: id, cause: Cause.pretty(cause) }),
        ),
        Effect.ensuring(Effect.sync(() => active.delete(id))),
        Effect.forkIn(scope, { startImmediately: true }),
      )

      return created
    })

    AutomationTrigger.register({ start })

    return Service.of({ start })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [
    InstanceStore.node,
    Automation.node,
    Session.node,
    SessionPrompt.node,
    EventV2Bridge.node,
  ],
})

export * as AutomationEngine from "./engine"
