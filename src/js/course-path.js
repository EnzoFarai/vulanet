// src/js/course-path.js
/**
 * VULANET COURSE PATH ENGINE
 * Renders interactive learning paths for any course.
 * Uses only local assets. Full implementation.
 */

// ============================================================
// STATE MANAGEMENT
// ============================================================

let currentState = {
  chapters: [],
  userProgress: {},
  activeNode: null,
  activeChapterIndex: 0,
  selectedSublesson: 1,
  isTransitioning: false,
  treasureReward: null,
  courseId: null,
  onLessonStart: null,
};

// ============================================================
// RENDER ENGINE – ENTRY POINT
// ============================================================

export function renderLearningPath(config) {
  const container = document.getElementById(config.containerId);
  if (!container) {
    console.error('Container not found:', config.containerId);
    return;
  }

  // Store state
  currentState.chapters = config.chapters;
  currentState.userProgress = config.userProgress || {};
  currentState.courseId = config.courseId;
  currentState.onLessonStart = config.onLessonStart;

  // Build chapter containers
  let html = '';
  config.chapters.forEach((chapter, index) => {
    const chapterNumber = index + 1;
    html += `
      <div class="chapter-container" id="chapter-${chapterNumber}">
        <div class="subtitle-container">
          <div class="line"></div>
          <div class="subtitle">${chapter.title}</div>
          <div class="line"></div>
        </div>
        <div class="learning-path-container">
          <div class="learning-path" id="learning-path-${chapterNumber}"></div>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;

  // Initialize each chapter's path
  config.chapters.forEach((chapter, index) => {
    const pathElement = document.getElementById(`learning-path-${index + 1}`);
    if (pathElement) {
      renderChapterPath(pathElement, chapter, index);
    }
  });

  // Set up persistent card, start bubble, and treasure panel
  setupPersistentCard(config);
  setupStartBubble();
  setupTreasurePanel();

  // Initialize first active node
  const firstIncomplete = findFirstIncompleteNode(0);
  if (firstIncomplete) {
    setActiveNode(firstIncomplete.node, firstIncomplete.chapterIndex);
  } else {
    // If all nodes in first chapter are complete, move to next chapter
    for (let i = 1; i < config.chapters.length; i++) {
      const next = findFirstIncompleteNode(i);
      if (next) {
        setActiveNode(next.node, next.chapterIndex);
        break;
      }
    }
  }

  // Update persistent card initially
  updatePersistentCard();
  updatePersistentCardAppearance(currentState.activeChapterIndex);

  // Bind scroll listener
  setupScrollListener(config);

  // Bind resize listener
  window.addEventListener('resize', () => {
    if (currentState.activeNode) {
      positionStartBubble(currentState.activeNode);
    }
    updatePersistentCard();
  });

  // Bind click outside to close lesson cards
  document.addEventListener('click', (e) => {
    if (currentState.isTransitioning) return;
    // Close lesson card if clicking outside it and outside any node
    const openCard = document.querySelector('.lesson-card.active');
    if (openCard && !openCard.contains(e.target) && !e.target.closest('.path-node')) {
      closeLessonCard(currentState.activeChapterIndex);
    }
  });

  console.log('Learning path rendered successfully.');
}

// ============================================================
// CHAPTER PATH RENDERER
// ============================================================

function renderChapterPath(pathElement, chapter, chapterIndex) {
  const waveState = { direction: 'L', position: 0 };
  const positionMap = new Map([
    [0, 0],
    [-1, -44],
    [-2, -70],
    [1, 44],
    [2, 70]
  ]);

  let html = '<div class="path-group">';

  chapter.lessons.forEach((lesson, index) => {
    const isTreasure = lesson.type === 'treasure';
    const isFlag = lesson.type === 'flag';
    const position = positionMap.get(waveState.position) || 0;

    // Get progress status
    const progress = getUserProgress(chapterIndex, lesson.id);
    const isMastered = progress.mastered || false;
    const isCompleted = progress.status === 'completed';
    const isLocked = progress.status === 'locked';

    // Determine node classes
    let nodeClasses = 'path-node';
    let iconHTML = '';

    if (isTreasure) {
      nodeClasses += ` treasure ${progress.status}`;
      iconHTML = `<img src="public/assets/icons/phosphor/duotone/treasure-chest.svg" alt="Chest" style="width:53px;height:53px;">`;
    } else if (isFlag) {
      nodeClasses += ` flag`;
      if (isMastered) nodeClasses += ' mastered';
      if (isCompleted || isMastered) nodeClasses += ' completed';
      iconHTML = `<img src="public/assets/icons/phosphor/duotone/flag-checkered.svg" alt="Review" style="width:32px;height:32px;color:white;">`;
    } else {
      if (isMastered) {
        nodeClasses += ' mastered';
      } else if (isCompleted) {
        nodeClasses += ' completed';
        // Add chapter-specific color class
        nodeClasses += ` chapter-${chapterIndex + 1}-completed`;
      } else {
        nodeClasses += ' unstarted';
      }
      const iconName = (isCompleted && !isMastered) ? 'assignment_turned_in' : 'joystick';
      iconHTML = `<span class="material-symbols-outlined">${iconName}</span>`;
    }

    // Add position offset
    const style = `position: relative; left: ${position}px;`;
    if (isTreasure) {
      // Treasure nodes have no fixed size
    }

    html += `
      <div class="${nodeClasses}" 
           id="${lesson.id}" 
           data-lesson="${lesson.id}" 
           data-chapter="${chapterIndex}" 
           style="${style}">
        <div class="node-icon">
          ${iconHTML}
        </div>
      </div>
    `;

    // Update wave state
    if (waveState.direction === 'L' && waveState.position === -2) {
      waveState.direction = 'R';
      waveState.position = -1;
    } else if (waveState.direction === 'R' && waveState.position === 2) {
      waveState.direction = 'L';
      waveState.position = 1;
    } else {
      waveState.position += (waveState.direction === 'L') ? -1 : 1;
    }
  });

  html += '</div>';
  pathElement.innerHTML = html;

  // Bind click events to nodes in this chapter
  const nodes = pathElement.querySelectorAll('.path-node');
  nodes.forEach(node => {
    node.addEventListener('click', (e) => {
      handleNodeClick(parseInt(node.dataset.chapter), node);
    });
  });
}

// ============================================================
// USER PROGRESS HELPERS
// ============================================================

function getUserProgress(chapterIndex, lessonId) {
  const chapter = currentState.chapters[chapterIndex];
  if (!chapter) return { status: 'locked', mastered: false, sublessonCompleted: [], sublessonMastered: [] };

  const lesson = chapter.lessons.find(l => l.id === lessonId);
  if (!lesson) return { status: 'locked', mastered: false, sublessonCompleted: [], sublessonMastered: [] };

  const key = `${currentState.courseId}_${lessonId}`;
  const progress = currentState.userProgress[key] || {};

  // If lesson is treasure, default to locked unless overridden
  if (lesson.type === 'treasure') {
    return {
      status: progress.status || 'locked',
      mastered: false,
      sublessonCompleted: [],
      sublessonMastered: []
    };
  }

  return {
    status: progress.status || 'unstarted',
    mastered: progress.mastered || false,
    sublessonCompleted: progress.sublessonCompleted || Array(lesson.totalSublessons || 1).fill(false),
    sublessonMastered: progress.sublessonMastered || Array(lesson.totalSublessons || 1).fill(false),
    completedSublessons: progress.completedSublessons || 0,
    totalSublessons: lesson.totalSublessons || 1,
  };
}

function updateUserProgress(chapterIndex, lessonId, updates) {
  const key = `${currentState.courseId}_${lessonId}`;
  if (!currentState.userProgress[key]) {
    const chapter = currentState.chapters[chapterIndex];
    const lesson = chapter.lessons.find(l => l.id === lessonId);
    const total = lesson ? lesson.totalSublessons || 1 : 1;
    currentState.userProgress[key] = {
      status: 'unstarted',
      mastered: false,
      sublessonCompleted: Array(total).fill(false),
      sublessonMastered: Array(total).fill(false),
      completedSublessons: 0,
    };
  }
  Object.assign(currentState.userProgress[key], updates);
  // Also save to localStorage for persistence (if not using Supabase yet)
  try {
    localStorage.setItem(`vulanet_progress_${currentState.courseId}`, JSON.stringify(currentState.userProgress));
  } catch(e) {}
}

// ============================================================
// NODE INTERACTION
// ============================================================

function handleNodeClick(chapterIndex, node) {
  if (currentState.isTransitioning) return;

  const lessonId = node.dataset.lesson;
  const chapter = currentState.chapters[chapterIndex];
  const lesson = chapter.lessons.find(l => l.id === lessonId);
  if (!lesson) return;

  // Handle treasure nodes
  if (lesson.type === 'treasure') {
    const progress = getUserProgress(chapterIndex, lessonId);
    if (progress.status === 'locked') {
      // Check if all preceding lessons are completed
      const preceding = chapter.lessons.slice(0, chapter.lessons.indexOf(lesson));
      const allDone = preceding.every(l => {
        if (l.type === 'treasure') return true;
        const p = getUserProgress(chapterIndex, l.id);
        return p.status === 'completed' || p.mastered;
      });
      if (allDone) {
        // Unlock the treasure
        updateUserProgress(chapterIndex, lessonId, { status: 'unlocked' });
        node.classList.remove('locked');
        node.classList.add('unlocked');
        // Auto-open treasure panel
        setTimeout(() => {
          setActiveNode(node, chapterIndex);
          showTreasurePanel(chapterIndex, node);
        }, 300);
      }
      return;
    } else if (progress.status === 'unlocked' || progress.status === 'collected') {
      if (progress.status !== 'collected') {
        showTreasurePanel(chapterIndex, node);
      }
      return;
    }
    return;
  }

  // Regular lesson nodes
  setActiveNode(node, chapterIndex);
  showLessonCard(chapterIndex, lesson);
}

function setActiveNode(node, chapterIndex) {
  // Remove active class from all nodes
  document.querySelectorAll('.path-node.active').forEach(n => n.classList.remove('active'));

  node.classList.add('active');
  currentState.activeNode = node;
  currentState.activeChapterIndex = chapterIndex;

  // Update START bubble
  positionStartBubble(node);
  updateStartBubbleColor(chapterIndex, node.dataset.lesson);
  document.getElementById('start-speech-bubble')?.classList.add('visible');

  // Update persistent card if needed
  updatePersistentCard();
}

// ============================================================
// START SPEECH BUBBLE
// ============================================================

function setupStartBubble() {
  // Create the bubble if it doesn't exist
  let bubble = document.getElementById('start-speech-bubble');
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.id = 'start-speech-bubble';
    bubble.className = 'start-speech-bubble';
    bubble.innerHTML = `<div class="speech-title">START</div>`;
    document.body.appendChild(bubble);
    // Add styles (should be in CSS, but we inject minimal here)
    const style = document.createElement('style');
    style.textContent = `
      #start-speech-bubble {
        --bbColor: white;
        --bbArrowSize: 0.65rem;
        --bbBorderRadius: 0.5rem;
        --bbPadding: 0.65rem 1.1rem;
        background: var(--bbColor);
        border-radius: var(--bbBorderRadius);
        padding: var(--bbPadding);
        position: fixed;
        border: 2px solid #e5e5e5;
        color: black;
        width: 95px;
        height: 58px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        text-align: center;
        z-index: 1000;
        filter: drop-shadow(2px 2px 4px rgba(0, 0, 0, 0.1));
        animation: float 3s infinite ease-in-out;
        font-family: 'Atkinson Hyperlegible', sans-serif;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.3s ease, visibility 0.3s ease;
        pointer-events: none;
      }
      #start-speech-bubble.visible {
        opacity: 1;
        visibility: visible;
      }
      #start-speech-bubble::before {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: solid transparent;
        border-width: var(--bbArrowSize) calc(var(--bbArrowSize) * 0.75) 0;
        border-top-color: #e5e5e5;
      }
      #start-speech-bubble::after {
        content: '';
        position: absolute;
        top: calc(100% - 2px);
        left: 50%;
        transform: translateX(-50%);
        border: solid transparent;
        border-width: calc(var(--bbArrowSize) - 2px) calc(var(--bbArrowSize) * 0.75 - 2px) 0;
        border-top-color: var(--bbColor);
      }
      .speech-title {
        font-weight: 700;
        color: var(--primary-blue);
        font-size: 1.05rem;
        line-height: 1.2;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
      }
      @keyframes float {
        0%, 100% { transform: translateX(-50%) translateY(0); }
        50% { transform: translateX(-50%) translateY(-5px); }
      }
    `;
    document.head.appendChild(style);
  }

  // Also ensure the bubble is fixed positioned relative to the active node
  window.addEventListener('scroll', () => {
    if (currentState.activeNode) {
      positionStartBubble(currentState.activeNode);
    }
  });
}

function positionStartBubble(node) {
  const bubble = document.getElementById('start-speech-bubble');
  if (!bubble) return;
  const rect = node.getBoundingClientRect();
  const top = rect.top - 65;
  const left = rect.left + (rect.width / 2);
  bubble.style.top = `${top}px`;
  bubble.style.left = `${left}px`;
  bubble.style.transform = 'translateX(-50%)';
}

function updateStartBubbleColor(chapterIndex, lessonId) {
  const bubble = document.getElementById('start-speech-bubble');
  if (!bubble) return;
  const title = bubble.querySelector('.speech-title');
  const progress = getUserProgress(chapterIndex, lessonId);
  if (progress.mastered) {
    title.style.color = '#F4B400'; // Gold
  } else if (progress.status === 'completed') {
    // Use chapter colour
    const colors = ['#4285F4', '#1CB0F6', '#AA00FF', '#EA4335', '#FF6D01', '#FBBC05', '#34A853'];
    title.style.color = colors[chapterIndex % colors.length];
  } else {
    title.style.color = '#4285F4'; // Default blue
  }
}

// ============================================================
// LESSON CARD
// ============================================================

function showLessonCard(chapterIndex, lesson) {
  if (currentState.isTransitioning) return;
  currentState.isTransitioning = true;

  // Close existing card
  closeLessonCard(chapterIndex);

  const chapter = currentState.chapters[chapterIndex];
  const progress = getUserProgress(chapterIndex, lesson.id);

  // Create card
  const card = document.createElement('div');
  card.className = 'lesson-card';
  card.id = `lesson-card-${lesson.id}`;

  // Determine card style
  if (progress.mastered) {
    card.classList.add('mastered');
  } else if (progress.status === 'completed') {
    const chapterColors = ['#4285F4', '#1CB0F6', '#AA00FF', '#EA4335', '#FF6D01', '#FBBC05', '#34A853'];
    const color = chapterColors[chapterIndex % chapterColors.length];
    card.style.setProperty('--bbColor', color);
    card.style.setProperty('--bbBorderColor', darkenColor(color, 20));
  } else {
    card.style.setProperty('--bbColor', '#4285F4');
    card.style.setProperty('--bbBorderColor', '#3367D6');
  }

  // Header
  const header = document.createElement('div');
  header.className = 'lesson-header';
  const title = document.createElement('h2');
  title.className = 'lesson-title';
  title.textContent = lesson.title;
  header.appendChild(title);
  card.appendChild(header);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'lesson-actions';

  // Sub-lesson progress (if multi-sub)
  if (lesson.totalSublessons > 1) {
    const subProgress = document.createElement('div');
    subProgress.className = 'sublesson-progress';
    for (let i = 1; i <= lesson.totalSublessons; i++) {
      const item = document.createElement('div');
      item.className = 'sublesson-item';
      item.dataset.sublesson = i;
      const circle = document.createElement('div');
      circle.className = 'sublesson-circle';
      if (i === currentState.selectedSublesson) circle.classList.add('active');
      if (progress.sublessonCompleted[i-1]) circle.classList.add('completed');
      if (progress.sublessonMastered[i-1]) { circle.classList.remove('completed'); circle.classList.add('mastered'); }
      circle.textContent = i;
      const label = document.createElement('div');
      label.className = 'sublesson-label';
      label.textContent = `Lesson ${i}`;
      item.appendChild(circle);
      item.appendChild(label);
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentState.isTransitioning) return;
        currentState.selectedSublesson = i;
        showLessonCard(chapterIndex, lesson);
      });
      subProgress.appendChild(item);
    }
    actions.appendChild(subProgress);
  }

  // Lesson info
  const info = document.createElement('div');
  info.className = 'lesson-info';
  info.textContent = lesson.type === 'flag' ? 'Final Review' :
    (lesson.totalSublessons > 1 ? `Lesson ${currentState.selectedSublesson} of ${lesson.totalSublessons}` : 'Lesson 1 of 1');
  actions.appendChild(info);

  // Buttons
  if (lesson.type === 'flag') {
    if (progress.mastered) {
      const btn = createButton('Review', 'btn-chapter-review-mastered', '+25 XP');
      btn.onclick = () => { closeLessonCard(chapterIndex); if (currentState.onLessonStart) currentState.onLessonStart(lesson.id); };
      actions.appendChild(btn);
    } else if (progress.status === 'completed') {
      const reviewBtn = createButton('Review', 'btn-chapter-review', '+25 XP');
      reviewBtn.onclick = () => { closeLessonCard(chapterIndex); if (currentState.onLessonStart) currentState.onLessonStart(lesson.id); };
      actions.appendChild(reviewBtn);
      const masterBtn = createButton('Master', 'btn-master', '+100 XP');
      masterBtn.onclick = () => { masterLesson(chapterIndex, lesson.id); };
      actions.appendChild(masterBtn);
    } else {
      const beginBtn = createButton('Begin', 'btn-chapter-review', '+50 XP');
      beginBtn.onclick = () => { startLesson(chapterIndex, lesson.id); };
      actions.appendChild(beginBtn);
    }
  } else {
    // Standard joystick lesson
    if (progress.mastered) {
      const btn = createButton('Review', 'btn-review-mastered', '+5 XP');
      btn.onclick = () => { closeLessonCard(chapterIndex); if (currentState.onLessonStart) currentState.onLessonStart(lesson.id); };
      actions.appendChild(btn);
    } else if (lesson.totalSublessons > 1 && progress.sublessonMastered[currentState.selectedSublesson - 1]) {
      const reviewBtn = createButton('Review', 'btn-review-mastered', '+5 XP');
      reviewBtn.onclick = () => { closeLessonCard(chapterIndex); if (currentState.onLessonStart) currentState.onLessonStart(lesson.id); };
      actions.appendChild(reviewBtn);
      const allMastered = progress.sublessonMastered.every(v => v);
      if (!allMastered) {
        const masterBtn = createButton('Master', 'btn-master', '+40 XP');
        masterBtn.onclick = () => { masterSubLesson(chapterIndex, lesson.id, currentState.selectedSublesson); };
        actions.appendChild(masterBtn);
      }
    } else if (progress.status === 'completed' || (lesson.totalSublessons > 1 && progress.sublessonCompleted[currentState.selectedSublesson - 1])) {
      const reviewBtn = createButton('Review', 'btn-review-chapter-' + (chapterIndex + 1), '+5 XP');
      reviewBtn.onclick = () => { closeLessonCard(chapterIndex); if (currentState.onLessonStart) currentState.onLessonStart(lesson.id); };
      actions.appendChild(reviewBtn);
      const masterBtn = createButton('Master', 'btn-master', '+40 XP');
      masterBtn.onclick = () => {
        if (lesson.totalSublessons > 1) {
          masterSubLesson(chapterIndex, lesson.id, currentState.selectedSublesson);
        } else {
          masterLesson(chapterIndex, lesson.id);
        }
      };
      actions.appendChild(masterBtn);
    } else {
      const startBtn = createButton('START', 'btn-primary', '+10 XP');
      startBtn.onclick = () => {
        if (lesson.totalSublessons > 1) {
          startSubLesson(chapterIndex, lesson.id, currentState.selectedSublesson);
        } else {
          startLesson(chapterIndex, lesson.id);
        }
      };
      actions.appendChild(startBtn);
    }
  }

  card.appendChild(actions);

  // Position and add to DOM
  const pathContainer = document.getElementById(`learning-path-${chapterIndex + 1}`);
  pathContainer.appendChild(card);
  positionLessonCard(card, currentState.activeNode);

  // Show after brief delay
  setTimeout(() => {
    card.classList.add('active');
    currentState.isTransitioning = false;
  }, 50);
}

function createButton(text, className, badge) {
  const btn = document.createElement('button');
  btn.className = `btn ${className}`;
  btn.innerHTML = badge ? `${text} <span class="xp-badge">${badge}</span>` : text;
  return btn;
}

function positionLessonCard(card, node) {
  if (!node) return;
  const rect = node.getBoundingClientRect();
  const pathRect = node.closest('.learning-path')?.getBoundingClientRect() || { top: 0, left: 0 };
  const top = rect.top - pathRect.top + rect.height + 22;
  const left = rect.left - pathRect.left + (rect.width / 2);
  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
  card.style.transform = 'translateX(-50%)';
}

function closeLessonCard(chapterIndex) {
  const path = document.getElementById(`learning-path-${chapterIndex + 1}`);
  if (!path) return;
  const card = path.querySelector('.lesson-card.active');
  if (card) {
    card.classList.remove('active');
    setTimeout(() => {
      if (card.parentNode) card.parentNode.removeChild(card);
    }, 300);
  }
  currentState.isTransitioning = false;
}

// ============================================================
// LESSON ACTIONS (Start, Review, Master)
// ============================================================

function startLesson(chapterIndex, lessonId) {
  const progress = getUserProgress(chapterIndex, lessonId);
  if (progress.status === 'completed' || progress.mastered) return;

  updateUserProgress(chapterIndex, lessonId, { status: 'completed' });
  updateNodeIcon(chapterIndex, lessonId);
  checkTreasureUnlock(chapterIndex);
  updatePersistentCard();
  closeLessonCard(chapterIndex);

  // Find next node
  const next = findNextNodeAfterCompletion(chapterIndex, lessonId);
  if (next) {
    setActiveNode(next.node, next.chapterIndex);
  } else {
    // Keep current node active
    const node = document.getElementById(lessonId);
    if (node) setActiveNode(node, chapterIndex);
  }
}

function startSubLesson(chapterIndex, lessonId, sublessonNumber) {
  const progress = getUserProgress(chapterIndex, lessonId);
  if (progress.sublessonCompleted[sublessonNumber - 1]) return;

  progress.sublessonCompleted[sublessonNumber - 1] = true;
  progress.completedSublessons = progress.sublessonCompleted.filter(v => v).length;
  if (progress.completedSublessons >= progress.totalSublessons) {
    progress.status = 'completed';
  }
  updateUserProgress(chapterIndex, lessonId, {
    sublessonCompleted: progress.sublessonCompleted,
    completedSublessons: progress.completedSublessons,
    status: progress.status
  });
  updateNodeIcon(chapterIndex, lessonId);
  checkTreasureUnlock(chapterIndex);
  updatePersistentCard();
  closeLessonCard(chapterIndex);

  // Move to next sublesson or node
  const lesson = currentState.chapters[chapterIndex].lessons.find(l => l.id === lessonId);
  if (lesson && lesson.totalSublessons > 1) {
    let nextSub = sublessonNumber + 1;
    while (nextSub <= lesson.totalSublessons && progress.sublessonCompleted[nextSub - 1]) nextSub++;
    if (nextSub <= lesson.totalSublessons) {
      currentState.selectedSublesson = nextSub;
      const node = document.getElementById(lessonId);
      if (node) setActiveNode(node, chapterIndex);
      showLessonCard(chapterIndex, lesson);
      return;
    }
  }

  const next = findNextNodeAfterCompletion(chapterIndex, lessonId);
  if (next) {
    setActiveNode(next.node, next.chapterIndex);
  }
}

function masterLesson(chapterIndex, lessonId) {
  const progress = getUserProgress(chapterIndex, lessonId);
  if (progress.mastered) return;
  progress.mastered = true;
  updateUserProgress(chapterIndex, lessonId, { mastered: true });
  updateNodeIcon(chapterIndex, lessonId);
  checkTreasureUnlock(chapterIndex);
  updatePersistentCard();
  closeLessonCard(chapterIndex);
  // Reopen card to show updated state
  const lesson = currentState.chapters[chapterIndex].lessons.find(l => l.id === lessonId);
  if (lesson) {
    const node = document.getElementById(lessonId);
    if (node) setActiveNode(node, chapterIndex);
    showLessonCard(chapterIndex, lesson);
  }
}

function masterSubLesson(chapterIndex, lessonId, sublessonNumber) {
  const progress = getUserProgress(chapterIndex, lessonId);
  if (progress.sublessonMastered[sublessonNumber - 1]) return;
  progress.sublessonMastered[sublessonNumber - 1] = true;
  const allMastered = progress.sublessonMastered.every(v => v);
  if (allMastered) {
    progress.mastered = true;
    updateUserProgress(chapterIndex, lessonId, {
      sublessonMastered: progress.sublessonMastered,
      mastered: true
    });
  } else {
    updateUserProgress(chapterIndex, lessonId, {
      sublessonMastered: progress.sublessonMastered
    });
  }
  updateNodeIcon(chapterIndex, lessonId);
  updatePersistentCard();
  closeLessonCard(chapterIndex);
  const lesson = currentState.chapters[chapterIndex].lessons.find(l => l.id === lessonId);
  if (lesson) {
    const node = document.getElementById(lessonId);
    if (node) setActiveNode(node, chapterIndex);
    showLessonCard(chapterIndex, lesson);
  }
}

// ============================================================
// NODE ICON UPDATER
// ============================================================

function updateNodeIcon(chapterIndex, lessonId) {
  const node = document.getElementById(lessonId);
  if (!node) return;
  const chapter = currentState.chapters[chapterIndex];
  const lesson = chapter.lessons.find(l => l.id === lessonId);
  if (!lesson || lesson.type === 'treasure' || lesson.type === 'flag') return;

  const progress = getUserProgress(chapterIndex, lessonId);
  const icon = node.querySelector('.node-icon');
  if (!icon) return;

  if (progress.mastered) {
    icon.innerHTML = `<span class="material-symbols-outlined">joystick</span>`;
    node.classList.remove('completed', 'unstarted');
    node.classList.add('mastered');
    node.style.boxShadow = '0px var(--node-shadow-offset) 0 0 var(--node-gold-shadow)';
  } else if (progress.status === 'completed' || 
             (lesson.totalSublessons > 1 && progress.sublessonCompleted.every(v => v))) {
    icon.innerHTML = `<span class="material-symbols-outlined">assignment_turned_in</span>`;
    node.classList.remove('mastered', 'unstarted');
    node.classList.add('completed');
    const colors = ['#4285F4', '#1CB0F6', '#AA00FF', '#EA4335', '#FF6D01', '#FBBC05', '#34A853'];
    const shadowColors = ['#3367D6', '#0A9DE3', '#8A00D4', '#D32F2F', '#E65C00', '#D4A000', '#2E7D32'];
    const idx = chapterIndex % colors.length;
    node.style.backgroundColor = colors[idx];
    node.style.boxShadow = `0px var(--node-shadow-offset) 0 0 ${shadowColors[idx]}`;
  } else {
    icon.innerHTML = `<span class="material-symbols-outlined">joystick</span>`;
    node.classList.remove('completed', 'mastered');
    node.classList.add('unstarted');
    node.style.backgroundColor = '';
    node.style.boxShadow = '';
  }
}

// ============================================================
// TREASURE UNLOCK AND PANEL
// ============================================================

function checkTreasureUnlock(chapterIndex) {
  const chapter = currentState.chapters[chapterIndex];
  chapter.lessons.forEach((lesson, idx) => {
    if (lesson.type === 'treasure') {
      const progress = getUserProgress(chapterIndex, lesson.id);
      if (progress.status === 'locked') {
        const preceding = chapter.lessons.slice(0, idx);
        const allDone = preceding.every(l => {
          if (l.type === 'treasure') return true;
          const p = getUserProgress(chapterIndex, l.id);
          return p.status === 'completed' || p.mastered;
        });
        if (allDone) {
          updateUserProgress(chapterIndex, lesson.id, { status: 'unlocked' });
          const node = document.getElementById(lesson.id);
          if (node) {
            node.classList.remove('locked');
            node.classList.add('unlocked');
            // Auto-open treasure
            setTimeout(() => {
              setActiveNode(node, chapterIndex);
              showTreasurePanel(chapterIndex, node);
            }, 500);
          }
        }
      }
    }
  });
}

function showTreasurePanel(chapterIndex, node) {
  const panel = document.getElementById('treasure-panel');
  const overlay = document.getElementById('overlay');
  if (!panel) {
    console.warn('Treasure panel not found. Please add #treasure-panel and #overlay to your HTML.');
    return;
  }

  // Generate random reward
  const rewards = [
    { type: 'coin', amount: 250, title: 'You have earned 250 coins!', subtitle: 'Spend them wisely', icon: 'coins' },
    { type: 'coin', amount: 350, title: 'You have earned 350 coins!', subtitle: 'Spend them wisely', icon: 'coins' },
    { type: 'coin', amount: 500, title: 'You have earned 500 coins!', subtitle: 'Spend them wisely', icon: 'coins' },
    { type: 'xp-boost', multiplier: '1.5', dur: 30, title: 'You found an XP Boost!', subtitle: 'Congrats! 1.5x XP for 30 min.', icon: 'rocket' },
    { type: 'xp-boost', multiplier: '2', dur: 20, title: 'You found an XP Boost!', subtitle: 'Congrats! 2x XP for 20 min.', icon: 'rocket' },
    { type: 'xp-boost', multiplier: '3', dur: 15, title: 'You found an XP Boost!', subtitle: 'Congrats! 3x XP for 15 min.', icon: 'rocket' },
    { type: 'heart', amount: 5, title: 'You gained more hearts!', subtitle: 'You now have 5 hearts again.', icon: 'hearts' }
  ];
  const reward = rewards[Math.floor(Math.random() * rewards.length)];
  currentState.treasureReward = { reward, node, chapterIndex };

  // Update panel content
  const iconContainer = document.getElementById('reward-icon-container');
  const rewardTitle = document.getElementById('reward-title');
  const rewardSubtitle = document.getElementById('reward-subtitle');
  const claimBtn = document.getElementById('claim-button');

  if (iconContainer) {
    iconContainer.innerHTML = '';
    if (reward.type === 'coin') {
      iconContainer.innerHTML = `<img src="public/assets/icons/phosphor/duotone/coins.svg" style="width:140px;height:140px;filter:drop-shadow(0 4px 8px rgba(255,215,0,0.3));">`;
    } else if (reward.type === 'xp-boost') {
      iconContainer.innerHTML = `
        <div style="position:relative;width:160px;height:160px;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <img src="public/assets/icons/phosphor/duotone/rocket-launch.svg" style="width:140px;height:140px;filter:drop-shadow(0 4px 8px rgba(255,150,0,0.3));">
          <div style="font-size:24px;font-weight:900;color:#FF9600;margin-top:-10px;">x${reward.multiplier}</div>
        </div>
      `;
    } else if (reward.type === 'heart') {
      let heartsHTML = '';
      for (let i = 0; i < 5; i++) {
        heartsHTML += `<img src="public/assets/icons/phosphor/fill/heart.svg" style="width:80px;height:80px;filter:brightness(0) saturate(100%) invert(33%) sepia(98%) saturate(1748%) hue-rotate(330deg) brightness(97%) contrast(94%);">`;
      }
      iconContainer.innerHTML = `<div style="display:flex;gap:12px;">${heartsHTML}</div>`;
    }
  }

  if (rewardTitle) rewardTitle.textContent = reward.title;
  if (rewardSubtitle) rewardSubtitle.textContent = reward.subtitle;
  if (claimBtn) {
    claimBtn.textContent = reward.type === 'coin' ? `Claim ${reward.amount}` :
                           reward.type === 'xp-boost' ? 'Claim XP Boost' : 'Claim hearts';
    claimBtn.onclick = () => {
      // Apply reward (in a real app, this would call Supabase)
      if (reward.type === 'coin') {
        const current = parseInt(localStorage.getItem('coins') || '500');
        localStorage.setItem('coins', String(current + reward.amount));
        alert(`Claimed ${reward.amount} coins!`);
      } else if (reward.type === 'xp-boost') {
        alert(`Claimed ${reward.multiplier}x XP boost for ${reward.dur} minutes!`);
      } else if (reward.type === 'heart') {
        localStorage.setItem('hearts', '5');
        alert('Hearts refilled to 5!');
      }
      // Close panel and mark treasure as collected
      panel.classList.remove('active');
      overlay.classList.remove('active');
      const node = currentState.treasureReward.node;
      if (node) {
        node.classList.remove('unlocked');
        node.classList.add('collected');
        updateUserProgress(currentState.treasureReward.chapterIndex, node.dataset.lesson, { status: 'collected' });
      }
      currentState.treasureReward = null;
      // Find next node
      const next = findNextNodeAfterCompletion(currentState.activeChapterIndex, node ? node.dataset.lesson : null);
      if (next) setActiveNode(next.node, next.chapterIndex);
    };
  }

  panel.classList.add('active');
  if (overlay) overlay.classList.add('active');
}

function setupTreasurePanel() {
  // Panel and overlay are already in the DOM via header.html
  // We just need to ensure close on overlay click
  const overlay = document.getElementById('overlay');
  if (overlay) {
    overlay.addEventListener('click', () => {
      const panel = document.getElementById('treasure-panel');
      if (panel) panel.classList.remove('active');
      overlay.classList.remove('active');
    });
  }
}

// ============================================================
// PERSISTENT LEARNING CARD
// ============================================================

function setupPersistentCard(config) {
  // Check if card exists; if not, create it
  let card = document.getElementById('persistent-learning-card');
  if (!card) {
    card = document.createElement('div');
    card.id = 'persistent-learning-card';
    card.className = 'learning-card chapter-1';
    card.innerHTML = `
      <div class="text-container">
        <a href="#" class="section-link"><div class="section">UNIT 1</div></a>
        <a href="#" class="title-link"><div class="title">Chapter 1</div></a>
        <div class="card-progress"><div class="card-progress-bar" id="persistent-progress-bar"></div></div>
      </div>
      <a href="#" class="icon-link"><div class="icon-container"><img src="public/assets/icons/phosphor/bold/notebook.svg" style="width:44px;height:44px;color:#fff;"></div></a>
    `;
    document.body.insertBefore(card, document.body.firstChild);
    // Styles (should be in CSS, but we inject minimal)
    const style = document.createElement('style');
    style.textContent = `
      #persistent-learning-card {
        position: fixed;
        top: 28px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 100;
        width: calc(100% - 40px);
        max-width: 1200px;
        border-radius: 16px;
        display: flex;
        align-items: center;
        margin: 0 auto;
        box-shadow: 0 1px 3px rgba(0,0,0,0.12);
        overflow: hidden;
        padding: 18px 22px;
        transition: background-color 0.3s ease;
        pointer-events: auto;
        background: #4285F4;
      }
      #persistent-learning-card .text-container { flex-grow: 1; }
      #persistent-learning-card .section { font-weight: 500; color: #fff; font-size: 16px; letter-spacing:0.5px; text-transform:uppercase; }
      #persistent-learning-card .title { font-weight:700; color:#fff; font-size:24px; margin-top:3px; }
      #persistent-learning-card .card-progress { position:absolute; bottom:0; left:0; width:100%; height:5px; background:rgba(0,0,0,0.1); border-radius:0 0 16px 16px; overflow:hidden; }
      #persistent-learning-card .card-progress-bar { height:100%; background:#fff; width:0%; transition:width 0.3s ease; }
      #persistent-learning-card .icon-container { display:flex; justify-content:center; align-items:center; padding-left:18px; margin-left:18px; border-left:1px solid rgba(255,255,255,0.3); }
      .learning-card.chapter-1 { background: #4285F4; }
      .learning-card.chapter-2 { background: #1CB0F6; }
      .learning-card.chapter-3 { background: #AA00FF; }
      .learning-card.chapter-4 { background: #EA4335; }
      .learning-card.chapter-5 { background: #FF6D01; }
      .learning-card.chapter-6 { background: #FBBC05; }
      .learning-card.chapter-7 { background: #34A853; }
      .learning-card.gold { background: #F4B400; }
    `;
    document.head.appendChild(style);
  }
}

function updatePersistentCard() {
  const bar = document.getElementById('persistent-progress-bar');
  if (!bar) return;
  const chapterIndex = currentState.activeChapterIndex;
  const chapter = currentState.chapters[chapterIndex];
  if (!chapter) return;

  const lessons = chapter.lessons.filter(l => l.type !== 'treasure');
  const total = lessons.length;
  let completed = 0;
  let mastered = 0;
  lessons.forEach(l => {
    const p = getUserProgress(chapterIndex, l.id);
    if (p.mastered) mastered++;
    if (p.status === 'completed' || p.mastered) completed++;
  });
  const pct = total > 0 ? (completed / total) * 100 : 0;
  bar.style.width = `${Math.min(pct, 100)}%`;

  // Check if all are mastered -> Gold card
  const allMastered = mastered === total && total > 0;
  const card = document.getElementById('persistent-learning-card');
  if (card) {
    if (allMastered) {
      card.className = 'learning-card gold';
    } else {
      card.className = `learning-card chapter-${(chapterIndex % 7) + 1}`;
    }
    const titleEl = card.querySelector('.title');
    if (titleEl) titleEl.textContent = `Chapter ${chapterIndex + 1}`;
  }
}

function updatePersistentCardAppearance(chapterIndex) {
  const card = document.getElementById('persistent-learning-card');
  if (!card) return;
  const chapter = currentState.chapters[chapterIndex];
  if (!chapter) return;
  const lessons = chapter.lessons.filter(l => l.type !== 'treasure');
  const total = lessons.length;
  let mastered = 0;
  lessons.forEach(l => {
    const p = getUserProgress(chapterIndex, l.id);
    if (p.mastered) mastered++;
  });
  if (mastered === total && total > 0) {
    card.className = 'learning-card gold';
  } else {
    card.className = `learning-card chapter-${(chapterIndex % 7) + 1}`;
  }
}

// ============================================================
// SCROLL DETECTION (Chapter switching)
// ============================================================

function setupScrollListener(config) {
  let lastScrollTop = 0;
  let isScrolling = false;
  let scrollTimeout = null;

  window.addEventListener('scroll', () => {
    if (!currentState.activeNode) return;
    isScrolling = true;
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => { isScrolling = false; }, 100);

    requestAnimationFrame(() => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const direction = scrollTop > lastScrollTop ? 'down' : 'up';
      lastScrollTop = scrollTop;

      // Find the visible chapter based on scroll position
      const cardRect = document.getElementById('persistent-learning-card')?.getBoundingClientRect();
      if (!cardRect) return;
      const cardBottom = cardRect.bottom + window.pageYOffset;

      let visibleIndex = 0;
      for (let i = 0; i < config.chapters.length; i++) {
        const el = document.getElementById(`chapter-${i + 1}`);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const chapterTop = rect.top + window.pageYOffset;
        const chapterBottom = rect.bottom + window.pageYOffset;
        if (chapterTop < cardBottom + 100 && chapterBottom > cardBottom) {
          visibleIndex = i;
          break;
        }
        // Scrolling up edge case
        if (direction === 'up' && i > 0) {
          const prev = document.getElementById(`chapter-${i}`);
          if (prev) {
            const prevBottom = prev.getBoundingClientRect().bottom + window.pageYOffset;
            if (scrollTop < prevBottom - 50 && scrollTop > chapterTop - 100) {
              visibleIndex = i - 1;
              break;
            }
          }
        }
      }

      if (visibleIndex !== currentState.activeChapterIndex) {
        currentState.activeChapterIndex = visibleIndex;
        updatePersistentCardAppearance(visibleIndex);
        updatePersistentCard();
        // Update START bubble if active node is in wrong chapter
        if (currentState.activeNode) {
          const nodeChapter = parseInt(currentState.activeNode.dataset.chapter);
          if (nodeChapter !== visibleIndex) {
            // Find first incomplete node in visible chapter
            const first = findFirstIncompleteNode(visibleIndex);
            if (first) {
              setActiveNode(first.node, visibleIndex);
            }
          }
        }
      }
    });
  });
}

// ============================================================
// FINDERS
// ============================================================

function findFirstIncompleteNode(chapterIndex) {
  const chapter = currentState.chapters[chapterIndex];
  if (!chapter) return null;
  for (let i = 0; i < chapter.lessons.length; i++) {
    const lesson = chapter.lessons[i];
    if (lesson.type === 'treasure') continue;
    const progress = getUserProgress(chapterIndex, lesson.id);
    if (progress.status !== 'completed' && !progress.mastered) {
      const node = document.getElementById(lesson.id);
      if (node && !node.classList.contains('locked')) {
        return { node, chapterIndex };
      }
    }
  }
  return null;
}

function findNextNodeAfterCompletion(chapterIndex, completedLessonId) {
  const chapter = currentState.chapters[chapterIndex];
  if (!chapter) return null;
  const idx = chapter.lessons.findIndex(l => l.id === completedLessonId);
  if (idx === -1) return null;
  for (let i = idx + 1; i < chapter.lessons.length; i++) {
    const lesson = chapter.lessons[i];
    if (lesson.type === 'treasure') continue;
    const node = document.getElementById(lesson.id);
    if (node && !node.classList.contains('locked')) {
      const progress = getUserProgress(chapterIndex, lesson.id);
      if (progress.status !== 'completed' && !progress.mastered) {
        return { node, chapterIndex };
      }
    }
  }
  // Check next chapter
  for (let c = chapterIndex + 1; c < currentState.chapters.length; c++) {
    const first = findFirstIncompleteNode(c);
    if (first) return first;
  }
  return null;
}

// ============================================================
// COLOR UTILITY
// ============================================================

function darkenColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max((num >> 16) - amt, 0);
  const G = Math.max((num >> 8 & 0x00FF) - amt, 0);
  const B = Math.max((num & 0x0000FF) - amt, 0);
  return `#${(1 << 24 | R << 16 | G << 8 | B).toString(16).slice(1)}`;
}

// ============================================================
// EXPOSE FOR DEBUGGING
// ============================================================

window.__coursePath = {
  state: currentState,
  render: renderLearningPath,
  findFirstIncompleteNode,
  findNextNodeAfterCompletion,
  updateNodeIcon,
  checkTreasureUnlock,
  updatePersistentCard,
};

