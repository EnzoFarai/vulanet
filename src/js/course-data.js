// ========================================
// VULANET COURSE DATA
// Courses use semantic IDs for permanence
// Categories are NOT stored here - they are only for UI display
// ========================================

// Course data with accurate creation dates (actual launch date)
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
    createdAt: "2025-03-15", // Actual launch date
    firstLessonId: "introduction-to-financial-accounting",
    firstReadingId: "introduction-to-financial-accounting-reading"
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
    firstReadingId: "introduction-to-international-law-reading"
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
    firstReadingId: "introduction-to-clinical-pharmacy-reading"
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
    firstReadingId: "introduction-to-anticoagulants-reading"
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
    firstReadingId: "introduction-to-java-reading"
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
    firstReadingId: "introduction-to-web-design-reading"
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
    firstReadingId: "introduction-to-nucleic-acids-reading"
  }
};

// Course categories - stored separately for UI display only
// Courses can appear in multiple categories, and categories can change over time
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

// Helper function to get course by ID
export function getCourseById(id) {
  return courses[id] || null;
}

// Helper function to get courses by category (UI only)
export function getCoursesByCategory(categoryId) {
  const category = courseCategories.find(c => c.id === categoryId);
  if (!category) return [];
  return category.courseIds.map(id => courses[id]).filter(c => c);
}

// Helper function to get all courses
export function getAllCourses() {
  return Object.values(courses);
}

// Helper function to get a course's first lesson URL
export function getFirstLessonUrl(courseId, startWith = "game") {
  const course = courses[courseId];
  if (!course) return null;
  
  if (startWith === "game") {
    return `/src/pages/lessons/${courseId}/${course.firstLessonId}.html`;
  } else {
    return `/src/pages/read/${courseId}/${course.firstReadingId}.html`;
  }
}
