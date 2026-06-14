module.exports = {
  key: "eq",
  label: "等于",
  match(value, threshold) {
    return value === threshold;
  },
};
