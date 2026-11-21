"use strict";

function toCustomerResponse(item) {
  return {
    customerId: item.customerId,
    fullName: item.fullName,
    email: item.email,
    status: item.status,
    createdAt: item.createdAt,
  };
}

function toAccountResponse(item) {
  return {
    accountId: item.accountId,
    customerId: item.customerId,
    type: item.type,
    currency: item.currency,
    balance: item.balance,
    status: item.status,
    createdAt: item.createdAt,
  };
}

module.exports = {
  toCustomerResponse,
  toAccountResponse,
};
