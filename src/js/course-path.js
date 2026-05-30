// src/js/course-path.js
export class CoursePath {
  constructor(containerId, courseData, options = {}) {
    this.container = document.getElementById(containerId);
    this.courseData = courseData; // { id, chapters: [...] }
    this.startColorIndex = options.startColorIndex || 0; // 0-6, defaults to Carpenter Blue
    this.userProgressCallback = options.onProgressUpdate || (() => {});
    this.currentActiveNode = null;
    this.currentChapterIndex = 0;
    this.rewardPanel = null;
    this.overlay = null;
    this.startBubble = document.getElementById('start-speech-bubble');
    this.persistentCard = document.getElementById('persistent-learning-card');
    this.persistentProgressBar = document.getElementById('persistent-progress-bar');
    
    this.init();
  }

  init() {
    this.createRewardPanel();
    this.renderChapters();
    this.attachEventListeners();
    this.setInitialActiveNode();
  }

  getColorClassForChapter(chapterIndex) {
    const colorIndex = (this.startColorIndex + chapterIndex) % 7;
    return `chapter-color-${colorIndex}`;
  }

  getShadowClassForChapter(chapterIndex) {
    const colorIndex = (this.startColorIndex + chapterIndex) % 7;
    return `chapter-shadow-${colorIndex}`;
  }

  createRewardPanel() {
    if (document.getElementById('treasure-panel')) return;
    this.rewardPanel = document.createElement('div');
    this.rewardPanel.id = 'treasure-panel';
    this.rewardPanel.className = 'treasure-panel';
    this.rewardPanel.innerHTML = `
      <div class="reward-scene"><div class="reward-icon-container"></div></div>
      <div class="reward-title"></div>
      <div class="reward-subtitle"></div>
      <div class="reward-buttons-container"><button class="claim-button" id="claim-button">Claim</button></div>
    `;
    this.overlay = document.createElement('div');
    this.overlay.id = 'overlay';
    this.overlay.className = 'overlay';
    document.body.appendChild(this.overlay);
    document.body.appendChild(this.rewardPanel);
    document.getElementById('claim-button').addEventListener('click', () => this.closeRewardPanel());
    this.overlay.addEventListener('click', () => this.closeRewardPanel());
  }

  showRewardPanel(reward, onClaim) {
    const iconContainer = this.rewardPanel.querySelector('.reward-icon-container');
    iconContainer.innerHTML = '';
    if (reward.type === 'coin') {
      iconContainer.innerHTML = `<div class="coin-container"><i class="ph-duotone ph-coins" style="font-size:140px;color:#FFD700;"></i></div>`;
    } else if (reward.type === 'xp-boost') {
      iconContainer.innerHTML = `<div class="rocket-container"><i class="ph-duotone ph-rocket-launch" style="font-size:140px;color:#FF9600;"></i><div class="xp-multiplier">x${reward.multiplier}</div></div>`;
    } else if (reward.type === 'heart') {
      let hearts = '';
      for (let i = 0; i < reward.amount; i++) hearts += `<i class="ph-fill ph-heart" style="font-size:80px;color:#FF0000;"></i>`;
      iconContainer.innerHTML = `<div class="hearts-container">${hearts}</div>`;
    }
    this.rewardPanel.querySelector('.reward-title').textContent = reward.title;
    this.rewardPanel.querySelector('.reward-subtitle').textContent = reward.subtitle;
    this.rewardPanel.classList.add('active');
    this.overlay.classList.add('active');
    this._pendingRewardClaim = onClaim;
  }

  closeRewardPanel() {
    this.rewardPanel.classList.remove('active');
    this.overlay.classList.remove('active');
    if (this._pendingRewardClaim) {
      this._pendingRewardClaim();
      this._pendingRewardClaim = null;
    }
  }

