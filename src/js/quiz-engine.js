// src/js/quiz-engine.js
// ============================================================
// VULANET QUIZ ENGINE — Complete lesson / streak / reward pipeline
// ============================================================
//
// This file orchestrates the entire lesson lifecycle:
//   1. Runs the quiz (renderers, retry queue, answer streak)
//   2. Persists progress to Supabase (lesson_progress, user_stats,
//      daily_progress via quest-engine)
//   3. Runs the post-lesson reward pipeline sequentially:
//        lesson-complete → daily-goal coins → streak modal →
//        streak rewards → achievements → records → daily quests
//   4. Redirects to the course page (or to /registration.html for
//      guests, with temp progress saved to sessionStorage)
//
// Design rules (see spec §4 and inspection report §7):
//
//   • Reward sequence is LINEAR. Each step awaits the previous
//     modal's close before opening the next. No stacking.
//
//   • Coin grants go through incrementCoins() in supabase.js so
//     the DB stays canonical. coins-reward.html is a pure display
//     modal that credits nothing.
//
//   • NEVER call showCoinReward / showBoostReward / showHeartReward
//     from inside a message handler that is already running inside
//     an open modal. showModalAsync reuses the same iframe, so
//     opening a nested modal replaces the parent's iframe and
//     hangs the parent's promise.
//
//   • Quest claim ordering (spec §9): mark → credit → modal.
//     showDailyQuestsFlow uses the close-and-reopen pattern:
//     daily-quest modal → requestClaim + close → mark + credit →
//     coin modal → repeat if more ready chests.
//
//   • quest-engine must be initialised before any of its methods
//     are called. initQuestEngine() is idempotent and cached.
//
//   • Pipeline robustness: every step in runPostLessonPipeline is
//     wrapped in try/catch so a failure in one step does not
//     prevent later steps or the final redirect.
//
// ============================================================

import {
  supabase,
  isLoggedIn,
  saveTempProgress,
  setHearts,
  setStreakState,
  getStreakState,
  getCurrentUserProfile,
  incrementCoins,
  recordLessonCompletion as persistLessonProgressRow
} from './supabase.js';

import {
  getLocalDateString,
  getLocalHour
} from './date-utils.js';

import * as questEngine from './quest-engine.js';

