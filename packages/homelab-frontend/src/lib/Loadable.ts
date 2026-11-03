import { Option, Result } from "effect"

export type Loadable<A, E = unknown> = Option.Option<Result.Result<A, E>>

export const loading = <A, E = unknown>(): Loadable<A, E> => Option.none()

export const success = <A, E = unknown>(value: A): Loadable<A, E> => Option.some(Result.succeed(value))

export const failure = <A, E = unknown>(error: E): Loadable<A, E> => Option.some(Result.fail(error))

export const isLoading = <A, E>(loadable: Loadable<A, E>): boolean => Option.isNone(loadable)

export const isSuccess = <A, E>(loadable: Loadable<A, E>): loadable is Option.Some<Result.Success<A, E>> =>
  Option.isSome(loadable) && Result.isSuccess(loadable.value)

export const isFailure = <A, E>(loadable: Loadable<A, E>): loadable is Option.Some<Result.Failure<A, E>> =>
  Option.isSome(loadable) && Result.isFailure(loadable.value)

export const getOrNull = <A, E>(loadable: Loadable<A, E>): A | null =>
  Option.isSome(loadable) && Result.isSuccess(loadable.value) ? loadable.value.success : null

export const getErrorOrNull = <A, E>(loadable: Loadable<A, E>): E | null =>
  Option.isSome(loadable) && Result.isFailure(loadable.value) ? loadable.value.failure : null
