/** A scoped target must belong to this runtime. Legacy unscoped data remains readable. */
export function matchesRuntimeScope(
  target: { readonly dshInstanceId?: string | undefined },
  runtimeIdentity?: { readonly dshInstanceId?: string | undefined },
): boolean {
  return target.dshInstanceId === undefined || target.dshInstanceId === runtimeIdentity?.dshInstanceId;
}
