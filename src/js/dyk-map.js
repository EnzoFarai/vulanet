// src/js/dyk-map.js
// Maps course IDs to their corresponding DYK fact files.
// Each course can use one or more files; facts are pooled randomly.

export const dykMap = {
  // G12 Life Sciences — biology facts only
  "g12-life-sciences": ["biology"],

  // Pharmacology-II — biology + medicine facts
  "pharmacology-ii": ["biology", "medicine"],

  // Clinical Pharmacy — medicine facts
  "clinical-pharmacy": ["medicine"],

  // Financial Accounting — business facts
  "financial-accounting": ["business"],

  // International Law — law facts
  "international-law": ["law"],

  // Java Programming — computer‑science facts
  "java-programming": ["computer-science"],

  // Web Design — computer‑science facts
  "web-design": ["computer-science"],

  // Python Programming — computer‑science facts
  "python-programming": ["computer-science"],

  // Default fallback for any course not explicitly mapped
  // (could be expanded in the future)
  "__default__": ["general"]
};
