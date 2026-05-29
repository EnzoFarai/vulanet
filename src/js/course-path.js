// src/js/course-path.js
import { getCurrentUser, loadUserProgress, updateUserProgress, addXpBoost } from './supabase.js';

// Reward variants (same as in quiz-engine)
const rewardVariants = [
  { type: "coin", amount: 250, title: "You have earned 250 coins!", subtitle: "Spend them wisely", iconClass: "ph-duotone ph-coins", containerClass: "coin-container", buttonText: "Claim 250" },
  { type: "coin", amount: 350, title: "You have earned 350 coins!", subtitle: "Spend them wisely", iconClass: "ph-duotone ph-coins", containerClass: "coin-container", buttonText: "Claim 350" },
  { type: "coin", amount: 500, title: "You have earned 500 coins!", subtitle: "Spend them wisely", iconClass: "ph-duotone ph-coins", containerClass: "coin-container", buttonText: "Claim 500" },
  { type: "xp-boost", multiplier: "1.5", duration: 30, title: "You found an XP Boost!", subtitle: "1.5x XP for 30 minutes", iconClass: "ph-duotone ph-rocket-launch", containerClass: "rocket-container", buttonText: "Claim XP Boost" },
  { type: "xp-boost", multiplier: "2", duration: 20, title: "You found an XP Boost!", subtitle: "2x XP for 20 minutes", iconClass: "ph-duotone ph-rocket-launch", containerClass: "rocket-container", buttonText: "Claim XP Boost" },
  { type: "xp-boost", multiplier: "3", duration: 15, title: "You found an XP Boost!", subtitle: "3x XP for 15 minutes", iconClass: "ph-duotone ph-rocket-launch", containerClass: "rocket-container", buttonText: "Claim XP Boost" },
  { type: "heart", amount: 5, title: "You gained more hearts!", subtitle: "You now have 5 hearts again.", iconClass: "ph-fill ph-heart", containerClass: "hearts-container", buttonText: "Claim hearts" }
];

// Chapter colour cycle (7 colours)
const chapterColors = [
  { bg: "#4285F4", shadow: "#3367D6", light: "#E8F0FE", class: "chapter-1" },
  { bg: "#1CB0F6", shadow: "#0A9DE3", light: "#E8F7FF", class: "chapter-2" },
  { bg: "#AA00FF", shadow: "#8A00D4", light: "#F5E6FF", class: "chapter-3" },
  { bg: "#EA4335", shadow: "#D32F2F", light: "#FCE8E6", class: "chapter-4" },
  { bg: "#FF6D01", shadow: "#E65C00", light: "#FFF3E0", class: "chapter-5" },
  { bg: "#FBBC05", shadow: "#D4A000", light: "#FFF9C4", class: "chapter-6" },
  { bg: "#34A853", shadow: "#288542", light: "#E8F5E9", class: "chapter-7" }
];

export class CoursePath {
  constructor(courseId, containerId) {
    this.courseId = courseId;
    this.container = document.getElementById(containerId);
    if (!this.container) throw new Error(`Container ${containerId} not found`);
    
    this.user = null;
    this.userProgress = null;
    this.courseData = null;
    this.currentActiveNode = null;
    this.currentActiveChapter = null;
    this.startSpeechBubble = null;
    this.isTransitioning = false;
    this.rewardPanel = null;
    this.overlay = null;
    
    this.init();
  }
  
  async init() {
    this.user = await getCurrentUser();
    if (this.user) {
      this.userProgress = await loadUserProgress(this.user.id);
    }
    await this.loadCourseData();
    this.createRewardPanel();
    this.render();
    this.setupStartSpeechBubble();
    this.attachEventListeners();
  }
  
