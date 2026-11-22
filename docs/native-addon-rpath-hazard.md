# Native npm Addons on NixOS: RPATH, the sharp Closure, and an Unscoped `find` That Almost Mis-Patched typst

Status: **hazard fixed 2026-11-19** (CL-T8, commit `3e62a1981`) while adding the second native
addon (`@myriaddreamin/typst-ts-node-compiler`) to the homelab-api bundle.
Location: `nix-config/modules/homelab/homelab-api/package.nix` installPhase.

## TL;DR

The install phase patched the RPATH of **every** `.node` file under `node_modules` with a
sharp-specific search path (`$ORIGIN/../../sharp-libvips-*/lib:...`). That was harmless while
sharp was the only native addon. The moment the typst compiler's addon was copied in, the
unscoped `find` would have stamped sharp's layout assumptions onto an unrelated binary. It
"would have worked" only by accident (the glibc/libstdc++ tail of the RPATH string is what the
typst addon actually needs). The fix: scope each patchelf loop to its own package, give each
native dep an explicit RPATH derived from its real `DT_NEEDED` list, and prove the closure with
a fail-closed build-time smoke test.

## Background: why prebuilt native addons break on NixOS

A Node native addon (`*.node`) is just an ELF shared library that node `dlopen()`s. Like any
ELF object it declares its dependencies in `DT_NEEDED` (`libc.so.6`, `libgcc_s.so.1`, …), and
the dynamic loader (`ld.so`) must _find_ those files at load time.

On a conventional distro the loader searches, roughly:

1. `DT_RPATH` (deprecated, only if no `DT_RUNPATH`)
2. `LD_LIBRARY_PATH`
3. `DT_RUNPATH`
4. the ldconfig cache (`/etc/ld.so.cache`)
5. default dirs `/lib`, `/usr/lib`, `/lib64`, `/usr/lib64`

NixOS has **none of the usual filesystem layout**: no `/lib64/ld-linux-x86-64.so.2`, no
`/usr/lib`, and (by design) no ldconfig cache for foreign binaries. Every library lives at an
absolute store path like `/nix/store/fsd4…-glibc-2.42-100/lib/libc.so.6`. A prebuilt binary
from npm — compiled against the FHS — therefore can't resolve its `DT_NEEDED` entries and dies
at load with `cannot open shared object file: No such file or directory`.

Two tools fix this:

- **`patchelf --set-rpath`** rewrites the binary's `DT_RUNPATH` (or `DT_RPATH`) to point at the
  actual store paths.
- **`$ORIGIN`** — a special RUNPATH token meaning "the directory containing _this_ object" —
  lets relocated trees stay internally relative (essential when the bundle is copied into
  `$out`, since the store path isn't known at patch time… it IS known in `$out`, but `$ORIGIN`
  keeps sibling packages resolvable regardless of where the closure is copied).

One subtlety worth knowing: **`DT_RUNPATH` is not transitive** — it applies only to the object
carrying it, not to that object's dependencies (unlike the older `DT_RPATH`, which the whole
load chain inherits). That's why _each_ binary in a chain (`sharp.node` → `libvips-cpp.so` →
glibc) needs its own correct RUNPATH.

## How the homelab-api package ships sharp (the working precedent)

`packages/homelab-server` bundles with rolldown, keeping native addons **external**
(`rolldown.config.js`: `external: ["sharp", /^@img\//, "@myriaddreamin/typst-ts-node-compiler",
/^@myriaddreamin\//]`) — a bundler can't inline `.node` binaries, and sharp is `require()`d
lazily at runtime anyway. The nix installPhase then:

1. copies `node_modules/sharp` + its hoisted/nested deps + the build-platform `@img/*`
   optional-dep packages into `$out/lib/bundle/node_modules/…`,
