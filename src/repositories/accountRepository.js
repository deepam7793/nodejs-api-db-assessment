"use strict";

const {
  GetCommand,
  QueryCommand,
  TransactGetCommand,
  TransactWriteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { docClient, TABLES, INDEXES } = require("../lib/dynamodb");

async function findById(accountId) {
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: TABLES.accounts,
      Key: { accountId },
      ConsistentRead: true,
    }),
  );
  return Item ?? null;
}

// Reads several accounts as one consistent snapshot; missing accounts come back as null.
async function findManyById(accountIds) {
  const { Responses = [] } = await docClient.send(
    new TransactGetCommand({
      TransactItems: accountIds.map((accountId) => ({
        Get: { TableName: TABLES.accounts, Key: { accountId } },
      })),
    }),
  );
  return accountIds.map((_, i) => Responses[i]?.Item ?? null);
}

async function listByCustomerId(customerId) {
  const items = [];
  let ExclusiveStartKey;

  do {
    const page = await docClient.send(
      new QueryCommand({
        TableName: TABLES.accounts,
        IndexName: INDEXES.accountsByCustomer,
        KeyConditionExpression: "customerId = :customerId",
        ExpressionAttributeValues: { ":customerId": customerId },
        ExclusiveStartKey,
      }),
    );
    items.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return items;
}

// The customer check and the insert commit together, so an account can never be
// created for a customer that does not exist.
async function insertForExistingCustomer(account) {
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          ConditionCheck: {
            TableName: TABLES.customers,
            Key: { customerId: account.customerId },
            ConditionExpression: "attribute_exists(customerId)",
          },
        },
        {
          Put: {
            TableName: TABLES.accounts,
            Item: account,
            ConditionExpression: "attribute_not_exists(accountId)",
          },
        },
      ],
    }),
  );
  return account;
}

// The arithmetic and the business rules run inside DynamoDB as one atomic step,
// so concurrent requests cannot overdraw or lose updates.
// No per-request values (e.g. timestamps): a retried transfer must send identical
// parameters for its ClientRequestToken to be honoured.
function balanceUpdate({ accountId, amount, currency, direction }) {
  const isDebit = direction === "debit";
  const conditions = ["attribute_exists(accountId)", "#currency = :currency", "#status = :open"];
  if (isDebit) {
    conditions.push("#balance >= :amount");
  }

  return {
    TableName: TABLES.accounts,
    Key: { accountId },
    UpdateExpression: `SET #balance = #balance ${isDebit ? "-" : "+"} :amount`,
    ConditionExpression: conditions.join(" AND "),
    ExpressionAttributeNames: {
      "#balance": "balance",
      "#currency": "currency",
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":amount": amount,
      ":currency": currency,
      ":open": "OPEN",
    },
  };
}

async function applyBalanceChange(change) {
  const { Attributes } = await docClient.send(
    new UpdateCommand({ ...balanceUpdate(change), ReturnValues: "ALL_NEW" }),
  );
  return Attributes;
}

async function transferFunds({ fromAccountId, toAccountId, amount, currency, idempotencyKey }) {
  await docClient.send(
    new TransactWriteCommand({
      ClientRequestToken: idempotencyKey,
      TransactItems: [
        { Update: balanceUpdate({ accountId: fromAccountId, amount, currency, direction: "debit" }) },
        { Update: balanceUpdate({ accountId: toAccountId, amount, currency, direction: "credit" }) },
      ],
    }),
  );
}

module.exports = {
  findById,
  findManyById,
  listByCustomerId,
  insertForExistingCustomer,
  applyBalanceChange,
  transferFunds,
};
