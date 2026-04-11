/**
 * AudioPlayer - Handles all sound playback for lessons
 * Provides methods for correct/incorrect feedback and celebrations
 */

const AudioPlayer = {
  // Audio element references
  correctAudio: null,
  incorrectAudio: null,
  celebrationAudio: null,
  
  // Cache for additional audio elements
  audioCache: {},

  /**
   * Initialize audio elements
   * @param {Object} options - Optional custom audio paths
   * @param {string} options.correctPath - Path to correct sound
   * @param {string} options.incorrectPath - Path to incorrect sound
   * @param {string} options.celebrationPath - Path to celebration sound
   */
  init(options = {}) {
    const basePath = options.basePath || 'public/assets/audio/';
    
    this.correctAudio = new Audio(options.correctPath || `${basePath}correct.mp3`);
    this.incorrectAudio = new Audio(options.incorrectPath || `${basePath}incorrect.mp3`);
    this.celebrationAudio = new Audio(options.celebrationPath || `${basePath}clapping.mp3`);
    
    // Preload all audio
    this.correctAudio.load();
    this.incorrectAudio.load();
    this.celebrationAudio.load();
  },

  /**
   * Play correct answer sound
   */
  playCorrect() {
    try {
      if (this.correctAudio) {
        this.correctAudio.currentTime = 0;
        this.correctAudio.play().catch(e => console.log("Audio play failed:", e));
      }
    } catch (error) {
      console.log("Error playing correct sound:", error);
    }
  },

  /**
   * Play incorrect answer sound
   */
  playIncorrect() {
    try {
      if (this.incorrectAudio) {
        this.incorrectAudio.currentTime = 0;
        this.incorrectAudio.play().catch(e => console.log("Audio play failed:", e));
      }
    } catch (error) {
      console.log("Error playing incorrect sound:", error);
    }
  },

  /**
   * Play celebration sound (clapping)
   */
  playCelebration() {
    try {
      if (this.celebrationAudio) {
        this.celebrationAudio.currentTime = 0;
        this.celebrationAudio.play().catch(e => console.log("Celebration audio play failed:", e));
      }
    } catch (error) {
      console.log("Error playing celebration sound:", error);
    }
  },

  /**
   * Play any audio file by path
   * @param {string} path - Path to audio file
   * @param {boolean} cache - Whether to cache the audio element for reuse
   */
  playSound(path, cache = false) {
    try {
      let audio;
      
      if (cache && this.audioCache[path]) {
        audio = this.audioCache[path];
      } else {
        audio = new Audio(path);
        if (cache) {
          this.audioCache[path] = audio;
        }
      }
      
      audio.currentTime = 0;
      audio.play().catch(e => console.log("Audio play failed:", e));
    } catch (error) {
      console.log("Error playing sound:", error);
    }
  },

  /**
   * Preload a sound file for later use
   * @param {string} path - Path to audio file
   */
  preload(path) {
    if (!this.audioCache[path]) {
      const audio = new Audio(path);
      audio.load();
      this.audioCache[path] = audio;
    }
  }
};

// Export for use in lessons
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AudioPlayer };
}
