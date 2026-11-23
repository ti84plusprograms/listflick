<!-- legal-content-revision: 2026-09-05 -->
# Privacy policy

**Effective date:** September 5, 2026

ListFlick helps users turn item photos into draft
marketplace listings. This policy describes the information processed by the
current beta application.

## Information we process

- **Account information:** Firebase Authentication provides an account UID,
  email address, display name, and sign-in provider details when available.
- **Listing information:** item photos, generated analysis, listing titles,
  descriptions, prices, categories, conditions, profile defaults, and edits.
- **Technical information:** authentication tokens are sent to the backend for
  verification. The backend logs operational events such as request type,
  timing, and error category, but should not log passwords or ID tokens.
- **Optional Notion information:** when Notion synchronization is enabled,
  listing data and selected photos are sent to the configured Notion
  integration.

## How information is used

We use this information to authenticate users, generate and improve listing
drafts, store listings and images, display inventory, support deletion and
restoration workflows, and optionally synchronize listings to Notion.

Photos and listing content may be sent to the configured Gemini or Groq
provider to perform AI analysis. Those providers process requests under their
own terms and privacy policies. Do not upload sensitive personal information
that is not needed to create a listing.

## Where information is stored

The deployed service uses Firebase Authentication, Render for the FastAPI
backend, PostgreSQL for listing records, and private Supabase Storage for
deployed images. Local development may use local image storage. The mobile app
also keeps user-scoped listings, drafts, profile defaults, and Recently Deleted
records in local device storage.

## Sharing and external services

We share information only with the services required for the feature you use:

- Firebase Authentication for sign-in and account management;
- Gemini or Groq for requested AI analysis;
- Render, PostgreSQL, and Supabase for backend operation and storage; and
- Notion only when optional synchronization is enabled.

The application does not automatically post to Facebook Marketplace. It
prepares content and opens native sharing flows.

## Retention and deletion

You can use **Settings > Delete Account** to delete the Firebase account,
server-side listings, uploaded images, and local user-scoped listing data.
Listing records in Recently Deleted are included in this operation.

Copies already synchronized to your own Notion workspace are external copies
under your control. Delete those pages in Notion as well; the current shared
integration does not automatically delete external Notion pages when the app
account is deleted.

Backups, provider logs, or legally required records may persist for a limited
period under the applicable provider's retention rules.

## Security

The backend verifies Firebase ID tokens and scopes listing and image operations
to the verified UID. No security system is guaranteed to be perfect. Never
share passwords, Firebase service-account credentials, Supabase service-role
keys, or AI API keys.

## Children

The application is not directed to children under 13, and we do not knowingly
collect personal information from children under 13.

## Contact

For privacy questions or deletion problems, email aaryaman04@gmail.com. Do not
include passwords, tokens, API keys, raw logs, or private item photos. Ordinary
email may not be appropriate for sensitive information.

We may update this policy as the product changes. The effective date above will
change when a material update is published.
