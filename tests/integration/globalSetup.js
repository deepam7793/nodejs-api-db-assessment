"use strict";

const path = require("path");
const { execFileSync } = require("child_process");
const { DynamoDBClient, ListTablesCommand } = require("@aws-sdk/client-dynamodb");
const { TEST_ENV } = require("./env");

module.exports = async function globalSetup() {
  const client = new DynamoDBClient({
    region: TEST_ENV.AWS_REGION,
    endpoint: TEST_ENV.DYNAMODB_ENDPOINT,
    credentials: {
      accessKeyId: TEST_ENV.AWS_ACCESS_KEY_ID,
      secretAccessKey: TEST_ENV.AWS_SECRET_ACCESS_KEY,
    },
    maxAttempts: 1,
  });

  try {
    await client.send(new ListTablesCommand({}));
  } catch (err) {
    throw new Error(
      `DynamoDB Local is not reachable at ${TEST_ENV.DYNAMODB_ENDPOINT} (${err.message}). ` +
        "Start it with `npm run db:up`.",
    );
  } finally {
    client.destroy();
  }

  execFileSync(process.execPath, [path.join(__dirname, "..", "..", "scripts", "create-tables.js")], {
    env: { ...process.env, ...TEST_ENV },
    stdio: "ignore",
  });
};
