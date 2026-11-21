"use strict";

const { v4: uuidv4 } = require("uuid");
const customerRepository = require("../repositories/customerRepository");
const { notFound } = require("../lib/errors");
const { toCustomerResponse } = require("../lib/serializers");

async function createCustomer({ fullName, email }) {
  const customer = {
    customerId: `cust_${uuidv4()}`,
    fullName,
    email,
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
  };

  await customerRepository.insert(customer);
  return toCustomerResponse(customer);
}

async function getCustomer(customerId) {
  const customer = await customerRepository.findById(customerId);
  if (!customer) {
    throw notFound(`Customer ${customerId} not found`);
  }
  return toCustomerResponse(customer);
}

module.exports = {
  createCustomer,
  getCustomer,
};
