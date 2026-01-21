// CHANGE: add ES2023 Array.prototype.toSorted typings for ES2022 lib
// WHY: satisfy lint rule requiring toSorted without changing global lib target
// QUOTE(TZ): "Use Array#toSorted() instead of Array#sort()."
// REF: req-guard-devdeps-1
// SOURCE: n/a
// FORMAT THEOREM: forall a: toSorted(a) preserves elements and order relation of comparator
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: toSorted does not mutate the original array
// COMPLEXITY: O(n log n)

interface Array<T> {
  toSorted(compareFn?: (left: T, right: T) => number): Array<T>
}

interface ReadonlyArray<T> {
  toSorted(compareFn?: (left: T, right: T) => number): Array<T>
}
