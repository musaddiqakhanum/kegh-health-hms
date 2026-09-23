/**
 * ABDM (Ayushman Bharat Digital Mission) gateway client — server only.
 *
 * Uses the ABDM M3 APIs:
 *  - Gateway session:   POST {gateway}/api/hiecm/gateway/v3/sessions
 *  - Public certificate: GET {abha}/abha/api/v3/profile/public/certificate
 *  - Login OTP request:  POST {abha}/abha/api/v3/profile/login/request/otp
 *  - Login OTP verify:   POST {abha}/abha/api/v3/profile/login/verify
 *  - Profile fetch:      GET  {abha}/abha/api/v3/profile/account
 */

export interface AbdmConfig {
  clientId: string;
  clientSecret: string;
  gatewayBase: string;
  abhaBase: string;
  environment: "sandbox" | "production";
}

export function readAbdmConfig(): AbdmConfig | null {
  const clientId = process.env["ABDM_CLIENT_ID"];
  const clientSecret = process.env["ABDM_CLIENT_SECRET"];
  if (!clientId || !clientSecret) return null;
  const environment = (process.env["ABDM_ENVIRONMENT"] ?? "sandbox") === "production" ? "production" : "sandbox";
  const sandbox = environment === "sandbox";
  return {
    clientId,
    clientSecret,
    gatewayBase: process.env["ABDM_GATEWAY_BASE"] ?? (sandbox ? "https://dev.abdm.gov.in" : "https://abdm.gov.in"),
    abhaBase: process.env["ABDM_ABHA_BASE"] ?? (sandbox ? "https://abhasbx.abdm.gov.in" : "https://abha.abdm.gov.in"),
    environment,
  };
}

function nowStamp() {
  return new Date().toISOString();
}

function baseHeaders() {
  return {
    "REQUEST-ID": crypto.randomUUID(),
    TIMESTAMP: nowStamp(),
    "Content-Type": "application/json",
  } as Record<string, string>;
}

export class AbdmError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

async function readError(res: Response, label: string): Promise<never> {
  const body = await res.text();
  console.error(`ABDM ${label} failed [${res.status}]: ${body}`);
  let message = body;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const detail = parsed["message"] ?? parsed["error"] ?? parsed["details"];
    if (typeof detail === "string") message = detail;
    else if (detail) message = JSON.stringify(detail);
  } catch {
    /* keep raw body */
  }
  throw new AbdmError(`ABDM ${label} failed (${res.status}): ${message}`, res.status);
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getSessionToken(cfg: AbdmConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;
  const res = await fetch(`${cfg.gatewayBase}/api/hiecm/gateway/v3/sessions`, {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      grantType: "client_credentials",
    }),
  });
  if (!res.ok) await readError(res, "session");
  const data = (await res.json()) as { accessToken?: string; expiresIn?: number };
  if (!data.accessToken) throw new AbdmError("ABDM session response did not contain an access token");
  cachedToken = { token: data.accessToken, expiresAt: Date.now() + (data.expiresIn ?? 1200) * 1000 };
  return data.accessToken;
}

let cachedCert: { pem: string; fetchedAt: number } | null = null;

