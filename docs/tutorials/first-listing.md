# Create your first listing

1. Start the backend and mobile development client.
2. Sign in through Firebase Authentication.
3. From Home, take or select one or more photos.
4. Wait for upload and AI analysis to finish. You may return Home and use
   **Resume listing** to continue an unfinished operation.
5. Review the generated title, description, condition, category, price, and
   image feedback. Swipe the image preview horizontally to inspect each photo;
   its dot indicator and **Photo N of M** accessibility label follow the
   settled photo.
6. Edit fields or manage photos if needed.
7. Save the listing. The backend persists it and optionally syncs it to Notion.
8. Find saved listings in Inventory.

Images begin in pending storage. Saving promotes them to permanent storage.
If saving fails, inspect backend storage and promotion logs before retrying.

The app records the operation before upload and reuses its idempotency key. If
the upload response or analysis request times out, choose **Try Again** or
resume from Home; do not start a separate photo flow. **Discard Listing** is
the explicit way to delete the pending server item and images.

For a local first run, leave `NOTION_CREATE_ENTRIES=false`. Enable Notion only
after the listing flow works without it.
