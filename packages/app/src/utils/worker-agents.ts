type Agent = { name: string; hidden?: boolean }

export function workerAgents<T extends Agent>(agents: readonly T[]) {
  return agents.filter((agent) => !agent.hidden && agent.name === "michael")
}

export function workerAgent(agents: readonly Agent[], _selected?: string, _current?: string) {
  const eligible = workerAgents(agents)
  return eligible[0]?.name
}
