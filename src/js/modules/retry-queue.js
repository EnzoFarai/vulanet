/**
 * RetryQueue - Manages retry queue for incorrect answers
 * Handles collecting wrong answers and replaying them after quiz completion
 */

class RetryQueue {
  constructor() {
    this.queue = [];
    this.currentIndex = 0;
    this.inRetryMode = false;
    this.showedRetryMessage = false;
    this.retryContainer = null;
  }

  /**
   * Add a question to the retry queue
   * @param {number} questionId - ID of the question to retry
   */
  addQuestion(questionId) {
    // Avoid duplicate entries in the queue
    if (!this.queue.includes(questionId)) {
      this.queue.push(questionId);
    }
  }

  /**
   * Add multiple questions to the retry queue
   * @param {Array<number>} questionIds - Array of question IDs
   */
  addQuestions(questionIds) {
    questionIds.forEach(id => {
      if (!this.queue.includes(id)) {
        this.queue.push(id);
      }
    });
  }

  /**
   * Get current question index in retry mode
   * @returns {number} Current index
   */
  getCurrentIndex() {
    return this.currentIndex;
  }

  /**
   * Get current question ID in retry mode
   * @returns {number|null} Current question ID or null if queue empty
   */
  getCurrentQuestion() {
    if (this.currentIndex < this.queue.length) {
      return this.queue[this.currentIndex];
    }
    return null;
  }

  /**
   * Move to next question in retry queue
   * @returns {boolean} True if there is a next question
   */
  next() {
    this.currentIndex++;
    return this.currentIndex < this.queue.length;
  }

  /**
   * Start retry mode
   * @returns {boolean} True if there are questions to retry
   */
  startRetry() {
    if (this.queue.length === 0) {
      return false;
    }
    
    this.inRetryMode = true;
    this.currentIndex = 0;
    return true;
  }

  /**
   * End retry mode and reset state
   */
  endRetry() {
    this.inRetryMode = false;
    this.queue = [];
    this.currentIndex = 0;
    this.showedRetryMessage = false;
    this.removeRetryContainer();
  }

  /**
   * Check if currently in retry mode
   * @returns {boolean} True if in retry mode
   */
  isInRetryMode() {
    return this.inRetryMode;
  }

  /**
   * Check if there are questions to retry
   * @returns {boolean} True if queue has items
   */
  hasQuestions() {
    return this.queue.length > 0;
  }

  /**
   * Get number of questions in retry queue
   * @returns {number} Queue length
   */
  getCount() {
    return this.queue.length;
  }

  /**
   * Show retry message modal
   * @param {Function} onContinue - Callback when user clicks Continue
   * @param {string} containerSelector - Optional selector for quiz container
   */
  showRetryMessage(onContinue, containerSelector = '.quiz-container') {
    if (this.showedRetryMessage) return;
    
    this.showedRetryMessage = true;
    
    // Create retry message element
    this.retryContainer = document.createElement('div');
    this.retryContainer.id = 'retryMessage';
    this.retryContainer.innerHTML = `
      <div class="question-container">
        <div class="icon-container">
          <i class="ph-fill ph-rabbit"></i>
        </div>
        
        <div speech-bubble pleft acenter style="--bbColor:#FFFFFF">
          <div class="bubble-text">
            Practice makes perfect. Let's review your mistakes before we go ahead.
          </div>
        </div>
      </div>
      
      <div class="footer">
        <button class="check-button" id="retryContinueBtn">Continue</button>
      </div>
    `;
    
    // Add to quiz container
    const container = document.querySelector(containerSelector);
    if (container) {
      container.appendChild(this.retryContainer);
    }
    
    // Set up continue button
    const continueBtn = document.getElementById('retryContinueBtn');
    if (continueBtn) {
      continueBtn.onclick = () => {
        this.removeRetryContainer();
        if (onContinue) onContinue();
      };
    }
  }

  /**
   * Remove retry message container
   */
  removeRetryContainer() {
    if (this.retryContainer && this.retryContainer.parentNode) {
      this.retryContainer.remove();
    }
    this.retryContainer = null;
  }

  /**
   * Reset queue state (for starting new quiz or after completion)
   */
  reset() {
    this.queue = [];
    this.currentIndex = 0;
    this.inRetryMode = false;
    this.showedRetryMessage = false;
    this.removeRetryContainer();
  }
}

// Export for use in lessons
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RetryQueue };
}
