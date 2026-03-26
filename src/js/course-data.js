// ========================================
// VULANET COURSE DATA
// Courses are identified by unique IDs to allow name changes without data loss
// ========================================

export const courses = {
  // Commerce
  "FIN-001": {
    id: "FIN-001",
    name: "Financial Accounting",
    displayName: "Financial Accounting",
    shortName: "Financial Accounting",
    category: "commerce",
    icon: "public/assets/courses/financial-accounting.png",
    order: 1,
    createdAt: "2024-01-01"
  },
  
  // Humanities
  "LAW-001": {
    id: "LAW-001",
    name: "International Law",
    displayName: "International Law",
    shortName: "International Law",
    category: "humanities",
    icon: "public/assets/courses/international-law.png",
    order: 1,
    createdAt: "2024-01-01"
  },
  
  // Medical Sciences
  "MED-001": {
    id: "MED-001",
    name: "Clinical Pharmacy",
    displayName: "Clinical Pharmacy",
    shortName: "Clinical Pharmacy",
    category: "medical",
    icon: "public/assets/courses/clinical-pharmacy.png",
    order: 1,
    createdAt: "2024-01-01"
  },
  "MED-002": {
    id: "MED-002",
    name: "Pharmacology-II",
    displayName: "Pharmacology-II",
    shortName: "Pharmacology-II",
    category: "medical",
    icon: "public/assets/courses/pharmacology-ii.png",
    order: 2,
    createdAt: "2024-01-01"
  },
  
  // Science & Technology
  "TECH-001": {
    id: "TECH-001",
    name: "Java Programming",
    displayName: "Java Programming",
    shortName: "Java Programming",
    category: "technology",
    icon: "public/assets/courses/java-programming.png",
    order: 1,
    createdAt: "2024-01-01"
  },
  "TECH-002": {
    id: "TECH-002",
    name: "Web Design",
    displayName: "Web Design",
    shortName: "Web Design",
    category: "technology",
    icon: "public/assets/courses/web-design.png",
    order: 2,
    createdAt: "2024-01-01"
  },
  
  // Matric (NSC)
  "SCI-001": {
    id: "SCI-001",
    name: "G12 Life Sciences",
    displayName: "G12 Life Sciences",
    shortName: "Life Sciences",
    category: "matric",
    icon: "public/assets/courses/g12-life-sciences.png",
    order: 1,
    createdAt: "2024-01-01"
  }
};

// Course categories for organization
export const courseCategories = [
  {
    id: "commerce",
    name: "Commerce",
    order: 1,
    courses: ["FIN-001"]
  },
  {
    id: "humanities",
    name: "Humanities",
    order: 2,
    courses: ["LAW-001"]
  },
  {
    id: "medical",
    name: "Medical Sciences",
    order: 3,
    courses: ["MED-001", "MED-002"]
  },
  {
    id: "technology",
    name: "Science & Technology",
    order: 4,
    courses: ["TECH-001", "TECH-002"]
  },
  {
    id: "matric",
    name: "Matric (NSC)",
    order: 5,
    courses: ["SCI-001"],
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
  return category.courses.map(id => courses[id]).filter(c => c);
}

// Helper function to get all courses
export function getAllCourses() {
  return Object.values(courses);
}
