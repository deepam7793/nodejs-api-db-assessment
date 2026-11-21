"use strict";

const { mockClient } = require("aws-sdk-client-mock");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactGetCommand,
  TransactWriteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} = require("@aws-sdk/client-dynamodb");

const customers = require("../../src/handlers/customers");
const accounts = require("../../src/handlers/accounts");
const transactions = require("../../src/handlers/transactions");
const { apiEvent, invoke } = require("../helpers/events");

const ddb = mockClient(DynamoDBDocumentClient);

const CUSTOMER = {
  customerId: "cust_001",
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const account = (overrides = {}) => ({
  accountId: "acct_001",
  customerId: "cust_001",
  type: "CHECKING",
  currency: "CAD",
  balance: 250,
  status: "OPEN",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const conditionFailed = () =>
  new ConditionalCheckFailedException({ message: "condition failed", $metadata: {} });
const transactionCanceled = () =>
  new TransactionCanceledException({ message: "transaction cancelled", $metadata: {} });

beforeEach(() => ddb.reset());

describe("POST /customers", () => {
  it("returns 201 with the contract shape", async () => {
    ddb.on(PutCommand).resolves({});

    const res = await invoke(
      customers.create,
      apiEvent({ body: { fullName: "Grace Hopper", email: "Grace@Example.com" } }),
    );

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({
      customerId: expect.stringMatching(/^cust_[0-9a-f-]{36}$/),
      fullName: "Grace Hopper",
      email: "grace@example.com",
      status: "ACTIVE",
      createdAt: expect.any(String),
    });
    const put = ddb.commandCalls(PutCommand)[0].args[0].input;
    expect(put.ConditionExpression).toBe("attribute_not_exists(customerId)");
  });

  it("returns 400 { error, message } when email is missing", async () => {
    const res = await invoke(customers.create, apiEvent({ body: { fullName: "Grace" } }));

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "BAD_REQUEST", message: "email is required" });
    expect(ddb.calls()).toHaveLength(0);
  });

  it.each([
    ["no body", undefined, "Request body is required"],
    ["invalid JSON", "{not json", "Request body must be valid JSON"],
    ["a JSON array", "[]", "Request body must be a JSON object"],
  ])("returns 400 for %s", async (_label, body, message) => {
    const res = await invoke(customers.create, apiEvent({ body }));
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe(message);
  });
});

describe("GET /customers/{customerId}", () => {
  it("returns 200 with the customer", async () => {
    ddb.on(GetCommand).resolves({ Item: CUSTOMER });

    const res = await invoke(customers.get, apiEvent({ pathParameters: { customerId: "cust_001" } }));

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(CUSTOMER);
  });

  it("returns 404 when the customer does not exist", async () => {
    ddb.on(GetCommand).resolves({});

    const res = await invoke(customers.get, apiEvent({ pathParameters: { customerId: "nope" } }));

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "NOT_FOUND", message: "Customer nope not found" });
  });
});

describe("POST /customers/{customerId}/accounts", () => {
  it("returns 201 and checks the customer exists in the same transaction", async () => {
    ddb.on(TransactWriteCommand).resolves({});

    const res = await invoke(
      accounts.create,
      apiEvent({ pathParameters: { customerId: "cust_001" }, body: { type: "SAVINGS", currency: "USD" } }),
    );

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({
      accountId: expect.stringMatching(/^acct_/),
      customerId: "cust_001",
      type: "SAVINGS",
      currency: "USD",
      balance: 0,
      status: "OPEN",
      createdAt: expect.any(String),
    });
    const [check, put] = ddb.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems;
    expect(check.ConditionCheck.Key).toEqual({ customerId: "cust_001" });
    expect(put.Put.TableName).toBe("Accounts");
  });

  it("returns 404 when the customer does not exist", async () => {
    ddb.on(TransactWriteCommand).rejects(transactionCanceled());
    ddb.on(GetCommand).resolves({});

    const res = await invoke(
      accounts.create,
      apiEvent({ pathParameters: { customerId: "nope" }, body: { type: "CHECKING", currency: "CAD" } }),
    );

    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for an unsupported currency", async () => {
    const res = await invoke(
      accounts.create,
      apiEvent({ pathParameters: { customerId: "cust_001" }, body: { type: "CHECKING", currency: "EUR" } }),
    );

    expect(res.statusCode).toBe(400);
    expect(ddb.calls()).toHaveLength(0);
  });
});

