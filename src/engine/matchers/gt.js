module.exports = {
  key: "gt",
  label: "大于",
  match(value, threshold) {
    return value > threshold;
  },
};
