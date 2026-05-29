// Shared module for rendering dynamic learning paths
// Usage: new CoursePath(containerElement, courseData, userProgress, onLessonStart)

export class CoursePath {
  constructor(container, courseConfig, userProgress, callbacks) {
    this.container = container;
    this.courseConfig = courseConfig; // { id, name, chapters: [{ title, lessons: [...] }] }
    this.userProgress = userProgress; // nested object: { chapterIndex: { lessonId: { status, mastered, sublessonCompleted, sublessonMastered } } }
    this.callbacks = callbacks || {};
    this.currentActiveNode = null;
    this.currentLessonCard = null;
    this.isTransitioning = false;
    this.selectedSublesson = 1;
    this.chaptersData = [];
    this.init();
  }

  init() {
    this.buildChapters();
    this.render();
    this.setupEventListeners();
  }

  buildChapters() {
    this.courseConfig.chapters.forEach((chapter, chIdx) => {
      const chapterObj = {
        id: `chapter-${chIdx}`,
        number: chIdx + 1,
        colorClass: `chapter-${(chIdx % 7) + 1}`, // cycle through 7 colors
        nodeColor: this.getChapterColor(chIdx),
        lessons: chapter.lessons,
        userProgress: this.userProgress[chIdx] || {},
        activeNode: null,
        currentLessonCard: null,
        selectedSublesson: 1
      };
      // initialize progress if missing
      chapter.lessons.forEach(lesson => {
        if (!chapterObj.userProgress[lesson.id]) {
          chapterObj.userProgress[lesson.id] = {
            status: lesson.type === 'treasure' ? 'locked' : 'unstarted',
            mastered: false,
            completedSublessons: 0,
            totalSublessons: lesson.totalSublessons || 1,
            sublessonCompleted: Array(lesson.totalSublessons || 1).fill(false),
            sublessonMastered: Array(lesson.totalSublessons || 1).fill(false)
          };
        }
      });
      this.chaptersData.push(chapterObj);
    });
  }

  getChapterColor(index) {
    const colors = ['#4285F4', '#1CB0F6', '#AA00FF', '#EA4335', '#FF6D01', '#FBBC05', '#34A853'];
    return colors[index % colors.length];
  }

  render() {
    this.container.innerHTML = '';
    this.chaptersData.forEach((chapter, idx) => {
      const chapterDiv = document.createElement('div');
      chapterDiv.className = 'chapter-container';
      chapterDiv.id = `chapter-${idx}`;
      if (idx === 0) chapterDiv.style.paddingTop = '110px';
      // Subtitle
      const subtitleContainer = document.createElement('div');
      subtitleContainer.className = 'subtitle-container';
      subtitleContainer.innerHTML = `<div class="line"></div><div class="subtitle">${this.courseConfig.chapters[idx].title}</div><div class="line"></div>`;
      chapterDiv.appendChild(subtitleContainer);
      // Learning path container
      const pathContainer = document.createElement('div');
      pathContainer.className = 'learning-path-container';
      const pathDiv = document.createElement('div');
      pathDiv.className = 'learning-path';
      pathDiv.id = `learning-path-${idx}`;
      pathContainer.appendChild(pathDiv);
      chapterDiv.appendChild(pathContainer);
      this.container.appendChild(chapterDiv);
      this.renderChapterNodes(chapter, pathDiv, idx);
    });
  }

