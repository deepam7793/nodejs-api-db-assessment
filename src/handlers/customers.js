"use strict";

const { created, ok } = require("../lib/response");
const { withErrorHandling, readJsonBody, readPathParam } = require("../lib/http");
const { validateCreateCustomer } = require("../lib/validation");
const customerService = require("../services/customerService");

// POST /customers
const create = withErrorHandling("createCustomer", async (event) => {
  const input = validateCreateCustomer(readJsonBody(event));
  return created(await customerService.createCustomer(input));
});

// GET /customers/{customerId}
const get = withErrorHandling("getCustomer", async (event) => {
  const customerId = readPathParam(event, "customerId");
  return ok(await customerService.getCustomer(customerId));
});

module.exports = {
  create,
  get,
};
