# @rae-hill/scratch

Throwaway proof-of-concept library for this repo's `lib/*` → npm publishing pipeline. It exists
to exercise the full flow end to end: RsLib build → TypeDoc docs → semantic-release → npm Trusted
Publishing with provenance.

## Usage

```ts
import { clamp, greet, slugify, sum } from "@rae-hill/scratch"

greet("world") // => "Hello, world!"
slugify("Crème Brûlée — Recipe!") // => "creme-brulee-recipe"
clamp(15, 0, 10) // => 10
sum([1, 2, 3]) // => 6
```

## Development (inside this monorepo)

```sh
yarn workspace @rae-hill/scratch build       # RsLib → dist/ (runs publint + arethetypeswrong)
yarn workspace @rae-hill/scratch docs        # TypeDoc markdown → docs/v<major>.<minor>/ (committed)
yarn workspace @rae-hill/scratch docs:dev    # RsPress site preview (HTML output is gitignored)
yarn workspace @rae-hill/scratch test
```

## Releases

Fully automated on push to `main` — conventional commits touching `lib/scratch/**` drive the
version (`fix:` → patch, `feat:` → minor, `BREAKING CHANGE` → major), and CI publishes via npm
Trusted Publishing (OIDC, provenance attached). Never edit `version` or create release tags by
hand. See `docs/npm-lib-publishing-plan.md` at the repo root for the full design.

## License

MIT
