// ============================================================
// VULANET QUIZ ENGINE – Complete data-driven engine
// Handles all question types and modal sequences.
// ============================================================

/**
 * Sanitise a string to prevent XSS attacks.
 * Converts < > " ' & to their HTML entities.
 */
function sanitiseHTML(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

class QuizEngine {
  constructor(lessonData) {
    // Lesson configuration
    this.title = lessonData.title || 'Lesson';
    this.totalQuestions = lessonData.totalQuestions || 0;
    this.redirectUrl = lessonData.redirectUrl || '/';
    this.streakKey = lessonData.streakKey || 'userStreakDays';
    this.questionsData = lessonData.questions || [];
    this.pairsData = lessonData.pairs || [];

    // Game state
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

    // Statistics
    this.quizStartTime = Date.now();
    this.quizCompleted = false;
    this.totalAttempts = 0;
    this.questionFinalCorrect = new Array(this.totalQuestions).fill(false);
    this.heartsAtCompletion = 5;
    this.currentStreakDays = 1;

    // Flag for first lesson (hearts modal)
    this.hasCompletedFirstLesson = localStorage.getItem('hasCompletedFirstLesson') === 'true';

    // Bind methods
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

    // DOM references (created dynamically)
    this.progressBar = null;
    this.livesCountSpan = null;
    this.livesIcon = null;
    this.streakCounterSpan = null;
    this.fullscreenOverlay = null;
    this.modalIframe = null;
    this.questionSections = [];
    this.resultOverlays = [];

    // Build the quiz UI
    this.buildQuizUI();

    // Bind close button
    const closeBtn = document.getElementById('close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.showModal('../modals/quit-confirmation.html', () => {});
      });
    }

    // Initialise
    this.loadStreakFromStorage();
    this.updateStreakCounter();
    this.updateHeartIcon();
    this.progressBar.style.width = `${(1 / this.totalQuestions) * 100}%`;

    // Show first question or hearts modal
    if (!this.hasCompletedFirstLesson) {
      this.showModal('../modals/hearts-modal.html', () => {
        localStorage.setItem('hasCompletedFirstLesson', 'true');
        this.hasCompletedFirstLesson = true;
        this.showQuestion(0);
      });
    } else {
      this.showQuestion(0);
    }
  }

  /**
   * Safely set innerHTML after sanitising.
   */
  static setSafeHTML(element, html) {
    // First, sanitise by creating a text node
    const temp = document.createElement('div');
    temp.textContent = html;
    element.innerHTML = temp.innerHTML;
  }

  // ============================================================
  // UI Construction
  // ============================================================

  buildQuizUI() {
    const container = document.querySelector('.quiz-container');

    // Get existing elements
    this.progressBar = document.getElementById('progress-bar');
    this.livesCountSpan = document.getElementById('lives-count');
    this.livesIcon = document.getElementById('lives-icon');
    this.streakCounterSpan = document.getElementById('streakCounter');
    this.fullscreenOverlay = document.getElementById('fullscreenModalOverlay');
    this.modalIframe = document.getElementById('modalIframe');

    // Create question sections and result overlays
    for (let i = 0; i < this.totalQuestions; i++) {
      // Question section
      const qSection = document.createElement('div');
      qSection.id = `question${i + 1}`;
      qSection.style.display = 'none';
      container.appendChild(qSection);

      // Result overlay
      const overlay = document.createElement('div');
      overlay.className = 'result-overlay';
      overlay.id = `resultOverlay-${i + 1}`;
      overlay.innerHTML = `
        <div class="result-container" id="resultContainer-${i + 1}">
          <div class="result-main">
            <span class="material-symbols-outlined material-icon" id="resultIcon-${i + 1}"></span>
            <div class="result-header" id="resultHeader-${i + 1}"></div>
            <span class="material-symbols-outlined material-icon" id="actionIcon-${i + 1}"></span>
          </div>
          <div class="explanation-content" id="explanationContainer-${i + 1}"></div>
          <button class="result-continue-btn" id="resultContinueBtn-${i + 1}">Continue</button>
        </div>
      `;
      container.appendChild(overlay);

      this.questionSections.push(qSection);
      this.resultOverlays.push(overlay);
    }

    // Create matching feedback overlay (shared for matching questions)
    // We'll create it once and reposition it as needed
    const feedbackOverlay = document.createElement('div');
    feedbackOverlay.className = 'feedback-overlay';
    feedbackOverlay.id = 'feedbackOverlay';
    feedbackOverlay.innerHTML = `
      <div class="matching-feedback" id="feedbackPanel">
        <div class="result-main">
          <span class="material-symbols-outlined material-icon" id="cancelIcon">cancel</span>
          <div class="result-header" id="feedbackTitle">Incorrect</div>
          <span class="material-symbols-outlined material-icon" id="notesIcon">stylus_note</span>
        </div>
        <div class="feedback-subtitle" id="feedbackMessage">Let's try that again</div>
        <button class="feedback-button" id="tryAgainBtn">Try Again</button>
      </div>
    `;
    container.appendChild(feedbackOverlay);

    // Create matching continue button (shared)
    const matchingContinueBtn = document.createElement('button');
    matchingContinueBtn.className = 'matching-continue-btn';
    matchingContinueBtn.id = 'matchingContinueBtn';
    matchingContinueBtn.style.display = 'none';
    matchingContinueBtn.textContent = 'Continue';
    container.appendChild(matchingContinueBtn);
  }

  // ============================================================
  // Storage Helpers
  // ============================================================

  loadStreakFromStorage() {
    const saved = localStorage.getItem(this.streakKey);
    if (saved) this.currentStreakDays = parseInt(saved, 10);
    else localStorage.setItem(this.streakKey, '1');
  }

  saveStreakToStorage() {
    localStorage.setItem(this.streakKey, String(this.currentStreakDays));
  }

  incrementStreak() {
    this.currentStreakDays++;
    this.saveStreakToStorage();
  }

  // ============================================================
  // UI Helpers
  // ============================================================

  updateStreakCounter() {
    if (this.currentStreak >= 2) {
      this.streakCounterSpan.textContent = `${this.currentStreak} in a row!`;
    } else {
      this.streakCounterSpan.textContent = '';
    }
  }

  updateHeartIcon() {
    if (this.lives === 0) {
      this.livesIcon.classList.remove('ph-fill');
      this.livesIcon.classList.add('ph');
    } else {
      this.livesIcon.classList.remove('ph');
      this.livesIcon.classList.add('ph-fill');
    }
  }

  playSound(isCorrect) {
    const audio = isCorrect
      ? document.getElementById('correctSound')
      : document.getElementById('incorrectSound');
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  }

  normalizeAnswer(answer) {
    return answer
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[()]/g, '')
      .replace(/\//g, ' ')
      .trim();
  }

  shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ============================================================
  // Modal Handling
  // ============================================================

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
        this.lives = 5;
        this.livesCountSpan.textContent = String(this.lives);
        this.updateHeartIcon();
        this.resetCurrentQuestion();
        if (onClose) onClose();
      } else if (event.data && event.data.type === 'streakClosed') {
        this.currentStreakDays = event.data.streakDays;
        this.saveStreakToStorage();
        if (onClose) onClose();
      }
    };
    window.addEventListener('message', handler);
  }

  resetCurrentQuestion() {
    this.showQuestion(this.currentQuestion);
  }

  // ============================================================
  // Answer Handling
  // ============================================================

  handleCorrectAnswer() {
    this.currentStreak++;
    this.updateStreakCounter();
    if (this.currentStreak % 5 === 0 && this.currentStreak > 0) {
      this.pendingCelebration = true;
      this.pendingCelebrationStreak = this.currentStreak;
    }
  }

  handleIncorrectAnswer() {
    this.currentStreak = 0;
    this.updateStreakCounter();
  }

  processAfterExplanation(onComplete) {
    if (this.pendingCelebration) {
      const streak = this.pendingCelebrationStreak;
      this.pendingCelebration = false;
      this.pendingCelebrationStreak = null;
      this.waitingForCelebration = true;
      this.showModal(`../modals/answer-streak.html?streak=${streak}`, () => {
        this.waitingForCelebration = false;
        if (onComplete) onComplete();
      });
    } else {
      if (onComplete) onComplete();
    }
  }

  showResultOverlay(questionNumber, isCorrect, explanationHTML, onComplete) {
    const overlay = document.getElementById(`resultOverlay-${questionNumber}`);
    const container = document.getElementById(`resultContainer-${questionNumber}`);
    const header = document.getElementById(`resultHeader-${questionNumber}`);
    const icon = document.getElementById(`resultIcon-${questionNumber}`);
    const actionIcon = document.getElementById(`actionIcon-${questionNumber}`);
    const explanationDiv = document.getElementById(`explanationContainer-${questionNumber}`);
    const continueBtn = document.getElementById(`resultContinueBtn-${questionNumber}`);

    if (!overlay) return;

    if (isCorrect) {
      header.textContent = 'Correct!';
      icon.textContent = 'check_circle';
      actionIcon.textContent = 'recommend';
      container.className = 'result-container correct';
    } else {
      header.textContent = 'Incorrect';
      icon.textContent = 'cancel';
      actionIcon.textContent = 'stylus_note';
      container.className = 'result-container incorrect';
    }

    explanationDiv.innerHTML = explanationHTML;
    overlay.classList.add('visible');

    continueBtn.onclick = () => {
      overlay.classList.remove('visible');
      this.processAfterExplanation(onComplete);
    };
  }

  // ============================================================
  // Navigation
  // ============================================================

  moveToNextQuestion() {
    if (this.waitingForCelebration) return false;

    if (this.inRetryMode) {
      this.currentQuestion++;
      if (this.currentQuestion >= this.retryQueue.length) {
        this.inRetryMode = false;
        this.retryQueue = [];
        this.showedRetryMessage = false;
        this.currentQuestion = 0;
        this.finishQuiz();
        return false;
      }
      this.showQuestion(this.currentQuestion);
      return true;
    } else {
      this.currentQuestion++;
      if (this.currentQuestion >= this.totalQuestions) {
        if (this.retryQueue.length > 0) {
          this.inRetryMode = true;
          this.currentQuestion = 0;
          if (!this.showedRetryMessage) {
            this.showedRetryMessage = true;
            this.showModal('../modals/review-questions.html', () => {
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

  finishQuiz() {
    if (this.quizCompleted) return;
    this.quizCompleted = true;

    const timeSeconds = Math.floor((Date.now() - this.quizStartTime) / 1000);
    let finalCorrect = 0;
    for (let i = 0; i < this.questionFinalCorrect.length; i++) {
      if (this.questionFinalCorrect[i]) finalCorrect++;
    }

    if (this.totalAttempts < finalCorrect) {
      this.totalAttempts = finalCorrect;
    }

    this.heartsAtCompletion = this.lives;
    this.incrementStreak();

    this.showModal(
      `../modals/lesson-complete.html?correctAttempts=${finalCorrect}&totalAttempts=${this.totalAttempts}&time=${timeSeconds}`,
      () => {
        this.showModal('../modals/streak.html', () => {
          const isMilestone = (this.currentStreakDays % 5 === 0);
          if (isMilestone) {
            let coinsAmount = 250;
            if (this.currentStreakDays >= 30 && this.currentStreakDays <= 70) coinsAmount = 500;
            this.showModal(`../modals/coins-reward.html?amount=${coinsAmount}`, () => {
              this.showDailyQuest(finalCorrect, this.totalAttempts);
            });
          } else {
            const random = Math.random();
            if (random < 0.5) {
              const multipliers = [
                { mult: 1.5, dur: 30 },
                { mult: 2, dur: 20 },
                { mult: 3, dur: 15 }
              ];
              const chosen = multipliers[Math.floor(Math.random() * multipliers.length)];
              this.showModal(`../modals/boost-reward.html?multiplier=${chosen.mult}&duration=${chosen.dur}`, () => {
                this.showDailyQuest(finalCorrect, this.totalAttempts);
              });
            } else {
              if (this.heartsAtCompletion <= 2) {
                this.showModal(`../modals/heart-reward.html?hearts=full`, () => {
                  this.showDailyQuest(finalCorrect, this.totalAttempts);
                });
              } else {
                this.showModal('../modals/boost-reward.html?multiplier=1.5&duration=30', () => {
                  this.showDailyQuest(finalCorrect, this.totalAttempts);
                });
              }
            }
          }
        });
      }
    );
  }

  showDailyQuest(correct, total) {
    this.showModal(`../modals/daily-quest.html?correctAttempts=${correct}&totalAttempts=${total}&completed=true`, () => {
      // After daily quest, check if user is logged in
      // For now, redirect to learning path
      window.location.href = this.redirectUrl;
    });
  }

  // ============================================================
  // Question Rendering – Data-driven for all types
  // ============================================================

  showQuestion(questionIndex) {
    // Hide all sections
    this.questionSections.forEach(s => { if (s) s.style.display = 'none'; });

    const actualIdx = this.inRetryMode
      ? this.retryQueue[this.currentQuestion]
      : this.currentQuestion;

    const section = this.questionSections[actualIdx];
    if (!section) return;
    section.style.display = 'block';

    // Update progress
    const total = this.inRetryMode ? this.retryQueue.length : this.totalQuestions;
    const percent = Math.round(((this.currentQuestion + 1) / total) * 100);
    this.progressBar.style.width = `${percent}%`;

    this.updateStreakCounter();
    this.answered = false;
    this.selectedOption = null;

    const qData = this.questionsData[actualIdx];
    if (!qData) return;

    // Clear the section
    section.innerHTML = '';

    // Build question UI based on type
    switch (qData.type) {
      case 'multiple-choice':
        this.renderMultipleChoice(section, qData, actualIdx);
        break;
      case 'complete-sentence':
        this.renderCompleteSentence(section, qData, actualIdx);
        break;
      case 'fill-blank':
        this.renderFillBlank(section, qData, actualIdx);
        break;
      case 'image-selection':
        this.renderImageSelection(section, qData, actualIdx);
        break;
      case 'matching':
        this.renderMatching(section, qData, actualIdx);
        break;
      default:
        section.innerHTML = '<p>Unknown question type.</p>';
    }
  }

  // ----------------------------------------------------------
  // Multiple Choice
  // ----------------------------------------------------------
  renderMultipleChoice(section, qData, actualIdx) {
    section.innerHTML = `
      <h2 class="quiz-title">Choose the correct option</h2>
      <div class="question">${qData.questionText}</div>
      <div class="options-container" id="options-container-${actualIdx}"></div>
      <div class="footer">
        <button class="check-button" id="check-button-${actualIdx}" disabled>Check</button>
      </div>
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
      this.totalAttempts++;

      const isCorrect = (selected === qData.correctAnswer);
      this.playSound(isCorrect);

      const correctBtn = Array.from(container.querySelectorAll('.option-button'))
        .find(b => b.dataset.value === qData.correctAnswer);
      if (correctBtn) correctBtn.classList.add('correct');

      if (isCorrect) {
        if (!this.questionFinalCorrect[actualIdx]) this.questionFinalCorrect[actualIdx] = true;
        this.handleCorrectAnswer();
        this.showResultOverlay(
          actualIdx + 1,
          true,
          `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`,
          () => this.moveToNextQuestion()
        );
      } else {
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
          actualIdx + 1,
          false,
          `<div class="correct-answer-section"><span class="correct-text">Correct answer:</span> <span class="underlined">${sanitiseHTML(qData.correctAnswer)}</span></div>
           <div class="explanation-section"><span class="explanation-label">Explanation:</span> <span class="explanation-text">${qData.explanation}</span></div>`,
          () => {
            if (this.lives === 0) {
              this.showModal('../modals/refill-hearts.html', () => {});
            } else {
              this.moveToNextQuestion();
            }
          }
        );
      }

      container.querySelectorAll('.option-button').forEach(b => {
        b.disabled = true;
        b.style.cursor = 'not-allowed';
      });
    });
  }

  // ----------------------------------------------------------
  // Complete Sentence
  // ----------------------------------------------------------
  renderCompleteSentence(section, qData, actualIdx) {
    // Extract blank IDs from the question HTML
    const blankIds = [];
    const re = /id="(blank-[^"]+)"/g;
    let match;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = qData.questionText;
    while ((match = re.exec(qData.questionText)) !== null) {
      blankIds.push(match[1]);
    }

    // Build blank placeholders
    const blanksHTML = blankIds.map(id =>
      `<span id="${id}" class="blank" tabindex="0"></span>`
    );

    // Replace blanks in question text with the span placeholders
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
        <div class="icon-container">
          <img src="../public/assets/icons/phosphor/fill/rabbit-blue.svg" alt="Vusi" style="width: 4rem; height: 4rem;">
        </div>
        <div speech-bubble pleft abottom style="--bbColor:#FFFFFF">
          <div class="bubble-text">${displayText}</div>
        </div>
      </div>
      <div id="options-${actualIdx}" class="options-container"></div>
      <div class="footer">
        <button id="check-button-${actualIdx}" class="check-button" disabled>Check</button>
      </div>
    `;

    const blankElements = blankIds.map(id => document.getElementById(id));
    const optsContainer = document.getElementById(`options-${actualIdx}`);
    const btn = document.getElementById(`check-button-${actualIdx}`);

    // Reset blanks
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

    // Click on a blank to clear it
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
      this.totalAttempts++;

      const userAnswers = filled.map(f => f.value);
      // Check if all answers match, in any order
      const correctSet = [...qData.correctAnswers].sort().join(',');
      const userSet = [...userAnswers].sort().join(',');
      const isCorrect = (correctSet === userSet);

      this.playSound(isCorrect);
      optionBtns.forEach(b => { b.disabled = true; });

      if (isCorrect) {
        if (!this.questionFinalCorrect[actualIdx]) this.questionFinalCorrect[actualIdx] = true;
        blankElements.forEach(b => { if (b) b.classList.add('correct'); });
        optionBtns.forEach(b => {
          if (qData.correctAnswers.includes(b.dataset.value)) b.classList.add('correct');
        });
        this.handleCorrectAnswer();
        this.showResultOverlay(
          actualIdx + 1,
          true,
          `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`,
          () => this.moveToNextQuestion()
        );
      } else {
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

        const correctLabels = qData.correctAnswers.map(a =>
          qData.options.find(o => o.value === a)?.label || a
        ).join('</span> and <span class="underlined">');

        this.showResultOverlay(
          actualIdx + 1,
          false,
          `<div class="correct-answer-section"><span class="correct-text">Correct answer:</span> <span><span class="underlined">${correctLabels}</span></span></div>
           <div class="explanation-section"><span class="explanation-label">Explanation:</span> <span class="explanation-text">${qData.explanation}</span></div>`,
          () => {
            if (this.lives === 0) {
              this.showModal('../modals/refill-hearts.html', () => {});
            } else {
              this.moveToNextQuestion();
            }
          }
        );
      }
    });
  }

  // ----------------------------------------------------------
  // Fill Blank
  // ----------------------------------------------------------
  renderFillBlank(section, qData, actualIdx) {
    section.innerHTML = `
      <h2 class="quiz-title">Complete the statement</h2>
      <div class="question-container">
        <div class="icon-container">
          <img src="../public/assets/icons/phosphor/fill/rabbit-blue.svg" alt="Vusi" style="width: 4rem; height: 4rem;">
        </div>
        <div speech-bubble pleft acenter style="--bbColor:#FFFFFF">
          <div class="bubble-text">${qData.questionText}</div>
        </div>
      </div>
      <div class="response-container">
        <div class="response-text">Type your answer below:</div>
        <div class="response-input-container">
          <input type="text" id="fill-blank-input-${actualIdx}" class="response-input" placeholder="Type your answer here" spellcheck="false">
        </div>
      </div>
      <div class="footer">
        <button class="check-button" id="check-button-${actualIdx}" disabled>Check</button>
      </div>
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
      this.totalAttempts++;

      const userAnswer = this.normalizeAnswer(input.value.trim());
      const isCorrect = qData.acceptableAnswers.some(a => userAnswer === this.normalizeAnswer(a));

      this.playSound(isCorrect);

      if (isCorrect) {
        if (!this.questionFinalCorrect[actualIdx]) this.questionFinalCorrect[actualIdx] = true;
        input.classList.add('correct');
        this.handleCorrectAnswer();
        this.showResultOverlay(
          actualIdx + 1,
          true,
          `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`,
          () => this.moveToNextQuestion()
        );
      } else {
        if (!this.retryQueue.includes(actualIdx)) this.retryQueue.push(actualIdx);
        this.handleIncorrectAnswer();
        input.classList.add('incorrect');
        if (this.lives > 0) {
          this.lives--;
          this.livesCountSpan.textContent = String(this.lives);
          this.updateHeartIcon();
        }
        this.showResultOverlay(
          actualIdx + 1,
          false,
          `<div class="correct-answer-section"><span class="correct-text">Correct answer:</span> <span class="underlined">${sanitiseHTML(qData.correctAnswer)}</span></div>
           <div class="explanation-section"><span class="explanation-label">Explanation:</span> <span class="explanation-text">${qData.explanation}</span></div>`,
          () => {
            if (this.lives === 0) {
              this.showModal('../modals/refill-hearts.html', () => {});
            } else {
              this.moveToNextQuestion();
            }
          }
        );
      }

      input.disabled = true;
    });

    input.focus();
  }

  // ----------------------------------------------------------
  // Image Selection
  // ----------------------------------------------------------
  renderImageSelection(section, qData, actualIdx) {
    const imagesHTML = (qData.images || []).map((img, i) => `
      <div class="image-tile" data-image="${i + 1}">
        <div class="image-container" data-image="${i + 1}">
          <img src="${img.src}" alt="${img.label}" loading="lazy">
        </div>
        <div class="image-label">${img.label}</div>
      </div>
    `).join('');

    section.innerHTML = `
      <h2 class="quiz-title">Pick the correct image</h2>
      <div class="question" style="text-align: center;">${qData.questionText}</div>
      <div class="image-selection-container">
        <div class="image-grid" id="image-grid-${actualIdx}">
          ${imagesHTML}
        </div>
        <div class="expand-hint"><i>Tap any image to expand for a closer look</i></div>
      </div>
      <div class="footer">
        <button id="check-button-${actualIdx}" class="check-button" disabled>Check</button>
      </div>
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
      t.classList.remove('selected', 'correct', 'incorrect');
      t.style.cursor = 'pointer';
    });

    tiles.forEach(t => {
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
        const num = parseInt(c.dataset.image, 10);
        const img = c.querySelector('img');
        if (img && img.src) {
          zoomImg.src = img.src;
          zoomLabel.textContent = `Image ${num}`;
          zoomModal.classList.add('visible');
        }
      });
    });

    const closeZoom = () => {
      zoomModal.classList.remove('visible');
      zoomImg.src = '';
    };
    zoomModal.addEventListener('click', (e) => {
      if (e.target === zoomModal) closeZoom();
    });
    zoomClose.addEventListener('click', closeZoom);
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        closeZoom();
        document.removeEventListener('keydown', escHandler);
      }
    });

    btn.addEventListener('click', () => {
      if (state.selected === null || state.answered) return;
      state.answered = true;
      this.totalAttempts++;

      tiles.forEach(t => (t.style.cursor = 'default'));
      tiles.forEach(t => {
        const num = parseInt(t.dataset.image, 10);
        if (num === qData.correctAnswer) t.classList.add('correct');
        else if (num === state.selected && num !== qData.correctAnswer) t.classList.add('incorrect');
        t.classList.remove('selected');
      });

      const isCorrect = (state.selected === qData.correctAnswer);
      this.playSound(isCorrect);

      if (isCorrect) {
        if (!this.questionFinalCorrect[actualIdx]) this.questionFinalCorrect[actualIdx] = true;
        this.handleCorrectAnswer();
        this.showResultOverlay(
          actualIdx + 1,
          true,
          `<div class="explanation-section"><span class="explanation-text">${qData.explanation}</span></div>`,
          () => this.moveToNextQuestion()
        );
      } else {
        if (!this.retryQueue.includes(actualIdx)) this.retryQueue.push(actualIdx);
        this.handleIncorrectAnswer();
        if (this.lives > 0) {
          this.lives--;
          this.livesCountSpan.textContent = String(this.lives);
          this.updateHeartIcon();
        }
        this.showResultOverlay(
          actualIdx + 1,
          false,
          `<div class="correct-answer-section"><span class="correct-text">Correct answer:</span> <span class="underlined">Image ${qData.correctAnswer}</span></div>
           <div class="explanation-section"><span class="explanation-label">Explanation:</span> <span class="explanation-text">${qData.explanation}</span></div>`,
          () => {
            if (this.lives === 0) {
              this.showModal('../modals/refill-hearts.html', () => {});
            } else {
              this.moveToNextQuestion();
            }
          }
        );
      }
    });
  }

  // ----------------------------------------------------------
  // Matching
  // ----------------------------------------------------------
  renderMatching(section, qData, actualIdx) {
    section.innerHTML = `
      <h2 class="quiz-title">Match the pairs</h2>
      <div class="game-container">
        <div class="column" id="leftColumn-${actualIdx}"></div>
        <div class="column" id="rightColumn-${actualIdx}"></div>
      </div>
    `;

    const leftCol = document.getElementById(`leftColumn-${actualIdx}`);
    const rightCol = document.getElementById(`rightColumn-${actualIdx}`);
    const feedbackOverlay = document.getElementById('feedbackOverlay');
    const tryAgainBtn = document.getElementById('tryAgainBtn');
    const matchingContinueBtn = document.getElementById('matchingContinueBtn');
    const feedbackTitle = document.getElementById('feedbackTitle');
    const feedbackMsg = document.getElementById('feedbackMessage');

    // Hide feedback and continue button initially
    feedbackOverlay.classList.remove('visible');
    matchingContinueBtn.style.display = 'none';

    let selectedLeft = null;
    let selectedRight = null;
    let matched = 0;
    let gameActive = true;
    let lifeLostInThisGame = false;
    let completed = false;

    const pairs = qData.pairs || [];
    const shuffledPairs = this.shuffleArray([...pairs]);

    // Build left column (terms)
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
        if (selectedLeft && selectedRight) checkMatch(actualIdx);
      });
      leftCol.appendChild(card);
    });

    // Build right column (meanings)
    const shuffledMeanings = this.shuffleArray([...shuffledPairs]);
    rightCol.innerHTML = '';
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
        if (selectedLeft && selectedRight) checkMatch(actualIdx);
      });
      rightCol.appendChild(card);
    });

    const checkMatch = (qIdx) => {
      if (!selectedLeft || !selectedRight || !gameActive) return;

      if (selectedLeft.dataset.pair === selectedRight.dataset.pair) {
        this.playSound(true);
        selectedLeft.classList.remove('selected');
        selectedRight.classList.remove('selected');
        selectedLeft.classList.add('correct');
        selectedRight.classList.add('correct');
        matched++;

        setTimeout(() => {
          document.querySelectorAll(`#leftColumn-${qIdx} .card.correct, #rightColumn-${qIdx} .card.correct`).forEach(c => {
            c.classList.remove('correct');
            c.classList.add('matched');
          });
        }, 800);

        if (matched === pairs.length && !completed) {
          gameActive = false;
          completed = true;
          this.totalAttempts++;
          if (!this.questionFinalCorrect[qIdx]) this.questionFinalCorrect[qIdx] = true;
          this.currentStreak++;
          this.updateStreakCounter();

          if (this.currentStreak % 5 === 0 && this.currentStreak > 0) {
            this.pendingCelebration = true;
            this.pendingCelebrationStreak = this.currentStreak;
            this.processAfterExplanation(() => this.moveToNextQuestion());
          } else {
            this.moveToNextQuestion();
          }
        }
      } else {
        this.playSound(false);
        selectedLeft.classList.add('wrong');
        selectedRight.classList.add('wrong');

        // Only lose a heart on the very first mistake in this matching game
        if (!lifeLostInThisGame) {
          if (this.lives > 0) {
            this.lives--;
            this.livesCountSpan.textContent = String(this.lives);
            this.updateHeartIcon();
            lifeLostInThisGame = true;

            if (this.lives === 0) {
              feedbackTitle.textContent = 'Game Over';
              feedbackMsg.textContent = 'You\'ve run out of lives!';
              feedbackOverlay.classList.add('visible');
              gameActive = false;
              // Show refill modal
              this.showModal('../modals/refill-hearts.html', () => {});
              return;
            }
          }
        }

        this.handleIncorrectAnswer();
        feedbackTitle.textContent = 'Incorrect';
        feedbackMsg.textContent = 'Let\'s try that again';
        feedbackOverlay.classList.add('visible');
      }

      selectedLeft = null;
      selectedRight = null;
    };

    const resetWrong = () => {
      document.querySelectorAll(`#leftColumn-${actualIdx} .card.wrong, #rightColumn-${actualIdx} .card.wrong`).forEach(c => {
        c.classList.remove('wrong');
      });
      document.querySelectorAll(`#leftColumn-${actualIdx} .card.selected, #rightColumn-${actualIdx} .card.selected`).forEach(c => {
        c.classList.remove('selected');
      });
      selectedLeft = null;
      selectedRight = null;
      feedbackOverlay.classList.remove('visible');
    };

    tryAgainBtn.onclick = resetWrong;
    feedbackOverlay.onclick = (e) => {
      if (e.target === feedbackOverlay) resetWrong();
    };
    matchingContinueBtn.onclick = () => this.moveToNextQuestion();
  }
}

// Make globally available
window.QuizEngine = QuizEngine;
