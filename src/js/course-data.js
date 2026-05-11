// ========================================
// VULANET COURSE DATA
// Courses use semantic IDs for permanence
// Categories are NOT stored here – they are only for UI display
// ========================================

// ------------------------------------------
// COURSE DEFINITIONS
// ------------------------------------------
export const courses = {
  // Commerce
  "financial-accounting": {
    id: "financial-accounting",
    name: "Financial Accounting",
    displayName: "Financial Accounting",
    shortName: "Financial Accounting",
    slug: "financial-accounting",
    icon: "public/assets/courses/financial-accounting.png",
    order: 1,
    createdAt: "2025-03-15",
    firstLessonId: "introduction-to-financial-accounting",
    firstReadingId: "introduction-to-financial-accounting-reading",
    dykSources: ["business.html", "mathematics.html"]
  },

  // Humanities
  "international-law": {
    id: "international-law",
    name: "International Law",
    displayName: "International Law",
    shortName: "International Law",
    slug: "international-law",
    icon: "public/assets/courses/international-law.png",
    order: 1,
    createdAt: "2025-03-15",
    firstLessonId: "introduction-to-international-law",
    firstReadingId: "introduction-to-international-law-reading",
    dykSources: ["law.html", "humanities.html"]
  },

  // Medical Sciences
  "clinical-pharmacy": {
    id: "clinical-pharmacy",
    name: "Clinical Pharmacy",
    displayName: "Clinical Pharmacy",
    shortName: "Clinical Pharmacy",
    slug: "clinical-pharmacy",
    icon: "public/assets/courses/clinical-pharmacy.png",
    order: 1,
    createdAt: "2025-03-15",
    firstLessonId: "introduction-to-clinical-pharmacy",
    firstReadingId: "introduction-to-clinical-pharmacy-reading",
    dykSources: ["medicine.html", "chemistry.html"]
  },
  "pharmacology-ii": {
    id: "pharmacology-ii",
    name: "Pharmacology-II",
    displayName: "Pharmacology-II",
    shortName: "Pharmacology-II",
    slug: "pharmacology-ii",
    icon: "public/assets/courses/pharmacology-ii.png",
    order: 2,
    createdAt: "2025-03-15",
    firstLessonId: "introduction-to-anticoagulants",
    firstReadingId: "introduction-to-anticoagulants-reading",
    dykSources: ["medicine.html", "biology.html"]
  },

  // Science & Technology
  "java-programming": {
    id: "java-programming",
    name: "Java Programming",
    displayName: "Java Programming",
    shortName: "Java Programming",
    slug: "java-programming",
    icon: "public/assets/courses/java-programming.png",
    order: 1,
    createdAt: "2025-03-15",
    firstLessonId: "introduction-to-java",
    firstReadingId: "introduction-to-java-reading",
    dykSources: ["computer-science.html", "engineering.html"]
  },
  "web-design": {
    id: "web-design",
    name: "Web Design",
    displayName: "Web Design",
    shortName: "Web Design",
    slug: "web-design",
    icon: "public/assets/courses/web-design.png",
    order: 2,
    createdAt: "2025-03-15",
    firstLessonId: "introduction-to-web-design",
    firstReadingId: "introduction-to-web-design-reading",
    dykSources: ["computer-science.html", "engineering.html"]
  },

  // Matric (NSC)
  "g12-life-sciences": {
    id: "g12-life-sciences",
    name: "G12 Life Sciences",
    displayName: "G12 Life Sciences",
    shortName: "Life Sciences",
    slug: "g12-life-sciences",
    icon: "public/assets/courses/g12-life-sciences.png",
    order: 1,
    createdAt: "2025-03-15",
    firstLessonId: "introduction-to-nucleic-acids",
    firstReadingId: "introduction-to-nucleic-acids-reading",
    dykSources: ["biology.html", "chemistry.html"]
  }
};

// ------------------------------------------
// CATEGORIES (UI only – not tied to courses)
// Courses can appear in multiple categories,
// and categories can be re‑ordered or renamed.
// ------------------------------------------
export const courseCategories = [
  {
    id: "commerce",
    name: "Commerce",
    order: 1,
    courseIds: ["financial-accounting"]
  },
  {
    id: "humanities",
    name: "Humanities",
    order: 2,
    courseIds: ["international-law"]
  },
  {
    id: "medical",
    name: "Medical Sciences",
    order: 3,
    courseIds: ["clinical-pharmacy", "pharmacology-ii"]
  },
  {
    id: "technology",
    name: "Science & Technology",
    order: 4,
    courseIds: ["java-programming", "web-design"]
  },
  {
    id: "matric",
    name: "Matric (NSC)",
    order: 5,
    courseIds: ["g12-life-sciences"],
    isSpecial: true
  }
];

// ------------------------------------------
// HELPER FUNCTIONS
// ------------------------------------------

/**
 * Get a single course by its ID.
 */
export function getCourseById(id) {
  return courses[id] || null;
}

/**
 * Get all courses belonging to a given category.
 * Returns an array of course objects (in category order).
 */
export function getCoursesByCategory(categoryId) {
  const category = courseCategories.find(c => c.id === categoryId);
  if (!category) return [];
  return category.courseIds
    .map(id => courses[id])
    .filter(course => course !== undefined);
}

/**
 * Get every defined course as an array.
 */
export function getAllCourses() {
  return Object.values(courses);
}

/**
 * Build the URL for the first lesson (or reading) of a course.
 * @param {string} courseId
 * @param {"game"|"reading"} startWith – "game" for lesson, "reading" for reading
 * @returns {string|null} The relative URL, or null if the course doesn't exist.
 */
export function getFirstLessonUrl(courseId, startWith = "game") {
  const course = courses[courseId];
  if (!course) return null;

  if (startWith === "game") {
    return `/pages/lesson.html?course=${encodeURIComponent(courseId)}&lesson=${encodeURIComponent(course.firstLessonId)}`;
  } else {
    return `/pages/reading.html?course=${encodeURIComponent(courseId)}&lesson=${encodeURIComponent(course.firstReadingId)}`;
  }
}

/**
 * Return the DYK file names associated with a course.
 * Falls back to "general.html" if no match is found.
 */
export function getCourseDykSources(courseId) {
  const course = courses[courseId];
  if (!course) return ["general.html"];
  return course.dykSources || ["general.html"];
}
