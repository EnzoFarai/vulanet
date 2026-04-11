/**
 * CelebrationManager - Handles milestone celebrations
 * Displays celebration overlay for streak milestones (5, 10, 15, 20, 25...)
 */

class CelebrationManager {
  constructor() {
    this.overlay = null;
    this.messageElement = null;
    this.continueBtn = null;
    this.isVisible = false;
    this.onContinueCallback = null;
  }

  /**
   * Initialize celebration overlay elements
   * @param {string} overlayId - ID of celebration overlay element
   * @param {string} messageId - ID of message element within overlay
   * @param {string} continueBtnId - ID of continue button within overlay
   */
  init(overlayId = 'celebrationOverlay', messageId = 'celebrationMessage', continueBtnId = 'celebrationContinueBtn') {
    this.overlay = document.getElementById(overlayId);
    this.messageElement = document.getElementById(messageId);
    this.continueBtn = document.getElementById(continueBtnId);
    
    if (this.continueBtn) {
      this.continueBtn.onclick = () => this.hide();
    }
  }

  /**
   * Show celebration overlay with milestone message
   * @param {number} milestone - The streak milestone (5, 10, 15, 20, 25...)
   * @param {Function} onContinue - Optional callback when user clicks Continue
   */
  show(milestone, onContinue = null) {
    if (!this.overlay) {
      console.warn('Celebration overlay not initialized');
      return;
    }
    
    this.onContinueCallback = onContinue;
    
    // Set message based on milestone
    const message = this.getMilestoneMessage(milestone);
    if (this.messageElement) {
      this.messageElement.textContent = message;
    }
    
    // Show overlay
    this.overlay.classList.add('visible');
    this.isVisible = true;
    
    // Set up continue button callback
    if (this.continueBtn && onContinue) {
      // Remove existing listeners to avoid duplicates
      const newBtn = this.continueBtn.cloneNode(true);
      this.continueBtn.parentNode.replaceChild(newBtn, this.continueBtn);
      this.continueBtn = newBtn;
      
      this.continueBtn.onclick = () => {
        this.hide();
        if (onContinue) onContinue();
      };
    }
  }

  /**
   * Get appropriate message for a milestone
   * @param {number} milestone - The streak milestone
   * @returns {string} Celebration message
   */
  getMilestoneMessage(milestone) {
    switch (milestone) {
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
        return `${milestone} in a row! Amazing!`;
    }
  }

  /**
   * Hide celebration overlay
   */
  hide() {
    if (this.overlay && this.isVisible) {
      this.overlay.classList.remove('visible');
      this.isVisible = false;
    }
  }

  /**
   * Check if celebration is currently visible
   * @returns {boolean} True if visible
   */
  isActive() {
    return this.isVisible;
  }

  /**
   * Set custom continue button callback
   * @param {Function} callback - Function to call on continue
   */
  setContinueCallback(callback) {
    this.onContinueCallback = callback;
    if (this.continueBtn) {
      this.continueBtn.onclick = () => {
        this.hide();
        if (callback) callback();
      };
    }
  }
}

// Export for use in lessons
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CelebrationManager };
}