  renderChapters() {
    for (let chIdx = 0; chIdx < this.courseData.chapters.length; chIdx++) {
      const chapter = this.courseData.chapters[chIdx];
      const pathDiv = document.querySelector(`#chapter-${chIdx} .learning-path`);
      if (!pathDiv) continue;
      pathDiv.innerHTML = '';
      const positionMap = new Map([[0,0],[-1,-44],[-2,-70],[1,44],[2,70]]);
      let waveState = { direction: "L", position: 0 };
      for (let i = 0; i < chapter.lessons.length; i++) {
        const lesson = chapter.lessons[i];
        const node = this.createNode(lesson, chIdx, positionMap.get(waveState.position));
        pathDiv.appendChild(node);
        waveState = this.updateWaveState(waveState);
      }
    }
    this.updateAllProgressIndicators();
  }

  updateWaveState(state) {
    let { direction, position } = state;
    if (direction === "L" && position === -2) return { direction: "R", position: -1 };
    if (direction === "R" && position === 2) return { direction: "L", position: 1 };
    return { direction, position: direction === "L" ? position - 1 : position + 1 };
  }

  createNode(lesson, chapterIdx, leftOffset) {
    const node = document.createElement('div');
    node.className = 'path-node';
    if (lesson.type === 'treasure') node.classList.add('treasure');
    else if (lesson.type === 'flag') node.classList.add('flag');
    node.id = lesson.id;
    node.dataset.lessonId = lesson.id;
    node.dataset.chapter = chapterIdx;
    node.style.position = 'relative';
    node.style.left = `${leftOffset}px`;
    
    const iconDiv = document.createElement('div');
    iconDiv.className = 'node-icon';
    if (lesson.type === 'treasure') {
      iconDiv.innerHTML = '<i class="ph-duotone ph-treasure-chest" style="font-size:53px;"></i>';
    } else if (lesson.type === 'flag') {
      iconDiv.innerHTML = '<i class="ph-duotone ph-flag-checkered" style="font-size:42px;color:white;"></i>';
    } else {
      iconDiv.innerHTML = '<span class="material-symbols-outlined">joystick</span>';
    }
    node.appendChild(iconDiv);
    
    // Load progress from localStorage (mock)
    const progressKey = `course_${this.courseData.id}_ch${chapterIdx}`;
    let progress = JSON.parse(localStorage.getItem(progressKey) || '{}');
    const status = progress[lesson.id] || (lesson.type === 'treasure' ? 'locked' : 'unstarted');
    const colorClass = this.getColorClassForChapter(chapterIdx);
    if (status === 'completed') {
      node.classList.add('completed', colorClass);
      iconDiv.innerHTML = '<span class="material-symbols-outlined">assignment_turned_in</span>';
    } else if (status === 'mastered') {
      node.classList.add('mastered');
    } else if (status === 'locked') {
      node.classList.add('locked');
    } else if (status === 'unlocked' && lesson.type === 'treasure') {
      node.classList.add('unlocked');
    }
    
    node.addEventListener('click', () => this.handleNodeClick(lesson, node, chapterIdx));
    return node;
  }

  handleNodeClick(lesson, node, chapterIdx) {
    if (lesson.type === 'treasure') {
      if (node.classList.contains('locked')) {
        const allPrevCompleted = this.arePreviousLessonsCompleted(chapterIdx, lesson.id);
        if (allPrevCompleted) {
          node.classList.remove('locked');
          node.classList.add('unlocked');
          this.saveProgress(chapterIdx, lesson.id, 'unlocked');
          this.showTreasureReward(lesson, node, chapterIdx);
        }
      } else if (node.classList.contains('unlocked') && !node.classList.contains('collected')) {
        this.showTreasureReward(lesson, node, chapterIdx);
      }
      return;
    }
    this.setActiveNode(node, chapterIdx);
    this.showLessonCard(lesson, node, chapterIdx);
  }