  renderChapterNodes(chapter, container, chIdx) {
    const positionMap = new Map([[0,0],[-1,-44],[-2,-70],[1,44],[2,70]]);
    let waveState = { direction: "L", position: 0 };
    const updateWaveState = (state) => {
      let { direction, position } = state;
      if (direction === "L" && position === -2) return { direction: "R", position: -1 };
      if (direction === "R" && position === 2) return { direction: "L", position: 1 };
      return { direction, position: direction === "L" ? position - 1 : direction === "R" ? position + 1 : position };
    };
    let html = '<div class="path-group">';
    chapter.lessons.forEach((lesson, idx) => {
      const prog = chapter.userProgress[lesson.id];
      const position = positionMap.get(waveState.position) || 0;
      if (lesson.type === 'treasure') {
        html += `<div class="path-node treasure ${prog.status}" id="${lesson.id}" style="position: relative; left: ${position}px;"><i class="ph-duotone ph-treasure-chest"></i></div>`;
      } else if (lesson.type === 'flag') {
        const nodeClass = prog.mastered ? 'flag mastered' : 'flag';
        const statusClass = (prog.status === 'completed' || prog.mastered) ? 'completed' : prog.status;
        html += `<div class="path-node ${nodeClass} ${statusClass}" id="${lesson.id}" style="position: relative; left: ${position}px;"><div class="node-icon"><i class="ph-duotone ph-flag-checkered" style="color: white;"></i></div></div>`;
      } else {
        const nodeClass = prog.mastered ? 'path-node mastered' : 'path-node';
        const statusClass = (prog.status === 'completed' || prog.mastered) ? 'completed' : prog.status;
        const initialIcon = prog.status === 'completed' ? '<span class="material-symbols-outlined">assignment_turned_in</span>' : '<span class="material-symbols-outlined">joystick</span>';
        const completedClass = (prog.status === 'completed' && !prog.mastered) ? ` ${chapter.completedColorClass || ''}` : '';
        html += `<div class="${nodeClass} ${statusClass}${completedClass}" id="${lesson.id}" style="position: relative; left: ${position}px;"><div class="node-icon">${initialIcon}</div></div>`;
      }
      waveState = updateWaveState(waveState);
    });
    html += '</div>';
    container.innerHTML = html;
    // attach click handlers
    container.querySelectorAll('.path-node').forEach(node => {
      node.addEventListener('click', (e) => this.handleNodeClick(chapter, node, chIdx));
    });
  }

  handleNodeClick(chapter, node, chIdx) {
    if (this.isTransitioning) return;
    const lessonId = node.id;
    const lesson = chapter.lessons.find(l => l.id === lessonId);
    if (!lesson) return;
    if (node.classList.contains('treasure') && node.classList.contains('locked')) {
      // check preceding lessons
      const treasureIndex = chapter.lessons.findIndex(l => l.id === lessonId);
      const preceding = chapter.lessons.slice(0, treasureIndex);
      const allCompleted = preceding.every(l => {
        if (l.type === 'treasure') return true;
        const prog = chapter.userProgress[l.id];
        if (l.totalSublessons > 1) return prog.sublessonCompleted.every(c => c);
        return prog.status === 'completed';
      });
      if (!allCompleted) return;
      node.classList.remove('locked'); node.classList.add('unlocked');
      chapter.userProgress[lessonId].status = 'unlocked';
      setTimeout(() => this.showTreasure(chapter, node, chIdx), 50);
      return;
    }
    if (node.classList.contains('treasure') && !node.classList.contains('locked')) {
      this.showTreasure(chapter, node, chIdx);
      return;
    }
    this.setActiveNode(node, chapter, chIdx);
    this.showLessonCard(chapter, lesson, chIdx);
  }

  setActiveNode(node, chapter, chIdx) {
    // remove active class from all nodes
    document.querySelectorAll('.path-node').forEach(n => n.classList.remove('active'));
    node.classList.add('active');
    this.currentActiveNode = node;
    // position START bubble
    const bubble = document.getElementById('start-speech-bubble');
    if (bubble) {
      const rect = node.getBoundingClientRect();
      bubble.style.top = `${rect.top + window.pageYOffset - 65}px`;
      bubble.style.left = `${rect.left + rect.width/2}px`;
      bubble.classList.add('visible');
    }
  }

  showLessonCard(chapter, lesson, chIdx) {
    this.isTransitioning = true;
    if (chapter.currentLessonCard) {
      chapter.currentLessonCard.classList.remove('active');
      setTimeout(() => {
        if (chapter.currentLessonCard && chapter.currentLessonCard.parentNode) chapter.currentLessonCard.remove();
        chapter.currentLessonCard = null;
        this.createLessonCard(chapter, lesson, chIdx);
      }, 300);
    } else {
      this.createLessonCard(chapter, lesson, chIdx);
    }
  }

