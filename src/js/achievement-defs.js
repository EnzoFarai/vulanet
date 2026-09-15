// src/js/achievement-defs.js
/**
 * Single source of truth for all achievements.
 * Each entry includes:
 *   id, title, icon (Material Symbol name), color,
 *   levels: array of thresholds, maxLevel,
 *   messageTemplate: function(currentLevel) => string
 *   shareMessageTemplate: function(currentLevel) => string
 *   rewardCoins: function(level) => number
 */
export const ACHIEVEMENT_DEFS = {
  xppowerhouse: {
    id: 'xppowerhouse',
    title: 'XP Powerhouse',
    icon: 'exercise',
    color: '#2563eb',
    levels: [100, 250, 500, 1000, 2500, 5000, 7500, 10000, 20000, 30000],
    maxLevel: 10,
    messageTemplate: (level) => `You earned XP Powerhouse by gaining ${ACHIEVEMENT_DEFS.xppowerhouse.levels[level-1]} XP!`,
    shareMessageTemplate: (level) => `I earned XP Powerhouse by gaining ${ACHIEVEMENT_DEFS.xppowerhouse.levels[level-1]} XP!`,
    rewardCoins: (level) => 50 * level
  },
  perfectweek: {
    id: 'perfectweek',
    title: 'Perfect Week',
    icon: 'date_range',
    color: '#db2777',
    levels: [1],
    maxLevel: 1,
    messageTemplate: () => 'You earned Perfect Week by maintaining a 7‑day streak without Streak Revival!',
    shareMessageTemplate: () => 'I earned Perfect Week by maintaining a 7‑day streak without Streak Revival!',
    rewardCoins: () => 500
  },
  wordsmith: {
    id: 'wordsmith',
    title: 'Wordsmith',
    icon: 'dictionary',
    color: '#ea580c',
    levels: [50, 100, 175, 250, 350, 500, 750, 1000, 1500, 2000],
    maxLevel: 10,
    messageTemplate: (level) => `You earned Wordsmith by discovering ${ACHIEVEMENT_DEFS.wordsmith.levels[level-1]} glossary terms!`,
    shareMessageTemplate: (level) => `I earned Wordsmith by discovering ${ACHIEVEMENT_DEFS.wordsmith.levels[level-1]} glossary terms!`,
    rewardCoins: (level) => 30 * level
  },
  sharpshooter: {
    id: 'sharpshooter',
    title: 'Sharpshooter',
    icon: 'my_location',
    color: '#16a34a',
    levels: [1, 5, 20, 50, 100],
    maxLevel: 5,
    messageTemplate: (level) => `You earned Sharpshooter by completing ${ACHIEVEMENT_DEFS.sharpshooter.levels[level-1]} perfect lessons!`,
    shareMessageTemplate: (level) => `I earned Sharpshooter by completing ${ACHIEVEMENT_DEFS.sharpshooter.levels[level-1]} perfect lessons!`,
    rewardCoins: (level) => 40 * level
  },
  speedfreak: {
    id: 'speedfreak',
    title: 'Speed Freak',
    icon: 'sprint',
    color: '#eab308',
    levels: [40, 120, 500, 1000, 5000],
    maxLevel: 5,
    messageTemplate: (level) => `You earned Speed Freak by gaining ${ACHIEVEMENT_DEFS.speedfreak.levels[level-1]} XP from time challenges!`,
    shareMessageTemplate: (level) => `I earned Speed Freak by gaining ${ACHIEVEMENT_DEFS.speedfreak.levels[level-1]} XP from time challenges!`,
    rewardCoins: (level) => 35 * level
  },
  nightowl: {
    id: 'nightowl',
    title: 'Night Owl',
    icon: 'owl',
    color: '#4279b7',
    levels: [3, 10, 20, 30, 40, 50, 75, 100, 150, 200],
    maxLevel: 10,
    messageTemplate: (level) => `You earned Night Owl by completing ${ACHIEVEMENT_DEFS.nightowl.levels[level-1]} lessons between 12:00am–3:00am!`,
    shareMessageTemplate: (level) => `I earned Night Owl by completing ${ACHIEVEMENT_DEFS.nightowl.levels[level-1]} lessons between 12:00am–3:00am!`,
    rewardCoins: (level) => 25 * level
  },
  earlybird: {
    id: 'earlybird',
    title: 'Early Bird',
    icon: 'coffee',
    color: '#d946ef',
    levels: [3, 10, 20, 30, 40, 50, 75, 100, 150, 200],
    maxLevel: 10,
    messageTemplate: (level) => `You earned Early Bird by completing ${ACHIEVEMENT_DEFS.earlybird.levels[level-1]} lessons between 6:00am–9:00am!`,
    shareMessageTemplate: (level) => `I earned Early Bird by completing ${ACHIEVEMENT_DEFS.earlybird.levels[level-1]} lessons between 6:00am–9:00am!`,
    rewardCoins: (level) => 25 * level
  },
  goldenhands: {
    id: 'goldenhands',
    title: 'Golden Hands',
    icon: 'flag_circle',
    color: '#ec7e14',
    levels: [1, 5, 10, 25, 50, 75, 100, 150, 200, 250],
    maxLevel: 10,
    messageTemplate: (level) => `You earned Golden Hands by completing ${ACHIEVEMENT_DEFS.goldenhands.levels[level-1]} Master challenges!`,
    shareMessageTemplate: (level) => `I earned Golden Hands by completing ${ACHIEVEMENT_DEFS.goldenhands.levels[level-1]} Master challenges!`,
    rewardCoins: (level) => 75 * level
  },
  questhero: {
    id: 'questhero',
    title: 'Quest Hero',
    icon: 'military_tech',
    color: '#10b981',
    levels: [10, 25, 50, 75, 100, 200, 300, 400, 500, 750],
    maxLevel: 10,
    messageTemplate: (level) => `You earned Quest Hero by completing ${ACHIEVEMENT_DEFS.questhero.levels[level-1]} quests!`,
    shareMessageTemplate: (level) => `I earned Quest Hero by completing ${ACHIEVEMENT_DEFS.questhero.levels[level-1]} quests!`,
    rewardCoins: (level) => 40 * level
  },
  cheerleader: {
    id: 'cheerleader',
    title: 'Cheerleader',
    icon: 'cheer',
    color: '#ec4899',
    levels: [5, 10, 25, 50, 100],
    maxLevel: 5,
    messageTemplate: (level) => `You earned Cheerleader by sending ${ACHIEVEMENT_DEFS.cheerleader.levels[level-1]} congratulations!`,
    shareMessageTemplate: (level) => `I earned Cheerleader by sending ${ACHIEVEMENT_DEFS.cheerleader.levels[level-1]} congratulations!`,
    rewardCoins: (level) => 20 * level
  },
  erroreraser: {
    id: 'erroreraser',
    title: 'Error Eraser',
    icon: 'ink_eraser',
    color: '#61677c',
    levels: [10, 25, 50, 75, 100, 150, 250, 500, 750, 1000],
    maxLevel: 10,
    messageTemplate: (level) => `You earned Error Eraser by making ${ACHIEVEMENT_DEFS.erroreraser.levels[level-1]} corrections!`,
    shareMessageTemplate: (level) => `I earned Error Eraser by making ${ACHIEVEMENT_DEFS.erroreraser.levels[level-1]} corrections!`,
    rewardCoins: (level) => 30 * level
  },
  firstflock: {
    id: 'firstflock',
    title: 'First Flock',
    icon: 'diversity_2',
    color: '#3b82f6',
    levels: [3],
    maxLevel: 1,
    messageTemplate: () => 'You earned First Flock by following 3 users!',
    shareMessageTemplate: () => 'I earned First Flock by following 3 users!',
    rewardCoins: () => 100
  },
  leaguechampion: {
    id: 'leaguechampion',
    title: 'League Champion',
    icon: 'trophy',
    color: '#f59e0b',
    levels: [1],
    maxLevel: 1,
    messageTemplate: () => 'You earned League Champion by finishing #1 in a league!',
    shareMessageTemplate: () => 'I earned League Champion by finishing #1 in a league!',
    rewardCoins: () => 250
  },
  ultimatechampion: {
    id: 'ultimatechampion',
    title: 'Ultimate Champion',
    icon: 'award_star',
    color: '#a855f7',
    levels: [1],
    maxLevel: 1,
    messageTemplate: () => 'You earned Ultimate Champion by finishing #1 in the Ultimate League!',
    shareMessageTemplate: () => 'I earned Ultimate Champion by finishing #1 in the Ultimate League!',
    rewardCoins: () => 1000
  }
};

/**
 * Helper to get the current level based on user's progress value.
 * Returns { level: number, isCompleted: boolean }
 */
export function getAchievementLevel(achievementId, progressValue) {
  const def = ACHIEVEMENT_DEFS[achievementId];
  if (!def) return { level: 0, isCompleted: false };
  let level = 0;
  for (let i = 0; i < def.levels.length; i++) {
    if (progressValue >= def.levels[i]) level = i + 1;
    else break;
  }
  return { level, isCompleted: level >= def.maxLevel };
}
