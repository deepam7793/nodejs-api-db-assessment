"use strict";

const { TEST_ENV } = require("./env");

Object.assign(process.env, TEST_ENV);