  createLessonCard(chapter, lesson, chIdx) {
    const card = document.createElement('div');
    card.className = 'lesson-card';
    const prog = chapter.userProgress[lesson.id];
    const isCompleted = prog.status === 'completed' || (lesson.totalSublessons > 1 && prog.sublessonCompleted[chapter.selectedSublesson-1]);
    const isMastered = prog.mastered;
    if (isMastered) card.classList.add('mastered');
    else if (isCompleted && !isMastered) card.classList.add('chapter-review');
    else card.style.setProperty('--bbColor', '#4285F4');
    card.innerHTML = `<div class="lesson-header"><h2 class="lesson-title">${lesson.title}</h2></div><div class="lesson-actions" id="actions-${lesson.id}"></div>`;
    const actionsDiv = card.querySelector(`.lesson-actions`);
    // sublesson progress
    if (lesson.totalSublessons > 1) {
      const subDiv = document.createElement('div'); subDiv.className = 'sublesson-progress';
      for (let i=1; i<=lesson.totalSublessons; i++) {
        const item = document.createElement('div'); item.className = 'sublesson-item';
        const circle = document.createElement('div'); circle.className = 'sublesson-circle'; circle.textContent = i;
        if (i === chapter.selectedSublesson) circle.classList.add('active');
        if (prog.sublessonCompleted[i-1]) circle.classList.add('completed');
        if (prog.sublessonMastered[i-1]) circle.classList.add('mastered');
        item.appendChild(circle);
        item.appendChild(document.createElement('div')).className = 'sublesson-label'; item.lastChild.textContent = `Lesson ${i}`;
        item.onclick = (e) => { e.stopPropagation(); this.selectSublesson(chapter, lesson.id, i, chIdx); };
        subDiv.appendChild(item);
      }
      actionsDiv.appendChild(subDiv);
    }
    const info = document.createElement('div'); info.className = 'lesson-info';
    info.textContent = lesson.totalSublessons > 1 ? `Lesson ${chapter.selectedSublesson} of ${lesson.totalSublessons}` : 'Lesson 1 of 1';
    actionsDiv.appendChild(info);
    // buttons
    if (lesson.type === 'flag') {
      if (isMastered) {
        const btn = this.createButton('Review', 'btn-chapter-review-mastered', () => this.reviewLesson(chapter, lesson.id, chIdx));
        actionsDiv.appendChild(btn);
      } else if (prog.status === 'completed') {
        actionsDiv.appendChild(this.createButton('Review', 'btn-chapter-review', () => this.reviewLesson(chapter, lesson.id, chIdx)));
        actionsDiv.appendChild(this.createButton('Master', 'btn-master', () => this.masterLesson(chapter, lesson.id, chIdx)));
      } else {
        actionsDiv.appendChild(this.createButton('Begin', 'btn-chapter-review', () => this.startLesson(chapter, lesson.id, chIdx)));
      }
    } else {
      if (isMastered) {
        actionsDiv.appendChild(this.createButton('Review', 'btn-review-mastered', () => this.reviewLesson(chapter, lesson.id, chIdx)));
      } else if (lesson.totalSublessons > 1 && prog.sublessonMastered[chapter.selectedSublesson-1]) {
        actionsDiv.appendChild(this.createButton('Review', 'btn-review-mastered', () => this.reviewSubLesson(chapter, lesson.id, chapter.selectedSublesson, chIdx)));
        if (!prog.sublessonMastered.every(m => m)) {
          actionsDiv.appendChild(this.createButton('Master', 'btn-master', () => this.masterSubLesson(chapter, lesson.id, chapter.selectedSublesson, chIdx)));
        }
      } else if (isCompleted || (lesson.totalSublessons > 1 && prog.sublessonCompleted[chapter.selectedSublesson-1])) {
        actionsDiv.appendChild(this.createButton('Review', 'btn-review', () => {
          if (lesson.totalSublessons > 1) this.reviewSubLesson(chapter, lesson.id, chapter.selectedSublesson, chIdx);
          else this.reviewLesson(chapter, lesson.id, chIdx);
        }));
        actionsDiv.appendChild(this.createButton('Master', 'btn-master', () => {
          if (lesson.totalSublessons > 1) this.masterSubLesson(chapter, lesson.id, chapter.selectedSublesson, chIdx);
          else this.masterLesson(chapter, lesson.id, chIdx);
        }));
      } else {
        actionsDiv.appendChild(this.createButton('START', 'btn-primary', () => {
          if (lesson.totalSublessons > 1) this.startSubLesson(chapter, lesson.id, chapter.selectedSublesson, chIdx);
          else this.startLesson(chapter, lesson.id, chIdx);
        }));
      }
    }
    const pathContainer = document.querySelector(`#learning-path-${chIdx}`);
    pathContainer.appendChild(card);
    chapter.currentLessonCard = card;
    this.positionLessonCard(card, this.currentActiveNode, pathContainer);
    setTimeout(() => { card.classList.add('active'); this.isTransitioning = false; }, 50);
  }

