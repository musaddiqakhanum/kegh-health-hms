/**
 * Client-safe helpers for health identifiers (ABHA number, ABHA address,
 * PM-JAY card). No server imports — safe to use from UI components.
 */

import type { PmjayStatus } from "@/lib/hms/types";

/** Profile returned by ABDM after a successful OTP verification. */
export interface AbhaProfile {
  abhaNumber: string;
  abhaAddress: string;
  name: string;
  gender: string;
  dob: string;
  mobile: string;
  address: string;
}

/** What a verification produced — `demo: true` means sample data, never trusted. */
export interface AbhaApplyPatch {
  abhaNumber: string;
  abhaAddress: string;
  /** Only set for a live (non-demo) verification. */
  abhaVerified?: boolean;
  abhaVerifiedAt?: number;
  name?: string;
  gender?: string;
  dob?: string;
  phone?: string;
  address?: string;
  demo?: boolean;
}

export type AbhaLoginHint = "abha-number" | "abha-address";

export function digitsOnly(v: string): string {
  return (v ?? "").replace(/\D/g, "");
}

/** Format 14 digits as the standard ABHA display grouping 99-9999-9999-9999. */
export function formatAbhaNumber(v: string): string {
  const d = digitsOnly(v).slice(0, 14);
  const parts = [d.slice(0, 2), d.slice(2, 6), d.slice(6, 10), d.slice(10, 14)].filter(Boolean);
  return parts.join("-");
}

export function isCompleteAbhaNumber(v: string): boolean {
  return digitsOnly(v).length === 14;
}

export const ABHA_ADDRESS_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,35})@[A-Za-z]{2,10}$/;

export function isValidAbhaAddress(v: string): boolean {
  return ABHA_ADDRESS_RE.test((v ?? "").trim());
}

/** Guess whether free-typed input is an ABHA address (has an @) or a number. */
export function abhaLoginHint(v: string): AbhaLoginHint {
  return (v ?? "").includes("@") ? "abha-address" : "abha-number";
}

/** Map the gender reported by ABDM onto the HMS patient gender values. */
export function abdmGenderToPatient(g: string): "M" | "F" | "Other" | "" {
  const s = (g ?? "").trim().toUpperCase();
  if (s.startsWith("M")) return "M";
  if (s.startsWith("F")) return "F";
  if (s) return "Other";
  return "";
}

/** Normalize a PM-JAY card ID: keep alphanumerics, `/` and `-`, collapse spaces. */
export function normalizePmjayCardId(v: string): string {
  return (v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function pmjayStatusLabel(s: PmjayStatus | string | undefined): string {
  return s ?? "Not enrolled";
}
