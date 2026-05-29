// src/js/quiz-engine.js
import { supabase, getCurrentUser, loadUserProgress, updateUserProgress, recordLessonCompletion, getActiveXpBoost, addXpBoost } from './supabase.js';

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
    this.courseId = lessonData.courseId || 'g12-life-sciences';

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
    this._streakRewardProcessed = false;

    this.user = null;
    this.userProgress = null;
    this.activeXpBoost = null;

    this.showQuestion = this.showQuestion.bind(this);
    this.moveToNextQuestion = this.moveToNextQuestion.bind(this);
    this.finishQuiz = this.finishQuiz.bind(this);
    this.handleCorrectAnswer = this.handleCorrectAnswer.bind(this);
    this.handleIncorrectAnswer = this.handleIncorrectAnswer.bind(this);
    this.showResultOverlay = this.showResultOverlay.bind(this);
    this.showModal = this.showModal.bind(this);
    this.updateStreakCounter = this.updateStreakCounter.bind(this);
    this.updateHeartIcon = this.updateHeartIcon.bind(this);
    this.processAfterExplanation = this.processAfterExplanation.bind(this);
    this.shuffleArray = this.shuffleArray.bind(this);
    this.normalizeAnswer = this.normalizeAnswer.bind(this);
    this.playSound = this.playSound.bind(this);

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

    this.initUser().then(() => {
      if (this.user && this.userProgress) {
        this.lives = this.userProgress.hearts;
        this.livesCountSpan.textContent = this.lives;
        this.updateHeartIcon();
        this.currentStreakDays = this.userProgress.current_streak;
        this.updateStreakCounter();
      }
      this.loadStreakFromStorage();
      this.updateStreakCounter();
      this.updateHeartIcon();
      this.progressBar.style.width = `${(1 / this.totalQuestions) * 100}%`;

      if (!localStorage.getItem('hasCompletedFirstLesson')) {
        this.showModal('../src/components/modals/hearts-modal.html', () => {
          localStorage.setItem('hasCompletedFirstLesson', 'true');
          this.showQuestion(0);
        });
      } else {
        this.showQuestion(0);
      }
    }).catch(() => {
      // Not logged in, start with defaults
      this.lives = 5;
      this.livesCountSpan.textContent = '5';
      this.updateHeartIcon();
      this.loadStreakFromStorage();
      this.updateStreakCounter();
      this.progressBar.style.width = `${(1 / this.totalQuestions) * 100}%`;
      if (!localStorage.getItem('hasCompletedFirstLesson')) {
        this.showModal('../src/components/modals/hearts-modal.html', () => {
          localStorage.setItem('hasCompletedFirstLesson', 'true');
          this.showQuestion(0);
        });
      } else {
        this.showQuestion(0);
      }
    });
  }

  async initUser() {
    this.user = await getCurrentUser();
    if (this.user) {
      this.userProgress = await loadUserProgress(this.user.id);
      const boost = await getActiveXpBoost(this.user.id);
      this.activeXpBoost = boost ? boost.multiplier : null;
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
  saveStreakToStorage() { localStorage.setItem(this.streakKey, String(this.currentStreakDays)); }
  incrementStreak() { this.currentStreakDays++; this.saveStreakToStorage(); }

  isFirstLessonOfDay() {
    const tz = localStorage.getItem('userTimezone') || 'UTC';
    const today = this.getDateInTimezone(tz);
    const last = localStorage.getItem('lastLessonDate');
    return last !== today;
  }

  getDateInTimezone(tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  buildStreakData() {
    const tz = localStorage.getItem('userTimezone') || 'UTC';
    const todayStr = this.getDateInTimezone(tz);
    let streakData = {};
    const stored = localStorage.getItem('streakState');
    if (stored) streakData = JSON.parse(stored);

    const defaults = {
      currentStreak: 1,
      totalAppDays: 1,
      lastLessonDate: todayStr,
      timezone: tz,
      recentDays: []
    };
    streakData = Object.assign({}, defaults, streakData);

    if (!streakData.recentDays || streakData.recentDays.length === 0) {
      streakData.recentDays = [{ date: todayStr, status: 'completed' }];
      streakData.totalAppDays = 1;
      streakData.currentStreak = 1;
      localStorage.setItem('firstLessonDate', todayStr);
    } else {
      const todayEntry = streakData.recentDays.find(d => d.date === todayStr);
      if (!todayEntry) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);
        const prevDay = streakData.recentDays.find(d => d.date === yesterdayStr);
        if (prevDay && (prevDay.status === 'completed' || prevDay.status === 'revived')) {
          streakData.currentStreak = (streakData.currentStreak || 0) + 1;
        } else {
          streakData.currentStreak = 1;
        }
        streakData.recentDays.push({ date: todayStr, status: 'completed' });
        if (streakData.recentDays.length > 7) streakData.recentDays = streakData.recentDays.slice(-7);
        const first = localStorage.getItem('firstLessonDate');
        if (first) {
          const firstDate = new Date(first + 'T12:00:00Z');
          const now = new Date(todayStr + 'T12:00:00Z');
          const diffDays = Math.floor((now - firstDate) / 86400000) + 1;
          streakData.totalAppDays = diffDays;
        } else {
          streakData.totalAppDays = streakData.recentDays.length;
        }
      }
    }

    streakData.lastLessonDate = todayStr;
    localStorage.setItem('streakState', JSON.stringify(streakData));
    localStorage.setItem('lastLessonDate', todayStr);
    this.currentStreakDays = streakData.currentStreak;
    this.saveStreakToStorage();
    return streakData;
  }

  processStreakReward(rewardInfo) {
    if (this._streakRewardProcessed) return;
    this._streakRewardProcessed = true;
    const { isMilestone, heartsAtCompletion } = rewardInfo;
    const streakDays = this.currentStreakDays;

    if (isMilestone) {
      let coins = 250;
      if (streakDays >= 30 && streakDays <= 70) coins = 500;
      if (streakDays > 70 && streakDays <= 360) coins = 750;
      if (streakDays > 360) coins = 1000;
      this.showModal(`../src/components/modals/coins-reward.html?amount=${coins}`, () => {
        this.openDailyQuest();
      });
      if (this.user && this.userProgress) {
        this.userProgress.coins += coins;
        updateUserProgress(this.user.id, { coins: this.userProgress.coins });
      }
    } else {
      if (heartsAtCompletion >= 3 && heartsAtCompletion <= 5) {
        const multipliers = [
          { mult: 1.5, dur: 30 },
          { mult: 2, dur: 20 },
          { mult: 3, dur: 15 }
        ];
        const chosen = multipliers[Math.floor(Math.random() * multipliers.length)];
        this.showModal(`../src/components/modals/boost-reward.html?multiplier=${chosen.mult}&duration=${chosen.dur}`, () => {
          this.openDailyQuest();
        });
        if (this.user) addXpBoost(this.user.id, chosen.mult, chosen.dur);
      } else if (heartsAtCompletion >= 1 && heartsAtCompletion <= 2) {
        if (Math.random() < 0.5) {
          this.showModal(`../src/components/modals/heart-reward.html?hearts=full`, () => {
            this.openDailyQuest();
          });
          if (this.user) {
            this.lives = 5;
            updateUserProgress(this.user.id, { hearts: 5 });
          }
        } else {
          const multipliers = [
            { mult: 1.5, dur: 30 },
            { mult: 2, dur: 20 },
            { mult: 3, dur: 15 }
          ];
          const chosen = multipliers[Math.floor(Math.random() * multipliers.length)];
          this.showModal(`../src/components/modals/boost-reward.html?multiplier=${chosen.mult}&duration=${chosen.dur}`, () => {
            this.openDailyQuest();
          });
          if (this.user) addXpBoost(this.user.id, chosen.mult, chosen.dur);
        }
      } else {
        this.openDailyQuest();
      }
    }
  }

  openDailyQuest() {
    this.showModal(`../src/components/modals/daily-quest.html?correctAttempts=${this.totalCorrectAttempts}&totalAttempts=${this.totalAttempts}&completed=true`, () => {
      if (this.user) {
        window.location.href = this.redirectUrl;
      } else {
        const tempProgress = {
          heartsAtCompletion: this.heartsAtCompletion,
          totalCorrectAttempts: this.totalCorrectAttempts,
          totalAttempts: this.totalAttempts,
          xpEarned: this.calculateXp(),
          lessonId: this.title,
          courseId: this.courseId
        };
        localStorage.setItem('tempLessonProgress', JSON.stringify(tempProgress));
        window.location.href = '/pages/registration.html?returnTo=' + encodeURIComponent(this.redirectUrl);
      }
    });
  }

  calculateXp() {
    const accuracy = Math.round((this.totalCorrectAttempts / this.totalAttempts) * 10);
    const timeSeconds = Math.floor((Date.now() - this.quizStartTime) / 1000);
    const expectedTime = this.totalQuestions * 15;
    let speedXP = 0;
    if (timeSeconds <= expectedTime) speedXP = 10;
    else if (timeSeconds <= expectedTime * 2) speedXP = Math.round(10 * (2 - (timeSeconds / expectedTime)));
    let total = 10 + accuracy + speedXP;
    if (this.activeXpBoost) total = Math.round(total * this.activeXpBoost);
    return total;
  }

  async finishQuiz() {
    if (this.quizCompleted) return;
    this.quizCompleted = true;
    const timeSeconds = Math.floor((Date.now() - this.quizStartTime) / 1000);
    this.heartsAtCompletion = this.lives;
    localStorage.setItem('heartsAtCompletion', String(this.heartsAtCompletion));

    if (this.user && this.userProgress) {
      const xpEarned = this.calculateXp();
      const accuracy = Math.round((this.totalCorrectAttempts / this.totalAttempts) * 100);
      await recordLessonCompletion(this.user.id, this.courseId, this.title, xpEarned, accuracy, timeSeconds);
      const updates = {
        hearts: this.lives,
        total_xp: this.userProgress.total_xp + xpEarned,
        coins: this.userProgress.coins
      };
      await updateUserProgress(this.user.id, updates);
      this.userProgress = await loadUserProgress(this.user.id);
    }

    this.showModal(`../src/components/modals/lesson-complete.html?correctAttempts=${this.totalCorrectAttempts}&totalAttempts=${this.totalAttempts}&time=${timeSeconds}`, () => {
      if (this.isFirstLessonOfDay()) {
        const streakData = this.buildStreakData();
        const encodedData = encodeURIComponent(JSON.stringify(streakData));
        const heartsValue = this.heartsAtCompletion;
        this.showModal(`../src/components/modals/streak.html?data=${encodedData}&hearts=${heartsValue}`, () => {});
      } else {
        this.openDailyQuest();
      }
    });
  }

  updateStreakCounter() { this.streakCounterSpan.textContent = this.currentStreak >= 2 ? `${this.currentStreak} in a row!` : ''; }
  updateHeartIcon() {
    this.livesIcon.src = this.lives === 0
      ? '../public/assets/icons/phosphor/regular/heart.svg'
      : '../public/assets/icons/phosphor/fill/heart.svg';
  }
  playSound(isCorrect) {
    const audio = isCorrect ? document.getElementById('correctSound') : document.getElementById('incorrectSound');
    if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); }
  }
  normalizeAnswer(a) { return a.toLowerCase().replace(/\s+/g,' ').replace(/[()]/g,'').replace(/\//g,' ').trim(); }
  shuffleArray(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

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
          localStorage.setItem('coins', String(coins - 450));
          this.lives = 5;
          this.livesCountSpan.textContent = '5';
          this.updateHeartIcon();
          const currentActualIdx = this.inRetryMode ? this.retryQueue[this.currentQuestion] : this.currentQuestion;
          const idxInQueue = this.retryQueue.indexOf(currentActualIdx);
          if (idxInQueue !== -1) this.retryQueue.splice(idxInQueue, 1);
          this.moveToNextQuestion();
        } else {
          window.location.href = this.redirectUrl;
        }
        if (onClose) onClose();
      } else if (event.data && event.data.type === 'streakClosed') {
        window.removeEventListener('message', handler);
        this.fullscreenOverlay.classList.remove('visible');
        this.modalIframe.src = 'about:blank';
        this.currentStreakDays = event.data.streakDays;
        this.saveStreakToStorage();
        this.processStreakReward({
          isMilestone: event.data.isMilestone,
          heartsAtCompletion: event.data.heartsAtCompletion
        });
      } else if (event.data && event.data.type === 'openCoinReward') {
        const coinModalUrl = `../src/components/modals/coins-reward.html?amount=${event.data.amount}`;
        this.modalIframe.src = coinModalUrl;
        this.fullscreenOverlay.classList.add('visible');
        const subHandler = (subEvent) => {
          if (subEvent.data === 'modalClose') {
            window.removeEventListener('message', subHandler);
            this.fullscreenOverlay.classList.remove('visible');
            this.modalIframe.src = 'about:blank';
          }
        };
        window.addEventListener('message', subHandler);
      } else if (event.data && event.data.type === 'questChestClaimed') {
        const coins = parseInt(localStorage.getItem('coins') || '500', 10);
        localStorage.setItem('coins', String(coins + (event.data.amount || 0)));
      } else if (event.data && event.data.type === 'achievementClaimed') {
        const coins = parseInt(localStorage.getItem('coins') || '500', 10);
        localStorage.setItem('coins', String(coins + (event.data.coins || 0)));
      } else if (event.data && event.data.type === 'recordClaimed') {
        const coins = parseInt(localStorage.getItem('coins') || '500', 10);
        localStorage.setItem('coins', String(coins + (event.data.coins || 0)));
      }
    };
    window.addEventListener('message', handler);
  }

  resetCurrentQuestion() { this.showQuestion(this.currentQuestion); }
  handleCorrectAnswer() { this.currentStreak++; this.updateStreakCounter(); if (this.currentStreak % 5 === 0 && this.currentStreak > 0) { this.pendingCelebration = true; this.pendingCelebrationStreak = this.currentStreak; } }
  handleIncorrectAnswer() { this.currentStreak = 0; this.updateStreakCounter(); }

  processAfterExplanation(onComplete) {
    if (this.pendingCelebration) {
      const streak = this.pendingCelebrationStreak;
      this.pendingCelebration = false; this.pendingCelebrationStreak = null; this.waitingForCelebration = true;
      this.showModal(`../src/components/modals/answer-streak.html?streak=${streak}`, () => {
        this.waitingForCelebration = false;
        if (onComplete) onComplete();
      });
    } else { if (onComplete) onComplete(); }
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
    continueBtn.onclick = () => { overlay.classList.remove('visible'); this.processAfterExplanation(onComplete); };
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

  showQuestion(questionIndex) {
    this.questionSections.forEach(s => { if (s) s.style.display = 'none'; });
    const actualIdx = this.inRetryMode ? this.retryQueue[this.currentQuestion] : this.currentQuestion;
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
      case 'multiple-choice': this.renderMultipleChoice(section, qData, actualIdx); break;
      case 'complete-sentence': this.renderCompleteSentence(section, qData, actualIdx); break;
      case 'fill-blank': this.renderFillBlank(section, qData, actualIdx); break;
      case 'image-selection': this.renderImageSelection(section, qData, actualIdx); break;
      case 'matching': this.renderMatching(section, qData, actualIdx); break;
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
      const b = document.createElement('button'); b.className = 'option-button'; b.dataset.value = opt; b.textContent = opt;
      b.addEventListener('click', () => {
        if (this.answered) return;
        container.querySelectorAll('.option-button').forEach(bb => bb.classList.remove('selected'));
        b.classList.add('selected'); selected = b.dataset.value; btn.disabled = false;
      });
      container.appendChild(b);
    });

    btn.addEventListener('click', () => {
      if (!selected || this.answered) return;
      this.answered = true;
      const isCorrect = (selected === qData.correctAnswer);
      this.playSound(isCorrect);
      const correctBtn = Array.from(container.querySelectorAll('.option-button')).find(b => b.dataset.value === qData.correctAnswer);
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
          this.showResultOverlay(actualIdx + 1, true, `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`, () => this.moveToNextQuestion(skip));
        } else {
          this.handleCorrectAnswer();
          this.showResultOverlay(actualIdx + 1, true, `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`, () => this.moveToNextQuestion());
        }
      } else {
        this.totalAttempts++;
        this.handleIncorrectAnswer();
        if (!this.retryQueue.includes(actualIdx)) this.retryQueue.push(actualIdx);
        if (this.lives > 0) { this.lives--; this.livesCountSpan.textContent = String(this.lives); this.updateHeartIcon(); }
        const selBtn = Array.from(container.querySelectorAll('.option-button')).find(b => b.dataset.value === selected);
        if (selBtn) selBtn.classList.add('incorrect');
        this.showResultOverlay(actualIdx + 1, false, `<div class="correct-answer-section"><span class="correct-text">Correct answer:</span> <span class="underlined">${sanitiseHTML(qData.correctAnswer)}</span></div><div class="explanation-section"><span class="explanation-label">Explanation:</span> <span class="explanation-text">${qData.explanation}</span></div>`, () => {
          if (this.lives === 0) {
            const coins = parseInt(localStorage.getItem('coins') || '500', 10);
            if (coins >= 450) this.showModal('../src/components/modals/refill-hearts.html', () => {});
            else window.location.href = this.redirectUrl;
          } else this.moveToNextQuestion();
        });
      }
      container.querySelectorAll('.option-button').forEach(b => { b.disabled = true; b.style.cursor = 'not-allowed'; });
    });
  }

  renderCompleteSentence(section, qData, actualIdx) {
    const blankIds = []; const re = /id="(blank-[^"]+)"/g; let match;
    while ((match = re.exec(qData.questionText)) !== null) blankIds.push(match[1]);
    const blanksHTML = blankIds.map(id => `<span id="${id}" class="blank" tabindex="0"></span>`);
    let displayText = qData.questionText;
    blankIds.forEach((id, i) => { displayText = displayText.replace(new RegExp(`<span[^>]*id="${id}"[^>]*>.*?</span>`, 'g'), blanksHTML[i]); });

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
      const button = document.createElement('button'); button.className = 'option-button'; button.dataset.value = opt.value;
      button.innerHTML = `<span>${opt.label}</span>`; optionBtns.push(button);
      button.addEventListener('click', () => {
        if (this.answered) return; if (filled.some(f => f && f.value === opt.value)) return;
        const idx = filled.findIndex(f => f === null); if (idx === -1) return;
        const target = blankElements[idx]; if (!target) return;
        filled[idx] = { value: opt.value, label: opt.label }; target.textContent = opt.label;
        target.classList.add('filled'); button.classList.add('used-option');
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
          if (b) b.classList.remove('used-option'); blank.textContent = '';
          blank.classList.remove('filled', 'correct', 'incorrect'); filled[idx] = null;
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
      this.playSound(isCorrect); optionBtns.forEach(b => { b.disabled = true; });

      if (isCorrect) {
        this.totalCorrectAttempts++;
        this.totalAttempts++;
        if (!this.questionFinalCorrect[actualIdx]) this.questionFinalCorrect[actualIdx] = true;
        const idx = this.retryQueue.indexOf(actualIdx);
        if (idx !== -1) {
          this.retryQueue.splice(idx, 1);
          const skip = this.inRetryMode && idx === this.currentQuestion;
          blankElements.forEach(b => { if (b) b.classList.add('correct'); });
          optionBtns.forEach(b => { if (qData.correctAnswers.includes(b.dataset.value)) b.classList.add('correct'); });
          this.handleCorrectAnswer();
          this.showResultOverlay(actualIdx + 1, true, `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`, () => this.moveToNextQuestion(skip));
        } else {
          blankElements.forEach(b => { if (b) b.classList.add('correct'); });
          optionBtns.forEach(b => { if (qData.correctAnswers.includes(b.dataset.value)) b.classList.add('correct'); });
          this.handleCorrectAnswer();
          this.showResultOverlay(actualIdx + 1, true, `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`, () => this.moveToNextQuestion());
        }
      } else {
        this.totalAttempts++;
        blankElements.forEach(b => { if (b) b.classList.add('incorrect'); });
        if (!this.retryQueue.includes(actualIdx)) this.retryQueue.push(actualIdx);
        this.handleIncorrectAnswer();
        if (this.lives > 0) { this.lives--; this.livesCountSpan.textContent = String(this.lives); this.updateHeartIcon(); }
        optionBtns.forEach(b => { if (qData.correctAnswers.includes(b.dataset.value)) b.classList.add('correct'); });
        const correctLabels = qData.correctAnswers.map(a => qData.options.find(o => o.value === a)?.label || a).join('</span> and <span class="underlined">');
        this.showResultOverlay(actualIdx + 1, false, `<div class="correct-answer-section"><span class="correct-text">Correct answer:</span> <span><span class="underlined">${correctLabels}</span></span></div><div class="explanation-section"><span class="explanation-label">Explanation:</span> <span class="explanation-text">${qData.explanation}</span></div>`, () => {
          if (this.lives === 0) {
            const coins = parseInt(localStorage.getItem('coins') || '500', 10);
            if (coins >= 450) this.showModal('../src/components/modals/refill-hearts.html', () => {});
            else window.location.href = this.redirectUrl;
          } else this.moveToNextQuestion();
        });
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
    input.addEventListener('input', () => { btn.disabled = !input.value.trim(); if (this.answered) { input.classList.remove('correct', 'incorrect'); this.answered = false; } });
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !btn.disabled) btn.click(); });
    btn.addEventListener('click', () => {
      this.answered = true;
      const userAnswer = this.normalizeAnswer(input.value.trim());
      const isCorrect = qData.acceptableAnswers.some(a => userAnswer === this.normalizeAnswer(a));
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
          this.showResultOverlay(actualIdx + 1, true, `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`, () => this.moveToNextQuestion(skip));
        } else {
          input.classList.add('correct');
          this.handleCorrectAnswer();
          this.showResultOverlay(actualIdx + 1, true, `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`, () => this.moveToNextQuestion());
        }
      } else {
        this.totalAttempts++;
        if (!this.retryQueue.includes(actualIdx)) this.retryQueue.push(actualIdx);
        this.handleIncorrectAnswer(); input.classList.add('incorrect');
        if (this.lives > 0) { this.lives--; this.livesCountSpan.textContent = String(this.lives); this.updateHeartIcon(); }
        this.showResultOverlay(actualIdx + 1, false, `<div class="correct-answer-section"><span class="correct-text">Correct answer:</span> <span class="underlined">${sanitiseHTML(qData.correctAnswer)}</span></div><div class="explanation-section"><span class="explanation-label">Explanation:</span> <span class="explanation-text">${qData.explanation}</span></div>`, () => {
          if (this.lives === 0) {
            const coins = parseInt(localStorage.getItem('coins') || '500', 10);
            if (coins >= 450) this.showModal('../src/components/modals/refill-hearts.html', () => {});
            else window.location.href = this.redirectUrl;
          } else this.moveToNextQuestion();
        });
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
          this.showResultOverlay(actualIdx + 1, true, `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`, () => this.moveToNextQuestion(skip));
        } else {
          this.handleCorrectAnswer();
          this.showResultOverlay(actualIdx + 1, true, `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`, () => this.moveToNextQuestion());
        }
      } else {
        this.totalAttempts++;
        if (!this.retryQueue.includes(actualIdx)) this.retryQueue.push(actualIdx);
        this.handleIncorrectAnswer();
        if (this.lives > 0) { this.lives--; this.livesCountSpan.textContent = String(this.lives); this.updateHeartIcon(); }
        this.showResultOverlay(actualIdx + 1, false, `<div class="correct-answer-section"><span class="correct-text">Correct answer:</span> <span class="underlined">Image ${qData.correctAnswer}</span></div><div class="explanation-section"><span class="explanation-label">Explanation:</span> <span class="explanation-text">${qData.explanation}</span></div>`, () => {
          if (this.lives === 0) {
            const coins = parseInt(localStorage.getItem('coins') || '500', 10);
            if (coins >= 450) this.showModal('../src/components/modals/refill-hearts.html', () => {});
            else window.location.href = this.redirectUrl;
          } else this.moveToNextQuestion();
        });
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

    let selectedLeft = null, selectedRight = null, matched = 0, gameActive = true, lifeLostInThisGame = false, completed = false;
    const pairs = qData.pairs || [], shuffledPairs = this.shuffleArray([...pairs]);

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
      document.querySelectorAll(`#leftColumn-${actualIdx} .card.wrong, #rightColumn-${actualIdx} .card.wrong`).forEach(c => c.classList.remove('wrong'));
      document.querySelectorAll(`#leftColumn-${actualIdx} .card.selected, #rightColumn-${actualIdx} .card.selected`).forEach(c => c.classList.remove('selected'));
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
        const wasAlreadyMatched = leftCard.classList.contains('matched') || rightCard.classList.contains('matched');

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
          document.querySelectorAll(`#leftColumn-${actualIdx} .card.correct, #rightColumn-${actualIdx} .card.correct`).forEach(c => {
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
          this.currentStreak++;
          this.updateStreakCounter();
          if (this.currentStreak % 5 === 0 && this.currentStreak > 0) {
            this.pendingCelebration = true;
            this.pendingCelebrationStreak = this.currentStreak;
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
              if (coins >= 450) this.showModal('../src/components/modals/refill-hearts.html', () => {});
              else window.location.href = this.redirectUrl;
              return;
            }
          }
        }
        this.handleIncorrectAnswer();
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
