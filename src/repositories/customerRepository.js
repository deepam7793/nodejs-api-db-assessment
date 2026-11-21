"use strict";

const { GetCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { docClient, TABLES } = require("../lib/dynamodb");

async function findById(customerId) {
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: TABLES.customers,
      Key: { customerId },
      ConsistentRead: true,
    }),
  );
  return Item ?? null;
}

async function insert(customer) {
  await docClient.send(
    new PutCommand({
      TableName: TABLES.customers,
      Item: customer,
      ConditionExpression: "attribute_not_exists(customerId)",
    }),
  );
  return customer;
}

module.exports = {
  findById,
  insert,
};
