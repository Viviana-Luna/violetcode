
export type DeepImmutable<T> = T extends (...args: any[]) => any
  ? T
  : T extends ReadonlyMap<infer K, infer V>
    ? ReadonlyMap<DeepImmutable<K>, DeepImmutable<V>>
    : T extends ReadonlySet<infer V>
      ? ReadonlySet<DeepImmutable<V>>
      : T extends readonly unknown[]
        ? number extends T['length']
          ? readonly DeepImmutable<T[number]>[]
          : { readonly [K in keyof T]: DeepImmutable<T[K]> }
        : T extends object
          ? { readonly [K in keyof T]: DeepImmutable<T[K]> }
          : T

export type Permutations<T extends string, U extends string = T> = T extends T
  ? T | `${T}${Permutations<Exclude<U, T>>}`
  : never
