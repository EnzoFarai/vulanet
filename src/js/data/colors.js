// ========================================
// VULANET COLOR SEQUENCE
// For chapters, cards, and UI elements
// ========================================

// Color sequence from brand guidelines
export const COLOR_SEQUENCE = [
  { name: "Carpenter Blue", hex: "#4285F4", className: "chapter-1" },
  { name: "Gecko", hex: "#1CB0F6", className: "chapter-2" },
  { name: "Beetle", hex: "#AA00FF", className: "chapter-3" },
  { name: "Ladybug", hex: "#EA4335", className: "chapter-4" },
  { name: "Tiger", hex: "#FF6D01", className: "chapter-5" },
  { name: "Bee", hex: "#FBBC05", className: "chapter-6" },
  { name: "Boa", hex: "#34A853", className: "chapter-7" }
];

// Get color for a chapter, starting from a specific index
export function getChapterColor(chapterNumber, startIndex = 0) {
  const sequenceIndex = (startIndex + (chapterNumber - 1)) % COLOR_SEQUENCE.length;
  return {
    ...COLOR_SEQUENCE[sequenceIndex],
    index: sequenceIndex
  };
}

// Get all colors for a course (for generating theme)
export function getCourseTheme(courseId, startIndex = 0, chapterCount = 10) {
  const theme = {};
  for (let i = 1; i <= chapterCount; i++) {
    const color = getChapterColor(i, startIndex);
    theme[`--chapter-${i}`] = color.hex;
    theme[`chapter-${i}-class`] = color.className;
  }
  return theme;
}
