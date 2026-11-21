"use strict";

const { badRequest } = require("./errors");

const ACCOUNT_TYPES = ["CHECKING", "SAVINGS"];
const CURRENCIES = ["CAD", "USD"];
const MAX_AMOUNT = 1_000_000_000_000;
const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;
const MAX_IDEMPOTENCY_KEY_LENGTH = 36; // DynamoDB ClientRequestToken limit
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireString(body, field, maxLength) {
  const value = body[field];
  if (value === undefined || value === null) {
    throw badRequest(`${field} is required`);
  }
  if (typeof value !== "string") {
    throw badRequest(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    throw badRequest(`${field} must not be empty`);
  }
  if (trimmed.length > maxLength) {
    throw badRequest(`${field} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function requireEnum(body, field, allowed) {
  const value = body[field];
  if (value === undefined || value === null) {
    throw badRequest(`${field} is required`);
  }
  if (!allowed.includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function requireMoney(value, field, { allowZero }) {
  if (value === undefined || value === null) {
    throw badRequest(`${field} is required`);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badRequest(`${field} must be a number`);
  }
  if (allowZero ? value < 0 : value <= 0) {
    throw badRequest(
      allowZero ? `${field} must be greater than or equal to 0` : `${field} must be greater than 0`,
    );
  }
  if (value > MAX_AMOUNT) {
    throw badRequest(`${field} must not exceed ${MAX_AMOUNT}`);
  }
  if (Math.round(value * 100) / 100 !== value) {
    throw badRequest(`${field} must have at most 2 decimal places`);
  }
  return value;
}

function validateCreateCustomer(body) {
  const fullName = requireString(body, "fullName", MAX_NAME_LENGTH);
  const email = requireString(body, "email", MAX_EMAIL_LENGTH).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw badRequest("email must be a valid email address");
  }
  return { fullName, email };
}

function validateCreateAccount(body) {
  return {
    type: requireEnum(body, "type", ACCOUNT_TYPES),
    currency: requireEnum(body, "currency", CURRENCIES),
    initialBalance:
      body.initialBalance === undefined
        ? 0
        : requireMoney(body.initialBalance, "initialBalance", { allowZero: true }),
  };
}

function validateAmountRequest(body) {
  return {
    amount: requireMoney(body.amount, "amount", { allowZero: false }),
    currency: requireEnum(body, "currency", CURRENCIES),
  };
}

function validateTransferRequest(body) {
  const fromAccountId = requireString(body, "fromAccountId", MAX_ID_LENGTH);
  const toAccountId = requireString(body, "toAccountId", MAX_ID_LENGTH);
  if (fromAccountId === toAccountId) {
    throw badRequest("fromAccountId and toAccountId must be different accounts");
  }
  return { fromAccountId, toAccountId, ...validateAmountRequest(body) };
}

function validateIdempotencyKey(value) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw badRequest(`Idempotency-Key header must be 1-${MAX_IDEMPOTENCY_KEY_LENGTH} characters`);
  }
  return value;
}

module.exports = {
  validateCreateCustomer,
  validateCreateAccount,
  validateAmountRequest,
  validateTransferRequest,
  validateIdempotencyKey,
};
