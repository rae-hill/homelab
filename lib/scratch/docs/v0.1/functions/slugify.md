[**@rae-hill/scratch**](../README.md)

---

[@rae-hill/scratch](../README.md) / slugify

# Function: slugify()

> **slugify**(`input`): `string`

Defined in: [index.ts:41](https://github.com/rae-hill/homelab/blob/main/lib/scratch/src/index.ts#L41)

Converts arbitrary text into a URL-friendly slug.

Strips diacritics, lowercases, and replaces runs of non-alphanumeric
characters with single hyphens.

## Parameters

### input

`string`

The text to slugify.

## Returns

`string`

The slug (empty string when nothing alphanumeric remains).

## Example

```ts
import { slugify } from "@rae-hill/scratch"

slugify("Crème Brûlée — Recipe!") // => "creme-brulee-recipe"
```
