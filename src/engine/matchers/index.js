const lt = require("./lt");
const lte = require("./lte");
const gt = require("./gt");
const gte = require("./gte");
const eq = require("./eq");
const neq = require("./neq");

class MatcherRegistry {
  constructor() {
    this._matchers = new Map();
    this._registerDefaults();
  }

  _registerDefaults() {
    this.register(lt);
    this.register(lte);
    this.register(gt);
    this.register(gte);
    this.register(eq);
    this.register(neq);
  }

  register(matcher) {
    if (!matcher || typeof matcher.key !== "string" || !matcher.key) {
      throw new Error("Matcher 必须包含非空 string 类型的 key");
    }
    if (typeof matcher.match !== "function") {
      throw new Error(
        `Matcher ${matcher.key} 必须实现 match(value, threshold) 函数`,
      );
    }
    if (typeof matcher.label !== "string" || !matcher.label) {
      throw new Error(
        `Matcher ${matcher.key} 必须包含非空 string 类型的 label`,
      );
    }
    this._matchers.set(matcher.key, matcher);
  }

  unregister(key) {
    return this._matchers.delete(key);
  }

  get(key) {
    return this._matchers.get(key) || null;
  }

  has(key) {
    return this._matchers.has(key);
  }

  keys() {
    return [...this._matchers.keys()];
  }

  list() {
    return [...this._matchers.values()];
  }

  toMap() {
    const result = {};
    for (const matcher of this._matchers.values()) {
      result[matcher.key] = {
        label: matcher.label,
        fn: (value, threshold) => matcher.match(value, threshold),
      };
    }
    return result;
  }
}

const registry = new MatcherRegistry();

module.exports = {
  MatcherRegistry,
  matcherRegistry: registry,
  registerMatcher: (m) => registry.register(m),
  unregisterMatcher: (k) => registry.unregister(k),
  getMatcher: (k) => registry.get(k),
  hasMatcher: (k) => registry.has(k),
  getMatcherKeys: () => registry.keys(),
  getMatcherList: () => registry.list(),
  getMatcherMap: () => registry.toMap(),
};
