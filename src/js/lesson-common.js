// ========================================
// VULANET LESSON COMMON ENGINE
// Shared across all lesson quizzes
// ========================================

// Sound Manager - Local audio only
const SoundManager = {
  play(soundName) {
    const audio = new Audio(`public/assets/audio/${soundName}.mp3`);
    audio.play().catch(e => console.log('Audio play failed:', e));
  },
  correct() { this.play('correct'); },
  incorrect() { this.play('incorrect'); },
  complete() { this.play('complete'); },
  streak() { this.play('streak'); },
  coins() { this.play('coins'); },
  boost() { this.play('boost'); },
  heartbeat() { this.play('heartbeat'); },
  quest() { this.play('quest'); },
  outOfHearts() { this.play('out-of-hearts'); },
  quit() { this.play('quit'); }
};

// XP Calculator
const XPCalculator = {
  calculate(totalQuestions, correctCount, timeTakenSeconds, activeBoost = null) {
    const completionXP = 10;
    const accuracyXP = Math.round((correctCount / totalQuestions) * 10);
    
    const expectedTime = totalQuestions * 15;
    const maxTime = expectedTime * 2;
    let speedXP = 0;
    
    if (timeTakenSeconds <= expectedTime) speedXP = 10;
    else if (timeTakenSeconds <= maxTime) {
      speedXP = Math.round(10 * (2 - (timeTakenSeconds / expectedTime)));
      speedXP = Math.max(0, speedXP);
    } else speedXP = 0;
    
    let totalXP = completionXP + accuracyXP + speedXP;
    let boostMultiplier = 1;
    let boostType = null;
    
    if (activeBoost) {
      boostMultiplier = activeBoost.multiplier;
      boostType = activeBoost.type;
      totalXP = Math.floor(totalXP * boostMultiplier);
    }
    
    return {
      baseXP: completionXP + accuracyXP + speedXP,
      totalXP, boostMultiplier, boostType,
      completionXP, accuracyXP, speedXP,
      expectedTime, timeTaken: timeTakenSeconds
    };
  },
  
  getTimeDisplay(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    if (remaining === 0) return `${minutes}m`;
    return `${minutes}m ${remaining}s`;
  },
  
  getPercentageDisplay(correct, total) {
    const percent = Math.round((correct / total) * 100);
    if (percent === 100) return 'PERFECT';
    if (percent >= 80) return 'OUTSTANDING';
    if (percent >= 50) return 'NICE';
    return 'YIKES';
  }
};

// Lives Manager
const LivesManager = {
  getLives() { return parseInt(localStorage.getItem('vulanet_lives') || '5'); },
  setLives(lives) { localStorage.setItem('vulanet_lives', Math.min(5, Math.max(0, lives))); return this.getLives(); },
  loseLife() { const lives = this.getLives(); if (lives > 0) this.setLives(lives - 1); return this.getLives(); },
  refillLives() { this.setLives(5); return this.getLives(); }
};

// Streak Manager
const StreakManager = {
  getStreak() { return parseInt(localStorage.getItem('vulanet_streak') || '0'); },
  increment() { const newStreak = this.getStreak() + 1; localStorage.setItem('vulanet_streak', newStreak); return newStreak; },
  reset() { localStorage.setItem('vulanet_streak', 0); return 0; },
  isFirstLessonToday() {
    const lastDate = localStorage.getItem('vulanet_last_lesson_date');
    const today = new Date().toDateString();
    return lastDate !== today;
  },
  markTodayCompleted() { localStorage.setItem('vulanet_last_lesson_date', new Date().toDateString()); }
};

// Progress Manager
const ProgressManager = {
  getLessonProgress(courseId, lessonId) {
    const key = `vulanet_progress_${courseId}_${lessonId}`;
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : { completed: false, mastered: false, attempts: 0, bestScore: 0 };
  },
  saveLessonProgress(courseId, lessonId, progress) {
    localStorage.setItem(`vulanet_progress_${courseId}_${lessonId}`, JSON.stringify(progress));
  },
  markCompleted(courseId, lessonId, score, xpEarned) {
    const progress = this.getLessonProgress(courseId, lessonId);
    progress.completed = true;
    progress.bestScore = Math.max(progress.bestScore, score);
    progress.attempts++;
    progress.xpEarned = xpEarned;
    this.saveLessonProgress(courseId, lessonId, progress);
    
    const totalXP = parseInt(localStorage.getItem('vulanet_total_xp') || '0');
    localStorage.setItem('vulanet_total_xp', totalXP + xpEarned);
    return progress;
  }
};

// Modal Manager - All modals use local assets
const ModalManager = {
  showModal(modalId, data = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById(modalId);
      if (!modal) { resolve({ action: 'continue' }); return; }
      
      modal.classList.add('visible');
      const handleAction = (action) => {
        modal.classList.remove('visible');
        resolve({ action, data });
      };
      
      modal.querySelectorAll('[data-modal-action]').forEach(btn => {
        btn.onclick = () => handleAction(btn.dataset.modalAction);
      });
    });
  },
  
  async showQuitConfirm() { return this.showModal('quitConfirmModal'); },
  async showHeartsRefill() { return this.showModal('heartsRefillModal'); },
  async showLessonComplete(xpData) { return this.showModal('lessonCompleteModal', xpData); },
  async showStreakDisplay(streak) { return this.showModal('streakDisplayModal', { streak }); },
  async showAchievement(achievement) { return this.showModal('achievementModal', achievement); },
  async showDailyQuests(quests) { return this.showModal('dailyQuestsModal', { quests }); }
};

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SoundManager, XPCalculator, LivesManager, StreakManager, ProgressManager, ModalManager };
}
