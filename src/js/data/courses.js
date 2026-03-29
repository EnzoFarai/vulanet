// ========================================
// VULANET COURSE DATA
// Courses use semantic IDs that are stable
// No categories - categories are UI-only
// No createdAt dates - handled by database
// ========================================

export const courses = {
  "financial-accounting": {
    id: "financial-accounting",
    name: "Financial Accounting",
    displayName: "Financial Accounting",
    shortName: "Financial Accounting",
    slug: "financial-accounting",
    icon: "/public/assets/courses/financial-accounting.png",
    colorStartIndex: 0,  // Starts at Carpenter Blue
    lessons: []  // Lessons will be loaded separately
  },
  
  "international-law": {
    id: "international-law",
    name: "International Law",
    displayName: "International Law",
    shortName: "International Law",
    slug: "international-law",
    icon: "/public/assets/courses/international-law.png",
    colorStartIndex: 1,  // Starts at Gecko
    lessons: []
  },
  
  "clinical-pharmacy": {
    id: "clinical-pharmacy",
    name: "Clinical Pharmacy",
    displayName: "Clinical Pharmacy",
    shortName: "Clinical Pharmacy",
    slug: "clinical-pharmacy",
    icon: "/public/assets/courses/clinical-pharmacy.png",
    colorStartIndex: 2,  // Starts at Beetle
    lessons: []
  },
  
  "pharmacology-ii": {
    id: "pharmacology-ii",
    name: "Pharmacology-II",
    displayName: "Pharmacology-II",
    shortName: "Pharmacology-II",
    slug: "pharmacology-ii",
    icon: "/public/assets/courses/pharmacology-ii.png",
    colorStartIndex: 3,  // Starts at Ladybug
    lessons: []
  },
  
  "java-programming": {
    id: "java-programming",
    name: "Java Programming",
    displayName: "Java Programming",
    shortName: "Java Programming",
    slug: "java-programming",
    icon: "/public/assets/courses/java-programming.png",
    colorStartIndex: 4,  // Starts at Tiger
    lessons: []
  },
  
  "web-design": {
    id: "web-design",
    name: "Web Design",
    displayName: "Web Design",
    shortName: "Web Design",
    slug: "web-design",
    icon: "/public/assets/courses/web-design.png",
    colorStartIndex: 5,  // Starts at Bee
    lessons: []
  },
  
  "g12-life-sciences": {
    id: "g12-life-sciences",
    name: "G12 Life Sciences",
    displayName: "G12 Life Sciences",
    shortName: "Life Sciences",
    slug: "g12-life-sciences",
    icon: "/public/assets/courses/g12-life-sciences.png",
    colorStartIndex: 0,  // Starts at Carpenter Blue
    lessons: []
  }
};

// Helper function to get course by ID
export function getCourseById(id) {
  return courses[id] || null;
}

// Helper function to get all courses
export function getAllCourses() {
  return Object.values(courses);
}

// Helper to get course color start index
export function getCourseColorStartIndex(courseId) {
  const course = courses[courseId];
  return course ? course.colorStartIndex : 0;
}
