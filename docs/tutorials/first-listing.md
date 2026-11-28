# Create your first listing

1. Start the backend and mobile development client.
2. Sign in through Firebase Authentication.
3. From Home, tap **New listing** (or **Make your first listing**) and take
   or select one or more photos. Optionally switch the camera to Video to
   record a clip of up to 60 seconds, or pick a video from the library. A
   listing holds one video; a second one replaces the first.
4. Wait for upload and AI analysis to finish. You may return Home and tap the
   **Unfinished listing** row under **Needs attention** to continue an
   unfinished operation. Several unfinished listings can exist at once, each
   with its own row.
5. Review the generated title, description, condition, category, price, and
   image feedback. Swipe the image preview horizontally to inspect each photo;
   its dot indicator and **Photo N of M** accessibility label follow the
   settled photo. If you added a video, it is the last slide.
6. If the review screen shows questions about price or details a buyer would
   ask, choose an answer to update the listing, or choose **Skip for now**.
7. Edit fields or manage photos and the video if needed. The edit screen
   offers AI rewrite actions such as **More searchable title** and **Shorter
   description**.
8. Save the listing with **Save to Inventory**. The backend persists it and
   optionally syncs it to Notion.
9. Find saved listings in Inventory. On Home, saved listings with open
   checklist items appear under **Needs attention** and the rest under
   **Ready to post**.

Images begin in pending storage. Saving promotes them to permanent storage.
If saving fails, inspect backend storage and promotion logs before retrying.

The app records the operation before upload and reuses its idempotency key. If
the upload response or analysis request times out, choose **Try Again** or
resume from Home; do not start a separate photo flow. **Discard Listing** is
the explicit way to delete the pending server item and images.

For a local first run, leave `NOTION_CREATE_ENTRIES=false`. Enable Notion only
after the listing flow works without it.
