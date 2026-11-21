"use strict";

const { created, ok } = require("../lib/response");
const { withErrorHandling, readJsonBody, readPathParam } = require("../lib/http");
const { validateCreateAccount } = require("../lib/validation");
const accountService = require("../services/accountService");

// POST /customers/{customerId}/accounts
const create = withErrorHandling("createAccount", async (event) => {
  const customerId = readPathParam(event, "customerId");
  const input = validateCreateAccount(readJsonBody(event));
  return created(await accountService.createAccount(customerId, input));
});

// GET /customers/{customerId}/accounts
const list = withErrorHandling("listAccounts", async (event) => {
  const customerId = readPathParam(event, "customerId");
  return ok(await accountService.listAccounts(customerId));
});

// GET /accounts/{accountId}
const get = withErrorHandling("getAccount", async (event) => {
  const accountId = readPathParam(event, "accountId");
  return ok(await accountService.getAccount(accountId));
});

module.exports = {
  create,
  list,
  get,
};