describe("GET /customers/{customerId}/accounts", () => {
  it("queries the GSI across pages and returns { items } sorted by createdAt", async () => {
    ddb.on(GetCommand).resolves({ Item: CUSTOMER });
    ddb
      .on(QueryCommand)
      .resolvesOnce({
        Items: [account({ accountId: "acct_b", createdAt: "2026-03-01T00:00:00.000Z" })],
        LastEvaluatedKey: { accountId: "acct_b", customerId: "cust_001" },
      })
      .resolvesOnce({
        Items: [account({ accountId: "acct_a", createdAt: "2026-02-01T00:00:00.000Z" })],
      });

    const res = await invoke(accounts.list, apiEvent({ pathParameters: { customerId: "cust_001" } }));

    expect(res.statusCode).toBe(200);
    expect(res.body.items.map((a) => a.accountId)).toEqual(["acct_a", "acct_b"]);
    const queries = ddb.commandCalls(QueryCommand).map((c) => c.args[0].input);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toMatchObject({
      IndexName: "CustomerIdIndex",
      KeyConditionExpression: "customerId = :customerId",
    });
    expect(queries[1].ExclusiveStartKey).toEqual({ accountId: "acct_b", customerId: "cust_001" });
  });

  it("returns 404 when the customer does not exist", async () => {
    ddb.on(GetCommand).resolves({});
    ddb.on(QueryCommand).resolves({ Items: [] });

    const res = await invoke(accounts.list, apiEvent({ pathParameters: { customerId: "nope" } }));

    expect(res.statusCode).toBe(404);
  });
});

describe("GET /accounts/{accountId}", () => {
  it("returns 200 with the balance", async () => {
    ddb.on(GetCommand).resolves({ Item: account() });

    const res = await invoke(accounts.get, apiEvent({ pathParameters: { accountId: "acct_001" } }));

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(account());
  });

  it("returns 404 when the account does not exist", async () => {
    ddb.on(GetCommand).resolves({});

    const res = await invoke(accounts.get, apiEvent({ pathParameters: { accountId: "nope" } }));

    expect(res.statusCode).toBe(404);
  });
});

describe("POST /accounts/{accountId}/deposits", () => {
  const deposit = (body) =>
    invoke(transactions.deposit, apiEvent({ pathParameters: { accountId: "acct_001" }, body }));

  it("credits the balance atomically and returns the account", async () => {
    ddb.on(UpdateCommand).resolves({ Attributes: account({ balance: 300 }) });

    const res = await deposit({ amount: 50, currency: "CAD" });

    expect(res.statusCode).toBe(200);
    expect(res.body.balance).toBe(300);
    const update = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(update.UpdateExpression).toBe("SET #balance = #balance + :amount");
    expect(update.ConditionExpression).toContain("#currency = :currency");
  });

  it("returns 400 when the currency does not match the account", async () => {
    ddb.on(UpdateCommand).rejects(conditionFailed());
    ddb.on(GetCommand).resolves({ Item: account({ currency: "USD" }) });

    const res = await deposit({ amount: 50, currency: "CAD" });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/does not match/);
  });

  it("returns 404 for an unknown account", async () => {
    ddb.on(UpdateCommand).rejects(conditionFailed());
    ddb.on(GetCommand).resolves({});

    const res = await deposit({ amount: 5, currency: "CAD" });

    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for a non-positive amount", async () => {
    const res = await deposit({ amount: 0, currency: "CAD" });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /accounts/{accountId}/withdrawals", () => {
  const withdraw = (body) =>
    invoke(transactions.withdraw, apiEvent({ pathParameters: { accountId: "acct_001" }, body }));

  it("debits only if the balance covers the amount", async () => {
    ddb.on(UpdateCommand).resolves({ Attributes: account({ balance: 225 }) });

    const res = await withdraw({ amount: 25, currency: "CAD" });

    expect(res.statusCode).toBe(200);
    expect(res.body.balance).toBe(225);
    const update = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(update.UpdateExpression).toBe("SET #balance = #balance - :amount");
    expect(update.ConditionExpression).toContain("#balance >= :amount");
  });

  it("returns 409 on insufficient funds", async () => {
    ddb.on(UpdateCommand).rejects(conditionFailed());
    ddb.on(GetCommand).resolves({ Item: account({ balance: 10 }) });

    const res = await withdraw({ amount: 25, currency: "CAD" });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: "CONFLICT",
      message: "Insufficient funds in account acct_001",
    });
  });

  it("returns a retryable 409 if the account changed concurrently", async () => {
    ddb.on(UpdateCommand).rejects(conditionFailed());
    ddb.on(GetCommand).resolves({ Item: account({ balance: 1000 }) });

    const res = await withdraw({ amount: 25, currency: "CAD" });

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/concurrently/);
  });
});