async function getPublicCertificate(cfg: AbdmConfig, token: string): Promise<string> {
  if (cachedCert && Date.now() - cachedCert.fetchedAt < 6 * 60 * 60 * 1000) return cachedCert.pem;
  const res = await fetch(`${cfg.abhaBase}/abha/api/v3/profile/public/certificate`, {
    method: "GET",
    headers: { ...baseHeaders(), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) await readError(res, "public certificate");
  const text = await res.text();
  let pem = text;
  try {
    const parsed = JSON.parse(text) as { publicKey?: string };
    if (parsed.publicKey) pem = parsed.publicKey;
  } catch {
    /* plain PEM body */
  }
  cachedCert = { pem, fetchedAt: Date.now() };
  return pem;
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** RSA-OAEP(SHA-1) encrypt a value with the ABDM public key, base64 encoded. */
export async function encryptWithAbdmKey(cfg: AbdmConfig, token: string, value: string): Promise<string> {
  const pem = await getPublicCertificate(cfg, token);
  const key = await crypto.subtle.importKey(
    "spki",
    pemToDer(pem) as unknown as ArrayBuffer,
    { name: "RSA-OAEP", hash: "SHA-1" },
    false,
    ["encrypt"],
  );
  const cipher = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, new TextEncoder().encode(value));
  let binary = "";
  const bytes = new Uint8Array(cipher);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export interface AbhaProfile {
  abhaNumber: string;
  abhaAddress: string;
  name: string;
  gender: string;
  dob: string;
  mobile: string;
  address: string;
}

/** Step 1 — send an OTP to the mobile linked with the given ABHA number. */
export async function requestAbhaLoginOtp(abhaNumber: string): Promise<{ txnId: string; message: string }> {
  const cfg = readAbdmConfig();
  if (!cfg) throw new AbdmError("ABDM credentials are not configured on this server", 503);
  const token = await getSessionToken(cfg);
  const encrypted = await encryptWithAbdmKey(cfg, token, abhaNumber.replace(/\D/g, ""));

  const res = await fetch(`${cfg.abhaBase}/abha/api/v3/profile/login/request/otp`, {
    method: "POST",
    headers: { ...baseHeaders(), Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      scope: ["abha-login", "mobile-verify"],
      loginHint: "abha-number",
      loginId: encrypted,
      otpSystem: "abdm",
    }),
  });
  if (!res.ok) await readError(res, "OTP request");
  const data = (await res.json()) as { txnId?: string; message?: string };
  if (!data.txnId) throw new AbdmError("ABDM did not return a transaction id for this ABHA number");
  return { txnId: data.txnId, message: data.message ?? "OTP sent to the mobile linked with this ABHA number." };
}

/** Step 2 — verify the OTP and pull the ABHA profile. */
export async function verifyAbhaLoginOtp(txnId: string, otp: string): Promise<AbhaProfile> {
  const cfg = readAbdmConfig();
  if (!cfg) throw new AbdmError("ABDM credentials are not configured on this server", 503);
  const token = await getSessionToken(cfg);
  const encryptedOtp = await encryptWithAbdmKey(cfg, token, otp);

  const res = await fetch(`${cfg.abhaBase}/abha/api/v3/profile/login/verify`, {
    method: "POST",
    headers: { ...baseHeaders(), Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      scope: ["abha-login", "mobile-verify"],
      authData: {
        authMethods: ["otp"],
        otp: { txnId, otpValue: encryptedOtp, timeStamp: nowStamp() },
      },
    }),
  });
  if (!res.ok) await readError(res, "OTP verification");
  const verified = (await res.json()) as { token?: string; tokens?: { token?: string } };
  const xToken = verified.token ?? verified.tokens?.token;
  if (!xToken) throw new AbdmError("ABDM did not return a profile token after OTP verification");

  const profileRes = await fetch(`${cfg.abhaBase}/abha/api/v3/profile/account`, {
    method: "GET",
    headers: { ...baseHeaders(), Authorization: `Bearer ${token}`, "X-token": `Bearer ${xToken}` },
  });
  if (!profileRes.ok) await readError(profileRes, "profile fetch");
  const p = (await profileRes.json()) as Record<string, unknown>;

  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const dobParts = [str("yearOfBirth"), str("monthOfBirth"), str("dayOfBirth")].filter(Boolean);
  const dob =
    str("dob") ||
    (dobParts.length === 3
      ? `${dobParts[0]}-${dobParts[1]!.padStart(2, "0")}-${dobParts[2]!.padStart(2, "0")}`
      : "");

  return {
    abhaNumber: str("ABHANumber") || str("abhaNumber"),
    abhaAddress: str("preferredAbhaAddress") || str("abhaAddress"),
    name: str("name") || [str("firstName"), str("middleName"), str("lastName")].filter(Boolean).join(" "),
    gender: str("gender"),
    dob,
    mobile: str("mobile"),
    address: [str("address"), str("districtName"), str("stateName"), str("pincode")].filter(Boolean).join(", "),
  };
}