function sanitiseHTML(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

class QuizEngine {
  constructor(lessonData) {
    this.title = lessonData.title || 'Lesson';
    this.totalQuestions = lessonData.totalQuestions || 0;
    this.redirectUrl = lessonData.redirectUrl || '/';
    this.streakKey = lessonData.streakKey || 'userStreakDays';
    this.questionsData = lessonData.questions || [];

    const urlParams = new URLSearchParams(window.location.search);
    this.courseId    = urlParams.get('course') || 'g12-life-sciences';
    this.lessonId    = urlParams.get('lesson') || 'introduction-to-nucleic-acids';
    this.lessonMode  = urlParams.get('mode') || 'regular';

    this.maxStreakInLesson = 0;
    this.mistakesMade      = 0;

    this._resolvedTimezone = null;

    this.lives = 5;
    this.currentQuestion = 0;
    this.retryQueue = [];
    this.inRetryMode = false;
    this.showedRetryMessage = false;
    this.currentStreak = 0;
    this.pendingCelebration = false;
    this.pendingCelebrationStreak = null;
    this.waitingForCelebration = false;
    this.answered = false;
    this.selectedOption = null;

    this.quizStartTime = Date.now();
    this.quizCompleted = false;
    this.totalAttempts = 0;
    this.totalCorrectAttempts = 0;
    this.questionFinalCorrect = new Array(this.totalQuestions).fill(false);
    this.heartsAtCompletion = 5;
    this.currentStreakDays = 1;
    this.currentTotalAppDays = 1;
    this.lessonStats = null;

    this.hasCompletedFirstLesson = localStorage.getItem('hasCompletedFirstLesson') === 'true';
    if (!localStorage.getItem('coins')) localStorage.setItem('coins', '500');

    this.showQuestion = this.showQuestion.bind(this);
    this.moveToNextQuestion = this.moveToNextQuestion.bind(this);
    this.finishQuiz = this.finishQuiz.bind(this);
    this.handleCorrectAnswer = this.handleCorrectAnswer.bind(this);
    this.handleIncorrectAnswer = this.handleIncorrectAnswer.bind(this);
    this.showResultOverlay = this.showResultOverlay.bind(this);
    this.showModal = this.showModal.bind(this);
    this.showModalAsync = this.showModalAsync.bind(this);
    this.updateStreakCounter = this.updateStreakCounter.bind(this);
    this.updateHeartIcon = this.updateHeartIcon.bind(this);
    this.processAfterExplanation = this.processAfterExplanation.bind(this);
    this.shuffleArray = this.shuffleArray.bind(this);
    this.normalizeAnswer = this.normalizeAnswer.bind(this);
    this.playSound = this.playSound.bind(this);
    this.runPostLessonPipeline = this.runPostLessonPipeline.bind(this);

    this.progressBar = null;
    this.livesCountSpan = null;
    this.livesIcon = null;
    this.streakCounterSpan = null;
    this.fullscreenOverlay = null;
    this.modalIframe = null;
    this.questionSections = [];

    this.buildQuizUI();

    document.getElementById('close-btn').addEventListener('click', () => {
      this.showModal('../src/components/modals/quit-confirmation.html', () => {});
    });

    this.loadStreakFromStorage();
    this.updateStreakCounter();
    this.updateHeartIcon();
    this.progressBar.style.width = `${(1 / this.totalQuestions) * 100}%`;

    if (!this.hasCompletedFirstLesson) {
      this.showModal('../src/components/modals/hearts-modal.html', () => {
        localStorage.setItem('hasCompletedFirstLesson', 'true');
        this.hasCompletedFirstLesson = true;
        this.showQuestion(0);
      });
    } else {
      this.showQuestion(0);
    }
  }

  buildQuizUI() {
    const container = document.querySelector('.quiz-container');
    this.progressBar = document.getElementById('progress-bar');
    this.livesCountSpan = document.getElementById('lives-count');
    this.livesIcon = document.getElementById('lives-icon');
    this.streakCounterSpan = document.getElementById('streakCounter');
    this.fullscreenOverlay = document.getElementById('fullscreenModalOverlay');
    this.modalIframe = document.getElementById('modalIframe');

    for (let i = 0; i < this.totalQuestions; i++) {
      const qSection = document.createElement('div');
      qSection.id = `question${i + 1}`;
      qSection.style.display = 'none';
      container.appendChild(qSection);
      this.questionSections.push(qSection);
    }
  }

  loadStreakFromStorage() {
    const saved = localStorage.getItem(this.streakKey);
    if (saved) this.currentStreakDays = parseInt(saved, 10);
    else localStorage.setItem(this.streakKey, '1');
  }

  saveStreakToStorage() {
    localStorage.setItem(this.streakKey, String(this.currentStreakDays));
  }

  async resolveTimezone() {
    if (this._resolvedTimezone) return this._resolvedTimezone;

    const cached = localStorage.getItem('userTimezone');
    const isLegacy = typeof cached === 'string'
      && /^(UTC[+-]|Etc\/GMT)/.test(cached);
    const isRealIana = typeof cached === 'string'
      && (cached === 'UTC' || cached.includes('/'));

    if (cached && isRealIana && !isLegacy) {
      this._resolvedTimezone = cached;
      return cached;
    }

    try {
      const profile = await getCurrentUserProfile();
      if (profile && profile.profile && profile.profile.timezone) {
        localStorage.setItem('userTimezone', profile.profile.timezone);
        this._resolvedTimezone = profile.profile.timezone;
        return profile.profile.timezone;
      }
    } catch (e) {
      console.error('resolveTimezone: Supabase read failed', e);
    }

    const fallback = cached || 'UTC';
    this._resolvedTimezone = fallback;
    return fallback;
  }

  async buildStreakData() {
    const tz = await this.resolveTimezone();
    const todayStr = getLocalDateString(tz);

    let dbStreak = { currentStreak: 0, longestStreak: 0, lastLessonDate: null };
    try {
      dbStreak = await getStreakState();
    } catch (e) {
      console.error('buildStreakData: Supabase read failed', e);
    }

    let localStreak = {};
    try {
      const stored = localStorage.getItem('streakState');
      if (stored) localStreak = JSON.parse(stored);
    } catch (e) {
      console.error('buildStreakData: localStorage read failed', e);
    }

    const merged = {
      currentStreak: Math.max(
        Number(dbStreak.currentStreak) || 0,
        Number(localStreak.currentStreak) || 0
      ),
      longestStreak: Math.max(
        Number(dbStreak.longestStreak) || 0,
        Number(localStreak.longestStreak) || 0,
        Number(localStreak.currentStreak) || 0
      ),
      lastLessonDate: this._moreRecentDate(
        dbStreak.lastLessonDate,
        localStreak.lastLessonDate
      ),
      totalAppDays: Number(localStreak.totalAppDays) || 1,
      timezone: tz,
      recentDays: Array.isArray(localStreak.recentDays)
        ? localStreak.recentDays.slice()
        : []
    };

    const shouldIncrement = merged.lastLessonDate !== todayStr;

    if (shouldIncrement) {
      const isConsecutive = this._isPreviousDay(merged.lastLessonDate, todayStr);

      if (isConsecutive) {
        merged.currentStreak = (merged.currentStreak || 0) + 1;
      } else {
        merged.currentStreak = 1;
      }

      if (merged.currentStreak > merged.longestStreak) {
        merged.longestStreak = merged.currentStreak;
      }

      const todayEntry = merged.recentDays.find(d => d.date === todayStr);
      if (!todayEntry) {
        merged.recentDays.push({ date: todayStr, status: 'completed' });
        if (merged.recentDays.length > 7) {
          merged.recentDays = merged.recentDays.slice(-7);
        }
      }

      const first = localStorage.getItem('firstLessonDate');
      if (!first) {
        localStorage.setItem('firstLessonDate', todayStr);
        merged.totalAppDays = 1;
      } else {
        const firstDate = new Date(first + 'T12:00:00Z');
        const now = new Date(todayStr + 'T12:00:00Z');
        merged.totalAppDays = Math.floor((now - firstDate) / 86400000) + 1;
      }
    }

    merged.lastLessonDate = shouldIncrement ? todayStr : merged.lastLessonDate;

    localStorage.setItem('streakState', JSON.stringify(merged));
    if (shouldIncrement) {
      localStorage.setItem('lastLessonDate', todayStr);
    }
    localStorage.setItem(this.streakKey, String(merged.currentStreak));
    localStorage.setItem('userTimezone', tz);

    this.currentStreakDays = merged.currentStreak;
    this.currentTotalAppDays = merged.totalAppDays;
    this.saveStreakToStorage();

    if (shouldIncrement) {
      try {
        await setStreakState({
          currentStreak: merged.currentStreak,
          longestStreak: merged.longestStreak,
          lastLessonDate: todayStr
        });
      } catch (e) {
        console.error('buildStreakData: Supabase write failed', e);
      }
    }

    return { shouldIncrement, streakData: merged };
  }

  _moreRecentDate(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return a > b ? a : b;
  }

  _isPreviousDay(prevStr, currentStr) {
    if (!prevStr) return false;
    const prev = new Date(prevStr + 'T12:00:00Z');
    const current = new Date(currentStr + 'T12:00:00Z');
    const diffDays = Math.round((current - prev) / 86400000);
    return diffDays === 1;
  }

  getActiveBoostMultiplier() {
    try {
      const raw = localStorage.getItem('activeBoosts');
      if (!raw) return 1;
      const boosts = JSON.parse(raw) || [];
      const now = Date.now();
      const active = boosts.filter(b => b.expiresAt > now);
      if (active.length === 0) return 1;
      return Math.max(...active.map(b => b.multiplier || 1), 1);
    } catch (e) {
      return 1;
    }
  }

  pushActiveBoost(multiplier, durationMinutes) {
    try {
      const raw = localStorage.getItem('activeBoosts');
      const boosts = raw ? JSON.parse(raw) : [];
      const now = Date.now();
      const active = boosts.filter(b => b.expiresAt > now);
      active.push({
        multiplier,
        durationMinutes,
        expiresAt: now + durationMinutes * 60 * 1000
      });
      localStorage.setItem('activeBoosts', JSON.stringify(active));
    } catch (e) {
      console.error('pushActiveBoost failed:', e);
    }
  }

  computeXP({ correctAttempts, totalAttempts, timeSeconds, totalQuestions, boost }) {
    const T_expected = totalQuestions * 15;
    const T_max = 2 * T_expected;

    const ratio = totalAttempts > 0 ? correctAttempts / totalAttempts : 0;
    const accuracyXP = Math.min(Math.max(Math.round(ratio * 10), 0), 10);

    let speedXP = 0;
    if (timeSeconds <= T_expected) {
      speedXP = 10;
    } else if (timeSeconds <= T_max) {
      speedXP = Math.round(10 * (2 - timeSeconds / T_expected));
      if (speedXP < 0) speedXP = 0;
    } else {
      speedXP = 0;
    }

    const baseXP = 10 + accuracyXP + speedXP;
    if (boost && boost > 1) return Math.round(baseXP * boost);
    return baseXP;
  }

  computeLessonStats(timeSeconds) {
    const totalAttempts = this.totalAttempts;
    const totalCorrect  = this.totalCorrectAttempts;
    const accuracy      = totalAttempts > 0 ? totalCorrect / totalAttempts : 0;
    const perfectLesson = totalAttempts > 0 && totalCorrect === totalAttempts;
    const hadAnswerStreak5 = this.maxStreakInLesson >= 5;

    const isReview        = this.lessonMode === 'review';
    const isMastery       = this.lessonMode === 'master';
    const isChapterReview = this.lessonMode === 'chapter-review';

    const boost = this.getActiveBoostMultiplier();
    const xpEarned = this.computeXP({
      correctAttempts: totalCorrect,
      totalAttempts,
      timeSeconds,
      totalQuestions: this.totalQuestions,
      boost
    });

    return {
      courseId: this.courseId,
      lessonId: this.lessonId,
      timeSeconds,
      xpEarned,
      accuracy,
      perfectLesson,
      hadAnswerStreak5,
      isReview,
      isMastery,
      isChapterReview,
      correctAttempts: totalCorrect,
      totalAttempts,
      heartsAtCompletion: this.lives,
      boost,
      totalQuestions: this.totalQuestions
    };
  }

  updateStreakCounter() {
    this.streakCounterSpan.textContent = this.currentStreak >= 2
      ? `${this.currentStreak} in a row!`
      : '';
  }

  updateHeartIcon() {
    this.livesIcon.src = this.lives === 0
      ? '../public/assets/icons/phosphor/regular/heart.svg'
      : '../public/assets/icons/phosphor/fill/heart.svg';
  }

  playSound(isCorrect) {
    const audio = isCorrect
      ? document.getElementById('correctSound')
      : document.getElementById('incorrectSound');
    if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); }
  }

  handleCorrectAnswer() {
    this.currentStreak++;
    if (this.currentStreak > this.maxStreakInLesson) {
      this.maxStreakInLesson = this.currentStreak;
    }
    this.updateStreakCounter();
    if (this.currentStreak % 5 === 0 && this.currentStreak > 0) {
      this.pendingCelebration = true;
      this.pendingCelebrationStreak = this.currentStreak;
    }
  }

  handleIncorrectAnswer() {
    this.currentStreak = 0;
    this.mistakesMade++;
    this.updateStreakCounter();
  }

  normalizeAnswer(a) {
    return a.toLowerCase().replace(/\s+/g, ' ').replace(/[()]/g, '').replace(/\//g, ' ').trim();
  }

  shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  showModal(modalUrl, onClose) {
    this.modalIframe.src = modalUrl;
    this.fullscreenOverlay.classList.add('visible');
    const handler = (event) => {
      if (event.data === 'modalClose') {
        window.removeEventListener('message', handler);
        this.fullscreenOverlay.classList.remove('visible');
        this.modalIframe.src = 'about:blank';
        if (onClose) onClose();
      } else if (event.data === 'modalQuit') {
        window.removeEventListener('message', handler);
        window.location.href = this.redirectUrl;
      } else if (event.data && event.data.type === 'refillHearts') {
        window.removeEventListener('message', handler);
        this.fullscreenOverlay.classList.remove('visible');
        this.modalIframe.src = 'about:blank';
        const coins = parseInt(localStorage.getItem('coins') || '500', 10);
        if (coins >= 450) {
          incrementCoins(-450).catch(() => {});
          this.lives = 5;
          this.livesCountSpan.textContent = '5';
          this.updateHeartIcon();
          setHearts(5).catch(() => {});
          const currentActualIdx = this.inRetryMode
            ? this.retryQueue[this.currentQuestion]
            : this.currentQuestion;
          const idxInQueue = this.retryQueue.indexOf(currentActualIdx);
          if (idxInQueue !== -1) this.retryQueue.splice(idxInQueue, 1);
          this.moveToNextQuestion();
        } else {
          window.location.href = this.redirectUrl;
        }
        if (onClose) onClose();
      }
    };
    window.addEventListener('message', handler);
  }

  showModalAsync(modalUrl, handlers = {}) {
    return new Promise((resolve) => {
      const cleanup = () => {
        window.removeEventListener('message', handler);
        this.fullscreenOverlay.classList.remove('visible');
        this.modalIframe.src = 'about:blank';
      };
      const handler = (event) => {
        if (event.data === 'modalClose') {
          cleanup();
          resolve({ type: 'modalClose' });
          return;
        }
        if (event.data === 'modalQuit') {
          cleanup();
          window.location.href = this.redirectUrl;
          resolve({ type: 'modalQuit' });
          return;
        }
        if (event.data && event.data.type && typeof handlers[event.data.type] === 'function') {
          const result = handlers[event.data.type](event.data);
          if (result === 'close') {
            cleanup();
            resolve({ type: 'handled', data: event.data });
          }
        }
      };
      window.addEventListener('message', handler);
      this.modalIframe.src = modalUrl;
      this.fullscreenOverlay.classList.add('visible');
    });
  }

  async showCoinReward(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    await this.showModalAsync(
      `../src/components/modals/coins-reward.html?amount=${amount}`
    );
    try {
      await incrementCoins(amount);
    } catch (e) {
      console.error('coin credit failed:', e);
    }
  }

  async showBoostReward(multiplier, durationMinutes) {
    await this.showModalAsync(
      `../src/components/modals/boost-reward.html?multiplier=${multiplier}&duration=${durationMinutes}`
    );
    this.pushActiveBoost(multiplier, durationMinutes);
  }

  async showHeartReward() {
    await this.showModalAsync(
      `../src/components/modals/heart-reward.html?hearts=full`
    );
    try {
      await setHearts(5);
    } catch (e) {
      console.error('hearts credit failed:', e);
    }
    this.lives = 5;
    this.livesCountSpan.textContent = '5';
    this.updateHeartIcon();
  }

  processAfterExplanation(onComplete) {
    if (this.pendingCelebration) {
      const streak = this.pendingCelebrationStreak;
      this.pendingCelebration = false;
      this.pendingCelebrationStreak = null;
      this.waitingForCelebration = true;
      this.showModal(
        `../src/components/modals/answer-streak.html?streak=${streak}`,
        () => {
          this.waitingForCelebration = false;
          if (onComplete) onComplete();
        }
      );
    } else {
      if (onComplete) onComplete();
    }
  }

  showResultOverlay(qNum, isCorrect, explanationHTML, onComplete) {
    let overlay = document.getElementById(`resultOverlay-${qNum}`);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'result-overlay';
      overlay.id = `resultOverlay-${qNum}`;
      overlay.innerHTML = `
        <div class="result-container" id="resultContainer-${qNum}">
          <div class="result-main">
            <img id="resultIcon-${qNum}" src="" class="material-icon" alt="" style="width:2.5rem;">
            <div class="result-header" id="resultHeader-${qNum}"></div>
            <img id="actionIcon-${qNum}" src="" class="material-icon" alt="" style="width:2.5rem;">
          </div>
          <div class="explanation-content" id="explanationContainer-${qNum}"></div>
          <button class="result-continue-btn" id="resultContinueBtn-${qNum}">Continue</button>
        </div>
      `;
      document.querySelector('.quiz-container').appendChild(overlay);
    }

    const container = document.getElementById(`resultContainer-${qNum}`);
    const header = document.getElementById(`resultHeader-${qNum}`);
    const icon = document.getElementById(`resultIcon-${qNum}`);
    const actionIcon = document.getElementById(`actionIcon-${qNum}`);
    const explanationDiv = document.getElementById(`explanationContainer-${qNum}`);
    const continueBtn = document.getElementById(`resultContinueBtn-${qNum}`);

    if (isCorrect) {
      header.textContent = 'Correct!';
      icon.src = '../public/assets/icons/material-symbols/outline/check_circle.svg';
      actionIcon.src = '../public/assets/icons/material-symbols/outline/recommend.svg';
      container.className = 'result-container correct';
    } else {
      header.textContent = 'Incorrect';
      icon.src = '../public/assets/icons/material-symbols/outline/cancel.svg';
      actionIcon.src = '../public/assets/icons/material-symbols/outline/stylus_note.svg';
      container.className = 'result-container incorrect';
    }
    explanationDiv.innerHTML = explanationHTML;
    overlay.classList.add('visible');
    continueBtn.onclick = () => {
      overlay.classList.remove('visible');
      this.processAfterExplanation(onComplete);
    };
  }

  moveToNextQuestion(skipIncrement = false) {
    if (this.waitingForCelebration) return false;
    if (this.inRetryMode) {
      if (!skipIncrement) this.currentQuestion++;
      if (this.currentQuestion >= this.retryQueue.length) {
        if (this.retryQueue.length > 0) {
          this.currentQuestion = 0;
          this.showQuestion(this.currentQuestion);
          return true;
        } else {
          this.inRetryMode = false;
          this.retryQueue = [];
          this.showedRetryMessage = false;
          this.currentQuestion = 0;
          this.finishQuiz();
          return false;
        }
      }
      this.showQuestion(this.currentQuestion);
      return true;
    } else {
      if (!skipIncrement) this.currentQuestion++;
      if (this.currentQuestion >= this.totalQuestions) {
        if (this.retryQueue.length > 0) {
          this.inRetryMode = true;
          this.currentQuestion = 0;
          if (!this.showedRetryMessage) {
            this.showedRetryMessage = true;
            this.showModal('../src/components/modals/review-questions.html', () => {
              this.showQuestion(this.currentQuestion);
            });
            return false;
          }
          this.showQuestion(this.currentQuestion);
          return true;
        } else {
          this.finishQuiz();
          return false;
        }
      }
      this.showQuestion(this.currentQuestion);
      return true;
    }
  }

  async finishQuiz() {
    if (this.quizCompleted) return;
    this.quizCompleted = true;
    const timeSeconds = Math.floor((Date.now() - this.quizStartTime) / 1000);

    this.heartsAtCompletion = this.lives;
    localStorage.setItem('heartsAtCompletion', String(this.heartsAtCompletion));

    this.lessonStats = this.computeLessonStats(timeSeconds);

    const completeUrl =
      `../src/components/modals/lesson-complete.html` +
      `?correctAttempts=${this.totalCorrectAttempts}` +
      `&totalAttempts=${this.totalAttempts}` +
      `&time=${timeSeconds}` +
      `&totalQuestions=${this.totalQuestions}` +
      `&boost=${this.lessonStats.boost}`;

    await this.showModalAsync(completeUrl);
    await this.runPostLessonPipeline();
  }

  async runPostLessonPipeline() {
    const stats = this.lessonStats;
    let persistResult = { lessonProgress: null, quests: null, dailyGoal: null };

    try {
      persistResult = await this.persistLessonResults(stats);
    } catch (e) {
      console.error('pipeline: persistLessonResults failed', e);
    }

    if (persistResult.dailyGoal && persistResult.dailyGoal.should) {
      try {
        const marked = await questEngine.markDailyGoalClaimed();
        if (marked) {
          await this.showCoinReward(persistResult.dailyGoal.amount);
        }
      } catch (e) {
        console.error('pipeline: daily-goal reward failed', e);
      }
    }

    try {
      const streakResult = await this.showStreakFlow();
      if (streakResult && streakResult.ran) {
        try {
          await this.showStreakReward(streakResult);
        } catch (e) {
          console.error('pipeline: showStreakReward failed', e);
        }
      }
    } catch (e) {
      console.error('pipeline: showStreakFlow failed', e);
    }

    try {
      await this.showAchievements();
    } catch (e) {
      console.error('pipeline: showAchievements failed', e);
    }

    try {
      await this.showRecords();
    } catch (e) {
      console.error('pipeline: showRecords failed', e);
    }

    try {
      await this.showDailyQuestsFlow();
    } catch (e) {
      console.error('pipeline: showDailyQuestsFlow failed', e);
    }

    await this.redirectAfterLesson();
  }

  async persistLessonResults(stats) {
    const out = { lessonProgress: null, quests: null, dailyGoal: null };

    try {
      await questEngine.initQuestEngine();
    } catch (e) {
      console.error('persistLessonResults: initQuestEngine failed', e);
    }

    try {
      out.lessonProgress = await persistLessonProgressRow({
        courseId: stats.courseId,
        lessonId: stats.lessonId,
        mastered: stats.isMastery,
        sublessonIndex: null
      });
    } catch (e) {
      console.error('persistLessonProgressRow failed:', e);
    }

    try {
      await setHearts(stats.heartsAtCompletion);
    } catch (e) {
      console.error('setHearts failed:', e);
    }

    try {
      out.quests = await questEngine.recordLessonCompletion({
        courseId: stats.courseId,
        lessonId: stats.lessonId,
        timeSeconds: stats.timeSeconds,
        xpEarned: stats.xpEarned,
        accuracy: stats.accuracy,
        perfectLesson: stats.perfectLesson,
        hadAnswerStreak5: stats.hadAnswerStreak5,
        isReview: stats.isReview,
        isMastery: stats.isMastery,
        isChapterReview: stats.isChapterReview
      });
      if (out.quests && out.quests.dailyGoal) {
        out.dailyGoal = out.quests.dailyGoal;
      }
    } catch (e) {
      console.error('questEngine.recordLessonCompletion failed:', e);
    }

    return out;
  }

  async showStreakFlow() {
    const { shouldIncrement, streakData } = await this.buildStreakData();

    if (!shouldIncrement) {
      return { ran: false };
    }

    const encoded = encodeURIComponent(JSON.stringify(streakData));
    const heartsValue = this.heartsAtCompletion;
    const url =
      `../src/components/modals/streak.html` +
      `?data=${encoded}&hearts=${heartsValue}`;

    await this.showModalAsync(url, {
      streakClosed: (msg) => {
        if (msg.streakDays) {
          this.currentStreakDays = msg.streakDays;
          this.saveStreakToStorage();
        }
        return 'close';
      }
    });

    return {
      ran: true,
      streakDays: this.currentStreakDays,
      heartsAtCompletion: this.heartsAtCompletion
    };
  }

  async showStreakReward(streakResult) {
    const streakDays = streakResult.streakDays;
    const hearts = streakResult.heartsAtCompletion;

    if (streakDays > 0 && streakDays % 5 === 0) {
      let coins = 250;
      if (streakDays > 360) coins = 1000;
      else if (streakDays > 195) coins = 750;
      else if (streakDays > 95) coins = 500;
      await this.showCoinReward(coins);
      return;
    }

    if (hearts >= 3 && hearts <= 5) {
      const pick = this._pickRandomBoost();
      await this.showBoostReward(pick.multiplier, pick.durationMinutes);
      return;
    }

    if (hearts >= 1 && hearts <= 2) {
      if (Math.random() < 0.5) {
        await this.showHeartReward();
      } else {
        const pick = this._pickRandomBoost();
        await this.showBoostReward(pick.multiplier, pick.durationMinutes);
      }
      return;
    }
  }

  _pickRandomBoost() {
    const options = [
      { multiplier: 1.5, durationMinutes: 30 },
      { multiplier: 2,   durationMinutes: 20 },
      { multiplier: 3,   durationMinutes: 15 }
    ];
    return options[Math.floor(Math.random() * options.length)];
  }

  async showAchievements() {
    // TODO: Once achievement counters land on user_stats,
    // evaluate them here and open achievement.html sequentially.
  }

  async showRecords() {
    if (!this.currentTotalAppDays || this.currentTotalAppDays < 2) return;
    // TODO: Same pattern as showAchievements once record counters
    // are being maintained.
  }

  // ============================================================
  // DAILY QUESTS FLOW (close-and-reopen loop)
  // ============================================================
  //
  // Contract with daily-quest.html:
  //   - Chest tap → modal posts { type: 'requestClaim', tier }
  //     then 'modalClose'.
  //   - Continue tap → modal posts 'modalClose'.
  //
  // Pipeline per claim (spec §9):
  //   1. mark chest as claimed in DB (claimQuestChest)
  //   2. credit coins (incrementCoins)
  //   3. open coins-reward.html (pure display)
  //   4. reopen daily-quest.html if more ready chests exist
  //
  // The MAX_ITERATIONS cap prevents an infinite loop if the modal
  // keeps requesting a claim that the DB keeps refusing.

  async _openDailyQuestModalOnce() {
    return new Promise((resolve) => {
      let pendingTier = null;
      const handler = (event) => {
        if (event.data && event.data.type === 'requestClaim') {
          pendingTier = event.data.tier;
          return;
        }
        if (event.data === 'modalClose') {
          window.removeEventListener('message', handler);
          this.fullscreenOverlay.classList.remove('visible');
          this.modalIframe.src = 'about:blank';
          resolve(pendingTier
            ? { action: 'claim', tier: pendingTier }
            : { action: 'continue' });
        } else if (event.data === 'modalQuit') {
          window.removeEventListener('message', handler);
          window.location.href = this.redirectUrl;
          resolve({ action: 'quit' });
        }
      };
      window.addEventListener('message', handler);
      this.modalIframe.src = '../src/components/modals/daily-quest.html';
      this.fullscreenOverlay.classList.add('visible');
    });
  }

  async showDailyQuestsFlow() {
    try {
      await questEngine.initQuestEngine();
    } catch (e) {
      console.error('pipeline: initQuestEngine failed', e);
      return;
    }

    const MAX_ITERATIONS = 5;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const result = await this._openDailyQuestModalOnce();

      if (result.action === 'quit') return;
      if (result.action !== 'claim') return;

      // Spec §9: mark → credit → modal
      const claim = await questEngine.claimQuestChest(result.tier);
      if (!claim.ok) {
        console.warn('pipeline: claimQuestChest refused:', claim.error);
        // Loop reopens the modal, which will show the updated
        // state. MAX_ITERATIONS caps the retry.
        continue;
      }

      try {
        await incrementCoins(claim.amount);
      } catch (e) {
        console.error('pipeline: incrementCoins failed', e);
      }

      if (Number.isFinite(claim.amount) && claim.amount > 0) {
        await this.showModalAsync(
          `../src/components/modals/coins-reward.html?amount=${claim.amount}`
        );
      }
    }
  }

  async redirectAfterLesson() {
    const loggedIn = await isLoggedIn();
    if (loggedIn) {
      window.location.href = this.redirectUrl;
      return;
    }
    saveTempProgress(this.courseId, this.lessonId, {
      correct: this.totalCorrectAttempts,
      total: this.totalAttempts,
      hearts: this.heartsAtCompletion,
      streak: this.currentStreakDays,
      xp: this.lessonStats ? this.lessonStats.xpEarned : 0
    });
    window.location.href = '/registration.html';
  }

  // ============================================================
  // QUESTION RENDERERS
  // ============================================================
  showQuestion(questionIndex) {
    this.questionSections.forEach(s => { if (s) s.style.display = 'none'; });
    const actualIdx = this.inRetryMode
      ? this.retryQueue[this.currentQuestion]
      : this.currentQuestion;
    const section = this.questionSections[actualIdx];
    if (!section) return;
    section.style.display = 'block';

    const total = this.inRetryMode ? this.retryQueue.length : this.totalQuestions;
    const percent = Math.round(((this.currentQuestion + 1) / total) * 100);
    this.progressBar.style.width = `${percent}%`;
    this.updateStreakCounter();
    this.answered = false;
    this.selectedOption = null;

    const qData = this.questionsData[actualIdx];
    if (!qData) return;
    section.innerHTML = '';

    switch (qData.type) {
      case 'multiple-choice':    this.renderMultipleChoice(section, qData, actualIdx); break;
      case 'complete-sentence':  this.renderCompleteSentence(section, qData, actualIdx); break;
      case 'fill-blank':         this.renderFillBlank(section, qData, actualIdx); break;
      case 'image-selection':    this.renderImageSelection(section, qData, actualIdx); break;
      case 'matching':           this.renderMatching(section, qData, actualIdx); break;
    }
  }

  renderMultipleChoice(section, qData, actualIdx) {
    section.innerHTML = `
      <h2 class="quiz-title">Choose the correct option</h2>
      <div class="question">${qData.questionText}</div>
      <div class="options-container" id="options-container-${actualIdx}"></div>
      <div class="footer"><button class="check-button" id="check-button-${actualIdx}" disabled>Check</button></div>
    `;
    const container = document.getElementById(`options-container-${actualIdx}`);
    const btn = document.getElementById(`check-button-${actualIdx}`);
    const shuffledOpts = this.shuffleArray(qData.options);
    let selected = null;

    shuffledOpts.forEach(opt => {
      const b = document.createElement('button');
      b.className = 'option-button';
      b.dataset.value = opt;
      b.textContent = opt;
      b.addEventListener('click', () => {
        if (this.answered) return;
        container.querySelectorAll('.option-button').forEach(bb => bb.classList.remove('selected'));
        b.classList.add('selected');
        selected = b.dataset.value;
        btn.disabled = false;
      });
      container.appendChild(b);
    });

    btn.addEventListener('click', () => {
      if (!selected || this.answered) return;
      this.answered = true;
      const isCorrect = (selected === qData.correctAnswer);
      this.playSound(isCorrect);
      const correctBtn = Array.from(container.querySelectorAll('.option-button'))
        .find(b => b.dataset.value === qData.correctAnswer);
      if (correctBtn) correctBtn.classList.add('correct');

      if (isCorrect) {
        this.totalCorrectAttempts++;
        this.totalAttempts++;
        if (!this.questionFinalCorrect[actualIdx]) this.questionFinalCorrect[actualIdx] = true;
        const idx = this.retryQueue.indexOf(actualIdx);
        if (idx !== -1) {
          this.retryQueue.splice(idx, 1);
          const skip = this.inRetryMode && idx === this.currentQuestion;
          this.handleCorrectAnswer();
          this.showResultOverlay(
            actualIdx + 1, true,
            `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`,
            () => this.moveToNextQuestion(skip)
          );
        } else {
          this.handleCorrectAnswer();
          this.showResultOverlay(
            actualIdx + 1, true,
            `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`,
            () => this.moveToNextQuestion()
          );
        }
      } else {
        this.totalAttempts++;
        this.handleIncorrectAnswer();
        if (!this.retryQueue.includes(actualIdx)) this.retryQueue.push(actualIdx);
        if (this.lives > 0) {
          this.lives--;
          this.livesCountSpan.textContent = String(this.lives);
          this.updateHeartIcon();
        }
        const selBtn = Array.from(container.querySelectorAll('.option-button'))
          .find(b => b.dataset.value === selected);
        if (selBtn) selBtn.classList.add('incorrect');
        this.showResultOverlay(
          actualIdx + 1, false,
          `<div class="correct-answer-section"><span class="correct-text">Correct answer:</span> <span class="underlined">${sanitiseHTML(qData.correctAnswer)}</span></div><div class="explanation-section"><span class="explanation-label">Explanation:</span> <span class="explanation-text">${qData.explanation}</span></div>`,
          () => {
            if (this.lives === 0) {
              const coins = parseInt(localStorage.getItem('coins') || '500', 10);
              if (coins >= 450) {
                this.showModal('../src/components/modals/refill-hearts.html', () => {});
              } else {
                window.location.href = this.redirectUrl;
              }
            } else this.moveToNextQuestion();
          }
        );
      }
      container.querySelectorAll('.option-button').forEach(b => {
        b.disabled = true;
        b.style.cursor = 'not-allowed';
      });
    });
  }

  renderCompleteSentence(section, qData, actualIdx) {
    const blankIds = [];
    const re = /id="(blank-[^"]+)"/g;
    let match;
    while ((match = re.exec(qData.questionText)) !== null) blankIds.push(match[1]);
    const blanksHTML = blankIds.map(id => `<span id="${id}" class="blank" tabindex="0"></span>`);
    let displayText = qData.questionText;
    blankIds.forEach((id, i) => {
      displayText = displayText.replace(
        new RegExp(`<span[^>]*id="${id}"[^>]*>.*?</span>`, 'g'),
        blanksHTML[i]
      );
    });

    section.innerHTML = `
      <h2 class="quiz-title">Select what is missing</h2>
      <div class="question-container">
        <div class="icon-container"><img src="../public/assets/icons/phosphor/fill/rabbit-blue.svg" alt="Vusi" style="width:4rem;height:4rem;"></div>
        <div speech-bubble pleft abottom style="--bbColor:#FFFFFF"><div class="bubble-text">${displayText}</div></div>
      </div>
      <div id="options-${actualIdx}" class="options-container"></div>
      <div class="footer"><button id="check-button-${actualIdx}" class="check-button" disabled>Check</button></div>
    `;

    const blankElements = blankIds.map(id => document.getElementById(id));
    const optsContainer = document.getElementById(`options-${actualIdx}`);
    const btn = document.getElementById(`check-button-${actualIdx}`);
    blankElements.forEach(b => { if (b) b.textContent = ''; });
    let filled = new Array(blankElements.length).fill(null);
    let optionBtns = [];
    const shuffledOpts = this.shuffleArray([...qData.options]);

    shuffledOpts.forEach(opt => {
      const button = document.createElement('button');
      button.className = 'option-button';
      button.dataset.value = opt.value;
      button.innerHTML = `<span>${opt.label}</span>`;
      optionBtns.push(button);
      button.addEventListener('click', () => {
        if (this.answered) return;
        if (filled.some(f => f && f.value === opt.value)) return;
        const idx = filled.findIndex(f => f === null);
        if (idx === -1) return;
        const target = blankElements[idx];
        if (!target) return;
        filled[idx] = { value: opt.value, label: opt.label };
        target.textContent = opt.label;
        target.classList.add('filled');
        button.classList.add('used-option');
        btn.disabled = !filled.every(f => f !== null);
      });
      optsContainer.appendChild(button);
    });

    blankElements.forEach((blank, idx) => {
      if (!blank) return;
      blank.addEventListener('click', () => {
        if (this.answered) return;
        if (filled[idx]) {
          const b = optionBtns.find(ob => ob.dataset.value === filled[idx].value);
          if (b) b.classList.remove('used-option');
          blank.textContent = '';
          blank.classList.remove('filled', 'correct', 'incorrect');
          filled[idx] = null;
          btn.disabled = !filled.every(f => f !== null);
        }
      });
    });

    btn.addEventListener('click', () => {
      if (!filled.every(f => f !== null)) return;
      this.answered = true;
      const userAnswers = filled.map(f => f.value);
      const correctSet = [...qData.correctAnswers].sort().join(',');
      const userSet = [...userAnswers].sort().join(',');
      const isCorrect = (correctSet === userSet);
      this.playSound(isCorrect);
      optionBtns.forEach(b => { b.disabled = true; });

      if (isCorrect) {
        this.totalCorrectAttempts++;
        this.totalAttempts++;
        if (!this.questionFinalCorrect[actualIdx]) this.questionFinalCorrect[actualIdx] = true;
        const idx = this.retryQueue.indexOf(actualIdx);
        if (idx !== -1) {
          this.retryQueue.splice(idx, 1);
          const skip = this.inRetryMode && idx === this.currentQuestion;
          blankElements.forEach(b => { if (b) b.classList.add('correct'); });
          optionBtns.forEach(b => {
            if (qData.correctAnswers.includes(b.dataset.value)) b.classList.add('correct');
          });
          this.handleCorrectAnswer();
          this.showResultOverlay(
            actualIdx + 1, true,
            `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`,
            () => this.moveToNextQuestion(skip)
          );
        } else {
          blankElements.forEach(b => { if (b) b.classList.add('correct'); });
          optionBtns.forEach(b => {
            if (qData.correctAnswers.includes(b.dataset.value)) b.classList.add('correct');
          });
          this.handleCorrectAnswer();
          this.showResultOverlay(
            actualIdx + 1, true,
            `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`,
            () => this.moveToNextQuestion()
          );
        }
      } else {
        this.totalAttempts++;
        blankElements.forEach(b => { if (b) b.classList.add('incorrect'); });
        if (!this.retryQueue.includes(actualIdx)) this.retryQueue.push(actualIdx);
        this.handleIncorrectAnswer();
        if (this.lives > 0) {
          this.lives--;
          this.livesCountSpan.textContent = String(this.lives);
          this.updateHeartIcon();
        }
        optionBtns.forEach(b => {
          if (qData.correctAnswers.includes(b.dataset.value)) b.classList.add('correct');
        });
        const correctLabels = qData.correctAnswers
          .map(a => qData.options.find(o => o.value === a)?.label || a)
          .join('</span> and <span class="underlined">');
        this.showResultOverlay(
          actualIdx + 1, false,
          `<div class="correct-answer-section"><span class="correct-text">Correct answer:</span> <span><span class="underlined">${correctLabels}</span></span></div><div class="explanation-section"><span class="explanation-label">Explanation:</span> <span class="explanation-text">${qData.explanation}</span></div>`,
          () => {
            if (this.lives === 0) {
              const coins = parseInt(localStorage.getItem('coins') || '500', 10);
              if (coins >= 450) {
                this.showModal('../src/components/modals/refill-hearts.html', () => {});
              } else {
                window.location.href = this.redirectUrl;
              }
            } else this.moveToNextQuestion();
          }
        );
      }
    });
  }

  renderFillBlank(section, qData, actualIdx) {
    section.innerHTML = `
      <h2 class="quiz-title">Complete the statement</h2>
      <div class="question-container">
        <div class="icon-container"><img src="../public/assets/icons/phosphor/fill/rabbit-blue.svg" alt="Vusi" style="width:4rem;height:4rem;"></div>
        <div speech-bubble pleft acenter style="--bbColor:#FFFFFF"><div class="bubble-text">${qData.questionText}</div></div>
      </div>
      <div class="response-container">
        <div class="response-text">Type your answer below:</div>
        <div class="response-input-container"><input type="text" id="fill-blank-input-${actualIdx}" class="response-input" placeholder="Type your answer here" spellcheck="false"></div>
      </div>
      <div class="footer"><button class="check-button" id="check-button-${actualIdx}" disabled>Check</button></div>
    `;
    const input = document.getElementById(`fill-blank-input-${actualIdx}`);
    const btn = document.getElementById(`check-button-${actualIdx}`);

    input.addEventListener('input', () => {
      btn.disabled = !input.value.trim();
      if (this.answered) {
        input.classList.remove('correct', 'incorrect');
        this.answered = false;
      }
    });
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !btn.disabled) btn.click();
    });
    btn.addEventListener('click', () => {
      this.answered = true;
      const userAnswer = this.normalizeAnswer(input.value.trim());
      const isCorrect = qData.acceptableAnswers.some(
        a => userAnswer === this.normalizeAnswer(a)
      );
      this.playSound(isCorrect);

      if (isCorrect) {
        this.totalCorrectAttempts++;
        this.totalAttempts++;
        if (!this.questionFinalCorrect[actualIdx]) this.questionFinalCorrect[actualIdx] = true;
        const idx = this.retryQueue.indexOf(actualIdx);
        if (idx !== -1) {
          this.retryQueue.splice(idx, 1);
          const skip = this.inRetryMode && idx === this.currentQuestion;
          input.classList.add('correct');
          this.handleCorrectAnswer();
          this.showResultOverlay(
            actualIdx + 1, true,
            `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`,
            () => this.moveToNextQuestion(skip)
          );
        } else {
          input.classList.add('correct');
          this.handleCorrectAnswer();
          this.showResultOverlay(
            actualIdx + 1, true,
            `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`,
            () => this.moveToNextQuestion()
          );
        }
      } else {
        this.totalAttempts++;
        if (!this.retryQueue.includes(actualIdx)) this.retryQueue.push(actualIdx);
        this.handleIncorrectAnswer();
        input.classList.add('incorrect');
        if (this.lives > 0) {
          this.lives--;
          this.livesCountSpan.textContent = String(this.lives);
          this.updateHeartIcon();
        }
        this.showResultOverlay(
          actualIdx + 1, false,
          `<div class="correct-answer-section"><span class="correct-text">Correct answer:</span> <span class="underlined">${sanitiseHTML(qData.correctAnswer)}</span></div><div class="explanation-section"><span class="explanation-label">Explanation:</span> <span class="explanation-text">${qData.explanation}</span></div>`,
          () => {
            if (this.lives === 0) {
              const coins = parseInt(localStorage.getItem('coins') || '500', 10);
              if (coins >= 450) {
                this.showModal('../src/components/modals/refill-hearts.html', () => {});
              } else {
                window.location.href = this.redirectUrl;
              }
            } else this.moveToNextQuestion();
          }
        );
      }
      input.disabled = true;
    });
    input.focus();
  }

  renderImageSelection(section, qData, actualIdx) {
    const imgs = qData.images || [];
    section.innerHTML = `
      <h2 class="quiz-title">Pick the correct image</h2>
      <div class="question" style="text-align:center">${qData.questionText}</div>
      <div class="image-selection-container">
        <div class="image-grid" id="image-grid-${actualIdx}">${imgs.map((img, i) => `<div class="image-tile" data-image="${i + 1}"><div class="image-container" data-image="${i + 1}"><img src="${img.src}" alt="${img.label}" loading="lazy"></div><div class="image-label">${img.label}</div></div>`).join('')}</div>
        <div class="expand-hint"><i>Tap any image to expand for a closer look</i></div>
      </div>
      <div class="footer"><button id="check-button-${actualIdx}" class="check-button" disabled>Check</button></div>
    `;
    const tiles = section.querySelectorAll('.image-tile');
    const containers = section.querySelectorAll('.image-container');
    const btn = document.getElementById(`check-button-${actualIdx}`);
    const zoomModal = document.getElementById('imageZoomModal');
    const zoomImg = document.getElementById('zoomedImage');
    const zoomLabel = document.getElementById('zoomImageLabel');
    const zoomClose = document.getElementById('zoomCloseBtn');
    let state = { selected: null, answered: false };

    tiles.forEach(t => {
      t.style.cursor = 'pointer';
      t.addEventListener('click', (e) => {
        if (state.answered) return;
        if (e.target.closest('.image-container')) return;
        tiles.forEach(tt => tt.classList.remove('selected'));
        t.classList.add('selected');
        state.selected = parseInt(t.dataset.image, 10);
        btn.disabled = false;
      });
    });
    containers.forEach(c => {
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        const img = c.querySelector('img');
        if (img && img.src) {
          zoomImg.src = img.src;
          zoomLabel.textContent = `Image ${c.dataset.image}`;
          zoomModal.classList.add('visible');
        }
      });
    });
    const closeZoom = () => { zoomModal.classList.remove('visible'); zoomImg.src = ''; };
    zoomModal.addEventListener('click', (e) => { if (e.target === zoomModal) closeZoom(); });
    zoomClose.addEventListener('click', closeZoom);

    btn.addEventListener('click', () => {
      if (state.selected === null || state.answered) return;
      state.answered = true;
      tiles.forEach(t => t.style.cursor = 'default');
      tiles.forEach(t => {
        const n = parseInt(t.dataset.image, 10);
        if (n === qData.correctAnswer) t.classList.add('correct');
        else if (n === state.selected && n !== qData.correctAnswer) t.classList.add('incorrect');
        t.classList.remove('selected');
      });
      const isCorrect = (state.selected === qData.correctAnswer);
      this.playSound(isCorrect);

      if (isCorrect) {
        this.totalCorrectAttempts++;
        this.totalAttempts++;
        if (!this.questionFinalCorrect[actualIdx]) this.questionFinalCorrect[actualIdx] = true;
        const idx = this.retryQueue.indexOf(actualIdx);
        if (idx !== -1) {
          this.retryQueue.splice(idx, 1);
          const skip = this.inRetryMode && idx === this.currentQuestion;
          this.handleCorrectAnswer();
          this.showResultOverlay(
            actualIdx + 1, true,
            `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`,
            () => this.moveToNextQuestion(skip)
          );
        } else {
          this.handleCorrectAnswer();
          this.showResultOverlay(
            actualIdx + 1, true,
            `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`,
            () => this.moveToNextQuestion()
          );
        }
      } else {
        this.totalAttempts++;
        if (!this.retryQueue.includes(actualIdx)) this.retryQueue.push(actualIdx);
        this.handleIncorrectAnswer();
        if (this.lives > 0) {
          this.lives--;
          this.livesCountSpan.textContent = String(this.lives);
          this.updateHeartIcon();
        }
        this.showResultOverlay(
          actualIdx + 1, false,
          `<div class="correct-answer-section"><span class="correct-text">Correct answer:</span> <span class="underlined">Image ${qData.correctAnswer}</span></div><div class="explanation-section"><span class="explanation-label">Explanation:</span> <span class="explanation-text">${qData.explanation}</span></div>`,
          () => {
            if (this.lives === 0) {
              const coins = parseInt(localStorage.getItem('coins') || '500', 10);
              if (coins >= 450) {
                this.showModal('../src/components/modals/refill-hearts.html', () => {});
              } else {
                window.location.href = this.redirectUrl;
              }
            } else this.moveToNextQuestion();
          }
        );
      }
    });
  }

  renderMatching(section, qData, actualIdx) {
    section.innerHTML = `
      <h2 class="quiz-title">Match the pairs</h2>
      <div class="game-container"><div class="column" id="leftColumn-${actualIdx}"></div><div class="column" id="rightColumn-${actualIdx}"></div></div>
      <button class="matching-continue-btn" id="matchingContinueBtn-${actualIdx}" style="display: none;">Continue</button>
      <div class="feedback-overlay" id="feedbackOverlay-${actualIdx}" style="display: none;">
        <div class="matching-feedback">
          <div class="result-main">
            <img src="../public/assets/icons/material-symbols/outline/cancel.svg" class="material-icon" alt="cancel" style="width:2.5rem;">
            <div class="result-header" id="feedbackTitle-${actualIdx}">Incorrect</div>
            <img src="../public/assets/icons/material-symbols/outline/stylus_note.svg" class="material-icon" alt="note" style="width:2.5rem;">
          </div>
          <div class="feedback-subtitle" id="feedbackMessage-${actualIdx}">Let's try that again</div>
          <button class="feedback-button" id="tryAgainBtn-${actualIdx}">Try Again</button>
        </div>
      </div>
    `;

    const leftCol = document.getElementById(`leftColumn-${actualIdx}`);
    const rightCol = document.getElementById(`rightColumn-${actualIdx}`);
    const feedbackOverlay = document.getElementById(`feedbackOverlay-${actualIdx}`);
    const tryAgainBtn = document.getElementById(`tryAgainBtn-${actualIdx}`);
    const matchingContinueBtn = document.getElementById(`matchingContinueBtn-${actualIdx}`);
    const feedbackTitle = document.getElementById(`feedbackTitle-${actualIdx}`);
    const feedbackMessage = document.getElementById(`feedbackMessage-${actualIdx}`);

    feedbackOverlay.style.display = 'none';
    matchingContinueBtn.style.display = 'none';

    let selectedLeft = null, selectedRight = null;
    let matched = 0, gameActive = true, lifeLostInThisGame = false, completed = false;
    const pairs = qData.pairs || [];
    const shuffledPairs = this.shuffleArray([...pairs]);

    leftCol.innerHTML = '';
    shuffledPairs.forEach((pair, idx) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.pair = String(idx);
      card.dataset.type = 'term';
      card.textContent = pair.term;
      card.addEventListener('click', () => {
        if (!gameActive || card.classList.contains('matched')) return;
        if (card.classList.contains('wrong')) resetWrong();
        leftCol.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedLeft = card;
        if (selectedLeft && selectedRight) checkMatch();
      });
      leftCol.appendChild(card);
    });

    rightCol.innerHTML = '';
    const shuffledMeanings = this.shuffleArray([...shuffledPairs]);
    shuffledMeanings.forEach(pair => {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.pair = String(shuffledPairs.findIndex(p => p.meaning === pair.meaning));
      card.dataset.type = 'meaning';
      card.textContent = pair.meaning;
      card.addEventListener('click', () => {
        if (!gameActive || card.classList.contains('matched')) return;
        if (card.classList.contains('wrong')) resetWrong();
        rightCol.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedRight = card;
        if (selectedLeft && selectedRight) checkMatch();
      });
      rightCol.appendChild(card);
    });

    const resetWrong = () => {
      document.querySelectorAll(
        `#leftColumn-${actualIdx} .card.wrong, #rightColumn-${actualIdx} .card.wrong`
      ).forEach(c => c.classList.remove('wrong'));
      document.querySelectorAll(
        `#leftColumn-${actualIdx} .card.selected, #rightColumn-${actualIdx} .card.selected`
      ).forEach(c => c.classList.remove('selected'));
      selectedLeft = null;
      selectedRight = null;
      feedbackOverlay.style.display = 'none';
    };

    const checkMatch = () => {
      if (!selectedLeft || !selectedRight || !gameActive) return;
      if (selectedLeft.dataset.pair === selectedRight.dataset.pair) {
        this.playSound(true);
        const leftCard = selectedLeft;
        const rightCard = selectedRight;
        const wasAlreadyMatched =
          leftCard.classList.contains('matched') ||
          rightCard.classList.contains('matched');

        selectedLeft.classList.remove('selected');
        selectedRight.classList.remove('selected');
        selectedLeft.classList.add('correct');
        selectedRight.classList.add('correct');

        if (!wasAlreadyMatched) {
          this.totalCorrectAttempts++;
          this.totalAttempts++;
          matched++;
        } else {
          matched++;
        }

        setTimeout(() => {
          document.querySelectorAll(
            `#leftColumn-${actualIdx} .card.correct, #rightColumn-${actualIdx} .card.correct`
          ).forEach(c => {
            c.classList.remove('correct');
            c.classList.add('matched');
          });
        }, 800);

        if (matched === pairs.length && !completed) {
          gameActive = false;
          completed = true;
          if (!this.questionFinalCorrect[actualIdx]) this.questionFinalCorrect[actualIdx] = true;
          const idx = this.retryQueue.indexOf(actualIdx);
          if (idx !== -1) {
            this.retryQueue.splice(idx, 1);
            this._skipNextIncrement = this.inRetryMode && idx === this.currentQuestion;
          }
          this.handleCorrectAnswer();
          if (this.pendingCelebration) {
            this.processAfterExplanation(() => {
              matchingContinueBtn.style.display = 'block';
            });
          } else {
            matchingContinueBtn.style.display = 'block';
          }
        }
      } else {
        this.playSound(false);
        selectedLeft.classList.add('wrong');
        selectedRight.classList.add('wrong');
        this.totalAttempts++;
        this.handleIncorrectAnswer();

        if (!lifeLostInThisGame) {
          if (this.lives > 0) {
            this.lives--;
            this.livesCountSpan.textContent = String(this.lives);
            this.updateHeartIcon();
            lifeLostInThisGame = true;
            if (this.lives === 0) {
              feedbackTitle.textContent = 'Game Over';
              feedbackMessage.textContent = "You've run out of lives!";
              feedbackOverlay.style.display = 'flex';
              gameActive = false;
              const coins = parseInt(localStorage.getItem('coins') || '500', 10);
              if (coins >= 450) {
                this.showModal('../src/components/modals/refill-hearts.html', () => {});
              } else {
                window.location.href = this.redirectUrl;
              }
              return;
            }
          }
        }
        feedbackTitle.textContent = 'Incorrect';
        feedbackMessage.textContent = "Let's try that again";
        feedbackOverlay.style.display = 'flex';
      }
      selectedLeft = null;
      selectedRight = null;
    };

    matchingContinueBtn.onclick = () => {
      const skip = this._skipNextIncrement || false;
      this._skipNextIncrement = false;
      this.moveToNextQuestion(skip);
    };

    tryAgainBtn.onclick = () => resetWrong();
    feedbackOverlay.addEventListener('click', (e) => {
      if (e.target === feedbackOverlay) resetWrong();
    });
  }
}

window.QuizEngine = QuizEngine;
