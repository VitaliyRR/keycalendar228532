import { assertDomain } from "./errors.js";
import { effectiveStayRange, parseInstant, rangesOverlap, stayRange, type StayRange } from "./dates.js";

export type AllocationKind = "reservation" | "block" | "hold";

export interface ExistingAllocation {
  readonly id: string;
  readonly organizationId: string;
  readonly resourceId: string;
  readonly range: StayRange;
  readonly active: boolean;
  readonly kind: AllocationKind;
  readonly holdExpiresAt?: string;
}

export interface ProposedAllocation {
  readonly organizationId: string;
  readonly unitId: string;
  readonly resourceIds: readonly string[];
  readonly stay: StayRange;
  readonly bufferBeforeDays?: number;
  readonly bufferAfterDays?: number;
  readonly kind: AllocationKind;
  readonly holdExpiresAt?: string;
}

export interface PlannedAllocation {
  readonly organizationId: string;
  readonly unitId: string;
  readonly resourceId: string;
  readonly kind: AllocationKind;
  readonly stay: StayRange;
  readonly effective: StayRange;
  readonly holdExpiresAt?: string;
}

export interface AllocationConflict { readonly resourceId: string; readonly allocationId: string; readonly effective: StayRange }
export type AllocationPlan =
  | { readonly ok: true; readonly allocations: readonly PlannedAllocation[]; readonly lockResourceIds: readonly string[]; readonly deactivateAllocationIds: readonly string[]; readonly expiredHoldIds: readonly string[] }
  | { readonly ok: false; readonly conflicts: readonly AllocationConflict[]; readonly lockResourceIds: readonly string[]; readonly expiredHoldIds: readonly string[] };

export function planAllocation(
  proposals: readonly ProposedAllocation[],
  existing: readonly ExistingAllocation[],
  options: { readonly at: string; readonly replaceAllocationIds?: readonly string[] },
): AllocationPlan {
  const now = parseInstant(options.at);
  assertDomain(proposals.length > 0, "INVALID_RANGE", "At least one stay is required");
  const org = proposals[0]!.organizationId;
  assertDomain(!!org, "INVALID_STATE", "Organization is required");
  assertDomain(proposals.every((proposal) => proposal.organizationId === org), "INVALID_STATE", "A plan cannot span organizations");
  assertDomain(existing.every((item) => item.organizationId === org), "INVALID_STATE", "Existing allocations must be tenant-scoped");
  for (const item of existing) {
    stayRange(item.range.from, item.range.to);
    if (item.kind === "hold") assertDomain(!!item.holdExpiresAt, "INVALID_STATE", "Existing hold needs expiry");
  }
  const replace = new Set(options.replaceAllocationIds ?? []);
  assertDomain(replace.size === (options.replaceAllocationIds?.length ?? 0), "INVALID_STATE", "Duplicate replacement allocation ID");
  assertDomain([...replace].every((id) => existing.some((item) => item.id === id)), "INVALID_STATE", "Replacement allocation is missing from locked snapshot");
  const expiredHoldIds = existing.filter((item) => item.active && item.kind === "hold" && !!item.holdExpiresAt && parseInstant(item.holdExpiresAt) <= now).map((item) => item.id).sort();
  const expired = new Set(expiredHoldIds);
  const allocated: PlannedAllocation[] = [];
  for (const proposal of proposals) {
    assertDomain(!!proposal.unitId && proposal.resourceIds.length > 0 && proposal.resourceIds.every(Boolean), "INVALID_STATE", "Unit and atomic resources are required");
    assertDomain(new Set(proposal.resourceIds).size === proposal.resourceIds.length, "INVALID_STATE", "Duplicate atomic resource");
    if (proposal.kind === "hold") assertDomain(!!proposal.holdExpiresAt && parseInstant(proposal.holdExpiresAt) > now, "INVALID_STATE", "Hold must have future expiry");
    const stay = stayRange(proposal.stay.from, proposal.stay.to);
    const effective = effectiveStayRange(stay, proposal.bufferBeforeDays, proposal.bufferAfterDays);
    for (const resourceId of proposal.resourceIds) {
      allocated.push({ organizationId: org, unitId: proposal.unitId, resourceId, kind: proposal.kind, stay, effective, ...(proposal.holdExpiresAt ? { holdExpiresAt: proposal.holdExpiresAt } : {}) });
    }
  }
  const lockResourceIds = [...new Set([...allocated.map((item) => item.resourceId), ...existing.filter((item) => replace.has(item.id)).map((item) => item.resourceId)])].sort();
  const conflicts: AllocationConflict[] = [];
  for (const item of allocated) {
    for (const old of existing) {
      if (old.active && old.resourceId === item.resourceId && !replace.has(old.id) && !expired.has(old.id) && rangesOverlap(item.effective, old.range)) {
        conflicts.push({ resourceId: item.resourceId, allocationId: old.id, effective: old.range });
      }
    }
  }
  for (let i = 0; i < allocated.length; i++) {
    for (let j = i + 1; j < allocated.length; j++) {
      const left = allocated[i]!;
      const right = allocated[j]!;
      if (left.resourceId === right.resourceId && rangesOverlap(left.effective, right.effective)) {
        conflicts.push({ resourceId: left.resourceId, allocationId: `proposed:${j}`, effective: right.effective });
      }
    }
  }
  if (conflicts.length) return { ok: false, conflicts, lockResourceIds, expiredHoldIds };
  return { ok: true, allocations: allocated, lockResourceIds, deactivateAllocationIds: [...replace].sort(), expiredHoldIds };
}

export interface CategoryCandidate { readonly unitId: string; readonly resourceIds: readonly string[] }
export type CategoryPlan =
  | { readonly ok: true; readonly provisionalUnitId: string; readonly allocationPlan: Extract<AllocationPlan, { ok: true }> }
  | { readonly ok: false; readonly reason: "NO_CONTINUOUS_UNIT"; readonly conflicts: readonly AllocationConflict[] };

export function planCategoryAllocation(
  organizationId: string,
  candidates: readonly CategoryCandidate[],
  stay: StayRange,
  existing: readonly ExistingAllocation[],
  options: { readonly at: string; readonly kind: "reservation" | "hold"; readonly bufferBeforeDays?: number; readonly bufferAfterDays?: number; readonly holdExpiresAt?: string },
): CategoryPlan {
  assertDomain(new Set(candidates.map((candidate) => candidate.unitId)).size === candidates.length, "INVALID_STATE", "Duplicate category unit");
  const sorted = [...candidates].sort((a, b) => a.unitId.localeCompare(b.unitId));
  const conflicts: AllocationConflict[] = [];
  for (const candidate of sorted) {
    const plan = planAllocation([{ organizationId, unitId: candidate.unitId, resourceIds: candidate.resourceIds, stay, kind: options.kind, ...(options.bufferBeforeDays === undefined ? {} : { bufferBeforeDays: options.bufferBeforeDays }), ...(options.bufferAfterDays === undefined ? {} : { bufferAfterDays: options.bufferAfterDays }), ...(options.holdExpiresAt ? { holdExpiresAt: options.holdExpiresAt } : {}) }], existing, { at: options.at });
    if (plan.ok) return { ok: true, provisionalUnitId: candidate.unitId, allocationPlan: plan };
    conflicts.push(...plan.conflicts);
  }
  return { ok: false, reason: "NO_CONTINUOUS_UNIT", conflicts };
}
