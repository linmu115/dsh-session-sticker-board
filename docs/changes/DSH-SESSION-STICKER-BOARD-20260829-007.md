# 0.3.0 - DSH 0.1.2-alpha.1 Conversation identity migration

- Removed the deleted `dsh-client-runtime` dependency and client injection.
- Deep links now resolve native Chat nodes by durable node `id`, then scroll using the current Chat key.
- Declares the alpha Session Controller and Chat UI capabilities through `dsh.client.inject`, without creating npm install constraints.
- No RC2 compatibility shim is retained.

Verification: typecheck, deep-link regression tests, client bundle build, and package dry run.