  arePreviousLessonsCompleted(chapterIdx, currentLessonId) {
    const lessons = this.courseData.chapters[chapterIdx].lessons;
    let found = false;
    for (let l of lessons) {
      if (l.id === currentLessonId) break;
      if (l.type === 'treasure') continue;
      const progressKey = `course_${this.courseData.id}_ch${chapterIdx}`;
      let progress = JSON.parse(localStorage.getItem(progressKey) || '{}');
      if (progress[l.id] !== 'completed' && progress[l.id] !== 'mastered') return false;
    }
    return true;
  }

  showTreasureReward(lesson, node, chapterIdx) {
    const rewardVariants = [
      { type: "coin", amount: 250, title: "You have earned 250 coins!", subtitle: "Spend them wisely" },
      { type: "coin", amount: 350, title: "You have earned 350 coins!", subtitle: "Spend them wisely" },
      { type: "coin", amount: 500, title: "You have earned 500 coins!", subtitle: "Spend them wisely" },
      { type: "xp-boost", multiplier: "1.5", duration: 30, title: "You found an XP Boost!", subtitle: "1.5x XP for 30 minutes" },
      { type: "xp-boost", multiplier: "2", duration: 20, title: "You found an XP Boost!", subtitle: "2x XP for 20 minutes" },
      { type: "xp-boost", multiplier: "3", duration: 15, title: "You found an XP Boost!", subtitle: "3x XP for 15 minutes" },
      { type: "heart", amount: 5, title: "You gained more hearts!", subtitle: "You now have 5 hearts again." }
    ];
    const randomReward = rewardVariants[Math.floor(Math.random() * rewardVariants.length)];
    this.showRewardPanel(randomReward, async () => {
      node.classList.add('collected');
      this.saveProgress(chapterIdx, lesson.id, 'collected');
      const coins = parseInt(localStorage.getItem('coins') || '500');
      if (randomReward.type === 'coin') localStorage.setItem('coins', coins + randomReward.amount);
      const nextNode = this.findNextNode(chapterIdx, lesson.id);
      if (nextNode) this.setActiveNode(nextNode, chapterIdx);
    });
  }

  findNextNode(chapterIdx, currentLessonId) {
    const lessons = this.courseData.chapters[chapterIdx].lessons;
    let found = false;
    for (let l of lessons) {
      if (found && l.type !== 'treasure') {
        return document.getElementById(l.id);
      }
      if (l.id === currentLessonId) found = true;
    }
    if (chapterIdx + 1 < this.courseData.chapters.length) {
      const nextChapterLessons = this.courseData.chapters[chapterIdx+1].lessons;
      for (let l of nextChapterLessons) {
        if (l.type !== 'treasure') return document.getElementById(l.id);
      }
    }
    return null;
  }

  saveProgress(chapterIdx, lessonId, status) {
    const progressKey = `course_${this.courseData.id}_ch${chapterIdx}`;
    let progress = JSON.parse(localStorage.getItem(progressKey) || '{}');
    progress[lessonId] = status;
    localStorage.setItem(progressKey, JSON.stringify(progress));
    this.updateAllProgressIndicators();
  }

  updateAllProgressIndicators() {
    for (let chIdx = 0; chIdx < this.courseData.chapters.length; chIdx++) {
      this.updateChapterProgressBar(chIdx);
    }
  }

  updateChapterProgressBar(chapterIdx) {
    const chapter = this.courseData.chapters[chapterIdx];
    const progressKey = `course_${this.courseData.id}_ch${chapterIdx}`;
    let progress = JSON.parse(localStorage.getItem(progressKey) || '{}');
    let total = 0, completed = 0;
    for (let l of chapter.lessons) {
      if (l.type === 'treasure') continue;
      total++;
      if (progress[l.id] === 'completed' || progress[l.id] === 'mastered') completed++;
    }
    const percent = total ? (completed / total) * 100 : 0;
    if (chapterIdx === this.currentChapterIndex) {
      this.persistentProgressBar.style.width = `${percent}%`;
      const titleEl = this.persistentCard.querySelector('.title');
      if (titleEl) titleEl.textContent = `Chapter ${chapterIdx+1}`;
    }
  }

