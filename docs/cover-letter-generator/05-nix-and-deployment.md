# 05 — Nix, Assets & Deployment

Covers CL-T8 (+ the CL-T1 `yarn.lock` consequence). No new ports, no firewall changes, **no new
sops secrets** — the OpenRouter key (`OPENROUTER_API_KEY_FILE`) is reused as-is. Load the
`nix-services`, `nix-hashes`, and `validation` skills when implementing. Remember: `git add` any
new `.nix` files before `nix eval`/`nix build` (flake evaluates the git tree).

## A) `nix-config/modules/homelab/homelab-api/package.nix` — native closure + assets

The typst compiler is the SECOND native napi dependency (after `sharp`); the install phase already
documents that pattern — extend it, and **fix one latent hazard first**:

1. **⚠ patchelf loop hazard (must fix in this task):** the existing addon loop
   `find $out/lib/bundle/node_modules -type f -name "*.node"` applies the **sharp-specific**
   `$ORIGIN/../../sharp-libvips-*` RPATH to EVERY `.node` file it finds. Once
   `@myriaddreamin/typst-ts-node-compiler-linux-x64-gnu` is copied in, that loop would stamp a
   nonsense RPATH onto the typst binding. Scope the sharp loop to `node_modules/sharp` +
   `node_modules/@img`, then add a separate loop for `node_modules/@myriaddreamin/**/*.node`
   setting `--set-rpath '${glibc}/lib:${stdenv.cc.cc.lib}/lib'` (Rust napi binaries need
   glibc/libstdc++, no `$ORIGIN` chain).
2. **Copy the closure** (mirror the sharp block, hoisted-vs-nested aware):
   ```nix
   mkdir -p $out/lib/bundle/node_modules/@myriaddreamin
   cp -rL node_modules/@myriaddreamin/typst-ts-node-compiler $out/lib/bundle/node_modules/@myriaddreamin/
   for pkg in node_modules/@myriaddreamin/typst-ts-node-compiler-*; do
     [ -d "$pkg" ] || continue   # optional deps: only the build platform is present
     cp -rL "$pkg" "$out/lib/bundle/node_modules/@myriaddreamin/"
   done
   ```
   Works for both flake outputs: x86_64-linux pulls `-linux-x64-gnu`, aarch64-linux `-linux-arm64-gnu`
   (napi optionalDependencies resolve per build platform, same as `@img/*`).
