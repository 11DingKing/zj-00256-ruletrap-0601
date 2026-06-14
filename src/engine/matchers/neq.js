module.exports = {
  key: "neq",
  label: "不等于",
  match(value, threshold) {
    return value !== threshold;
  },
};
