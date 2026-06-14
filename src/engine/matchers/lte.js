module.exports = {
  key: "lte",
  label: "小于等于",
  match(value, threshold) {
    return value <= threshold;
  },
};
