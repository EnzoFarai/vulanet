// ========================================
// VULANET COURSE DATA
// Courses use semantic IDs that are category-agnostic
// IDs are based on course name slugs for readability and permanence
// ========================================

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
    createdAt: "2024-01-01",
    categories: ["commerce"]
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
    createdAt: "2024-01-01",
    categories: ["humanities"]
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
    createdAt: "2024-01-01",
    categories: ["medical"]
  },
  "pharmacology-ii": {
    id: "pharmacology-ii",
    name: "Pharmacology-II",
    displayName: "Pharmacology-II",
    shortName: "Pharmacology-II",
    slug: "pharmacology-ii",
    icon: "public/assets/courses/pharmacology-ii.png",
    order: 2,
    createdAt: "2024-01-01",
    categories: ["medical"]
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
    createdAt: "2024-01-01",
    categories: ["technology"]
  },
  "web-design": {
    id: "web-design",
    name: "Web Design",
    displayName: "Web Design",
    shortName: "Web Design",
    slug: "web-design",
    icon: "public/assets/courses/web-design.png",
    order: 2,
    createdAt: "2024-01-01",
    categories: ["technology"]
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
    createdAt: "2024-01-01",
    categories: ["matric", "science"]
  }
};

// Course categories - flexible for any course to appear in multiple categories
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

// Helper function to get courses by category
export function getCoursesByCategory(categoryId) {
  const category = courseCategories.find(c => c.id === categoryId);
  if (!category) return [];
  return category.courseIds.map(id => courses[id]).filter(c => c);
}

// Helper function to get all courses
export function getAllCourses() {
  return Object.values(courses);
}

// Helper to get courses that match multiple categories
export function getCoursesByCategories(categoryIds) {
  const allCourses = getAllCourses();
  return allCourses.filter(course => 
    course.categories.some(cat => categoryIds.includes(cat))
  );
}
