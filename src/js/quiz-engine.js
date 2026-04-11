// ========================================
// VULANET QUIZ ENGINE
// Shared quiz logic for all lessons
// ========================================

// Sound Manager
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
  quest() { this.play('quest'); }
};

// XP Calculator
const XPCalculator = {
  calculate(totalQuestions, correctCount, timeTakenSeconds, activeBoost = null) {
    // Completion XP (always 10)
    const completionXP = 10;
    
    // Accuracy XP
    const accuracyXP = Math.round((correctCount / totalQuestions) * 10);
    
    // Speed XP
    const expectedTime = totalQuestions * 15;
    const maxTime = expectedTime * 2;
    let speedXP = 0;
    
    if (timeTakenSeconds <= expectedTime) {
      speedXP = 10;
    } else if (timeTakenSeconds <= maxTime) {
      speedXP = Math.round(10 * (2 - (timeTakenSeconds / expectedTime)));
      speedXP = Math.max(0, speedXP);
    } else {
      speedXP = 0;
    }
    
    let totalXP = completionXP + accuracyXP + speedXP;
    
    // Apply XP boost if active
    let boostMultiplier = 1;
    let boostType = null;
    if (activeBoost) {
      boostMultiplier = activeBoost.multiplier;
      boostType = activeBoost.type;
      totalXP = Math.floor(totalXP * boostMultiplier);
    }
    
    return {
      baseXP: completionXP + accuracyXP + speedXP,
      totalXP,
      boostMultiplier,
      boostType,
      completionXP,
      accuracyXP,
      speedXP,
      expectedTime,
      timeTaken: timeTakenSeconds
    };
  },
  
  getTimeDisplay(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) return `${minutes}m`;
    return `${minutes}m ${remainingSeconds}s`;
  },
  
  getPercentageDisplay(correct, total) {
    const percent = Math.round((correct / total) * 100);
    if (percent === 100) return 'PERFECT';
    if (percent >= 80) return 'OUTSTANDING';
    if (percent >= 50) return 'NICE';
    return 'YIKES';
  }
};

// Streak Manager
const StreakManager = {
  getStreakCount() {
    return parseInt(localStorage.getItem('vulanet_streak') || '0');
  },
  
  updateStreak(completedToday = false) {
    const lastLessonDate = localStorage.getItem('vulanet_last_lesson_date');
    const today = new Date().toDateString();
    
    let currentStreak = this.getStreakCount();
    
    if (!completedToday) return currentStreak;
    
    if (!lastLessonDate) {
      currentStreak = 1;
    } else if (lastLessonDate === today) {
      // Already completed today, don't increase
      return currentStreak;
    } else {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      if (lastLessonDate === yesterday.toDateString()) {
        currentStreak++;
      } else {
        currentStreak = 1;
      }
    }
    
    localStorage.setItem('vulanet_streak', currentStreak);
    localStorage.setItem('vulanet_last_lesson_date', today);
    return currentStreak;
  },
  
  isFirstLessonOfDay() {
    const lastLessonDate = localStorage.getItem('vulanet_last_lesson_date');
    const today = new Date().toDateString();
    return lastLessonDate !== today;
  }
};

// Lives Manager
const LivesManager = {
  getLives() {
    return parseInt(localStorage.getItem('vulanet_lives') || '5');
  },
  
  setLives(lives) {
    localStorage.setItem('vulanet_lives', Math.min(5, Math.max(0, lives)));
    return this.getLives();
  },
  
  loseLife() {
    const lives = this.getLives();
    if (lives > 0) {
      this.setLives(lives - 1);
      SoundManager.incorrect();
    }
    return this.getLives();
  },
  
  refillLives() {
    this.setLives(5);
    return this.getLives();
  }
};

// Progress Manager
const ProgressManager = {
  getLessonProgress(courseId, lessonId) {
    const key = `vulanet_progress_${courseId}_${lessonId}`;
    const saved = localStorage.getItem(key);
    if (saved) return JSON.parse(saved);
    return {
      completed: false,
      mastered: false,
      bestScore: 0,
      attempts: 0,
      lastAttempt: null
    };
  },
  
  saveLessonProgress(courseId, lessonId, progress) {
    const key = `vulanet_progress_${courseId}_${lessonId}`;
    localStorage.setItem(key, JSON.stringify(progress));
  },
  
  markCompleted(courseId, lessonId, score, xpEarned) {
    const progress = this.getLessonProgress(courseId, lessonId);
    progress.completed = true;
    progress.bestScore = Math.max(progress.bestScore, score);
    progress.attempts++;
    progress.lastAttempt = new Date().toISOString();
    progress.xpEarned = xpEarned;
    this.saveLessonProgress(courseId, lessonId, progress);
    
    // Update total XP
    const totalXP = parseInt(localStorage.getItem('vulanet_total_xp') || '0');
    localStorage.setItem('vulanet_total_xp', totalXP + xpEarned);
    
    return progress;
  },
  
  markMastered(courseId, lessonId) {
    const progress = this.getLessonProgress(courseId, lessonId);
    progress.mastered = true;
    this.saveLessonProgress(courseId, lessonId, progress);
    return progress;
  }
};

