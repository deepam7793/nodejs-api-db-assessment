"use strict";

const customers = require("../../src/handlers/customers");
const accounts = require("../../src/handlers/accounts");
const transactions = require("../../src/handlers/transactions");
const { apiEvent, invoke } = require("../helpers/events");

jest.setTimeout(30000);

async function createCustomer() {
  const res = await invoke(
    customers.create,
    apiEvent({ body: { fullName: "Test Customer", email: "test@example.com" } }),
  );
  expect(res.statusCode).toBe(201);
  return res.body;
}

async function createAccount(customerId, body) {
  const res = await invoke(accounts.create, apiEvent({ pathParameters: { customerId }, body }));
  expect(res.statusCode).toBe(201);
  return res.body;
}

async function getBalance(accountId) {
  const res = await invoke(accounts.get, apiEvent({ pathParameters: { accountId } }));
  expect(res.statusCode).toBe(200);
  return res.body.balance;
}

const deposit = (accountId, amount, currency = "CAD") =>
  invoke(transactions.deposit, apiEvent({ pathParameters: { accountId }, body: { amount, currency } }));

const withdraw = (accountId, amount, currency = "CAD") =>
  invoke(transactions.withdraw, apiEvent({ pathParameters: { accountId }, body: { amount, currency } }));

const transfer = (body, headers = {}) => invoke(transactions.transfer, apiEvent({ body, headers }));

async function twoCadAccounts(fromBalance, toBalance) {
  const { customerId } = await createCustomer();
  const from = await createAccount(customerId, { type: "CHECKING", currency: "CAD", initialBalance: fromBalance });
  const to = await createAccount(customerId, { type: "SAVINGS", currency: "CAD", initialBalance: toBalance });
  return { from, to };
}

describe("core endpoints", () => {
  it("creates a customer and accounts, lists them and reads balances", async () => {
    const customer = await createCustomer();

    const fetched = await invoke(customers.get, apiEvent({ pathParameters: { customerId: customer.customerId } }));
    expect(fetched.statusCode).toBe(200);
    expect(fetched.body).toEqual(customer);

    const checking = await createAccount(customer.customerId, {
      type: "CHECKING",
      currency: "CAD",
      initialBalance: 100.5,
    });
    const savings = await createAccount(customer.customerId, { type: "SAVINGS", currency: "USD" });
    expect(savings.balance).toBe(0);

    const list = await invoke(accounts.list, apiEvent({ pathParameters: { customerId: customer.customerId } }));
    expect(list.statusCode).toBe(200);
    expect(list.body.items.map((a) => a.accountId).sort()).toEqual(
      [checking.accountId, savings.accountId].sort(),
    );

    expect(await getBalance(checking.accountId)).toBe(100.5);
  });

  it("returns 404 for unknown customers and accounts", async () => {
    const createForMissing = await invoke(
      accounts.create,
      apiEvent({ pathParameters: { customerId: "cust_missing" }, body: { type: "CHECKING", currency: "CAD" } }),
    );
    const listForMissing = await invoke(accounts.list, apiEvent({ pathParameters: { customerId: "cust_missing" } }));
    const missingAccount = await invoke(accounts.get, apiEvent({ pathParameters: { accountId: "acct_missing" } }));

    expect(createForMissing.statusCode).toBe(404);
    expect(listForMissing.statusCode).toBe(404);
    expect(missingAccount.statusCode).toBe(404);
  });
});

describe("deposits and withdrawals", () => {
  it("keeps decimals exact and enforces the business rules", async () => {
    const { customerId } = await createCustomer();
    const acct = await createAccount(customerId, { type: "CHECKING", currency: "CAD", initialBalance: 0.1 });

    const credited = await deposit(acct.accountId, 0.2);
    expect(credited.statusCode).toBe(200);
    expect(credited.body.balance).toBe(0.3);

    expect((await deposit(acct.accountId, 1, "USD")).statusCode).toBe(400);
    expect((await withdraw(acct.accountId, 0.31)).statusCode).toBe(409);

    const debited = await withdraw(acct.accountId, 0.3);
    expect(debited.statusCode).toBe(200);
    expect(debited.body.balance).toBe(0);
  });

  it("never overdraws under concurrent withdrawals", async () => {
    const { customerId } = await createCustomer();
    const acct = await createAccount(customerId, { type: "CHECKING", currency: "CAD", initialBalance: 100 });

    const results = await Promise.all(Array.from({ length: 20 }, () => withdraw(acct.accountId, 10)));
    const statuses = results.map((r) => r.statusCode);

    expect(statuses.filter((s) => s === 200)).toHaveLength(10);
    expect(statuses.filter((s) => s === 409)).toHaveLength(10);
    expect(await getBalance(acct.accountId)).toBe(0);
  });
});

describe("transfers", () => {
  it("moves funds and returns both updated accounts", async () => {
    const { from, to } = await twoCadAccounts(100, 5);

    const res = await transfer({ fromAccountId: from.accountId, toAccountId: to.accountId, amount: 40, currency: "CAD" });

    expect(res.statusCode).toBe(200);
    expect(res.body.fromAccount.balance).toBe(60);
    expect(res.body.toAccount.balance).toBe(45);
  });

  it("is all-or-nothing: a rejected transfer leaves both balances untouched", async () => {
    const { from, to } = await twoCadAccounts(10, 0);
    const base = { fromAccountId: from.accountId, toAccountId: to.accountId, currency: "CAD" };

    expect((await transfer({ ...base, amount: 50 })).statusCode).toBe(409);
    expect((await transfer({ ...base, toAccountId: "acct_missing", amount: 5 })).statusCode).toBe(404);
    expect((await transfer({ ...base, amount: 5, currency: "USD" })).statusCode).toBe(400);

    expect(await getBalance(from.accountId)).toBe(10);
    expect(await getBalance(to.accountId)).toBe(0);
  });

  it("conserves money under concurrent transfers in both directions", async () => {
    const { from: a, to: b } = await twoCadAccounts(50, 50);

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        i % 2 === 0
          ? transfer({ fromAccountId: a.accountId, toAccountId: b.accountId, amount: 7, currency: "CAD" })
          : transfer({ fromAccountId: b.accountId, toAccountId: a.accountId, amount: 3, currency: "CAD" }),
      ),
    );

    results.forEach((r) => expect([200, 409]).toContain(r.statusCode));
    const balanceA = await getBalance(a.accountId);
    const balanceB = await getBalance(b.accountId);
    expect(balanceA + balanceB).toBe(100);
    expect(balanceA).toBeGreaterThanOrEqual(0);
    expect(balanceB).toBeGreaterThanOrEqual(0);
  });

  it("does not move money twice when retried with the same Idempotency-Key", async () => {
    const { from, to } = await twoCadAccounts(100, 0);
    const body = { fromAccountId: from.accountId, toAccountId: to.accountId, amount: 25, currency: "CAD" };
    const headers = { "Idempotency-Key": `it-${Date.now()}` };

    expect((await transfer(body, headers)).statusCode).toBe(200);
    expect((await transfer(body, headers)).statusCode).toBe(200);

    expect(await getBalance(from.accountId)).toBe(75);
    expect(await getBalance(to.accountId)).toBe(25);
  });
});
