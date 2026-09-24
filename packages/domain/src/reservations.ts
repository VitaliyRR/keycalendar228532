import { assertDomain } from "./errors.js";
import { parseInstant } from "./dates.js";

export type ReservationStatus = "draft" | "confirmed" | "checked_in" | "checked_out" | "cancelled" | "no_show";
export type ReservationCommand = "confirm" | "cancel" | "check_in" | "check_out" | "mark_no_show" | "reconfirm";

export interface ReservationState {
  readonly status: ReservationStatus;
  readonly version: number;
  readonly archivedAt?: string | null;
  readonly scheduledCheckinAt?: string | null;
}

export interface ReservationTransition {
  readonly command: ReservationCommand;
  readonly expectedVersion: number;
  readonly at: string;
  readonly allocationCommitted?: boolean;
  readonly cancellationPreviewVerified?: boolean;
}

export function transitionReservation(state: ReservationState, command: ReservationTransition): ReservationState {
  assertDomain(Number.isSafeInteger(state.version) && state.version > 0, "INVALID_STATE", "Version must be positive");
  assertDomain(command.expectedVersion === state.version, "VERSION_CHANGED", "Reservation version changed");
  parseInstant(command.at);
  assertDomain(!state.archivedAt, "INVALID_STATE", "Unarchive before changing lifecycle");
  let next: ReservationStatus;
  switch (command.command) {
    case "confirm":
      assertDomain(state.status === "draft", "INVALID_STATE", "Only a draft can be confirmed");
      assertDomain(command.allocationCommitted, "AVAILABILITY_CONFLICT", "Confirmation requires committed allocation");
      next = "confirmed";
      break;
    case "reconfirm":
      assertDomain(state.status === "cancelled" || state.status === "no_show", "INVALID_STATE", "Reconfirmation requires cancelled or no-show reservation");
      assertDomain(command.allocationCommitted, "AVAILABILITY_CONFLICT", "Reconfirmation requires a fresh committed allocation");
      next = "confirmed";
      break;
    case "cancel":
      assertDomain(state.status === "draft" || state.status === "confirmed", "INVALID_STATE", "Cancellation is only available before check-in");
      assertDomain(command.cancellationPreviewVerified, "PREVIEW_CHANGED", "Cancellation requires a verified financial preview");
      next = "cancelled";
      break;
    case "check_in":
      assertDomain(state.status === "confirmed", "INVALID_STATE", "Check-in requires confirmed status");
      next = "checked_in";
      break;
    case "check_out":
      assertDomain(state.status === "checked_in", "INVALID_STATE", "Check-out requires checked-in status");
      next = "checked_out";
      break;
    case "mark_no_show":
      assertDomain(state.status === "confirmed", "INVALID_STATE", "No-show requires confirmed status");
      assertDomain(!!state.scheduledCheckinAt && parseInstant(command.at) > parseInstant(state.scheduledCheckinAt), "INVALID_STATE", "No-show decision must follow scheduled check-in");
      next = "no_show";
      break;
  }
  return Object.freeze({ ...state, status: next, version: state.version + 1 });
}

export function archiveReservation(state: ReservationState, expectedVersion: number, at: string): ReservationState {
  assertDomain(expectedVersion === state.version, "VERSION_CHANGED", "Reservation version changed");
  assertDomain(!state.archivedAt, "INVALID_STATE", "Already archived");
  assertDomain(state.status !== "confirmed" && state.status !== "checked_in", "INVALID_STATE", "Active stay needs cancellation or check-out before archiving");
  parseInstant(at);
  return Object.freeze({ ...state, archivedAt: at, version: state.version + 1 });
}

export function unarchiveReservation(state: ReservationState, expectedVersion: number): ReservationState {
  assertDomain(expectedVersion === state.version, "VERSION_CHANGED", "Reservation version changed");
  assertDomain(!!state.archivedAt, "INVALID_STATE", "Reservation is not archived");
  return Object.freeze({ ...state, archivedAt: null, version: state.version + 1 });
}

export type HoldStatus = "active" | "converted" | "released" | "expired";
export interface HoldState { readonly status: HoldStatus; readonly version: number; readonly expiresAt: string }
export type HoldCommand = "convert" | "release" | "expire";

export function transitionHold(state: HoldState, command: HoldCommand, expectedVersion: number, at: string): HoldState {
  assertDomain(expectedVersion === state.version, "VERSION_CHANGED", "Hold version changed");
  assertDomain(state.status === "active", "INVALID_STATE", "Hold is not active");
  const now = parseInstant(at);
  const expiry = parseInstant(state.expiresAt);
  if (command === "convert") assertDomain(now < expiry, "INVALID_STATE", "Expired hold cannot confirm a booking");
  if (command === "expire") assertDomain(now >= expiry, "INVALID_STATE", "Hold has not expired");
  const next: HoldStatus = command === "convert" ? "converted" : command === "release" ? "released" : "expired";
  return Object.freeze({ ...state, status: next, version: state.version + 1 });
}
