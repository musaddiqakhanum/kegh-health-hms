import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const abhaNumberSchema = z.object({
  abhaNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length === 14, "ABHA number must have 14 digits"),
});

const otpSchema = z.object({
  txnId: z.string().trim().min(1, "Missing transaction id"),
  otp: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "Enter the OTP you received"),
});

/** Is ABDM wired up on this server? */
export const abdmStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { readAbdmConfig } = await import("./abdm.server");
  const cfg = readAbdmConfig();
  return { configured: Boolean(cfg), environment: cfg?.environment ?? null };
});

export const abdmRequestOtp = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => abhaNumberSchema.parse(data))
  .handler(async ({ data }) => {
    const { requestAbhaLoginOtp, AbdmError } = await import("./abdm.server");
    try {
      return { ok: true as const, ...(await requestAbhaLoginOtp(data.abhaNumber)) };
    } catch (err) {
      const message = err instanceof AbdmError || err instanceof Error ? err.message : "ABDM request failed";
      return { ok: false as const, error: message };
    }
  });

export const abdmVerifyOtp = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => otpSchema.parse(data))
  .handler(async ({ data }) => {
    const { verifyAbhaLoginOtp, AbdmError } = await import("./abdm.server");
    try {
      return { ok: true as const, profile: await verifyAbhaLoginOtp(data.txnId, data.otp) };
    } catch (err) {
      const message = err instanceof AbdmError || err instanceof Error ? err.message : "ABDM verification failed";
      return { ok: false as const, error: message };
    }
  });
