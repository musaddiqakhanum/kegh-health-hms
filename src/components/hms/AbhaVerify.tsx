import { useEffect, useState } from "react";
import { Loader2, Send, ShieldAlert, ShieldCheck, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { abdmRequestOtp, abdmStatus, abdmVerifyOtp } from "@/lib/abdm/abdm.functions";
import {
  abdmGenderToPatient,
  abhaLoginHint,
  formatAbhaNumber,
  isCompleteAbhaNumber,
  isValidAbhaAddress,
  type AbhaApplyPatch,
  type AbhaProfile,
} from "@/lib/abdm/healthId";
import { fmtDateTime } from "@/lib/hms/format";
import { Badge, Button, Field, Input } from "@/components/hms/ui";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "@/components/ui/input-otp";

interface AbdmStatusInfo {
  configured: boolean;
  environment: "sandbox" | "production" | null;
  demo: boolean;
}

let statusPromise: Promise<AbdmStatusInfo> | null = null;
function loadAbdmStatus(): Promise<AbdmStatusInfo> {
  if (!statusPromise) {
    statusPromise = abdmStatus().catch(
      () => ({ configured: false, environment: null, demo: true }) as AbdmStatusInfo,
    );
  }
  return statusPromise;
}

interface AbhaVerifyProps {
  abhaNumber?: string | undefined;
  abhaAddress?: string | undefined;
  abhaVerified?: boolean | undefined;
  abhaVerifiedAt?: number | undefined;
  /** Receives the verified (or demo) profile to merge into the patient. */
  onApply: (patch: AbhaApplyPatch) => void;
}

/**
 * Live ABHA verification against the ABDM gateway:
 * ABHA number / address → OTP on the linked mobile → verified profile.
 *
 * When the server has no ABDM credentials the widget runs a clearly-labelled
 * demo flow that prefills sample data but never marks the patient verified.
 */
export function AbhaVerify({
  abhaNumber,
  abhaAddress,
  abhaVerified,
  abhaVerifiedAt,
  onApply,
}: AbhaVerifyProps) {
  const [status, setStatus] = useState<AbdmStatusInfo | null>(null);
  const [loginId, setLoginId] = useState(
    abhaNumber ? formatAbhaNumber(abhaNumber) : (abhaAddress ?? ""),
  );
  const [phase, setPhase] = useState<"entry" | "otp" | "done">("entry");
  const [txnId, setTxnId] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<AbhaProfile | null>(null);
  const [demoProfile, setDemoProfile] = useState(false);

  useEffect(() => {
    void loadAbdmStatus().then(setStatus);
  }, []);

  const demo = status?.demo ?? false;
  const hint = abhaLoginHint(loginId);
  const loginOk =
    hint === "abha-number" ? isCompleteAbhaNumber(loginId) : isValidAbhaAddress(loginId);

  const sendOtp = async () => {
    setError("");
    if (!loginOk) {
      setError(
        hint === "abha-number"
          ? "ABHA number must have 14 digits"
          : "Enter a valid ABHA address, e.g. name@sbx",
      );
      return;
    }
    if (demo) {
      // No credentials on this server — walk through the same UX with sample data.
      setTxnId("demo-txn");
      setOtp("");
      setPhase("otp");
      toast.info("Demo mode — enter any 6 digits as the OTP (e.g. 123456).");
      return;
    }
    setBusy(true);
    try {
      const res = await abdmRequestOtp({
        data: { loginId: hint === "abha-number" ? loginId : loginId.trim(), loginHint: hint },
      });
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      setTxnId(res.txnId);
      setOtp("");
      setPhase("otp");
      toast.success(res.message);
    } catch (err) {
      const message = (err as Error).message ?? "Could not send the OTP";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    setError("");
    if (otp.length < 4) {
      setError("Enter the 6-digit OTP");
      return;
    }
    if (demo) {
      const d = digitsOf(loginId);
      const number = hint === "abha-number" ? d : "";
      const address =
        hint === "abha-address" ? loginId.trim().toLowerCase() : number ? `${number}@demo` : "";
      setProfile({
        abhaNumber: number,
        abhaAddress: address,
        name: "Demo ABHA Holder",
        gender: "M",
        dob: "1990-01-01",
        mobile: "9000000000",
        address: "Demo sample data — no ABDM credentials on this server",
      });
      setDemoProfile(true);
      setPhase("done");
      return;
    }
    setBusy(true);
    try {
      const res = await abdmVerifyOtp({ data: { txnId, otp } });
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      setProfile(res.profile);
      setDemoProfile(false);
      setPhase("done");
      toast.success("ABHA verified");
    } catch (err) {
      const message = (err as Error).message ?? "Could not verify the OTP";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!profile) return;
    const number = digitsOf(profile.abhaNumber);
    const patch: AbhaApplyPatch = {
      abhaNumber: number,
      abhaAddress: profile.abhaAddress ?? "",
      demo: demoProfile,
    };
    if (!demoProfile) {
      patch.abhaVerified = true;
      patch.abhaVerifiedAt = Date.now();
    }
    if (profile.name) patch.name = profile.name;
    if (abdmGenderToPatient(profile.gender)) patch.gender = abdmGenderToPatient(profile.gender);
    if (profile.dob) patch.dob = profile.dob;
    if (profile.mobile) patch.phone = profile.mobile;
    if (profile.address) patch.address = profile.address;
    onApply(patch);
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">ABHA verification</span>
        {abhaVerified ? (
          <Badge tone="green">
            <ShieldCheck className="mr-1 inline h-3 w-3" />
            Verified {abhaVerifiedAt ? fmtDateTime(abhaVerifiedAt) : ""}
          </Badge>
        ) : abhaNumber || abhaAddress ? (
          <Badge tone="amber">
            <ShieldAlert className="mr-1 inline h-3 w-3" /> Not verified
          </Badge>
        ) : null}
        {status ? (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {demo
              ? "Demo mode — ABDM credentials not set on this server"
              : `ABDM ${status.environment === "production" ? "production" : "sandbox"} · live`}
          </span>
        ) : null}
      </div>

      {phase === "entry" ? (
        <div className="space-y-2">
          <Field label="ABHA number or ABHA address" className="mb-1">
            <Input
              value={loginId}
              inputMode={hint === "abha-number" ? "numeric" : "text"}
              placeholder="14-3245-6789-0123 or name@sbx"
              onChange={(e) =>
                setLoginId(
                  loginId.includes("@") || e.target.value.includes("@")
                    ? e.target.value
                    : formatAbhaNumber(e.target.value),
                )
              }
            />
          </Field>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !loginId.trim()}
            onClick={sendOtp}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send OTP
          </Button>
        </div>
      ) : null}

      {phase === "otp" ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {demo
              ? "Demo OTP — enter any 6 digits. Live verification needs ABDM credentials on the server."
              : `Enter the OTP sent to the mobile linked with ${hint === "abha-number" ? formatAbhaNumber(loginId) : loginId.trim()}.`}
          </p>
          <InputOTP maxLength={6} value={otp} onChange={setOtp}>
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy || otp.length < 4} onClick={verifyOtp}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              Verify OTP
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPhase("entry");
                setOtp("");
                setError("");
              }}
            >
              Change ABHA
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "done" && profile ? (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
            <UserCheck className="h-4 w-4" />
            {demoProfile ? "Demo profile (not verified)" : "ABHA verified with ABDM"}
          </p>
          <div className="grid gap-x-4 gap-y-1 rounded-md bg-card p-3 text-sm sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">Name:</span> {profile.name || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Gender:</span> {profile.gender || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">DOB:</span> {profile.dob || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Mobile:</span> {profile.mobile || "—"}
            </p>
            <p className="sm:col-span-2">
              <span className="text-muted-foreground">ABHA:</span>{" "}
              {formatAbhaNumber(profile.abhaNumber) || profile.abhaAddress || "—"}
            </p>
            {profile.abhaAddress ? (
              <p className="sm:col-span-2">
                <span className="text-muted-foreground">ABHA address:</span> {profile.abhaAddress}
              </p>
            ) : null}
            {profile.address ? (
              <p className="sm:col-span-2">
                <span className="text-muted-foreground">Address:</span> {profile.address}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={apply}>
              {demoProfile ? "Prefill demo data (not verified)" : "Apply to patient"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPhase("entry");
                setProfile(null);
              }}
            >
              Verify another
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function digitsOf(v: string): string {
  return (v ?? "").replace(/\D/g, "").slice(0, 14);
}
