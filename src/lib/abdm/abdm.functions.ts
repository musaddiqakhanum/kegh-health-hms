import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { digitsOnly, isValidAbhaAddress } from "./healthId";

/** ABHA number (14 digits) or ABHA address (name@domain) to verify. */
const loginSchema = z
  .object({
    loginId: z.string().trim().min(3, "Enter the patient's ABHA number or ABHA address"),
    loginHint: z.enum(["abha-number", "abha-address"]).optional(),
  })
  .transform((v) => {
    const loginHint = v.loginHint ?? (v.loginId.includes("@") ? "abha-address" : "abha-number");
    return { loginId: loginHint === "abha-number" ? digitsOnly(v.loginId) : v.loginId, loginHint };
  })
  .refine(
    (v) =>
      v.loginHint === "abha-number" ? v.loginId.length === 14 : isValidAbhaAddress(v.loginId),
    (v) => ({
      message:
        v.loginHint === "abha-number"
          ? "ABHA number must have 14 digits"
          : "ABHA address looks invalid — expected something like name@sbx",
    }),
  );

const otpSchema = z.object({
  txnId: z.string().trim().min(1, "Missing transaction id"),
  otp: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "Enter the OTP you received"),
});

/** Is ABDM wired up on this server? `demo` is true when credentials are absent. */
export const abdmStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { readAbdmConfig } = await import("./abdm.server");
  const cfg = readAbdmConfig();
  return {
    configured: Boolean(cfg),
    environment: cfg?.environment ?? null,
    demo: !cfg,
  };
});

export const abdmRequestOtp = createServerFn({ method: "POST" })
  .validator((data: unknown) => loginSchema.parse(data))
  .handler(async ({ data }) => {
    const { requestAbhaLoginOtp, AbdmError } = await import("./abdm.server");
    try {
      return { ok: true as const, ...(await requestAbhaLoginOtp(data.loginId, data.loginHint)) };
    } catch (err) {
      const message =
        err instanceof AbdmError || err instanceof Error ? err.message : "ABDM request failed";
      return { ok: false as const, error: message };
    }
  });

export const abdmVerifyOtp = createServerFn({ method: "POST" })
  .validator((data: unknown) => otpSchema.parse(data))
  .handler(async ({ data }) => {
    const { verifyAbhaLoginOtp, AbdmError } = await import("./abdm.server");
    try {
      return { ok: true as const, profile: await verifyAbhaLoginOtp(data.txnId, data.otp) };
    } catch (err) {
      const message =
        err instanceof AbdmError || err instanceof Error ? err.message : "ABDM verification failed";
      return { ok: false as const, error: message };
    }
  });
