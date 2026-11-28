# Support and data deletion

## Support channel

In the mobile app, select **Settings > Contact Support** to open a prefilled,
user-editable email to:

`aaryaman04@gmail.com`

If the device has no configured email handler, use **Copy Email** or **Copy
Template** and paste the result into a preferred email app. Opening the composer
does not mean a message was sent.

The template includes the app version, device platform, and prompts for the
action that failed and the user-facing error. It never adds account identifiers,
listing data, logs, tokens, API keys, or photos automatically. Do not add those
private values manually; ordinary email may not be appropriate for sensitive
information.

## In-app account deletion

Signed-in users can select **Settings > Delete Account**. After confirmation,
the application:

1. verifies the Firebase identity on the backend;
2. removes the user's stored image and video objects;
3. deletes the user's PostgreSQL listing records, including Recently Deleted
   records;
4. deletes the Firebase Authentication account; and
5. clears the user's local listings, drafts, profile, and Recently Deleted data
   before signing out.

The operation is permanent. Stored images and videos, including incomplete
uploads, are removed before listing records. If that cleanup or record deletion
fails, the application reports the failure and leaves you signed in so you can
retry; some images may already have been removed. If the records and images were
deleted and only the final Firebase step fails, the app clears its local data
and signs you out anyway, since the server-side account data no longer exists.

## Notion copies

Optional Notion synchronization creates copies in the configured Notion
workspace. Because the current integration is shared rather than a
user-authorized Notion connection, account deletion does not delete those
external pages. Delete them directly in Notion or include their page links in a
support request.

## Manual fallback

If the in-app action is unavailable, email `aaryaman04@gmail.com` directly and
request account deletion without including credentials or private listing data.
Support will verify account ownership before processing the request.