3. **Fail-closed smoke test** (sharp's `node -e` precedent) — the binding must load AND compile in
   the sandbox (no network needed; plain typ, no `@preview` import):
   ```nix
   (cd $out/lib/bundle && node -e "
     const { NodeCompiler } = require('@myriaddreamin/typst-ts-node-compiler');
     const c = NodeCompiler.create({});
     const pdf = c.pdf({ mainFileContent: 'Hello, typst!' });
     if (pdf.subarray(0,4).toString() !== '%PDF') { console.error('bad pdf'); process.exit(1); }
     console.log('typst runtime closure OK');")
   ```
   This also permanently guards the CJS-named-import-from-ESM question (doc 02) at the bundle level.
4. **Assets** (template, signature, vendored letterloom — CL-D5/D9): the `nix-filter` src already
   includes `packages/` wholesale, so:
   ```nix
   cp -r packages/homelab-services-node/assets/typst $out/lib/typst-assets
   ```
5. **Hashes:** `yarn add @myriaddreamin/typst-ts-node-compiler@0.7.0` changes `yarn.lock` ⇒ run the
   **`nix-hashes` skill** for `homelab-api/package.nix` (`fetchYarnBerryDeps`) before any build.

## B) `nix-config/modules/homelab/homelab-api/systemd-service.nix` — env

New module options + `environment` entries (the `CHROME_EXECUTABLE` pattern, ~line 252):

```nix
typstAssetsDir = mkOption {
  type = types.nullOr types.str;
  default = null;   # hosts opt in explicitly (chromeExecutable posture); augustus sets
                    # "${inputs.self.packages.<system>.homelab-api}/lib/typst-assets"
  description = "Typst template/asset root (TYPST_ASSETS_DIR): letter.typ template,
    signature image, and vendor/letterloom-3.0.0 imported BY PATH (no universe-package
    resolution, no XDG env). null ⇒ cover-letter rendering dark.";
};
```

```
TYPST_ASSETS_DIR=${cfg.typstAssetsDir}
```

- The initial design also exported `XDG_DATA_HOME=${cfg.typstAssetsDir}` so the typst.ts
  `HttpRegistry` would resolve `@preview/letterloom` offline; the SHIPPED design imports
  letterloom by path, so no XDG env exists anywhere (a vitest run proved the hazard real:
  XDG_DATA_HOME pointed at a writable dir gets polluted — `vitest/`, `mimeapps.list`).
- `OPENROUTER_COVER_LETTER_MODEL`: code default ships (`anthropic/claude-sonnet-5.5`); add to the
  unit's environment only when the owner wants an override (same posture as `OPENROUTER_MODEL`).
- Feature flag: augustus runs `FEATURE_FLAGS=*` ⇒ `Resume_CoverLetter.enabled` automatically.
  **praeconinus**: explicit flag list omits `Resume_*` — verify NO change adds it (stays dark).
- NOTE (found during CL-T8): the module's pre-existing `services.homelab-api.pkg` option is a
  latent `mkPackageOption` misuse that THROWS when forced ("type lambda") — nothing read it
  before; augustus's `typstAssetsDir` therefore references the flake package directly. Fix the
  declaration separately if anything else ever needs it.

## C) Identity — kanidm group + claim (CL-D4)

Follow the `homelab.resume.tailoring` precedent end-to-end (tailor-harness doc 05, commit
`9727a4ceb1ff`):

1. kanidm group `homelab.resume.coverletter` (same module that declares the tailoring group).
2. Claim mapping in the homelab-api OIDC client config (`features/homelab-api/oidc.nix` per the
   corrected-facts table): group → `Resume_CoverLetter` role claim, beside the existing
   `Resume_Print` / `Resume_Tailor` mappings.
3. Add the owner's account to the group (same member set as tailoring).

Frontend constant `RESUME_COVER_LETTER_ROLE` (doc 04) must match the claim string exactly.

## D) Devshell + e2e bootstrap (as built — revised during CL-T8)

- **Devshell (`flake.nix`)**: `TYPST_ASSETS_DIR` is deliberately **NOT exported shell-wide**.
  The first attempt used `${self}/packages/...`, but `${self}` freezes the assets into a
  read-only STORE snapshot (stale on template edits), and a global `XDG_DATA_HOME` (since
  removed entirely — path imports) repointed every shell tool's data dir. Consumers resolve
  the live worktree assets themselves:
  - `scripts/e2e.sh` exports `TYPST_ASSETS_DIR` unconditionally from `repo_root`
    (git rev-parse — the script's existing root-resolution idiom).
  - The gated vitest live-render test
    (`homelab-services-node/test/document-rendering-service-typst-live.test.ts`) defaults
    to the repo-relative assets dir via `import.meta.dirname`.
  - Manual server runs: `TYPST_ASSETS_DIR=$PRJ_ROOT/packages/homelab-services-node/assets/typst
    yarn workspace homelab-server dev` (PRJ_ROOT is the devshell's live project root).
- **`scripts/stage-e2e-secrets.mjs`**: `.env-serve-test` gains `TYPST_ASSETS_DIR`
  (relative `../../packages/...` — the same convention as `ROOT_CERT_DER`; resolved against
  the server's cwd) and the e2e `TEST_API_KEY` gains the `Resume_CoverLetter` permission.
  dotenvx never overrides the absolute value e2e.sh exports, so the file is a fallback for
  manual server runs only.
- **`RUN_COVER_LETTER_LIVE=1`** stays OPT-IN (spends real OpenRouter money,
  `RUN_TAILOR_LIVE` precedent) and additionally requires the staged
  `OPENROUTER_API_KEY_FILE`. `COVER_LETTER_SAMPLE_PATH` writes the PDF artifact
  (`DOCX_SAMPLE_PATH` idiom). Zero-spend full-stack alternative (used for CL-T9
  verification): point `OPENROUTER_BASE_URL` at a local stub that branches on
  `response_format.json_schema.name` (`CleanupResponse` vs `CoverLetterGeneration`).
- **Testing layers**: `TYPST_ASSETS_DIR` default `Option.none()` (dark) in both
  `test-utils/testing-layer.ts` files; the live-render test provides its own env.

## E) Vendored-repo bookkeeping

`repos/typst.ts` (tag `v0.7.0`, shallow submodule) is committed (`08a46ecfd`). Remaining: add the
row to BOTH vendored-repo tables — `AGENTS.md` ("Vendored App Source — Prefer Over Web Docs") and
`.opencode/skills/effect-services/SKILL.md`:

| Question about | Resolves to |
| --- | --- |
| typst.ts node compiler behavior (`NodeCompiler`, universe-package resolution, fonts, PDF export, diagnostics) | `./repos/typst.ts/` (Myriad-Dreamin/typst.ts, tag `v0.7.0` = the `@myriaddreamin/typst-ts-node-compiler` pin) |

## F) Deploy checklist (augustus)

1. `nix-hashes` updated; `nix build .#checks.x86_64-linux.shellcheck` + full validation green.
2. kanidm group + claim deployed; owner account in the group; re-login refreshes the id_token claims.
3. Deploy host config: unit has `TYPST_ASSETS_DIR`; smoke line in build log
   reads `typst runtime closure OK`.
4. Manual: tailor a listing → Actions tab → download (expect cleanup `cache hit` in the
   journal/Tempo span on the cover-letter request) → open PDF: letterloom layout, signature
   image present, correct date, subject bolded.
5. Watch the first few runs in Tempo: spans `CoverLetterService.*`,
   `DocumentRenderingServiceTypst.renderPdf`; journal warnings for typst font fallbacks (README OQ2).

**Rollback / dark switches** (independent, no redeploy of code needed):
- `FEATURE_FLAGS` minus `Resume_CoverLetter.enabled` ⇒ endpoint 403s (flag check in `canCreate`).
- `TYPST_ASSETS_DIR` unset ⇒ rendering layer fails fast; tailor/print unaffected.
- Claim/group removal ⇒ UI hides the button (role hook) and server rejects.

## Cross-references

- **Doc 02** — asset layout the paths above point at; rolldown externals (repo side).
- **Doc 03** — env var names + testing-layer updates.
- **`../resume-tailor-harness/05-nix-and-secrets.md`** — sops/env-template + kanidm claim mechanics.
- Skills: `nix-hashes`, `nix-services`, `port-assignments` (no-op here — nothing new listens),
  `validation`.