  setActiveNode(node, chapterIdx) {
    document.querySelectorAll('.path-node').forEach(n => n.classList.remove('active'));
    node.classList.add('active');
    this.currentActiveNode = node;
    this.currentChapterIndex = chapterIdx;
    this.positionStartSpeechBubble(node);
    this.updateChapterProgressBar(chapterIdx);
    // Update persistent card color
    const colorClass = this.getColorClassForChapter(chapterIdx);
    this.persistentCard.className = `learning-card ${colorClass}`;
  }

  positionStartSpeechBubble(node) {
    const rect = node.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const top = rect.top + scrollTop - 65;
    const left = rect.left + (rect.width / 2);
    this.startBubble.style.top = `${top}px`;
    this.startBubble.style.left = `${left}px`;
    this.startBubble.style.transform = 'translateX(-50%)';
    this.startBubble.classList.add('visible');
  }

  showLessonCard(lesson, node, chapterIdx) {
    let existingCard = document.querySelector('.lesson-card');
    if (existingCard) existingCard.remove();
    const card = document.createElement('div');
    card.className = 'lesson-card';
    const colorClass = this.getColorClassForChapter(chapterIdx);
    card.style.setProperty('--bbColor', getComputedStyle(document.documentElement).getPropertyValue(`--${colorClass.replace('chapter-color-', 'bg-')}`) || '#4285F4');
    card.style.setProperty('--bbBorderColor', '#3367D6'); // fallback
    card.innerHTML = `
      <div class="lesson-header"><h2 class="lesson-title">${lesson.title}</h2></div>
      <div class="lesson-actions">
        <div class="lesson-info">Lesson 1 of ${lesson.totalSublessons || 1}</div>
        <button class="btn btn-primary start-lesson-btn">START <span class="xp-badge">+10 XP</span></button>
      </div>
    `;
    node.parentNode.appendChild(card);
    const rect = node.getBoundingClientRect();
    const containerRect = node.parentNode.getBoundingClientRect();
    card.style.top = `${rect.top - containerRect.top + rect.height + 22}px`;
    card.style.left = `${rect.left - containerRect.left + (rect.width / 2)}px`;
    card.style.transform = 'translateX(-50%)';
    setTimeout(() => card.classList.add('active'), 10);
    card.querySelector('.start-lesson-btn').addEventListener('click', () => {
      window.location.href = `/pages/lesson.html?course=${this.courseData.id}&lesson=${lesson.id}`;
    });
    const closeHandler = (e) => {
      if (!card.contains(e.target) && !node.contains(e.target)) {
        card.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 100);
  }

  setInitialActiveNode() {
    for (let chIdx = 0; chIdx < this.courseData.chapters.length; chIdx++) {
      const chapter = this.courseData.chapters[chIdx];
      const progressKey = `course_${this.courseData.id}_ch${chIdx}`;
      let progress = JSON.parse(localStorage.getItem(progressKey) || '{}');
      for (let l of chapter.lessons) {
        if (l.type === 'treasure') continue;
        const status = progress[l.id];
        if (status !== 'completed' && status !== 'mastered') {
          const node = document.getElementById(l.id);
          if (node) {
            this.setActiveNode(node, chIdx);
            return;
          }
        }
      }
    }
    const firstNode = document.querySelector('.path-node:not(.treasure)');
    if (firstNode) this.setActiveNode(firstNode, 0);
  }

  attachEventListeners() {
    window.addEventListener('scroll', () => {
      if (this.currentActiveNode) this.positionStartSpeechBubble(this.currentActiveNode);
    });
    window.addEventListener('resize', () => {
      if (this.currentActiveNode) this.positionStartSpeechBubble(this.currentActiveNode);
    });
  }
}
