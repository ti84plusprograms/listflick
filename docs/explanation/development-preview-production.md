# Development, preview, and production

Development is an interactive local workflow: Metro serves JavaScript, the
backend usually runs on the developer's Mac, and a custom native development
client provides Firebase modules.

Preview is a remotely installable EAS internal build. It normally talks to the
Render backend and real shared services, so it is appropriate for acceptance
testing but not rapid source iteration.

Production is the release EAS profile and deployed backend configuration used
by real users. It must use durable PostgreSQL/Supabase services, production
Firebase credentials, and no developer client overrides.

An EAS build packages the mobile app; it does not deploy a second backend.
Render (or another backend host) is what makes the API online.

The tracked Render Blueprint provisions only the FastAPI web service. Resumable
analysis state is durable in PostgreSQL, while execution remains request-inline
and reconnect-driven. A paid autonomous worker is intentionally deferred.
