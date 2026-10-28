module.exports = {
  extends: ["@commitlint/config-conventional"],
  defaultIgnores: false,
  parserPreset: {
    parserOpts: {
      headerPattern: /^([a-z][a-z0-9-]*)\(([a-z0-9][a-z0-9._/-]*)\): (\S(?:.*\S)?)$/,
      headerCorrespondence: ["type", "scope", "subject"],
    },
  },
  rules: {
    "header-max-length": [2, "always", 72],
    "type-empty": [2, "never"],
    "type-enum": [0],
    "scope-empty": [2, "never"],
    "subject-empty": [2, "never"],
    "subject-case": [0],
    "body-empty": [2, "always"],
    "footer-empty": [2, "always"],
  },
};
