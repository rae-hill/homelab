[**@rae-hill/scratch**](../README.md)

***

[@rae-hill/scratch](../README.md) / clamp

# Function: clamp()

> **clamp**(`value`, `min`, `max`): `number`

Defined in: index.ts:65

Clamps `value` into the inclusive range `[min, max]`.

## Parameters

### value

`number`

The number to clamp.

### min

`number`

Lower bound (must be <= max).

### max

`number`

Upper bound.

## Returns

`number`

`min` when value < min, `max` when value > max, else `value`.

## Example

```ts
import { clamp } from "@rae-hill/scratch"

clamp(15, 0, 10) //=> 10
```