// Modal Manager
const ModalManager = {
  showModal(modalId, data = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById(modalId);
      if (!modal) {
        resolve({ action: 'continue' });
        return;
      }
      
      modal.classList.add('visible');
      
      const handleAction = (action) => {
        modal.classList.remove('visible');
        cleanup();
        resolve({ action, data });
      };
      
      const cleanup = () => {
        modal.querySelectorAll('[data-modal-action]').forEach(btn => {
          btn.removeEventListener('click', handlers[btn.dataset.modalAction]);
        });
      };
      
      const handlers = {};
      modal.querySelectorAll('[data-modal-action]').forEach(btn => {
        const action = btn.dataset.modalAction;
        handlers[action] = () => handleAction(action);
        btn.addEventListener('click', handlers[action]);
      });
    });
  },
  
  async showQuitConfirm() {
    return this.showModal('quitConfirmModal');
  },
  
  async showHeartsRefill() {
    return this.showModal('heartsRefillModal');
  },
  
  async showLessonComplete(xpData, isFirstLessonOfDay = false) {
    // Update modal content before showing
    const modal = document.getElementById('lessonCompleteModal');
    if (modal) {
      const totalXPEl = modal.querySelector('[data-xp-total]');
      const accuracyEl = modal.querySelector('[data-accuracy]');
      const timeEl = modal.querySelector('[data-time]');
      const percentageEl = modal.querySelector('[data-percentage]');
      
      if (totalXPEl) totalXPEl.textContent = xpData.totalXP;
      if (accuracyEl) accuracyEl.textContent = `${xpData.accuracyXP}/10`;
      if (timeEl) timeEl.textContent = XPCalculator.getTimeDisplay(xpData.timeTaken);
      if (percentageEl) percentageEl.textContent = XPCalculator.getPercentageDisplay(xpData.correct, xpData.total);
      
      // Show streak modal if first lesson of day
      if (isFirstLessonOfDay) {
        setTimeout(() => this.showModal('streakDisplayModal'), 500);
      }
    }
    return this.showModal('lessonCompleteModal');
  },
  
  async showStreakDisplay(streakCount, message) {
    const modal = document.getElementById('streakDisplayModal');
    if (modal) {
      const streakEl = modal.querySelector('[data-streak-number]');
      const messageEl = modal.querySelector('[data-streak-message]');
      if (streakEl) streakEl.textContent = streakCount;
      if (messageEl) messageEl.textContent = message;
    }
    return this.showModal('streakDisplayModal');
  },
  
  async showAchievement(achievement) {
    const modal = document.getElementById('achievementModal');
    if (modal) {
      const titleEl = modal.querySelector('[data-achievement-title]');
      const numberEl = modal.querySelector('[data-achievement-number]');
      const iconEl = modal.querySelector('[data-achievement-icon]');
      if (titleEl) titleEl.textContent = achievement.title;
      if (numberEl) numberEl.textContent = achievement.number;
      if (iconEl && achievement.icon) iconEl.src = achievement.icon;
    }
    return this.showModal('achievementModal');
  },
  
  async showDailyQuests(quests) {
    const modal = document.getElementById('dailyQuestsModal');
    if (modal) {
      const container = modal.querySelector('[data-quests-container]');
      if (container && quests) {
        container.innerHTML = quests.map(q => `
          <div class="quest-row">
            <div class="quest-info">
              <div class="quest-title">${q.title}</div>
              <div class="progress-wrapper">
                <div class="progress-bar">
                  <div class="progress-inner" style="width: ${(q.progress / q.target) * 100}%"></div>
                  <div class="progress-count">${q.progress} / ${q.target}</div>
                </div>
              </div>
            </div>
            <div class="chest ${q.tier}" title="${q.tier} Chest">
              <span class="chest-icon"><img src="public/assets/icons/phosphor/regular/treasure-chest.svg" alt="Chest"></span>
            </div>
          </div>
        `).join('');
      }
    }
    return this.showModal('dailyQuestsModal');
  }
};

// Export for use in lessons
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SoundManager, XPCalculator, StreakManager, LivesManager, ProgressManager, ModalManager };
}