  createButton(text, className, onClick) {
    const btn = document.createElement('button'); btn.className = `btn ${className}`; btn.innerHTML = `${text} <span class="xp-badge">+10 XP</span>`;
    btn.onclick = onClick; return btn;
  }

  positionLessonCard(card, node, container) {
    if (!node) return;
    const nodeRect = node.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const top = nodeRect.top - containerRect.top + nodeRect.height + 22;
    const left = nodeRect.left - containerRect.left + nodeRect.width/2;
    card.style.top = `${top}px`; card.style.left = `${left}px`; card.style.transform = 'translateX(-50%)';
  }

  selectSublesson(chapter, lessonId, subNum, chIdx) {
    chapter.selectedSublesson = subNum;
    this.showLessonCard(chapter, chapter.lessons.find(l => l.id === lessonId), chIdx);
  }

  startLesson(chapter, lessonId, chIdx) {
    const prog = chapter.userProgress[lessonId];
    prog.status = 'completed';
    this.updateNodeIcon(chapter, lessonId, chIdx);
    this.checkTreasureUnlock(chapter, chIdx);
    this.updateProgress(chIdx);
    const next = this.findNextNode(chapter, lessonId, chIdx);
    if (next) this.setActiveNode(next.node, next.chapter, next.chIdx);
    if (chapter.currentLessonCard) chapter.currentLessonCard.remove();
    chapter.currentLessonCard = null;
    if (this.callbacks.onLessonComplete) this.callbacks.onLessonComplete(lessonId, chIdx);
  }

  startSubLesson(chapter, lessonId, subNum, chIdx) {
    const prog = chapter.userProgress[lessonId];
    prog.sublessonCompleted[subNum-1] = true;
    prog.completedSublessons = prog.sublessonCompleted.filter(c=>c).length;
    if (prog.completedSublessons >= prog.totalSublessons) prog.status = 'completed';
    this.updateNodeIcon(chapter, lessonId, chIdx);
    this.checkTreasureUnlock(chapter, chIdx);
    this.updateProgress(chIdx);
    if (subNum < prog.totalSublessons) {
      let nextSub = subNum+1;
      while (nextSub <= prog.totalSublessons && prog.sublessonCompleted[nextSub-1]) nextSub++;
      if (nextSub <= prog.totalSublessons) {
        chapter.selectedSublesson = nextSub;
        this.showLessonCard(chapter, chapter.lessons.find(l=>l.id===lessonId), chIdx);
        return;
      }
    }
    const next = this.findNextNode(chapter, lessonId, chIdx);
    if (next) this.setActiveNode(next.node, next.chapter, next.chIdx);
    if (chapter.currentLessonCard) chapter.currentLessonCard.remove();
    chapter.currentLessonCard = null;
    if (this.callbacks.onLessonComplete) this.callbacks.onLessonComplete(lessonId, chIdx);
  }

  reviewLesson(chapter, lessonId, chIdx) { this.closeLessonCard(chapter); }
  reviewSubLesson(chapter, lessonId, subNum, chIdx) { this.closeLessonCard(chapter); }

  masterLesson(chapter, lessonId, chIdx) {
    const prog = chapter.userProgress[lessonId];
    prog.mastered = true;
    this.updateNodeIcon(chapter, lessonId, chIdx);
    this.showLessonCard(chapter, chapter.lessons.find(l=>l.id===lessonId), chIdx);
  }

