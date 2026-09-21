import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"

export const Parameters = Schema.Struct({
  questions: Schema.mutable(Schema.Array(Question.Prompt)).annotate({ description: "Questions to ask" }),
  timeoutSeconds: Schema.optional(Schema.Number).annotate({
    description:
      "Seconds to wait for an answer before proceeding with the first (recommended) option. 0 decides immediately. Defaults to the configured question.timeout_seconds (300 seconds).",
  }),
})

type Metadata = {
  answers: ReadonlyArray<Question.Answer>
  source: Question.Resolution
}

export const QuestionTool = Tool.define<typeof Parameters, Metadata, Question.Service>(
  "question",
  Effect.gen(function* () {
    const question = yield* Question.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const result = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: params.questions,
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
            timeoutSeconds: params.timeoutSeconds,
          })

          const formatted = params.questions
            .map((q, i) => `"${q.question}"="${result.answers[i]?.length ? result.answers[i].join(", ") : "Unanswered"}"`)
            .join(", ")

          return {
            title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
            output: renderOutput(result, formatted),
            metadata: {
              answers: result.answers,
              source: result.source,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function renderOutput(result: Question.Result, formatted: string) {
  if (result.source === "timeout")
    return `The deadline passed before the user answered; the runtime assumed the first (recommended) option: ${formatted}. Continue with that assumption and state it when you report back.`
  if (result.source === "unattended")
    return `No user was available to answer (unattended session); the runtime assumed the first (recommended) option: ${formatted}. Continue with that assumption and state it when you report back.`
  if (result.source === "skipped")
    return `The user skipped these questions. Proceed with your own best judgment and state any assumptions you make: ${formatted}.`
  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`
}
