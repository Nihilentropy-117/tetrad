// structuredClone exists in Node 17+ and all modern browsers; the engine has
// no @types/node (it is environment-agnostic), so declare it here.
declare function structuredClone<T>(value: T): T;