2. patches two kinds of binaries:
   - `libvips-cpp.so.*` → `RUNPATH = $ORIGIN:<glibc>/lib:<gcc-lib>/lib` (libvips's own deps
     are store paths; `$ORIGIN` covers siblings in its lib dir),
   - `sharp-linux-x64.node` → `RUNPATH = $ORIGIN/../../sharp-libvips-linux-x64/lib:$ORIGIN/../../sharp-libvips-linux-arm64/lib:<glibc>/lib:<gcc-lib>/lib`
     — the `$ORIGIN/../..` chain walks from `@img/sharp-linux-x64/lib/` up to `@img/` so the
     addon finds `libvips-cpp.so.8.17.3` in the **sibling libvips package**, then falls back to
     the store paths for glibc/libstdc++,
3. runs a fail-closed smoke test (`node -e "require('sharp')(...).png().toBuffer()"`) so a
   broken closure fails the **build**, not the deploy.

Verified with `readelf -d` on the built closure (`/nix/store/cmblcz39…-homelab-api-0.1.0`):

```
$ readelf -d .../node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64.node | grep -E "NEEDED|RUNPATH"
 NEEDED  libvips-cpp.so.8.17.3
 NEEDED  libstdc++.so.6
 NEEDED  libm.so.6 / libgcc_s.so.1 / libpthread.so.0 / libc.so.6 / ld-linux-x86-64.so.2
 RUNPATH $ORIGIN/../../sharp-libvips-linux-x64/lib:$ORIGIN/../../sharp-libvips-linux-arm64/lib:/nix/store/fsd4…-glibc-2.42-100/lib:/nix/store/dqj5…-gcc-15.3.0-lib/lib
```

## The hazard: one `find` to rule them all

The patchelf step that handled sharp's addons was scoped by _filename pattern_, not by
_package_:

```sh
# BEFORE (hazardous):
while read -r addon; do
  patchelf --set-rpath '$ORIGIN/../../sharp-libvips-linux-x64/lib:$ORIGIN/../../sharp-libvips-linux-arm64/lib:'"$syslibs" \
    "$addon"
done < <(find $out/lib/bundle/node_modules -type f -name "*.node")
```

Fine while sharp was the only `.node` in the tree. But the cover-letter feature added a second
native addon with a completely different shape:

```
$ readelf -d .../node_modules/@myriaddreamin/typst-ts-node-compiler-linux-x64-gnu/typst-ts-node-compiler.linux-x64-gnu.node | grep -E "NEEDED|RUNPATH"
 NEEDED  libgcc_s.so.1 / librt.so.1 / libpthread.so.0 / libm.so.6 / libdl.so.2 / libc.so.6
 RUNPATH /nix/store/fsd4…-glibc-2.42-100/lib:/nix/store/dqj5…-gcc-15.3.0-lib/lib     # after the fix
```

Note what the typst binding (napi-rs, Rust) needs: plain glibc + libgcc_s — **no libstdc++, no
sibling library tree**. Under the old loop it would have received sharp's RUNPATH verbatim:

- `$ORIGIN/../../sharp-libvips-linux-x64/lib` resolves from
  `node_modules/@myriaddreamin/typst-ts-node-compiler-linux-x64-gnu/` to
  `node_modules/sharp-libvips-linux-x64/lib` — **which does not exist** (the real libvips lives
  under `node_modules/@img/`). Dead path entries.
- It still _loads_, because the `$syslibs` tail (glibc + libstdc++ store paths) happens to
  cover its actual `DT_NEEDED` list. **Working by coincidence is the dangerous part**: the
  build passes, the smoke test passes, and the rot is invisible until something changes.

### When a bogus RUNPATH actually bites

1. **Library shadowing / wrong-version loading.** `$ORIGIN`-relative entries are resolved
   against wherever the binary ends up. If a future dependency ever creates a matching sibling
   directory (another image pipeline, a vendored libvips, a renamed scope), the loader picks
   the **first match** — the unrelated binary silently binds against the wrong `libvips`/`libc++`
   ABI and fails at _runtime_, far from the cause.
2. **Ordering changes.** RUNPATH is consulted before the defaults but after `LD_LIBRARY_PATH`;
   a dead entry is harmless until a real one with an incompatible version appears earlier in
   the list.
