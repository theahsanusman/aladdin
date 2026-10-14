# Official connector mechanics

The configured server is `trello` at `https://mcp.trello.com/v1`. The authenticated automation account is `@aladdin`; HQ belongs to UnicronX Labs. Resolve current IDs from `workflow.json` and live reads. Check the live catalog if capabilities change.

## IDs and complete reads

- Use the verified `boardAri`, `listAris` and `labelAris` in `workflow.json`. Do not pass the raw IDs under `objectIds` to MCP. Read an explicit card URL to obtain its returned full `id` before writing. Write tools require a full ARI; `trelloReadList` also requires one even though it is a read tool.
- Board/list/card/label ARIs include the workspace: `ari:cloud:trello::card/workspace/<workspaceId>/<objectId>` (replace `card` with the appropriate entity).
- Aladdin prefixes these server tool names with `trello_`. For the initial board overview, copy the arguments from `readRequests.boardCards`; for lists or labels, use `readRequests.boardLists` or `readRequests.boardLabels`.

| Operation | Server tool | Required identifier field |
| --- | --- | --- |
| Cards grouped by board list | `trelloReadCard`, `action: list_by_board` | `boardIdOrUrl: workflow.boardAri` |
| Board lists | `trelloReadList`, `action: list_by_board` | `boardId: workflow.boardAri` |
| Board labels | `trelloReadBoard`, `action: list_labels` | `boardId: workflow.boardAri` |
| Card details, comments, attachments or activity | `trelloReadCard`, corresponding action | `cardIdOrUrl: <returned card ARI>` |
| Card checklists | `trelloReadChecklist`, `action: list_by_card` | `cardId: <returned card ARI>` |
| Move a card | `trelloWriteCard`, `action: move` | `cardId: <card ARI>`, `listId: <destination list ARI>` |

The two `list_by_board` tools use different parameter names. For `trelloReadCard`, passing `boardId` fails even when its value is a valid ARI. For `trelloReadList`, passing a raw 24-character ID fails even when the parameter is named correctly. These are argument errors, not authentication failures. Compare the request with this table and the live schema before one corrected retry; do not repeat an unchanged invalid request.

- `trelloReadCard` supports `get`, `list_by_board`, `list_by_list`, `list_comments`, `list_attachments` and `list_activity`. `trelloReadList` enumerates board lists. Read checklists separately with `trelloReadChecklist` (`list_by_card`); the verified card-get response did not embed an existing checklist.
- Follow every pagination flag (`hasNextPage`, `hasMore`) and its returned cursor. A card's embedded comments/labels can be truncated; read the relevant collection separately when its `HasMore` flag is set. Never interpret a first page as the complete backlog or discussion.
- `list_by_board` groups cards under lists; its nested cards can have null `listId`. Use the enclosing list's ID or fetch the individual card before a write.
- `trelloReadMember` can verify the owner's username before an `@mention`. Account timezone can be null; use the actual chat/user timezone for relative deadlines, then write UTC ISO 8601 timestamps.

## Writes and browser fallback

- `trelloWriteCard` supports create/update/move/archive, attach/detach existing labels, add/update comments and `mark_done`. `trelloWriteChecklist` creates checklists and adds/completes items. `trelloWriteList` creates and repositions lists.
- The verified catalog has no label-creation or attachment-upload tool. Create a missing project label or upload an authorized local file through the authenticated Trello interface in Agent Chrome. Check first for an existing label to avoid duplicates.
- `list_attachments` returns metadata and URLs, not image/file bytes. Open the attachment in Agent Chrome or retrieve its content through available authenticated tools. View the actual image or parse the actual document before using it. Do not treat an attachment's title as its contents.
- Preserve private attachment authentication. Do not copy browser cookies or OAuth credentials into card comments, URLs, repository files or general configuration.

After each uncertain write, read the current state before retrying. A repeated claim comment or failed move does not establish exclusive ownership. Lost authorization is a connection problem, not an empty board.
