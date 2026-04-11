/**
 * LivesManager - Handles lives/hearts tracking
 * Manages remaining lives, heart icon states, and sound triggers
 */

class LivesManager {
  constructor() {
    this.lives = 5;
    this.livesElement = null;
    this.iconElement = null;
    this.audioPlayer = null; // Will be set externally to avoid circular dependency
  }

  /**
   * Set audio player reference
   * @param {Object} audio - AudioPlayer instance
   */
  setAudioPlayer(audio) {
    this.audioPlayer = audio;
  }

  /**
   * Decrement lives by 1
   * @returns {number} New lives count
   */
  decrement() {
    if (this.lives > 0) {
      this.lives--;
      
      // Play incorrect sound when losing a life
      if (this.audioPlayer && this.lives < 5) {
        this.audioPlayer.playIncorrect();
      }
      
      this.updateDisplay();
    }
    return this.lives;
  }

  /**
   * Refill lives to maximum (5)
   * @returns {number} New lives count (5)
   */
  refill() {
    this.lives = 5;
    this.updateDisplay();
    return this.lives;
  }

  /**
   * Get current lives count
   * @returns {number} Current lives
   */
  getCount() {
    return this.lives;
  }

  /**
   * Check if user has any lives remaining
   * @returns {boolean} True if lives > 0
   */
  hasLives() {
    return this.lives > 0;
  }

  /**
   * Update lives count display and heart icon
   * @param {string} livesElementId - ID of element for lives count
   * @param {string} iconElementId - ID of element for heart icon
   */
  updateDisplay(livesElementId, iconElementId) {
    if (livesElementId) {
      this.livesElement = document.getElementById(livesElementId);
    }
    if (iconElementId) {
      this.iconElement = document.getElementById(iconElementId);
    }
    
    // Update lives count text
    if (this.livesElement) {
      this.livesElement.textContent = this.lives;
    }
    
    // Update heart icon (fill vs regular)
    this.updateHeartIcon();
  }

  /**
   * Update heart icon between fill and regular based on lives
   * @param {string} iconElementId - Optional ID of heart icon element
   */
  updateHeartIcon(iconElementId) {
    if (iconElementId) {
      this.iconElement = document.getElementById(iconElementId);
    }
    
    if (this.iconElement) {
      if (this.lives === 0) {
        // Change to regular (empty) heart when no lives left
        this.iconElement.classList.remove('ph-fill');
        this.iconElement.classList.add('ph');
      } else {
        // Change to fill heart when lives remain
        this.iconElement.classList.remove('ph');
        this.iconElement.classList.add('ph-fill');
      }
    }
  }

  /**
   * Set lives count directly
   * @param {number} count - New lives count (clamped between 0 and 5)
   */
  setLives(count) {
    this.lives = Math.min(5, Math.max(0, count));
    this.updateDisplay();
  }
}

// Export for use in lessons
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LivesManager };
}
