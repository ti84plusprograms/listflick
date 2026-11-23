# ListFlick documentation

This directory is the operational source of truth for developers, operators,
and contributors. It follows the [Diátaxis](https://diataxis.fr/) structure:

- [Tutorials](tutorials/README.md) teach a complete workflow.
- [How-to guides](how-to/README.md) solve a specific operational problem.
- [Reference](reference/README.md) describes commands, configuration, APIs,
  and contracts.
- [Explanation](explanation/README.md) describes architecture and design
  decisions.

## Documentation authority

When documentation conflicts, use this order:

1. Checked-in runtime configuration and code.
2. This documentation index and the linked reference pages.
3. The root `README.md` for project orientation.
4. Product specifications and context documents for product intent only.

`docs/AI_INSIGHTS_PRODUCT_SPEC.md` is retained as the active product
specification.

## Maintenance rule

Update the relevant reference page in the same change as any change to a
Makefile target, script, environment variable, API route, authentication,
image storage, deployment, logging behavior, setup step, or test command.

After changing code, run the repository tests and refresh Graphify according to
the repository `AGENTS.md` instructions. Do not commit secrets, generated
local `.env` files, Firebase service-account files, or installed local skills.

## Start here

- Product journey: [User-flow Mermaid source](user-flow.mmd) ([generated SVG](generated/user-flow.svg))
- New contributor: [Local development tutorial](tutorials/local-development.md)
- First end-to-end workflow: [Create your first listing](tutorials/first-listing.md)
- Local UI automation: [Local Maestro UI flows](how-to/maestro-create-listing.md),
  including [authentication and onboarding](how-to/maestro-auth-onboarding.md)
- Physical iPhone: [Mobile development build](tutorials/mobile-development-build.md)
- Daily commands: [Makefile reference](reference/makefile-commands.md)
- Deployment: [Preview and production deployment](how-to/preview-and-production-deployment.md)
- Notion integration check: [Validate Notion synchronization](how-to/validate-notion-synchronization.md)
- Broken images: [Image retrieval troubleshooting](how-to/image-retrieval-troubleshooting.md)
- Architecture: [System architecture](reference/architecture.md)
- Interrupted analysis: [Resumable analysis without a background worker](explanation/resumable-analysis.md)
- Legal and support: [Legal and support documents](legal/README.md)
