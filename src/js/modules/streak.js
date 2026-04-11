/**
 * StreakManager - Handles streak tracking and display
 * Manages consecutive correct answer streaks and updates UI
 */

class StreakManager {
  constructor() {
    this.currentStreak = 0;
    this.counterElement = null;
  }

  /**
   * Increment streak by 1 and update display
   * @returns {number} New streak count
   */
  increment() {
    this.currentStreak++;
    this.updateDisplay();
    return this.currentStreak;
  }

  /**
   * Reset streak to 0 and update display
   * @returns {number} New streak count (0)
   */
  reset() {
    this.currentStreak = 0;
    this.updateDisplay();
    return this.currentStreak;
  }

  /**
   * Get current streak count
   * @returns {number} Current streak
   */
  getCount() {
    return this.currentStreak;
  }

  /**
   * Check if current streak is a milestone (multiple of 5)
   * @returns {boolean} True if streak is a milestone (5, 10, 15, 20, 25...)
   */
  isMilestone() {
    return this.currentStreak > 0 && this.currentStreak % 5 === 0;
  }

  /**
   * Get milestone message for celebration
   * @returns {string} Appropriate celebration message
   */
  getMilestoneMessage() {
    switch (this.currentStreak) {
      case 5:
        return "5 in a row! Fantastic!";
      case 10:
        return "Wow, that's now 10 in a row! Is there anything you don't know?";
      case 15:
        return "15 in a row! That's the definition of perfection!";
      case 20:
        return "20 in a row! You're a pro!";
      case 25:
        return "25 in a row! Are you even human?";
      default:
        return `${this.currentStreak} in a row! Amazing!`;
    }
  }

  /**
   * Update the streak counter display in UI
   * @param {string} elementId - ID of element to update (optional, uses stored element)
   */
  updateDisplay(elementId) {
    if (elementId) {
      this.counterElement = document.getElementById(elementId);
    }
    
    if (this.counterElement) {
      if (this.currentStreak >= 2) {
        this.counterElement.textContent = `${this.currentStreak} in a row`;
      } else {
        this.counterElement.textContent = '';
      }
    }
  }

  /**
   * Set streak counter element reference
   * @param {HTMLElement} element - DOM element for streak display
   */
  setCounterElement(element) {
    this.counterElement = element;
  }
}

// Export for use in lessons
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StreakManager };
}
