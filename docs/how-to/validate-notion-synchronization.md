# Validate Notion synchronization

Use this procedure to validate the deployment-level Notion integration against
a controlled destination. It creates and updates a real Notion page. Do not run
it against a production destination without approval from its owner.

## Prepare the controlled environment

1. Use a non-production backend and a Notion data source with the marketplace
   schema expected by `backend/app/services/notion_service.py`.
2. Share the parent database with the Notion integration so it can create,
   update, and query pages.
3. Configure `NOTION_API_KEY` and either `NOTION_DATA_SOURCE_ID` or
   `NOTION_DATABASE_ID` as backend-only secrets.
4. Set `NOTION_CREATE_ENTRIES=true`. Enable
   `NOTION_ALLOW_CLIENT_OVERRIDE` only when testing the development override.
5. Deploy the backend so startup migration 10 adds the Notion lease and
   reconciliation columns.

Do not place secrets, destination identifiers, Firebase tokens, or raw provider
responses in screenshots or committed evidence.

## Capture the capability and initial save

1. Request `GET /health` and confirm `notion_capability.reason` is `configured`.
2. Sign in through a development build as the owner of a test item.
3. Save the test listing and record its app item ID.
4. Confirm the save response reports `notion_sync.status: synced` and includes a
   page ID. The inventory save must remain successful independently of Notion.
5. Request `GET /api/items/{item-id}` with the same Firebase identity. Confirm
   the persisted status, page ID, attempt timestamp, and success timestamp match
   the save result.
6. Open the resulting page in Notion and confirm its **Reason for Selling** value
   contains `Created from app item <item-id>.`.

## Validate retry and uniqueness

1. Call `POST /api/items/{item-id}/notion/retry` as the same owner.
2. Confirm the response remains `synced` and returns the same page ID.
3. Query or inspect the controlled data source and confirm exactly one page
   contains the app item marker.
4. Reopen the listing after restarting the development app. Confirm Review
   reloads the persisted Notion state and still opens the same page.
5. Review backend logs for the item ID and safe result category. Confirm no
   credential, provider response body, upload URL, or private storage path was
   recorded.

For an ambiguous-create exercise, use a controlled network fault after the
provider accepts the create request. Do not retry blindly: confirm the next
request logs reconciliation and restores the same page ID without another page.

## Record closure evidence

Keep a sanitized record of:

- the safe `/health` capability;
- the owner-scoped save and item responses;
- the retry response;
- the one matching Notion page; and
- the relevant redacted log lines.

Restore `NOTION_CREATE_ENTRIES=false` and redeploy when the controlled backend
should stop writing to Notion. This switch does not delete pages already
created during validation.
