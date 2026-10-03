# Michael worker recovery contract

The lead's executing assistant turn owns provider, model and reasoning variant. User-facing task tools copy that immutable turn snapshot; worker arguments cannot select a different model. A retry retains the accepted task snapshot. Fresh dispatch after changing the lead uses the new selection.

A desktop sidecar restart restores the same HTTP address and private persisted password. The supervisor joins shutdown and suppresses restarts when the application quits. Unexpected failures receive bounded backoff, with a visible connection failure if recovery cannot start the service.

Worker runtime epochs created by this build include their process ID. Startup does not interrupt a known still-live host. After a known host has exited, research/report attempts are fenced and reconciled as failed, freeing slots without retrying provider work. Coding attempts retain ownership until the user confirms the old app/process stopped and workspace side effects were reviewed. Legacy epochs without process identity require that same explicit acknowledgement. A user-requested retry creates a new worker/input identity after safe reconciliation; generation checks reject stale clicks. No V2 drain or unknown provider continuation is automatically replayed.

Root result cards are read from the durable task ledger. They appear in the main chat view without generating an extra provider turn or inserting an invented lead response. Reconnect/focus refresh restores missed live notices. Failures and interrupted work remain visible and actionable. Results are not independently factual merely because a nonempty check passed.

A bounded endurance run checks many admission/settlement cycles, pause/resume, restart fencing and exactly-once results. It cannot establish 24 hours of wall-clock operation. The optional long-run harness must measure that duration before a 24-hour claim can be made.
