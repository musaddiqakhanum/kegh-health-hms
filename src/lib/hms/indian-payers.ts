/**
 * Starter list of payers an Indian hospital bills every week — government
 * schemes (PM-JAY, CGHS, ESIC…), the big private health insurers, the TPAs
 * that process for them and the usual corporate panels. Contact details and
 * settlement windows are deliberately left editable: the desk fills in the
 * phone number / portal it actually uses, and the master is only a head start,
 * never a source of truth. Anything missing slots in via Claims → Payers.
 */
export interface IndianPayerSeed {
  name: string;
  /** Short code printed on the register, e.g. "PMJAY". */
  code: string;
  type: "Government scheme" | "Private insurer" | "TPA" | "Corporate" | "Self pay";
  /** Days the payer usually takes to settle after submission. */
  settlementDays: number;
}

export const INDIAN_PAYERS: readonly IndianPayerSeed[] = [
  /* ------------------------------------------------ government schemes */
  {
    name: "PM-JAY (Ayushman Bharat)",
    code: "PMJAY",
    type: "Government scheme",
    settlementDays: 45,
  },
  {
    name: "Ayushman Bharat — Arogya Karnataka (AB-ArK)",
    code: "ABARK",
    type: "Government scheme",
    settlementDays: 45,
  },
  {
    name: "Ayushman Bharat — Mukhyamantri Amrutam (MA Yojana)",
    code: "MAY",
    type: "Government scheme",
    settlementDays: 45,
  },
  {
    name: "Chief Minister's Relief Fund",
    code: "CMRF",
    type: "Government scheme",
    settlementDays: 60,
  },
  { name: "CGHS", code: "CGHS", type: "Government scheme", settlementDays: 30 },
  { name: "ESIC", code: "ESIC", type: "Government scheme", settlementDays: 30 },
  {
    name: "ECHS (Ex-Servicemen Contributory Health Scheme)",
    code: "ECHS",
    type: "Government scheme",
    settlementDays: 30,
  },
  {
    name: "Railway Health Scheme (RHS)",
    code: "RHS",
    type: "Government scheme",
    settlementDays: 30,
  },
  {
    name: "State Government Employees Scheme",
    code: "SGES",
    type: "Government scheme",
    settlementDays: 30,
  },
  { name: "PM National Relief Fund", code: "PMNRF", type: "Government scheme", settlementDays: 60 },

  /* --------------------------------------------------- private insurers */
  {
    name: "Star Health & Allied Insurance",
    code: "STAR",
    type: "Private insurer",
    settlementDays: 30,
  },
  {
    name: "ICICI Lombard General Insurance",
    code: "ICICIL",
    type: "Private insurer",
    settlementDays: 30,
  },
  {
    name: "HDFC ERGO General Insurance",
    code: "HDFCE",
    type: "Private insurer",
    settlementDays: 30,
  },
  { name: "Niva Bupa Health Insurance", code: "NIVA", type: "Private insurer", settlementDays: 30 },
  { name: "Care Health Insurance", code: "CARE", type: "Private insurer", settlementDays: 30 },
  {
    name: "Bajaj Allianz General Insurance",
    code: "BAJAJ",
    type: "Private insurer",
    settlementDays: 30,
  },
  {
    name: "TATA AIG General Insurance",
    code: "TATAAIG",
    type: "Private insurer",
    settlementDays: 30,
  },
  { name: "SBI General Insurance", code: "SBIG", type: "Private insurer", settlementDays: 30 },
  {
    name: "Aditya Birla Health Insurance",
    code: "ABHI",
    type: "Private insurer",
    settlementDays: 30,
  },
  {
    name: "ManipalCigna Health Insurance",
    code: "MCIGNA",
    type: "Private insurer",
    settlementDays: 30,
  },
  {
    name: "Go Digit General Insurance",
    code: "DIGIT",
    type: "Private insurer",
    settlementDays: 30,
  },
  { name: "The New India Assurance Co.", code: "NIA", type: "Private insurer", settlementDays: 45 },
  { name: "United India Insurance Co.", code: "UII", type: "Private insurer", settlementDays: 45 },
  { name: "The Oriental Insurance Co.", code: "OIC", type: "Private insurer", settlementDays: 45 },
  { name: "National Insurance Co.", code: "NIC", type: "Private insurer", settlementDays: 45 },

  /* --------------------------------------------------------------- TPAs */
  { name: "Medi Assist India TPA", code: "MEDI", type: "TPA", settlementDays: 30 },
  { name: "Paramount Health Services TPA", code: "PARA", type: "TPA", settlementDays: 30 },
  { name: "Health India TPA", code: "HITPA", type: "TPA", settlementDays: 30 },
  { name: "Vidal Health TPA", code: "VIDAL", type: "TPA", settlementDays: 30 },
  { name: "MDIndia Health Insurance TPA", code: "MDIND", type: "TPA", settlementDays: 30 },
  { name: "Raksha Health Insurance TPA", code: "RAKSHA", type: "TPA", settlementDays: 30 },

  /* ---------------------------------------------------------- corporate */
  { name: "Corporate / employer panel", code: "CORP", type: "Corporate", settlementDays: 45 },
  {
    name: "Institutional credit (schools, factories)",
    code: "INST",
    type: "Corporate",
    settlementDays: 60,
  },
  { name: "Self pay / cash patient", code: "SELF", type: "Self pay", settlementDays: 0 },
];
