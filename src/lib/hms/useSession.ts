import { useContext } from "react";
import { SessionContext, type SessionCtx } from "./session-context";

/** Current signed-in user plus login / logout actions (see session.tsx). */
export function useSession(): SessionCtx {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
