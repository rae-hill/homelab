export type ConcatAll_<Rest extends ReadonlyArray<string>, Acc extends string = ""> = Rest extends
  [infer Head extends string, ...infer Tail extends ReadonlyArray<string>] ? false extends true ? never
  : ConcatAll_<Tail, `${Acc}${Head}`>
  : Acc

export type ConcatAll<Strs extends ReadonlyArray<string>> = ConcatAll_<Strs>

export function concat<Strs extends ReadonlyArray<string>>(
  ...strs: Strs
): ConcatAll<Strs> {
  return strs.join("") as ConcatAll<Strs>
}

function wait(dur: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, dur))
}

export async function awaitClasses(
  className: string,
): Promise<HTMLCollectionOf<Element> | null> {
  let els = document.getElementsByClassName(className)
  let count = 0

  while (els.length === 0) {
    if (++count >= 10000) {
      return null
    }
    els = document.getElementsByClassName(className)
    await wait(0)
  }

  return els
}

export async function awaitEl(
  query: string,
  retryDelay: number = 0,
  maxTries: number = 10000,
): Promise<Element | null> {
  let els = document.querySelector(query)
  let count = 0

  while (!els) {
    if (++count >= maxTries) {
      return null
    }
    els = document.querySelector(query)
    await wait(retryDelay)
  }

  return els
}
