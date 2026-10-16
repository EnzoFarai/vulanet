// src/js/record-defs.js
export const RECORD_DEFS = {
  longestStreak: {
    id: 'longest-streak',
    title: 'Longest Streak',
    icon: 'fire', // Phosphor icon name
    color: '#ff6336',
    message: (value) => `You reached a ${value} day streak!`,
    shareMessage: (value) => `I reached a ${value} day streak!`,
    unachievedMessage: 'Start a streak!',
    defaultNumber: '—'
  },
  highestLeague: {
    id: 'highest-league',
    title: 'Highest League',
    icon: 'medal',
    color: '#fbc02d',
    // "value" here is a league tier name (Beginner, Amateur, ...,
    // Ultimate). Templates are grammatically tuned for names, not
    // numeric positions.
    message: (value) => `You reached the ${value} League!`,
    shareMessage: (value) => `I reached the ${value} League on Vulanet!`,
    unachievedMessage: 'Get promoted to a higher league!',
    defaultNumber: '—'
  },
  perfectLessons: {
    id: 'perfect-lessons',
    title: 'Perfect Lessons',
    icon: 'target',
    color: '#009d98',
    message: (value) => `You did ${value} perfect lessons in a day!`,
    shareMessage: (value) => `I did ${value} perfect lessons in a day!`,
    unachievedMessage: 'Complete 1 perfect lesson!',
    defaultNumber: '—'
  },
  mostXp: {
    id: 'most-xp',
    title: 'Most XP',
    icon: 'arrow-fat-lines-up',
    color: '#1976d2',
    message: (value) => `You earned ${value} XP in a day!`,
    shareMessage: (value) => `I earned ${value} XP in a day!`,
    unachievedMessage: 'Earn at least 1 XP!',
    defaultNumber: '—'
  }
};
