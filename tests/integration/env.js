"use strict";

// Separate tables so the tests never touch the seeded demo data.
const TEST_ENV = {
  DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT || "http://localhost:8000",
  AWS_REGION: process.env.AWS_REGION || "us-east-1",
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || "local",
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || "local",
  CUSTOMERS_TABLE: "Customers_test",
  ACCOUNTS_TABLE: "Accounts_test",
};

module.exports = { TEST_ENV };
