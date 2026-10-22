# Aladdin context retention

The installed desktop uses the V1 session backend. For continuity in long chats,
keep automatic compaction enabled and disable background tool-result pruning in
the user configuration:

```json
{
  "compaction": {
    "auto": true,
    "prune": false
  }
}
```

Pruning is independent of the model's context limit. Enabling it can clear older
tool results while considerable context space remains.

By default, compaction preserves recent complete turns within one quarter of the
usable context budget, with a 2,000-token minimum. An explicit
`preserve_recent_tokens` value or `tail_turns` limit still takes precedence.
Retention uses the same runtime output reservation as the overflow check.

For `opencode-go/mimo-v2.6-flash` with 524,288 context tokens, no separate input
cap, and a 32,000-token output reservation, automatic compaction starts at 492,288
reported tokens. The default verbatim tail budget is 123,072 tokens, plus the
summary of older conversation. These are local harness budgets, not proof that
an upstream route accepts a request of that size.

Changing the policy does not rewrite previous summaries or previously pruned tool
markers. The full original tool output remains stored locally; rereading relevant
files or rerunning a read-only tool can bring needed details back into a prompt.
