module.exports = {
  key: "lt",
  label: "小于",
  match(value, threshold) {
    return value < threshold;
  },
};
