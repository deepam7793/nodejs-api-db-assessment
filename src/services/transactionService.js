"use strict";

const accountRepository = require("../repositories/accountRepository");
const { badRequest, conflict, notFound } = require("../lib/errors");
const { toAccountResponse } = require("../lib/serializers");

// DynamoDB only reports that a condition failed, not which one, so the
// account is re-read to choose the right status code.
function findRuleViolation(account, accountId, { amount, currency, direction }) {
  if (!account) {
    return notFound(`Account ${accountId} not found`);
  }
  if (account.status !== "OPEN") {
    return conflict(`Account ${accountId} is not open`);
  }
  if (account.currency !== currency) {
    return badRequest(
      `currency ${currency} does not match account ${accountId} currency ${account.currency}`,
    );
  }
  if (direction === "debit" && account.balance < amount) {
    return conflict(`Insufficient funds in account ${accountId}`);
  }
  return null;
}

// The state changed between the failed write and the re-read; the client can retry.
const concurrentUpdate = () =>
  conflict("The account was modified concurrently; please retry the request");

async function changeBalance(accountId, { amount, currency }, direction) {
  try {
    const updated = await accountRepository.applyBalanceChange({
      accountId,
      amount,
      currency,
      direction,
    });
    return toAccountResponse(updated);
  } catch (err) {
    if (err.name !== "ConditionalCheckFailedException") {
      throw err;
    }
    const account = await accountRepository.findById(accountId);
    throw findRuleViolation(account, accountId, { amount, currency, direction }) ?? concurrentUpdate();
  }
}

function deposit(accountId, request) {
  return changeBalance(accountId, request, "credit");
}

function withdraw(accountId, request) {
  return changeBalance(accountId, request, "debit");
}

async function explainFailedTransfer({ fromAccountId, toAccountId, amount, currency }) {
  const [from, to] = await accountRepository.findManyById([fromAccountId, toAccountId]);

  if (!from) return notFound(`Account ${fromAccountId} not found`);
  if (!to) return notFound(`Account ${toAccountId} not found`);

  return (
    findRuleViolation(from, fromAccountId, { amount, currency, direction: "debit" }) ??
    findRuleViolation(to, toAccountId, { amount, currency, direction: "credit" }) ??
    concurrentUpdate()
  );
}

async function transfer(request, idempotencyKey) {
  try {
    await accountRepository.transferFunds({ ...request, idempotencyKey });
  } catch (err) {
    switch (err.name) {
      case "TransactionCanceledException":
        throw await explainFailedTransfer(request);
      case "IdempotentParameterMismatchException":
        throw conflict("Idempotency-Key was already used with a different transfer request");
      case "TransactionInProgressException":
        throw conflict("A transfer with this Idempotency-Key is still in progress; please retry");
      default:
        throw err;
    }
  }

  const [fromAccount, toAccount] = await accountRepository.findManyById([
    request.fromAccountId,
    request.toAccountId,
  ]);
  return {
    fromAccount: toAccountResponse(fromAccount),
    toAccount: toAccountResponse(toAccount),
  };
}

module.exports = {
  deposit,
  withdraw,
  transfer,
};
