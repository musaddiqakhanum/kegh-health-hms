/**
 * Starter list of common Indian medicines (brand names as used in Indian
 * practice). Auto-seeded into the shared `medCatalog` on first load so the
 * doctor's suggestions and the pharmacist's stock list work out of the box.
 *
 * Forms must use canonical MED_CATEGORIES casing. Several names appear in
 * multiple forms on purpose — that is exactly the "Syrup or Drop or
 * Injection?" choice the doctor gets on screen.
 */
export interface IndianDrugSeed {
  name: string;
  form: string;
  strength: string;
}

export const INDIAN_DRUGS: readonly IndianDrugSeed[] = [
  /* ---- fever / pain ---- */
  { name: "Dolo 650", form: "Tablet", strength: "650 mg" },
  { name: "Crocin", form: "Tablet", strength: "500 mg" },
  { name: "Calpol", form: "Syrup", strength: "250 mg/5 ml" },
  { name: "Calpol", form: "Drops", strength: "100 mg/ml" },
  { name: "Meftal", form: "Tablet", strength: "500 mg" },
  { name: "Meftal", form: "Suspension", strength: "100 mg/5 ml" },
  { name: "Brufen", form: "Tablet", strength: "400 mg" },
  { name: "Combiflam", form: "Tablet", strength: "400 mg + 325 mg" },
  { name: "Ultracet", form: "Tablet", strength: "37.5 mg + 325 mg" },
  { name: "Zerodol-P", form: "Tablet", strength: "100 mg + 325 mg" },
  { name: "Volini", form: "Ointment / Cream", strength: "1.16% gel" },
  { name: "Tramadol", form: "Injection", strength: "50 mg/ml" },
  { name: "Paracetamol IV", form: "Injection", strength: "1 g/100 ml" },
  { name: "Dexona", form: "Injection", strength: "4 mg/ml" },

  /* ---- antibiotics ---- */
  { name: "Augmentin", form: "Tablet", strength: "625 mg" },
  { name: "Augmentin", form: "Syrup", strength: "228 mg/5 ml" },
  { name: "Augmentin", form: "Suspension", strength: "457 mg/5 ml" },
  { name: "Augmentin", form: "Injection", strength: "1.2 g" },
  { name: "Azithral", form: "Tablet", strength: "250 mg" },
  { name: "Azithral", form: "Tablet", strength: "500 mg" },
  { name: "Azithral", form: "Suspension", strength: "200 mg/5 ml" },
  { name: "Azithral", form: "Drops", strength: "100 mg/ml" },
  { name: "Taxim-O", form: "Tablet", strength: "200 mg" },
  { name: "Taxim-O", form: "Suspension", strength: "50 mg/5 ml" },
  { name: "Monocef", form: "Injection", strength: "1 g" },
  { name: "Ciplox", form: "Tablet", strength: "500 mg" },
  { name: "Ciplox-D", form: "Drops", strength: "0.3% eye/ear" },
  { name: "Metrogyl", form: "Tablet", strength: "400 mg" },
  { name: "Metrogyl", form: "Suspension", strength: "200 mg/5 ml" },
  { name: "Doxt-SL", form: "Capsule", strength: "100 mg" },

  /* ---- allergy / cold / cough ---- */
  { name: "Okacet", form: "Tablet", strength: "10 mg" },
  { name: "Avil", form: "Tablet", strength: "25 mg" },
  { name: "Avil", form: "Injection", strength: "22.75 mg/ml" },
  { name: "Phenergan", form: "Syrup", strength: "5 mg/5 ml" },
  { name: "Zyncet", form: "Syrup", strength: "5 mg/5 ml" },
  { name: "Benadryl", form: "Syrup", strength: "cough formula" },
  { name: "Ambrodil-S", form: "Syrup", strength: "15 mg + 1 mg/5 ml" },
  { name: "Asthalin", form: "Inhaler", strength: "100 mcg/dose" },
  { name: "Asthalin", form: "Syrup", strength: "2 mg/5 ml" },
  { name: "Montek-LC", form: "Tablet", strength: "10 mg + 5 mg" },
  { name: "Sinarest", form: "Tablet", strength: "500 mg + 2 mg + 10 mg" },
  { name: "Sinarest", form: "Syrup", strength: "AF paediatric" },
  { name: "Betnesol", form: "Tablet", strength: "0.5 mg" },
  { name: "Betnesol", form: "Injection", strength: "4 mg/ml" },
  { name: "Wysolone", form: "Tablet", strength: "5 mg" },
  { name: "Wysolone", form: "Tablet", strength: "10 mg" },

  /* ---- stomach / GI ---- */
  { name: "Pan 40", form: "Tablet", strength: "40 mg" },
  { name: "Pan 40", form: "Injection", strength: "40 mg" },
  { name: "Pan-D", form: "Capsule", strength: "40 mg + 30 mg" },
  { name: "Omez", form: "Capsule", strength: "20 mg" },
  { name: "Emeset", form: "Tablet", strength: "4 mg" },
  { name: "Emeset", form: "Syrup", strength: "2 mg/5 ml" },
  { name: "Emeset", form: "Injection", strength: "2 mg/ml" },
  { name: "Lactihep", form: "Syrup", strength: "10 g/15 ml" },
  { name: "Electral", form: "Sachet", strength: "21.8 g (ORS)" },
  { name: "Norflox-TZ", form: "Tablet", strength: "400 mg + 600 mg" },
  { name: "Sporlac", form: "Tablet", strength: "chewable" },

  /* ---- vitamins / supplements ---- */
  { name: "Zincovit", form: "Tablet", strength: "multivitamin" },
  { name: "Zincovit", form: "Syrup", strength: "multivitamin" },
  { name: "Shelcal", form: "Tablet", strength: "500 mg calcium" },
  { name: "Orofer XT", form: "Tablet", strength: "iron + folic acid" },
  { name: "Becosules", form: "Capsule", strength: "B-complex" },

  /* ---- eyes / skin ---- */
  { name: "Refresh Tears", form: "Drops", strength: "0.5%/0.3%" },
  { name: "Nasivion", form: "Drops", strength: "0.01% paediatric" },
  { name: "Betadine", form: "Ointment / Cream", strength: "5%" },
  { name: "Soframycin", form: "Ointment / Cream", strength: "1%" },
  { name: "Candid-B", form: "Ointment / Cream", strength: "1% + 0.05%" },

  /* ---- chronic ---- */
  { name: "Glycomet", form: "Tablet", strength: "500 mg SR" },
  { name: "Telma", form: "Tablet", strength: "40 mg" },
  { name: "Amlong", form: "Tablet", strength: "5 mg" },
  { name: "Thyronorm", form: "Tablet", strength: "50 mcg" },
];
