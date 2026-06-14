module.exports = {
  key: "gte",
  label: "大于等于",
  match(value, threshold) {
    return value >= threshold;
  },
};