  masterSubLesson(chapter, lessonId, subNum, chIdx) {
    const prog = chapter.userProgress[lessonId];
    prog.sublessonMastered[subNum-1] = true;
    if (prog.sublessonMastered.every(m=>m)) prog.mastered = true;
    this.updateNodeIcon(chapter, lessonId, chIdx);
    this.showLessonCard(chapter, chapter.lessons.find(l=>l.id===lessonId), chIdx);
  }

  updateNodeIcon(chapter, lessonId, chIdx) {
    const node = document.getElementById(lessonId);
    if (!node) return;
    const prog = chapter.userProgress[lessonId];
    const iconDiv = node.querySelector('.node-icon');
    if (prog.mastered) {
      iconDiv.innerHTML = '<span class="material-symbols-outlined">joystick</span>';
      node.classList.add('mastered');
    } else if (prog.status === 'completed') {
      iconDiv.innerHTML = '<span class="material-symbols-outlined">assignment_turned_in</span>';
      node.classList.add('completed');
      node.classList.add(this.chaptersData[chIdx].completedColorClass || '');
    } else {
      iconDiv.innerHTML = '<span class="material-symbols-outlined">joystick</span>';
      node.classList.remove('completed', 'mastered');
    }
  }

  checkTreasureUnlock(chapter, chIdx) {
    chapter.lessons.forEach((lesson, idx) => {
      if (lesson.type === 'treasure') {
        const treasure = document.getElementById(lesson.id);
        if (treasure && treasure.classList.contains('locked')) {
          const preceding = chapter.lessons.slice(0, idx);
          const allCompleted = preceding.every(l => {
            if (l.type === 'treasure') return true;
            const p = chapter.userProgress[l.id];
            if (l.totalSublessons > 1) return p.sublessonCompleted.every(c=>c);
            return p.status === 'completed';
          });
          if (allCompleted) {
            treasure.classList.remove('locked'); treasure.classList.add('unlocked');
            chapter.userProgress[lesson.id].status = 'unlocked';
            setTimeout(() => this.showTreasure(chapter, treasure, chIdx), 500);
          }
        }
      }
    });
  }

  findNextNode(chapter, completedNodeId, chIdx) {
    const index = chapter.lessons.findIndex(l => l.id === completedNodeId);
    for (let i=index+1; i<chapter.lessons.length; i++) {
      const nextLesson = chapter.lessons[i];
      if (nextLesson.type === 'treasure') continue;
      const nextNode = document.getElementById(nextLesson.id);
      if (nextNode && !nextNode.classList.contains('locked')) return { node: nextNode, chapter, chIdx };
    }
    if (chIdx + 1 < this.chaptersData.length) {
      const nextChapter = this.chaptersData[chIdx+1];
      const firstNode = document.querySelector(`#chapter-${chIdx+1} .path-node:not(.treasure)`);
      if (firstNode) return { node: firstNode, chapter: nextChapter, chIdx: chIdx+1 };
    }
    return null;
  }

  updateProgress(chIdx) {
    // update persistent progress bar (to be implemented by parent)
    if (this.callbacks.onProgressUpdate) this.callbacks.onProgressUpdate(chIdx);
  }

  closeLessonCard(chapter) {
    if (chapter.currentLessonCard) {
      chapter.currentLessonCard.classList.remove('active');
      setTimeout(() => { if (chapter.currentLessonCard) chapter.currentLessonCard.remove(); chapter.currentLessonCard = null; this.isTransitioning = false; }, 300);
    }
  }

  showTreasure(chapter, node, chIdx) {
    // For now, just alert; integrate with reward modals later
    alert(`Treasure chest opened! You found a reward.`);
    node.classList.add('collected');
    chapter.userProgress[node.id].status = 'collected';
    const next = this.findNextNode(chapter, node.id, chIdx);
    if (next) this.setActiveNode(next.node, next.chapter, next.chIdx);
  }

  setupEventListeners() {
    window.addEventListener('resize', () => {
      if (this.currentActiveNode && this.currentLessonCard) this.positionLessonCard(this.currentLessonCard, this.currentActiveNode, this.currentLessonCard.parentNode);
    });
  }
}
