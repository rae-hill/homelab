# Updating Nix fetchYarnBerryDeps Hashes

When yarn dependencies change (adding/removing/updating packages), the Nix build hashes in the package derivations become stale and must be updated.

## Affected Files — ALL FOUR share ONE hash

- `nix-config/modules/homelab/homelab-api/package.nix`
- `nix-config/modules/homelab/homelab-ui/package.nix`
- `nix-config/modules/homelab/homelab-resume-site/package.nix`
- `nix-config/modules/ai/ai-openclaw/mail-mcp-package.nix`

All four use an identical nix-filter `src` and the same monorepo `yarn.lock` +
`missing-hashes.json`, so `fetchYarnBerryDeps` is the same fixed-output derivation
everywhere: **one hash value, copied into all four files**. Refresh them together —
grep for `fetchYarnBerryDeps` under `nix-config/` to confirm no fifth site appeared.
A site left stale only fails when its consumer is next built (e.g. resume-site at
augustus deploy time, mail-mcp only on mini), which is how the 2026-11-22 miss happened.

## Procedure

1. Set the hash to `lib.fakeHash` in all four files:
   ```nix
   hash = lib.fakeHash;
   ```

2. Run the Nix build (any of the x86_64-linux packages works since they share the lock):
   ```sh
   nix build .#homelab-api
   ```

3. The build will fail with a hash mismatch. Extract the `got:` value from the error output:
   ```
   specified: sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
      got:    sha256-<actual-hash>=
   ```

4. Replace `lib.fakeHash` with the actual hash in all four files:
   ```nix
   hash = "sha256-<actual-hash>=";
   ```

5. Verify the builds succeed (mail-mcp is aarch64-darwin-only and cannot be built on
   x86_64-linux; the FOD is platform-neutral, so the shared hash applies — mini's next
   deploy is its verification):
   ```sh
   nix build .#homelab-api .#resume-site
   ```

## When This Is Needed

- After running `yarn add`, `yarn remove`, or `yarn up`
- After any change that modifies `yarn.lock` (INCLUDING merges between branches that
  each touched dependencies — the merged lockfile is a new lockfile)
- The Nix error message will say: `fetchYarnDeps hash is out of date`
