/* Smoke tests for the insurance / PM-JAY claims desk: payer master, claim
   workflow, settlements, statistics and Drive merge behaviour. */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = join(process.cwd(), ".smoke-claims-tmp");
rmSync(dir, { recursive: true, force: true });
try {
  execFileSync(
    "npx",
    [
      "tsc",
      "src/lib/hms/claims.ts",
      "src/lib/hms/merge.ts",
      "--outDir",
      dir,
      "--rootDir",
      "src",
      "--module",
      "commonjs",
      "--target",
      "es2022",
      "--moduleResolution",
      "node",
      "--skipLibCheck",
    ],
    { cwd: process.cwd(), stdio: "pipe" },
  );
  writeFileSync(join(dir, "package.json"), '{"type":"commonjs"}');
  const { createRequire } = await import("node:module");
  const require = createRequire(pathToFileURL(join(dir, "index.js")).href);
  const cl = require(join(dir, "lib/hms/claims.js"));
  const { mergeStates } = require(join(dir, "lib/hms/merge.js"));

  let failures = 0;
  const check = (name, cond) => {
    if (cond) console.log(`  ok  ${name}`);
    else {
      failures++;
      console.error(`FAIL  ${name}`);
    }
  };

  const DAY = 86400000;
  const now = Date.now();
  /* Realistic day-based epochs, the house rule for smoke fixtures. */
  const daysAgo = (n) => now - n * DAY;

  const payer = (id, name, over = {}) => ({
    id,
    name,
    type: "Private insurer",
    code: name.slice(0, 4).toUpperCase(),
    contact: "",
    settlementDays: 30,
    active: true,
    notes: "",
    createdAt: 1,
    ...over,
  });

  const claim = (id, claimNo, over = {}) => ({
    id,
    claimNo,
    patientId: "p1",
    visitId: "",
    admissionId: "",
    billId: "",
    payerId: "pay1",
    payerName: "Star Health & Allied Insurance",
    scheme: "PM-JAY (Ayushman Bharat)",
    policyNo: "PMJAY-1234",
    date: "2026-09-01",
    treatment: "Acute appendicitis — appendectomy",
    admissionDate: "2026-09-01",
    dischargeDate: "2026-09-04",
    packageCode: "SG039A",
    claimedAmount: 45000,
    approvedAmount: 0,
    settledAmount: 0,
    patientShare: 0,
    status: "Preparing",
    reference: "",
    docs: cl.defaultDocs(),
    events: [],
    notes: "",
    preparedBy: "Front desk",
    settledOn: "",
    settlementRef: "",
    settlementPosted: 0,
    createdAt: 1,
    ...over,
  });

  const bill = (id, over = {}) => ({
    id,
    patientId: "p1",
    visitId: "",
    date: "2026-09-04",
    items: [{ description: "Bed charges — GW-1 (3 days)", qty: 1, rate: 45000, amount: 45000 }],
    totalAmount: 45000,
    discount: 0,
    tax: 0,
    paid: 0,
    due: 45000,
    paymentMode: "Cash",
    createdAt: 1,
    ...over,
  });

  const state = {
    payers: { pay1: payer("pay1", "Star Health & Allied Insurance") },
    claims: {
      c1: claim("c1", 1, { claimedAmount: 45000, status: "Claim submitted", events: [{ at: daysAgo(40), status: "Claim submitted", by: "Reception", note: "" }] }),
      c2: claim("c2", 2, { claimedAmount: 20000, date: "2026-09-18", approvedAmount: 18000, settledAmount: 18000, settledOn: "2026-09-20", status: "Settled", events: [{ at: daysAgo(20), status: "Claim submitted", by: "Reception", note: "" }, { at: daysAgo(15), status: "Settled", by: "Billing", note: "" }] }),
      c3: claim("c3", 3, { claimedAmount: 12000, date: "2026-09-10", status: "Rejected", patientId: "p2" }),
      c4: claim("c4", 4, { claimedAmount: 8000, status: "Preparing" }),
      c5: claim("c5", 5, { claimedAmount: 30000, date: "2026-09-25", approvedAmount: 25000, settledAmount: 10000, status: "Partially settled", patientShare: 5000 }),
    },
    patients: {},
    bills: { b1: bill("b1") },
    ops: {},
    deleted: {},
  };

  /* ------------------------------------------------------------ payer seed */
  const seeded = cl.seedPayers({ payers: {}, claims: {}, ops: {}, deleted: {} });
  const seededCount = Object.keys(seeded.payers).length;
  check("payer seed loads the built-in Indian list", seededCount >= 30);
  check("payer ids are deterministic", !!seeded.payers["seed-payer-pmjay"]);
  check(
    "Ayushman scheme seeded as a government scheme",
    seeded.payers["seed-payer-pmjay"]?.type === "Government scheme",
  );
  check("re-seeding is idempotent", Object.keys(cl.seedPayers(seeded).payers).length === seededCount);
  const handAdded = {
    payers: { mine: payer("mine", "Star Health & Allied Insurance") },
    claims: {},
    ops: {},
    deleted: {},
  };
  const seeded2 = cl.seedPayers(handAdded);
  check(
    "a payer the hospital typed itself is never duplicated",
    Object.values(seeded2.payers).filter((p) => p.name === "Star Health & Allied Insurance").length === 1,
  );
  check("payer list sorts active first", cl.payerList(seeded)[0]?.active !== false);
  check("active payers filter", cl.activePayers(seeded).length === seededCount);
  check("search payers by code", cl.searchPayers(cl.payerList(seeded), "cghs")[0]?.code === "CGHS");

  /* -------------------------------------------------------------- register */
  check("next claim number after 5 claims", cl.nextClaimNo(state) === 6);
  check("next claim number on an empty file", cl.nextClaimNo({ claims: {} }) === 1);
  const sorted = cl.claimList(state);
  check("open claims come first, oldest first", sorted[0].id === "c1" && sorted[1].id === "c4");
  check(
    "closed claims follow newest first",
    sorted.slice(2).map((c) => c.id).join(",") === "c5,c2,c3",
  );
  check("open claims helper", cl.openClaims(state).length === 2);
  check("claims for one patient", cl.claimsForPatient(state, "p2").length === 1);
  check("search by payer name", cl.searchClaims(cl.claimList(state), "star").length === 5);
  check("search by claim number", cl.searchClaims(cl.claimList(state), "clm-3")[0]?.id === "c3");
  check(
    "search by patient name / MRN",
    cl.searchClaims(cl.claimList(state), "Ramesh", () => "Ramesh Kumar KEGH/26/0007").length === 5,
  );
  check(
    "search by insurer reference",
    cl.searchClaims(cl.claimList(state), "SL-2026-9931").length === 0 &&
      cl.searchClaims(cl.claimList(state, () => "") , "star").length === 5,
  );
  check("search by treatment", cl.searchClaims(cl.claimList(state), "appendectomy").length === 5);
  check("status reads green when settled", cl.claimTone("Settled") === "green");
  check("status reads red when rejected", cl.claimTone("Rejected") === "red");

  /* ------------------------------------------------------------- workflow */
  check("Preparing → send pre-auth", cl.nextClaimStep("Preparing").to === "Pre-auth sent");
  check("Pre-auth sent → pre-auth approved", cl.nextClaimStep("Pre-auth sent").to === "Pre-auth approved");
  check("Pre-auth approved → submit", cl.nextClaimStep("Pre-auth approved").to === "Claim submitted");
  check("Query raised → resubmit", cl.nextClaimStep("Query raised").to === "Claim submitted");
  check("Claim submitted → approved", cl.nextClaimStep("Claim submitted").to === "Approved");
  check("Approved → record settlement", cl.nextClaimStep("Approved").kind === "settle");
  check("Pre-auth rejected → send again", cl.nextClaimStep("Pre-auth rejected").to === "Pre-auth sent");
  check("Settled has no next step", cl.nextClaimStep("Settled") === null);
  check("Rejected has no next step", cl.nextClaimStep("Rejected") === null);

  /* ------------------------------------------------------------ paperwork */
  check("checklist starts empty", cl.docsReady({ docs: cl.defaultDocs() }) === 0);
  check("missing docs lists the whole file", cl.missingDocs({ docs: cl.defaultDocs() }).length === 12);
  const partly = cl.defaultDocs().map((d, i) => (i < 3 ? { ...d, ready: true } : d));
  check("docs ready counts ticks", cl.docsReady({ docs: partly }) === 3);
  check(
    "normalizeDocs keeps ticks and re-adds missing lines",
    cl.normalizeDocs([{ name: "Discharge summary", ready: true }]).find((d) => d.name === "Discharge summary").ready === true &&
      cl.normalizeDocs([{ name: "Discharge summary", ready: true }]).length === 12,
  );
  check(
    "normalizeDocs drops lines the payer no longer needs",
    cl.normalizeDocs([{ name: "Old form", ready: true }]).every((d) => d.name !== "Old form"),
  );

  /* ---------------------------------------------------------------- money */
  check("pending = claimed − settled", cl.claimPending(claim("x", 1, { claimedAmount: 10000, settledAmount: 4000 })) === 6000);
  check(
    "pending follows the approval once one is on file",
    cl.claimPending(claim("x", 1, { claimedAmount: 10000, approvedAmount: 7000, settledAmount: 2000 })) === 5000,
  );
  check("rejected claims owe nothing", cl.claimPending(claim("x", 1, { claimedAmount: 10000, status: "Rejected" })) === 0);
  check(
    "a fully settled claim owes nothing, deduction or not",
    cl.claimPending(claim("x", 1, { claimedAmount: 10000, approvedAmount: 7000, settledAmount: 7000, status: "Settled" })) === 0,
  );
  check("full payment settles", cl.settledStatus(25000, 25000) === "Settled");
  check("short payment is a part settlement", cl.settledStatus(20000, 25000) === "Partially settled");
  check("over-payment still settles", cl.settledStatus(26000, 25000) === "Settled");
  check("delta ignores what was already posted", cl.settlementDelta(claim("x", 1, { settlementPosted: 10000 }), 25000) === 15000);
  check("re-saving the same settlement posts nothing", cl.settlementDelta(claim("x", 1, { settlementPosted: 25000 }), 25000) === 0);
  check("a corrected settlement posts the difference", cl.settlementDelta(claim("x", 1, { settlementPosted: 25000 }), 20000) === -5000);
  const paid = cl.applyPayment(bill("b1", { paid: 5000, due: 40000 }), 20000);
  check("payment raises paid and clears dues", paid.paid === 25000 && paid.due === 20000);
  check("payments are marked as insurance", paid.paymentMode === "Insurance / TPA");
  check("payment never exceeds the bill", cl.applyPayment(bill("b1"), 60000).paid === 45000);
  check("payment never exceeds the bill due", cl.applyPayment(bill("b1"), 60000).due === 0);
  const scheme = cl.applyPayment(bill("b1"), 1000, "Scheme (PM-JAY)");
  check("government schemes post under PM-JAY mode", scheme.paymentMode === "Scheme (PM-JAY)");
  check("claim raised against a bill takes the bill total", cl.claimedAmountForBill(bill("b1")) === 45000);

  /* ----------------------------------------------------------- ageing / SLA */
  check("submission stamp comes from the history", cl.submittedAt(state.claims.c1) === daysAgo(40));
  check("never-submitted claims have no stamp", cl.submittedAt(state.claims.c4) === 0);
  check("age runs to the settlement for closed claims", cl.claimAgeDays(state.claims.c2) === 5);
  check("open claims age to now", cl.claimAgeDays(state.claims.c1) === 40);
  check("due date = submission + payer window", cl.claimDueDate(state.claims.c1, state.payers.pay1) !== "");
  check("a 40-day-old claim past a 30-day window is overdue", cl.isOverdue(state.claims.c1, state.payers.pay1) === true);
  check(
    "a claim still in pre-auth is not overdue",
    cl.isOverdue(claim("x", 9, { status: "Pre-auth sent", events: [{ at: daysAgo(90), status: "Pre-auth sent", by: "", note: "" }] }), state.payers.pay1) === false,
  );
  check(
    "a settled claim is never overdue",
    cl.isOverdue(state.claims.c2, state.payers.pay1) === false,
  );
  check("no payer window means no SLA", cl.isOverdue(state.claims.c1, undefined) === false);

  /* ------------------------------------------------------------ statistics */
  const stats = cl.claimStats(cl.claimList(state));
  check("stats count every claim", stats.total === 5 && stats.open === 2 && stats.closed === 3);
  check("stats add the claimed money", stats.claimed === 115000);
  check("stats add the settled money", stats.settled === 28000);
  check("stats add the pending money", stats.pending === 68000);
  check("stats keep rejected apart", stats.byStatus.Rejected === 1);
  check("settlement rate is settled / claimed", stats.settlementRate === 24);
  check("rejection rate is a share of rows", stats.rejectionRate === 20);
  const queue = cl.claimQueueStats(state);
  check("queue counts pre-auth work", queue.preAuthPending === 1);
  check("queue counts claims with the payer", queue.awaitingSettlement === 1);
  check("queue sums what payers owe", queue.pendingAmount === 68000);
  check("queue flags the overdue file", queue.overdue === 1);

  /* ----------------------------------------------------------------- merge */
  const local = {
    ...state,
    patients: {},
    payers: state.payers,
    ops: { "claims:c1": 5, "payers:pay1": 5 },
    deleted: {},
  };
  const remote = {
    claims: { c1: { ...state.claims.c1, approvedAmount: 40000, status: "Approved" }, c9: claim("c9", 9) },
    payers: { pay1: { ...state.payers.pay1, settlementDays: 45 } },
    ops: { "claims:c1": 7, "claims:c9": 6, "payers:pay1": 7 },
    deleted: {},
  };
  const merged = mergeStates(local, remote);
  check("newer remote claim wins on sync", merged.claims.c1.status === "Approved");
  check("remote-only claims are brought in", merged.claims.c9.id === "c9");
  check("local-only claims survive", merged.claims.c4.id === "c4");
  check("payer master merges too", merged.payers.pay1.settlementDays === 45);
  const deletedState = mergeStates(local, { claims: {}, payers: {}, ops: {}, deleted: { "claims:c1": 8 } });
  check("claim tombstone wins on sync", !deletedState.claims.c1);
  check("payer tombstones work as well", !mergeStates(local, { claims: {}, payers: {}, ops: {}, deleted: { "payers:pay1": 8 } }).payers.pay1);
  check(
    "legacy backup without claims collections merges",
    !!mergeStates(local, { ops: {}, deleted: {} }).claims.c1,
  );

  console.log(failures === 0 ? "\nAll claims smoke tests passed." : `\n${failures} test(s) FAILED`);
  process.exitCode = failures ? 1 : 0;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
