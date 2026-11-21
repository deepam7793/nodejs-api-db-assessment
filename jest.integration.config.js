"use strict";

module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/integration/**/*.test.js"],
  setupFiles: ["<rootDir>/tests/integration/setupEnv.js"],
  globalSetup: "<rootDir>/tests/integration/globalSetup.js",
};
