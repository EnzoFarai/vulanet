// src/js/course-path.js
// Full learning path engine – renders nodes, lesson cards, treasure, start bubble.
// Uses only local assets (SVG icons). No CDN fonts or icons.

export function renderLearningPath(config) {
    const chapters = config.chapters;
    const containerId = config.containerId;
    const courseId = config.courseId;
    const onLessonStart = config.onLessonStart;
    const onNotebookClick = config.onNotebookClick; // new callback for notebook icon

    const container = document.getElementById(containerId);
    if (!container) {
        console.error('Container not found:', containerId);
        return;
    }

    // DOM refs (expect these to exist in the page)
    const persistentCard = document.getElementById('persistent-learning-card');
    const progressBar = document.getElementById('persistent-progress-bar');
    const startBubble = document.getElementById('start-speech-bubble');
    const treasurePanel = document.getElementById('treasure-panel');
    const overlay = document.getElementById('overlay');
    const claimBtn = document.getElementById('claim-button');
    const rewardIconContainer = document.getElementById('reward-icon-container');
    const rewardTitle = document.getElementById('reward-title');
    const rewardSubtitle = document.getElementById('reward-subtitle');

    // State
    let currentActiveNode = null;
    let currentActiveChapter = chapters[0];
    let isTransitioning = false;
    let lastScrollTop = 0;
    let scrollTimeout = null;

    // Reward variants (using local SVGs)
    const rewardVariants = [
        { type: 'coin', amount: 250, title: 'You have earned 250 coins!', subtitle: 'Spend them wisely', icon: '/assets/icons/phosphor/duotone/coins.svg', buttonText: 'Claim 250' },
        { type: 'coin', amount: 350, title: 'You have earned 350 coins!', subtitle: 'Spend them wisely', icon: '/assets/icons/phosphor/duotone/coins.svg', buttonText: 'Claim 350' },
        { type: 'coin', amount: 500, title: 'You have earned 500 coins!', subtitle: 'Spend them wisely', icon: '/assets/icons/phosphor/duotone/coins.svg', buttonText: 'Claim 500' },
        { type: 'xp-boost', multiplier: 1.5, dur: 30, title: 'You found an XP Boost!', subtitle: '1.5x XP for 30 minutes', icon: '/assets/icons/phosphor/duotone/rocket-launch.svg', buttonText: 'Claim XP Boost' },
        { type: 'xp-boost', multiplier: 2, dur: 20, title: 'You found an XP Boost!', subtitle: '2x XP for 20 minutes', icon: '/assets/icons/phosphor/duotone/rocket-launch.svg', buttonText: 'Claim XP Boost' },
        { type: 'xp-boost', multiplier: 3, dur: 15, title: 'You found an XP Boost!', subtitle: '3x XP for 15 minutes', icon: '/assets/icons/phosphor/duotone/rocket-launch.svg', buttonText: 'Claim XP Boost' },
        { type: 'heart', amount: 5, title: 'You gained more hearts!', subtitle: 'You now have 5 hearts again.', icon: '/assets/icons/phosphor/fill/heart.svg', buttonText: 'Claim hearts' }
    ];

    // Position map for wave offsets
    const posMap = {
        '-2': -70,
        '-1': -44,
        '0': 0,
        '1': 44,
        '2': 70
    };

    function getRandomReward(chapter) {
        if (chapter.currentTreasureReward) return chapter.currentTreasureReward;
        const idx = Math.floor(Math.random() * rewardVariants.length);
        chapter.currentTreasureReward = rewardVariants[idx];
        return chapter.currentTreasureReward;
    }

    function createRewardDisplay(reward) {
        const container = document.createElement('div');
        container.className = 'reward-icon-container';
        const img = document.createElement('img');
        img.src = reward.icon;
        img.alt = reward.type;
        if (reward.type === 'coin') {
            img.style.width = '140px';
            img.style.height = '140px';
            img.style.filter = 'drop-shadow(0 4px 8px rgba(255,215,0,0.3))';
        } else if (reward.type === 'xp-boost') {
            img.style.width = '140px';
            img.style.height = '140px';
            img.style.filter = 'drop-shadow(0 4px 8px rgba(255,150,0,0.3))';
            const mult = document.createElement('div');
            mult.className = 'xp-multiplier';
            mult.textContent = `x${reward.multiplier}`;
            container.appendChild(img);
            container.appendChild(mult);
            return container;
        } else if (reward.type === 'heart') {
            const wrapper = document.createElement('div');
            wrapper.className = 'hearts-container';
            for (let i = 0; i < 5; i++) {
                const h = document.createElement('img');
                h.src = '/assets/icons/phosphor/fill/heart.svg';
                h.style.width = '80px';
                h.style.height = '80px';
                h.style.filter = 'brightness(0) saturate(100%) invert(33%) sepia(98%) saturate(1748%) hue-rotate(330deg) brightness(97%) contrast(94%)';
                wrapper.appendChild(h);
            }
            return wrapper;
        }
        container.appendChild(img);
        return container;
    }

    function updateRewardDisplay(reward) {
        rewardIconContainer.innerHTML = '';
        const content = createRewardDisplay(reward);
        rewardIconContainer.appendChild(content);
        rewardTitle.textContent = reward.title;
        rewardSubtitle.textContent = reward.subtitle;
        claimBtn.textContent = reward.buttonText;
    }

    function getNodeIconSVG(lessonType, isCompleted, isMastered) {
        if (isMastered) {
            return '<img src="/assets/icons/material-symbols/outline/joystick.svg" alt="Joystick" style="width:32px;height:32px;filter:brightness(0) saturate(100%) invert(100%);">';
        } else if (isCompleted) {
            return '<img src="/assets/icons/material-symbols/outline/assignment_turned_in.svg" alt="Done" style="width:32px;height:32px;filter:brightness(0) saturate(100%) invert(100%);">';
        } else {
            return '<img src="/assets/icons/material-symbols/outline/joystick.svg" alt="Joystick" style="width:32px;height:32px;filter:brightness(0) saturate(100%) invert(100%);">';
        }
    }

    function getTreasureFilter(status) {
        if (status === 'unlocked' || status === 'collected') {
            return 'filter: brightness(0) saturate(100%) invert(77%) sepia(89%) saturate(1234%) hue-rotate(358deg) brightness(103%) contrast(101%);';
        } else {
            return 'filter: brightness(0) saturate(100%) invert(63%) sepia(0%) saturate(0%) hue-rotate(180deg) brightness(88%) contrast(85%);';
        }
    }

    function getWavePositions(length) {
        const positions = [];
        let dir = 'L';
        let pos = 0;
        for (let i = 0; i < length; i++) {
            positions.push(pos);
            if (dir === 'L' && pos === -2) {
                dir = 'R';
                pos = -1;
            } else if (dir === 'R' && pos === 2) {
                dir = 'L';
                pos = 1;
            } else {
                pos += (dir === 'L') ? -1 : 1;
            }
        }
        return positions;
    }

    function createNode(chapter, lesson, wavePos) {
        const isTreasure = lesson.type === 'treasure';
        const isFlag = lesson.type === 'flag';
        const pos = posMap[wavePos] || 0;
        const progress = chapter.userProgress[lesson.id] || {};
        let classes = 'path-node';
        let iconHTML = '';

        if (isTreasure) {
            classes += ` treasure ${progress.status || 'locked'}`;
            const filter = getTreasureFilter(progress.status);
            iconHTML = `<img src="/assets/icons/phosphor/duotone/treasure-chest.svg" alt="Chest" style="width:53px;height:53px;${filter}">`;
        } else if (isFlag) {
            classes += ' flag';
            if (progress.mastered) classes += ' mastered';
            if (progress.status === 'completed' || progress.mastered) classes += ' completed';
            iconHTML = `<img src="/assets/icons/phosphor/duotone/flag-checkered.svg" alt="Review" style="width:32px;height:32px;filter:brightness(0) saturate(100%) invert(100%);">`;
        } else {
            const isCompleted = progress.status === 'completed' || (lesson.totalSublessons > 1 && progress.sublessonCompleted && progress.sublessonCompleted.every(c => c));
            const isMastered = progress.mastered || false;
            if (isMastered) {
                classes += ' mastered';
            } else if (isCompleted) {
                classes += ' completed ' + chapter.completedColorClass;
            } else {
                classes += ' unstarted';
            }
            iconHTML = getNodeIconSVG('joystick', isCompleted, isMastered);
        }

        const pulseClass = (isTreasure && progress.status === 'unlocked') ? ' treasure-unlocked' : '';
        return `<div class="${classes}${pulseClass}" id="${lesson.id}" data-lesson="${lesson.id}" style="position:relative;left:${pos}px;">
            <div class="node-icon">${iconHTML}</div>
        </div>`;
    }

    function renderChapter(chapter) {
        const pathEl = document.getElementById(chapter.learningPathId);
        if (!pathEl) return;
        const positions = getWavePositions(chapter.lessons.length);
        let html = '<div class="path-group">';
        chapter.lessons.forEach((lesson, index) => {
            html += createNode(chapter, lesson, positions[index]);
        });
        html += '</div>';
        pathEl.innerHTML = html;

        pathEl.querySelectorAll('.path-node').forEach(node => {
            node.addEventListener('click', e => handleNodeClick(chapter, e));
        });

        const nodes = pathEl.querySelectorAll('.path-node:not(.treasure)');
        if (nodes.length > 0) {
            chapter.firstNode = nodes[0];
            chapter.lastNode = nodes[nodes.length - 1];
        }
        updateProgress(chapter);
    }

    function handleNodeClick(chapter, e) {
        if (isTransitioning) return;
        const node = e.currentTarget;
        const lessonId = node.dataset.lesson;
        const lesson = chapter.lessons.find(l => l.id === lessonId);
        if (!lesson) return;

        if (lesson.type === 'treasure') {
            const progress = chapter.userProgress[lessonId];
            if (progress.status === 'locked') {
                const idx = chapter.lessons.indexOf(lesson);
                const preceding = chapter.lessons.slice(0, idx);
                const allDone = preceding.every(l => {
                    if (l.type === 'treasure') return true;
                    const p = chapter.userProgress[l.id];
                    return p.status === 'completed' || p.mastered;
                });
                if (!allDone) return;
                progress.status = 'unlocked';
                node.classList.remove('locked');
                node.classList.add('unlocked');
                const img = node.querySelector('img');
                if (img) {
                    img.style.filter = 'brightness(0) saturate(100%) invert(77%) sepia(89%) saturate(1234%) hue-rotate(358deg) brightness(103%) contrast(101%)';
                }
                setTimeout(() => {
                    setActiveNode(node, chapter);
                    showTreasure(chapter, node);
                }, 300);
                return;
            } else if (progress.status === 'unlocked' || progress.status === 'collected') {
                if (progress.status !== 'collected') {
                    showTreasure(chapter, node);
                }
                return;
            }
            return;
        }

        setActiveNode(node, chapter);
        showLessonCard(chapter, lesson);
    }

    function setActiveNode(node, chapter) {
        document.querySelectorAll('.path-node.active').forEach(n => n.classList.remove('active'));
        node.classList.add('active');
        currentActiveNode = node;
        currentActiveChapter = chapter;

        positionStartBubble(node);
        const lessonId = node.dataset.lesson;
        const progress = chapter.userProgress[lessonId] || {};
        const titleEl = startBubble.querySelector('.speech-title');
        if (progress.mastered) {
            titleEl.style.color = '#F4B400';
        } else if (progress.status === 'completed') {
            const colors = ['#4285F4','#1CB0F6','#AA00FF','#EA4335','#FF6D01','#FBBC05','#34A853'];
            titleEl.style.color = colors[(chapter.number-1) % colors.length];
        } else {
            titleEl.style.color = '#4285F4';
        }
        startBubble.classList.add('visible');
    }

    function positionStartBubble(node) {
        const rect = node.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        // START bubble width restored to 95px (match CSS)
        const top = rect.top + scrollTop - 70;
        const left = rect.left + rect.width/2;
        startBubble.style.top = top + 'px';
        startBubble.style.left = left + 'px';
        startBubble.style.transform = 'translateX(-50%)';
    }

    function showLessonCard(chapter, lesson) {
        if (isTransitioning) return;
        isTransitioning = true;
        if (chapter.currentLessonCard) {
            chapter.currentLessonCard.classList.remove('active');
            setTimeout(() => {
                if (chapter.currentLessonCard && chapter.currentLessonCard.parentNode) {
                    chapter.currentLessonCard.parentNode.removeChild(chapter.currentLessonCard);
                }
                chapter.currentLessonCard = null;
                createLessonCard(chapter, lesson);
            }, 300);
        } else {
            createLessonCard(chapter, lesson);
        }
    }

    function createLessonCard(chapter, lesson) {
        const card = document.createElement('div');
        card.className = 'lesson-card';
        const progress = chapter.userProgress[lesson.id] || {};
        const isMastered = progress.mastered || false;
        const isCompleted = progress.status === 'completed' || (lesson.totalSublessons > 1 && progress.sublessonCompleted && progress.sublessonCompleted.every(c => c));

        if (isMastered) {
            card.classList.add('mastered');
        } else if (isCompleted && !isMastered) {
            card.classList.add(chapter.reviewCardClass);
            card.style.setProperty('--bbColor', chapter.nodeColor);
            card.style.setProperty('--bbBorderColor', chapter.nodeShadowColor);
        } else {
            card.style.setProperty('--bbColor', '#4285F4');
            card.style.setProperty('--bbBorderColor', '#3367D6');
        }

        const header = document.createElement('div');
        header.className = 'lesson-header';
        const title = document.createElement('h2');
        title.className = 'lesson-title';
        title.textContent = lesson.title;
        header.appendChild(title);

        const actions = document.createElement('div');
        actions.className = 'lesson-actions';

        if (lesson.totalSublessons > 1) {
            const subProg = document.createElement('div');
            subProg.className = 'sublesson-progress';
            for (let i = 1; i <= lesson.totalSublessons; i++) {
                const item = document.createElement('div');
                item.className = 'sublesson-item';
                const circle = document.createElement('div');
                circle.className = 'sublesson-circle';
                circle.textContent = i;
                if (i === chapter.selectedSublesson) circle.classList.add('active');
                if (progress.sublessonCompleted && progress.sublessonCompleted[i-1]) circle.classList.add('completed');
                if (progress.sublessonMastered && progress.sublessonMastered[i-1]) {
                    circle.classList.remove('completed');
                    circle.classList.add('mastered');
                }
                const label = document.createElement('div');
                label.className = 'sublesson-label';
                label.textContent = `Lesson ${i}`;
                item.appendChild(circle);
                item.appendChild(label);
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    chapter.selectedSublesson = i;
                    showLessonCard(chapter, lesson);
                });
                subProg.appendChild(item);
            }
            actions.appendChild(subProg);
        }

        const info = document.createElement('div');
        info.className = 'lesson-info';
        if (lesson.type === 'flag') {
            info.textContent = 'Final Review';
        } else {
            info.textContent = lesson.totalSublessons > 1 ? `Lesson ${chapter.selectedSublesson} of ${lesson.totalSublessons}` : 'Lesson 1 of 1';
        }
        actions.appendChild(info);

        function makeButton(text, className, badge, callback) {
            const btn = document.createElement('button');
            btn.className = `btn ${className}`;
            btn.innerHTML = badge ? `${text} <span class="xp-badge">${badge}</span>` : text;
            btn.onclick = callback;
            return btn;
        }

        if (lesson.type === 'flag') {
            if (isMastered) {
                actions.appendChild(makeButton('Review', 'btn-chapter-review-mastered', '+25 XP', () => startLesson(chapter, lesson.id)));
            } else if (isCompleted) {
                actions.appendChild(makeButton('Review', 'btn-chapter-review', '+25 XP', () => startLesson(chapter, lesson.id)));
                actions.appendChild(makeButton('Master', 'btn-master', '+100 XP', () => masterLesson(chapter, lesson.id)));
            } else {
                actions.appendChild(makeButton('Begin', 'btn-chapter-review', '+50 XP', () => startLesson(chapter, lesson.id)));
            }
        } else {
            if (isMastered) {
                actions.appendChild(makeButton('Review', 'btn-review-mastered', '+5 XP', () => startLesson(chapter, lesson.id)));
            } else if (lesson.totalSublessons > 1 && progress.sublessonMastered && progress.sublessonMastered[chapter.selectedSublesson-1]) {
                actions.appendChild(makeButton('Review', 'btn-review-mastered', '+5 XP', () => startSubLesson(chapter, lesson.id, chapter.selectedSublesson)));
                if (!progress.sublessonMastered.every(m => m)) {
                    actions.appendChild(makeButton('Master', 'btn-master', '+40 XP', () => masterSubLesson(chapter, lesson.id, chapter.selectedSublesson)));
                }
            } else if (isCompleted || (lesson.totalSublessons > 1 && progress.sublessonCompleted && progress.sublessonCompleted[chapter.selectedSublesson-1])) {
                actions.appendChild(makeButton('Review', chapter.reviewBtnClass, '+5 XP', () => startSubLesson(chapter, lesson.id, chapter.selectedSublesson)));
                actions.appendChild(makeButton('Master', 'btn-master', '+40 XP', () => masterSubLesson(chapter, lesson.id, chapter.selectedSublesson)));
            } else {
                actions.appendChild(makeButton('START', 'btn-primary', '+10 XP', () => startSubLesson(chapter, lesson.id, chapter.selectedSublesson)));
            }
        }

        card.appendChild(header);
        card.appendChild(actions);
        const pathEl = document.getElementById(chapter.learningPathId);
        pathEl.appendChild(card);
        chapter.currentLessonCard = card;
        positionLessonCard(chapter);
        setTimeout(() => {
            card.classList.add('active');
            isTransitioning = false;
        }, 50);
    }

    function positionLessonCard(chapter) {
        if (!currentActiveNode || !chapter.currentLessonCard) return;
        const rect = currentActiveNode.getBoundingClientRect();
        const pathEl = document.getElementById(chapter.learningPathId);
        const containerRect = pathEl.getBoundingClientRect();
        const top = rect.top - containerRect.top + rect.height + 22;
        const left = rect.left - containerRect.left + rect.width/2;
        chapter.currentLessonCard.style.top = top + 'px';
        chapter.currentLessonCard.style.left = left + 'px';
        chapter.currentLessonCard.style.transform = 'translateX(-50%)';
    }

    function closeLessonCard(chapter) {
        if (chapter.currentLessonCard) {
            chapter.currentLessonCard.classList.remove('active');
            setTimeout(() => {
                if (chapter.currentLessonCard && chapter.currentLessonCard.parentNode) {
                    chapter.currentLessonCard.parentNode.removeChild(chapter.currentLessonCard);
                }
                chapter.currentLessonCard = null;
                isTransitioning = false;
            }, 300);
        }
    }

    function startLesson(chapter, lessonId) {
        const lesson = chapter.lessons.find(l => l.id === lessonId);
        if (!lesson) return;
        window.location.href = `/pages/lesson.html?course=${courseId}&lesson=${lessonId}`;
    }

    function startSubLesson(chapter, lessonId, subNum) {
        startLesson(chapter, lessonId);
    }

    function masterLesson(chapter, lessonId) {
        const node = document.getElementById(lessonId);
        if (!node) return;
        const progress = chapter.userProgress[lessonId];
        if (!progress) return;
        progress.mastered = true;
        node.classList.remove('completed', 'unstarted');
        node.classList.add('mastered');
        node.classList.remove(chapter.completedColorClass);
        updateNodeIcon(chapter, lessonId);
        if (chapter.currentLessonCard) {
            closeLessonCard(chapter);
            const lesson = chapter.lessons.find(l => l.id === lessonId);
            setTimeout(() => showLessonCard(chapter, lesson), 400);
        }
        updateProgress(chapter);
        checkTreasureUnlock(chapter);
    }

    function masterSubLesson(chapter, lessonId, subNum) {
        const node = document.getElementById(lessonId);
        if (!node) return;
        const progress = chapter.userProgress[lessonId];
        if (!progress) return;
        if (!progress.sublessonMastered) progress.sublessonMastered = [];
        progress.sublessonMastered[subNum-1] = true;
        if (progress.sublessonMastered.every(m => m)) {
            progress.mastered = true;
            node.classList.remove('completed', 'unstarted');
            node.classList.add('mastered');
            node.classList.remove(chapter.completedColorClass);
        }
        updateNodeIcon(chapter, lessonId);
        if (chapter.currentLessonCard) {
            closeLessonCard(chapter);
            const lesson = chapter.lessons.find(l => l.id === lessonId);
            setTimeout(() => showLessonCard(chapter, lesson), 400);
        }
        updateProgress(chapter);
        checkTreasureUnlock(chapter);
    }

    function showTreasure(chapter, node) {
        const reward = getRandomReward(chapter);
        updateRewardDisplay(reward);
        treasurePanel.classList.add('active');
        overlay.classList.add('active');
        chapter.activeTreasureNode = node;
    }

    function collectTreasure() {
        if (currentChapter && currentChapter.activeTreasureNode) {
            const node = currentChapter.activeTreasureNode;
            const progress = currentChapter.userProgress[node.dataset.lesson];
            if (progress && progress.status !== 'collected') {
                progress.status = 'collected';
                node.classList.remove('unlocked');
                node.classList.add('collected');
                const img = node.querySelector('img');
                if (img) {
                    img.style.filter = 'brightness(0) saturate(100%) invert(77%) sepia(89%) saturate(1234%) hue-rotate(358deg) brightness(103%) contrast(101%)';
                }
                treasurePanel.classList.remove('active');
                overlay.classList.remove('active');
                currentChapter.currentTreasureReward = null;
                const next = findNextNodeAfterCompletion(node.dataset.lesson, currentChapter);
                if (next) {
                    setActiveNode(next.node, next.chapter);
                } else {
                    setActiveNode(node, currentChapter);
                }
            }
        }
    }

    function checkTreasureUnlock(chapter) {
        chapter.lessons.forEach((lesson, idx) => {
            if (lesson.type === 'treasure') {
                const node = document.getElementById(lesson.id);
                if (!node) return;
                const progress = chapter.userProgress[lesson.id];
                if (progress.status === 'locked') {
                    const preceding = chapter.lessons.slice(0, idx);
                    const allDone = preceding.every(l => {
                        if (l.type === 'treasure') return true;
                        const p = chapter.userProgress[l.id];
                        return p.status === 'completed' || p.mastered;
                    });
                    if (allDone) {
                        progress.status = 'unlocked';
                        node.classList.remove('locked');
                        node.classList.add('unlocked');
                        const img = node.querySelector('img');
                        if (img) {
                            img.style.filter = 'brightness(0) saturate(100%) invert(77%) sepia(89%) saturate(1234%) hue-rotate(358deg) brightness(103%) contrast(101%)';
                        }
                        setTimeout(() => {
                            setActiveNode(node, chapter);
                            showTreasure(chapter, node);
                        }, 500);
                    }
                }
            }
        });
    }

    function updateNodeIcon(chapter, lessonId) {
        const node = document.getElementById(lessonId);
        if (!node) return;
        const lesson = chapter.lessons.find(l => l.id === lessonId);
        if (!lesson || lesson.type === 'treasure' || lesson.type === 'flag') return;
        const progress = chapter.userProgress[lessonId];
        if (!progress) return;
        const icon = node.querySelector('.node-icon');
        if (!icon) return;
        const isCompleted = progress.status === 'completed' || (lesson.totalSublessons > 1 && progress.sublessonCompleted && progress.sublessonCompleted.every(c => c));
        const isMastered = progress.mastered || false;
        if (isMastered) {
            icon.innerHTML = '<img src="/assets/icons/material-symbols/outline/joystick.svg" alt="Joystick" style="width:32px;height:32px;filter:brightness(0) saturate(100%) invert(100%);">';
            node.classList.remove('completed', 'unstarted', chapter.completedColorClass);
            node.classList.add('mastered');
        } else if (isCompleted) {
            icon.innerHTML = '<img src="/assets/icons/material-symbols/outline/assignment_turned_in.svg" alt="Done" style="width:32px;height:32px;filter:brightness(0) saturate(100%) invert(100%);">';
            node.classList.remove('mastered', 'unstarted');
            node.classList.add('completed', chapter.completedColorClass);
        } else {
            icon.innerHTML = '<img src="/assets/icons/material-symbols/outline/joystick.svg" alt="Joystick" style="width:32px;height:32px;filter:brightness(0) saturate(100%) invert(100%);">';
            node.classList.remove('completed', 'mastered', chapter.completedColorClass);
            node.classList.add('unstarted');
        }
    }

    function findFirstIncompleteNode(chapter) {
        for (let i = 0; i < chapter.lessons.length; i++) {
            const lesson = chapter.lessons[i];
            if (lesson.type === 'treasure') continue;
            const node = document.getElementById(lesson.id);
            if (!node) continue;
            const progress = chapter.userProgress[lesson.id];
            if (!progress) continue;
            if (progress.mastered) continue;
            if (progress.status === 'completed') continue;
            if (lesson.totalSublessons > 1 && progress.sublessonCompleted && progress.sublessonCompleted.every(c => c)) continue;
            return { node, chapter };
        }
        return null;
    }

    function findNextNodeAfterCompletion(completedId, chapter) {
        const idx = chapter.lessons.findIndex(l => l.id === completedId);
        for (let i = idx+1; i < chapter.lessons.length; i++) {
            const lesson = chapter.lessons[i];
            if (lesson.type === 'treasure') continue;
            const node = document.getElementById(lesson.id);
            if (!node) continue;
            const progress = chapter.userProgress[lesson.id];
            if (!progress) continue;
            if (progress.mastered) continue;
            if (progress.status === 'completed') continue;
            if (lesson.totalSublessons > 1 && progress.sublessonCompleted && progress.sublessonCompleted.every(c => c)) continue;
            return { node, chapter };
        }
        const ci = chapters.indexOf(chapter);
        if (ci < chapters.length - 1) {
            const nextCh = chapters[ci+1];
            const first = findFirstIncompleteNode(nextCh);
            if (first) return first;
        }
        return null;
    }

    function updateProgress(chapter) {
        const total = chapter.lessons.filter(l => l.type !== 'treasure').length;
        let done = 0;
        chapter.lessons.forEach(l => {
            if (l.type === 'treasure') return;
            const p = chapter.userProgress[l.id];
            if (!p) return;
            if (p.mastered) { done++; return; }
            if (p.status === 'completed') { done++; return; }
            if (l.totalSublessons > 1 && p.sublessonCompleted && p.sublessonCompleted.every(c => c)) {
                done++;
            }
        });
        const pct = total > 0 ? (done / total) * 100 : 0;
        if (progressBar) {
            progressBar.style.width = Math.min(pct, 100) + '%';
        }
    }

    function updatePersistentCard() {
        const cardRect = persistentCard.getBoundingClientRect();
        const cardBottom = cardRect.bottom + window.pageYOffset;
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const dir = scrollTop > lastScrollTop ? 'down' : 'up';
        lastScrollTop = scrollTop;

        let visibleChapter = chapters[0];
        for (let i = 0; i < chapters.length; i++) {
            const ch = chapters[i];
            const el = document.getElementById(ch.id);
            if (!el) continue;
            const rect = el.getBoundingClientRect();
            const top = rect.top + scrollTop;
            const bottom = rect.bottom + scrollTop;
            if (top < cardBottom + 100 && bottom > cardBottom) {
                visibleChapter = ch;
                break;
            }
            if (dir === 'up' && i > 0) {
                const prev = chapters[i-1];
                const prevEl = document.getElementById(prev.id);
                if (prevEl) {
                    const prevBottom = prevEl.getBoundingClientRect().bottom + scrollTop;
                    if (scrollTop < prevBottom - 50 && scrollTop > top - 100) {
                        visibleChapter = prev;
                        break;
                    }
                }
            }
        }
        if (currentActiveChapter !== visibleChapter) {
            currentActiveChapter = visibleChapter;
            updateCardAppearance(visibleChapter);
        }
    }

    function updateCardAppearance(chapter) {
        persistentCard.className = 'learning-card ' + chapter.colorClass;
        const titleEl = persistentCard.querySelector('.title');
        if (titleEl) titleEl.textContent = `Chapter ${chapter.number}`;
        updateProgress(chapter);
    }

    // Set unit title
    const unitTitle = config.unitTitle || 'UNIT 1';
    const sectionEl = persistentCard.querySelector('.section');
    if (sectionEl) sectionEl.textContent = unitTitle;

    // Notebook icon click handler (white filter applied in CSS)
    const notebookIcon = document.querySelector('#persistent-learning-card .icon-container');
    if (notebookIcon) {
        notebookIcon.addEventListener('click', () => {
            if (onNotebookClick) {
                onNotebookClick(courseId);
            } else {
                // Default: go to reading TOC
                window.location.href = `/read/${courseId}.html`;
            }
        });
    }

    // Initialize progress for each chapter
    chapters.forEach(ch => {
        ch.lessons.forEach(lesson => {
            if (!ch.userProgress[lesson.id]) {
                ch.userProgress[lesson.id] = {
                    status: lesson.type === 'treasure' ? 'locked' : 'unstarted',
                    mastered: false,
                    completedSublessons: 0,
                    totalSublessons: lesson.totalSublessons || 1,
                    sublessonCompleted: Array(lesson.totalSublessons || 1).fill(false),
                    sublessonMastered: Array(lesson.totalSublessons || 1).fill(false)
                };
            }
        });
        renderChapter(ch);
    });

    // Set initial active node
    const first = findFirstIncompleteNode(chapters[0]);
    if (first) {
        setActiveNode(first.node, first.chapter);
    } else if (chapters.length > 1) {
        const second = findFirstIncompleteNode(chapters[1]);
        if (second) setActiveNode(second.node, second.chapter);
    }

    updateCardAppearance(chapters[0]);

    // Event listeners
    claimBtn.addEventListener('click', collectTreasure);
    overlay.addEventListener('click', () => {
        treasurePanel.classList.remove('active');
        overlay.classList.remove('active');
    });

    window.addEventListener('scroll', () => {
        if (scrollTimeout) clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            requestAnimationFrame(updatePersistentCard);
        }, 50);
    });

    window.addEventListener('resize', () => {
        chapters.forEach(ch => {
            if (ch.currentLessonCard) positionLessonCard(ch);
        });
        if (currentActiveNode) positionStartBubble(currentActiveNode);
        updatePersistentCard();
    });

    document.addEventListener('click', (e) => {
        if (isTransitioning) return;
        chapters.forEach(ch => {
            if (ch.currentLessonCard && !ch.currentLessonCard.contains(e.target) && !e.target.closest('.path-node')) {
                closeLessonCard(ch);
            }
        });
    });

    // Up Next button
    const upNextBtn = document.querySelector('.up-next-button');
    if (upNextBtn) {
        upNextBtn.addEventListener('click', () => {
            alert('Moving to next unit!');
        });
    }

    console.log('Learning path initialized.');
}
