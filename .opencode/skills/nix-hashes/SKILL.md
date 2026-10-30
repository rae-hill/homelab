---
name: nix-hashes
description: Procedure for updating stale fetchYarnBerryDeps hashes in nix-config/modules/features/homelab-api/package.nix and homelab-ui/package.nix. Use after yarn add/remove/up or any yarn.lock change, or when a Nix build fails with 'fetchYarnDeps hash is out of date'.
---

# Updating Nix fetchYarnBerryDeps Hashes

When yarn dependencies change (adding/removing/updating packages), the Nix build hashes in the package derivations become stale and must be updated.

## Affected Files

- `nix-config/modules/features/homelab-api/package.nix`
- `nix-config/modules/features/homelab-ui/package.nix`

Both use the same `fetchYarnBerryDeps` hash since they share the same monorepo `yarn.lock`.

## Procedure

1. Set the hash to `lib.fakeHash` in both files:
   ```nix
   hash = lib.fakeHash;
   ```

2. Run the Nix build (either package works since they share the lock):
   ```sh
   nix build .#homelab-api
   ```

3. The build will fail with a hash mismatch. Extract the `got:` value from the error output:
   ```
   specified: sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
      got:    sha256-<actual-hash>=
   ```

4. Replace `lib.fakeHash` with the actual hash in both files:
   ```nix
   hash = "sha256-<actual-hash>=";
   ```

5. Verify the build succeeds:
   ```sh
   nix build .#homelab-api
   ```

## When This Is Needed

- After running `yarn add`, `yarn remove`, or `yarn up`
- After any change that modifies `yarn.lock`
- The Nix error message will say: `fetchYarnDeps hash is out of date`
