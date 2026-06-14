const DEFAULT_LEVELS = [
  {
    key: "compliant",
    priority: 0,
    minScore: -Infinity,
  },
  {
    key: "suspicious",
    priority: 1,
    minScoreKey: "suspicious",
  },
  {
    key: "violation",
    priority: 2,
    minScoreKey: "violation",
  },
];

class LevelClassifier {
  constructor() {
    this._levels = [...DEFAULT_LEVELS];
  }

  setLevels(levels) {
    if (!Array.isArray(levels) || levels.length === 0) {
      throw new Error("levels 必须是非空数组");
    }
    for (const lvl of levels) {
      if (!lvl.key || typeof lvl.key !== "string") {
        throw new Error("每个 level 必须包含非空 string 类型的 key");
      }
      if (typeof lvl.priority !== "number") {
        throw new Error(`level ${lvl.key} 必须包含 number 类型的 priority`);
      }
    }
    this._levels = [...levels];
  }

  addLevel(level) {
    if (!level || !level.key || typeof level.key !== "string") {
      throw new Error("level 必须包含非空 string 类型的 key");
    }
    if (typeof level.priority !== "number") {
      throw new Error(`level ${level.key} 必须包含 number 类型的 priority`);
    }
    const existing = this._levels.findIndex((l) => l.key === level.key);
    if (existing >= 0) {
      this._levels[existing] = level;
    } else {
      this._levels.push(level);
    }
  }

  getLevels() {
    return [...this._levels];
  }

  classify(totalScore, thresholds) {
    const sorted = [...this._levels].sort((a, b) => b.priority - a.priority);

    for (const level of sorted) {
      let threshold;
      if (level.minScoreKey !== undefined && thresholds !== undefined) {
        threshold = thresholds[level.minScoreKey];
      }
      if (threshold === undefined && level.minScore !== undefined) {
        threshold = level.minScore;
      }
      if (threshold === undefined) {
        continue;
      }
      if (totalScore >= threshold) {
        return level.key;
      }
    }

    const lowest = [...this._levels].sort((a, b) => a.priority - b.priority)[0];
    return lowest ? lowest.key : "compliant";
  }
}

const classifier = new LevelClassifier();

module.exports = {
  LevelClassifier,
  levelClassifier: classifier,
  classifyLevel: (score, thresholds) => classifier.classify(score, thresholds),
  setLevels: (levels) => classifier.setLevels(levels),
  addLevel: (level) => classifier.addLevel(level),
  getLevels: () => classifier.getLevels(),
};
