import type { NonEmptyReadonlyArray } from "effect/Array"

export type Line = readonly [depth: number, line: string]

export function line(...line: Line): Line {
  return line
}

export type Lines = ReadonlyArray<Line>

export type NonEmptyLines = NonEmptyReadonlyArray<Line>

export const empty: Lines = []

export function lines(...lines: ReadonlyArray<Line>): Lines {
  return lines
}

export function singleton(...line: Line): Lines {
  return [line]
}

export interface CompilationParamters {
  readonly indent: string
  readonly newline: string
}

export function compile(params: CompilationParamters): (lines: Lines) => string {
  return (lines) =>
    lines
      .map(([depth, line]) => `${params.indent.repeat(depth)}${line}${params.newline}`)
      .join("")
}

export function isNonEmpty(lines: Lines): lines is NonEmptyLines {
  return lines.length >= 1
}

export function fst([line]: NonEmptyLines): Line {
  return line
}
