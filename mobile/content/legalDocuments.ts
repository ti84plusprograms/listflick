export const LEGAL_CONTENT_REVISION = "2026-09-05";

export const PRIVACY_POLICY_MARKDOWN = `<!-- legal-content-revision: 2026-09-05 -->
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

Photos and listing content may be sent to the configured Gemini, Groq, or
Claude (Anthropic) provider to perform AI analysis. Those providers process
requests under their own terms and privacy policies. Do not upload sensitive personal information
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
- Gemini, Groq, or Claude (Anthropic) for requested AI analysis;
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
`;

export const TERMS_OF_USE_MARKDOWN = `<!-- legal-content-revision: 2026-09-05 -->
# Terms of use

**Effective date:** September 5, 2026

These terms govern use of ListFlick, a beta tool for
creating draft marketplace listings.

## The service

The application accepts item photos and details, generates listing drafts, and
provides editing, inventory, sharing, and optional Notion synchronization.
Features may change, be unavailable, or be removed while the application is in
beta.

## Your responsibilities

You must:

- use an account and information that you are authorized to use;
- upload only photos and content you have the right to process;
- review every generated title, description, price, condition, and claim before
  sharing or publishing it;
- avoid uploading sensitive personal information that is unrelated to the
  listing; and
- comply with Facebook Marketplace rules, local law, and the rules of any
  service you use with generated content.

AI-generated content can be incomplete or incorrect. The application does not
verify ownership, authenticity, condition, pricing, safety, legal compliance,
or buyer suitability. You are responsible for the final listing and any
transaction that follows.

## Prohibited use

Do not use the application to violate law or another service's terms, upload
malware, attempt unauthorized access, interfere with the service, abuse AI or
storage resources, or submit content that you do not have permission to use.

## Third-party services

The application depends on Firebase, Render, PostgreSQL, Supabase, AI
providers, and optionally Notion. Their availability and terms are outside our
control. Notion copies and marketplace posts are governed by those services'
accounts and terms.

## Account deletion and termination

You may delete your account from **Settings > Delete Account**. This removes
the application account, server listings, uploaded images, and local
user-scoped listing data. External Notion pages must be deleted in Notion.

We may suspend or terminate access for abuse, security reasons, legal
requirements, or material violations of these terms.

## Disclaimer and liability

The beta service is provided on an "as available" basis. To the extent allowed
by law, we disclaim warranties and are not responsible for losses arising from
reliance on generated content, listing errors, marketplace activity, service
interruptions, or third-party services.

## Changes

We may update these terms as the product changes. Continued use after an
updated effective date means you accept the updated terms.

## Contact

Questions and support requests can be sent to aaryaman04@gmail.com. Do not
include passwords, tokens, API keys, raw logs, or private listing data. Ordinary
email may not be appropriate for sensitive information.
`;
