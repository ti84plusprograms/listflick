# Use the Git workflow

Before starting work, inspect `git status --short`, the current branch, and
the recent decorated log. Create a focused branch from an up-to-date base
branch. Preserve unrelated worktree changes; do not reset or discard them
without explicit approval.

Split commits by coherent concern, such as backend behavior/tests, mobile
behavior/tests, and documentation/generated graph updates. Before each commit,
review the diff, run tests, and use `git diff --check`.

Do not commit `.env`, service-account credentials, build output, local virtual
environments, or installed skills. Push only after local review. After a pull
request is merged, verify remote containment and fast-forward the local base
branch before deleting the feature branch.
