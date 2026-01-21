// CHANGE: introduce a JSON domain type for safe, typed package.json handling
// WHY: preserve unknown fields while keeping dependency maps type-safe
// QUOTE(TZ): "package.json" | n/a
// REF: req-io-json-1
// SOURCE: n/a
// FORMAT THEOREM: ∀x ∈ Json: isFiniteJson(x) → isFiniteJson(x)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: Json is closed under array/object nesting with primitive leaves
// COMPLEXITY: O(1)/O(1)

export type Json =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json }

export type JsonObject = { readonly [key: string]: Json }