describe("POST /transfers", () => {
  const body = { fromAccountId: "acct_001", toAccountId: "acct_002", amount: 10, currency: "CAD" };
  const bothAccounts = (from, to) => ({ Responses: [{ Item: from }, { Item: to }] });

  it("moves funds in one transaction and returns both accounts", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    ddb
      .on(TransactGetCommand)
      .resolves(bothAccounts(account({ balance: 240 }), account({ accountId: "acct_002", balance: 1010 })));

    const res = await invoke(
      transactions.transfer,
      apiEvent({ body, headers: { "idempotency-key": "transfer-123" } }),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.fromAccount).toEqual(account({ balance: 240 }));
    expect(res.body.toAccount).toEqual(account({ accountId: "acct_002", balance: 1010 }));
    const write = ddb.commandCalls(TransactWriteCommand)[0].args[0].input;
    expect(write.ClientRequestToken).toBe("transfer-123");
    expect(write.TransactItems.map((i) => i.Update.Key.accountId)).toEqual(["acct_001", "acct_002"]);
    expect(write.TransactItems[0].Update.ConditionExpression).toContain("#balance >= :amount");
  });

  it("sends identical parameters when retried, so the Idempotency-Key works", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    ddb.on(TransactGetCommand).resolves(bothAccounts(account(), account({ accountId: "acct_002" })));
    const event = () => apiEvent({ body, headers: { "Idempotency-Key": "retry-1" } });

    await invoke(transactions.transfer, event());
    await new Promise((resolve) => setTimeout(resolve, 5));
    await invoke(transactions.transfer, event());

    const [first, retry] = ddb.commandCalls(TransactWriteCommand).map((c) => c.args[0].input);
    expect(retry).toEqual(first);
  });

  it("returns 409 on insufficient funds", async () => {
    ddb.on(TransactWriteCommand).rejects(transactionCanceled());
    ddb
      .on(TransactGetCommand)
      .resolves(bothAccounts(account({ balance: 5 }), account({ accountId: "acct_002" })));

    const res = await invoke(transactions.transfer, apiEvent({ body }));

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe("Insufficient funds in account acct_001");
  });

  it("returns 404 when the destination account does not exist", async () => {
    ddb.on(TransactWriteCommand).rejects(transactionCanceled());
    ddb.on(TransactGetCommand).resolves(bothAccounts(account(), undefined));

    const res = await invoke(transactions.transfer, apiEvent({ body }));

    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe("Account acct_002 not found");
  });

  it("returns 400 for a transfer to the same account", async () => {
    const res = await invoke(
      transactions.transfer,
      apiEvent({ body: { ...body, toAccountId: "acct_001" } }),
    );

    expect(res.statusCode).toBe(400);
    expect(ddb.calls()).toHaveLength(0);
  });
});

describe("unexpected errors", () => {
  it("return a generic 500 without leaking details", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    ddb.on(GetCommand).rejects(new Error("socket hang up at 10.0.0.12"));

    const res = await invoke(customers.get, apiEvent({ pathParameters: { customerId: "cust_001" } }));

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "INTERNAL_SERVER_ERROR", message: "Unexpected server error" });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
