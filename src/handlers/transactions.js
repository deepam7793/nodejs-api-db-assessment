"use strict";

const { ok } = require("../lib/response");
const { withErrorHandling, readJsonBody, readPathParam, readHeader } = require("../lib/http");
const {
  validateAmountRequest,
  validateTransferRequest,
  validateIdempotencyKey,
} = require("../lib/validation");
const transactionService = require("../services/transactionService");

// POST /accounts/{accountId}/deposits
const deposit = withErrorHandling("deposit", async (event) => {
  const accountId = readPathParam(event, "accountId");
  const request = validateAmountRequest(readJsonBody(event));
  return ok(await transactionService.deposit(accountId, request));
});

// POST /accounts/{accountId}/withdrawals
const withdraw = withErrorHandling("withdraw", async (event) => {
  const accountId = readPathParam(event, "accountId");
  const request = validateAmountRequest(readJsonBody(event));
  return ok(await transactionService.withdraw(accountId, request));
});

// POST /transfers (optional Idempotency-Key header makes retries safe)
const transfer = withErrorHandling("transfer", async (event) => {
  const request = validateTransferRequest(readJsonBody(event));
  const idempotencyKey = validateIdempotencyKey(readHeader(event, "Idempotency-Key"));
  return ok(await transactionService.transfer(request, idempotencyKey));
});

module.exports = {
  deposit,
  withdraw,
  transfer,
};