3. **Diagnostics lie.** `readelf -d` / `ldd` are how you debug loader failures. A RUNPATH that
   describes _another package's_ layout sends whoever debugs it (future you, or an agent) down
   exactly the wrong path.
4. **Copy-paste escalation.** The next native dep's closure snippet would copy the loop as-is,
   compounding the mis-stamping.

### The fix (shipped in `package.nix`)

```sh
# sharp's loops are scoped to sharp's own trees:
done < <(find $out/lib/bundle/node_modules/sharp $out/lib/bundle/node_modules/@img \
           -type f -name "*.node" 2>/dev/null)

# the typst binding gets its OWN loop with an RPATH derived from ITS DT_NEEDED list
# (glibc + libstdc++ store paths; no $ORIGIN chain — it has no sibling library tree):
while read -r addon; do
  patchelf --set-rpath "${pkgs.glibc}/lib:${pkgs.stdenv.cc.cc.lib}/lib" "$addon"
done < <(find $out/lib/bundle/node_modules/@myriaddreamin -type f -name "*.node" 2>/dev/null)

# ...and its own fail-closed smoke test: the binding must LOAD and COMPILE inside the
# build sandbox (also permanently guards the CJS-named-import-from-ESM question):
(cd $out/lib/bundle && node -e "
  const {NodeCompiler}=require('@myriaddreamin/typst-ts-node-compiler');
  const c=NodeCompiler.create({});
  const pdf=c.pdf({mainFileContent:'Hello, typst!'});
  if(pdf.subarray(0,4).toString()!=='%PDF'){console.error('typst smoke: bad pdf');process.exit(1)};
  console.log('typst runtime closure OK')")
```

## Audit checklist for adding a native addon to this bundle

1. **rolldown external**: add the package name + scope regex to `rolldown.config.js`
   `external` (bundlers can't and mustn't inline `.node`).
2. **Copy the closure**: main package + the build-platform optional-dep package
   (`for pkg in node_modules/<scope>/<name>-*; do [ -d "$pkg" ] || continue; cp -rL …` —
   optional deps mean only the host platform is present; the `[ -d ]` guard handles the
   unexpanded glob).
3. **Read the binary's actual needs**: `readelf -d <addon>.node | grep NEEDED` — derive the
   RPATH from _that list_, never from another package's loop. Rust/napi bindings typically need
   only glibc (+ libgcc_s); C++ addons need libstdc++; image codecs need their sibling `.so`
   trees via `$ORIGIN` chains.
4. **Scope every patchelf `find`** to the owning package directory. An unscoped
   `-name "*.node"` find is a standing invitation to mis-patch the next dependency.
5. **Fail-closed smoke test** in the installPhase: `require` it, exercise it minimally, exit 1
   on any deviation. The sandbox has no network and no FHS — if it loads there, the RPATH work
   is genuinely complete.
6. Handy inspection commands:
   ```sh
   readelf -d file.node | grep -E 'NEEDED|R.?PATH'   # deps + search paths
   patchelf --print-rpath file.node                  # just the rpath
   ldd file.node                                     # resolved view ("not found" = broken closure)
   ```

## Lessons

- **Packaging globs are scope-creep hazards.** `find … -name "*.node"` reads as "all native
  addons" but encodes "all addons get _sharp's_ RPATH". Name the owner in the search path.
- **"It works" ≠ "it's right" for ELF metadata.** The loader tolerates dead RUNPATH entries;
  correctness is only visible via `readelf`, and only pays off when the tree changes.
- **Every native dep earns its own closure treatment** — copy, patch, smoke — as a unit. The
  build-time smoke test is what converts a 2 a.m. production `dlopen` failure into a red build
  log line.

## Cross-references

- `nix-config/modules/homelab/homelab-api/package.nix` — the live installPhase (sharp block,
  typst block, smoke tests).
- `packages/homelab-server/rolldown.config.js` — externals + the sharp/`@img` rationale comment.
- `docs/cover-letter-generator/02-typst-rendering.md` §"Build integration", `05-nix-and-deployment.md` §A.
- Companion doc on the other CL-T8 nix discovery: `docs/mkpackageoption-lambda-bug.md`.
