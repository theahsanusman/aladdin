import { createMemo } from "solid-js"

export function workerInteractionMemo<T extends { interaction: { id: string; generation: number } }>(
  read: () => T | undefined,
) {
  // A durable interaction's payload is immutable within its generation. Keep
  // the dock mounted when polling returns another projection of that request.
  return createMemo(read, undefined, {
    equals: (previous, next) =>
      previous === next ||
      (!!previous &&
        !!next &&
        previous.interaction.id === next.interaction.id &&
        previous.interaction.generation === next.interaction.generation),
  })
}
