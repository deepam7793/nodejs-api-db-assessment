"use strict";

const { v4: uuidv4 } = require("uuid");
const accountRepository = require("../repositories/accountRepository");
const customerRepository = require("../repositories/customerRepository");
const { notFound } = require("../lib/errors");
const { toAccountResponse } = require("../lib/serializers");

async function createAccount(customerId, { type, currency, initialBalance }) {
  const account = {
    accountId: `acct_${uuidv4()}`,
    customerId,
    type,
    currency,
    balance: initialBalance,
    status: "OPEN",
    createdAt: new Date().toISOString(),
  };

  try {
    await accountRepository.insertForExistingCustomer(account);
  } catch (err) {
    if (err.name !== "TransactionCanceledException") {
      throw err;
    }
    const customer = await customerRepository.findById(customerId);
    if (!customer) {
      throw notFound(`Customer ${customerId} not found`);
    }
    throw err;
  }

  return toAccountResponse(account);
}

async function listAccounts(customerId) {
  const [customer, accounts] = await Promise.all([
    customerRepository.findById(customerId),
    accountRepository.listByCustomerId(customerId),
  ]);

  if (!customer) {
    throw notFound(`Customer ${customerId} not found`);
  }

  accounts.sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.accountId.localeCompare(b.accountId),
  );
  return { items: accounts.map(toAccountResponse) };
}

async function getAccount(accountId) {
  const account = await accountRepository.findById(accountId);
  if (!account) {
    throw notFound(`Account ${accountId} not found`);
  }
  return toAccountResponse(account);
}

module.exports = {
  createAccount,
  listAccounts,
  getAccount,
};