  async loadCourseData() {
    // Fetch course data from a JSON file (you'll create these)
    // Format: { title, chapters: [{ title, lessons: [...] }] }
    try {
      const response = await fetch(`/data/courses/${this.courseId}.json`);
      if (!response.ok) throw new Error('Course data not found');
      this.courseData = await response.json();
    } catch (e) {
      console.error('Failed to load course data', e);
      this.container.innerHTML = '<div class="error">Course data not available.</div>';
    }
  }
  
  createRewardPanel() {
    this.rewardPanel = document.createElement('div');
    this.rewardPanel.id = 'treasure-panel';
    this.rewardPanel.className = 'treasure-panel';
    this.rewardPanel.innerHTML = `
      <div class="reward-scene"><div class="reward-icon-container" id="reward-icon-container"></div></div>
      <div class="reward-title" id="reward-title"></div>
      <div class="reward-subtitle" id="reward-subtitle"></div>
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
    const iconContainer = document.getElementById('reward-icon-container');
    iconContainer.innerHTML = '';
    if (reward.type === 'coin') {
      iconContainer.innerHTML = `<div class="${reward.containerClass}"><i class="${reward.iconClass}" style="font-size:140px;color:#FFD700;"></i></div>`;
    } else if (reward.type === 'xp-boost') {
      iconContainer.innerHTML = `<div class="${reward.containerClass}"><i class="${reward.iconClass}" style="font-size:140px;color:#FF9600;"></i><div class="xp-multiplier">x${reward.multiplier}</div></div>`;
    } else if (reward.type === 'heart') {
      let hearts = '';
      for (let i = 0; i < reward.amount; i++) hearts += `<i class="${reward.iconClass}" style="font-size:80px;color:#FF0000;"></i>`;
      iconContainer.innerHTML = `<div class="${reward.containerClass}">${hearts}</div>`;
    }
    document.getElementById('reward-title').textContent = reward.title;
    document.getElementById('reward-subtitle').textContent = reward.subtitle;
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
  
  setupStartSpeechBubble() {
    this.startSpeechBubble = document.createElement('div');
    this.startSpeechBubble.id = 'start-speech-bubble';
    this.startSpeechBubble.className = 'start-speech-bubble';
    this.startSpeechBubble.innerHTML = '<div class="speech-title">START</div>';
    document.body.appendChild(this.startSpeechBubble);
    // Styles for bubble (simplified – you can move to CSS)
    this.startSpeechBubble.style.position = 'absolute';
    this.startSpeechBubble.style.backgroundColor = 'white';
    this.startSpeechBubble.style.border = '2px solid #E5E5E5';
    this.startSpeechBubble.style.borderRadius = '0.5rem';
    this.startSpeechBubble.style.padding = '0.65rem 1.1rem';
    this.startSpeechBubble.style.width = '95px';
    this.startSpeechBubble.style.height = '58px';
    this.startSpeechBubble.style.display = 'flex';
    this.startSpeechBubble.style.alignItems = 'center';
    this.startSpeechBubble.style.justifyContent = 'center';
    this.startSpeechBubble.style.zIndex = '100';
    this.startSpeechBubble.style.filter = 'drop-shadow(2px 2px 4px rgba(0,0,0,0.1))';
    this.startSpeechBubble.style.visibility = 'hidden';
    this.startSpeechBubble.style.opacity = '0';
    this.startSpeechBubble.style.transition = 'opacity 0.3s ease, visibility 0.3s ease';
    this.startSpeechBubble.querySelector('.speech-title').style.fontWeight = '700';
    this.startSpeechBubble.querySelector('.speech-title').style.color = '#4285F4';
  }
  
  positionStartSpeechBubble(node) {
    const rect = node.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const top = rect.top + scrollTop - 65;
    const left = rect.left + (rect.width / 2);
    this.startSpeechBubble.style.top = `${top}px`;
    this.startSpeechBubble.style.left = `${left}px`;
    this.startSpeechBubble.style.transform = 'translateX(-50%)';
    this.startSpeechBubble.style.visibility = 'visible';
    this.startSpeechBubble.style.opacity = '1';
  }
  
  hideStartSpeechBubble() {
    this.startSpeechBubble.style.visibility = 'hidden';
    this.startSpeechBubble.style.opacity = '0';
  }
  
  render() {
    if (!this.courseData) return;
    this.container.innerHTML = '';
    let chapterIndex = 0;
    for (const chapter of this.courseData.chapters) {
      const color = chapterColors[chapterIndex % chapterColors.length];
      const chapterDiv = this.createChapterElement(chapter, color, chapterIndex);
      this.container.appendChild(chapterDiv);
      chapterIndex++;
    }
    // Add Up Next section
    const upNextDiv = document.createElement('div');
    upNextDiv.className = 'up-next-section';
    upNextDiv.innerHTML = `
      <div class="up-next-container">
        <div class="up-next-card">
          <div class="up-next-badge">UP NEXT</div>
          <h1 class="up-next-title">Unit ${chapterIndex + 1}</h1>
          <p class="up-next-description">Move ahead to the next unit.</p>
          <button class="up-next-button">CONTINUE</button>
        </div>
      </div>
    `;
    this.container.appendChild(upNextDiv);
    
    // Set initial active node
    const firstIncomplete = this.findFirstIncompleteNode();
    if (firstIncomplete) {
      this.setActiveNode(firstIncomplete.node, firstIncomplete.chapterDiv);
    }
  }
  
  createChapterElement(chapter, color, chapterIndex) {
    const chapterDiv = document.createElement('div');
    chapterDiv.className = `chapter-container ${color.class}`;
    chapterDiv.id = `chapter-${chapterIndex}`;
    if (chapterIndex === 0) chapterDiv.style.paddingTop = '110px'; // space for fixed card
    
    // Subtitle
    const subtitleDiv = document.createElement('div');
    subtitleDiv.className = 'subtitle-container';
    subtitleDiv.innerHTML = `<div class="line"></div><div class="subtitle">${chapter.title}</div><div class="line"></div>`;
    chapterDiv.appendChild(subtitleDiv);
    
    // Learning path container
    const pathContainer = document.createElement('div');
    pathContainer.className = 'learning-path-container';
    const pathDiv = document.createElement('div');
    pathDiv.className = 'learning-path';
    pathDiv.id = `learning-path-${chapterIndex}`;
    
    // Build nodes with wave pattern
    let waveState = { direction: "L", position: 0 };
    const positionMap = new Map([[0,0],[-1,-44],[-2,-70],[1,44],[2,70]]);
    
    for (let i = 0; i < chapter.lessons.length; i++) {
      const lesson = chapter.lessons[i];
      const node = this.createNode(lesson, color, positionMap.get(waveState.position));
      pathDiv.appendChild(node);
      waveState = this.updateWaveState(waveState);
    }
    pathContainer.appendChild(pathDiv);
    chapterDiv.appendChild(pathContainer);
    
    // Store reference to nodes for later updates
    chapterDiv.userProgress = {}; // will be loaded from DB
    // For now, load from localStorage mock
    const savedProgress = localStorage.getItem(`course_${this.courseId}_chapter_${chapterIndex}`);
    if (savedProgress) chapterDiv.userProgress = JSON.parse(savedProgress);
    
    return chapterDiv;
  }
  
  updateWaveState(state) {
    let { direction, position } = state;
    if (direction === "L" && position === -2) return { direction: "R", position: -1 };
    if (direction === "R" && position === 2) return { direction: "L", position: 1 };
    return { direction, position: direction === "L" ? position - 1 : position + 1 };
  }
  
  createNode(lesson, color, leftOffset) {
    const node = document.createElement('div');
    node.className = 'path-node';
    if (lesson.type === 'treasure') node.classList.add('treasure');
    else if (lesson.type === 'flag') node.classList.add('flag');
    node.id = lesson.id;
    node.dataset.lessonId = lesson.id;
    node.style.position = 'relative';
    node.style.left = `${leftOffset}px`;
    
    // Icon
    const iconDiv = document.createElement('div');
    iconDiv.className = 'node-icon';
    if (lesson.type === 'treasure') {
      iconDiv.innerHTML = '<i class="ph-duotone ph-treasure-chest" style="font-size:53px;"></i>';
    } else if (lesson.type === 'flag') {
      iconDiv.innerHTML = '<i class="ph-duotone ph-flag-checkered" style="font-size:42px;color:white;"></i>';
    } else {
      iconDiv.innerHTML = '<span class="material-symbols-outlined" style="font-size:32px;">joystick</span>';
    }
    node.appendChild(iconDiv);
    
    // Status from saved progress (default unstarted)
    const status = lesson.userProgress?.status || 'unstarted';
    if (status === 'completed') node.classList.add('completed', `${color.class}-completed`);
    else if (status === 'mastered') node.classList.add('mastered');
    else if (status === 'locked') node.classList.add('locked');
    
    node.addEventListener('click', (e) => this.handleNodeClick(lesson, node, color));
    return node;
  }
  
  handleNodeClick(lesson, node, color) {
    if (this.isTransitioning) return;
    if (lesson.type === 'treasure') {
      if (node.classList.contains('locked')) {
        // Check if all previous lessons completed
        const allPrevCompleted = this.arePreviousLessonsCompleted(lesson);
        if (allPrevCompleted) {
          node.classList.remove('locked');
          node.classList.add('unlocked');
          this.showTreasureReward(lesson, node, color);
        }
      } else if (node.classList.contains('unlocked') && !node.classList.contains('collected')) {
        this.showTreasureReward(lesson, node, color);
      }
      return;
    }
    this.setActiveNode(node, color);
    this.showLessonCard(lesson, node, color);
  }
  
  arePreviousLessonsCompleted(currentLesson) {
    // Find all lessons before this one in the same chapter
    // Implementation depends on structure; simplified for demo
    return true; // In real implementation, check DB
  }
  
  showTreasureReward(lesson, node, color) {
    const randomReward = rewardVariants[Math.floor(Math.random() * rewardVariants.length)];
    this.showRewardPanel(randomReward, async () => {
      node.classList.add('collected');
      if (randomReward.type === 'coin') {
        if (this.userProgress) {
          this.userProgress.coins += randomReward.amount;
          await updateUserProgress(this.user.id, { coins: this.userProgress.coins });
        }
      } else if (randomReward.type === 'xp-boost') {
        if (this.user) await addXpBoost(this.user.id, parseFloat(randomReward.multiplier), randomReward.duration);
      } else if (randomReward.type === 'heart') {
        if (this.userProgress) {
          this.userProgress.hearts = Math.min(5, this.userProgress.hearts + randomReward.amount);
          await updateUserProgress(this.user.id, { hearts: this.userProgress.hearts });
        }
      }
      // After claiming, find next node
      const nextNode = this.findNextNode(lesson);
      if (nextNode) this.setActiveNode(nextNode.node, nextNode.color);
    });
  }
  
  findFirstIncompleteNode() {
    // Iterate over chapters and nodes to find first that is not completed/mastered
    return null; // placeholder
  }
  
  setActiveNode(node, color) {
    // Remove active class from all nodes
    document.querySelectorAll('.path-node').forEach(n => n.classList.remove('active'));
    node.classList.add('active');
    this.currentActiveNode = node;
    this.positionStartSpeechBubble(node);
  }
  
  showLessonCard(lesson, node, color) {
    // Create floating card with lesson actions (Start, Review, Master)
    // This is a simplified version – full implementation would replicate the existing lesson card from your learning path HTML
    alert(`Start lesson: ${lesson.title}`);
  }
  
  findNextNode(currentLesson) {
    // Logic to find next incomplete node
    return null;
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
