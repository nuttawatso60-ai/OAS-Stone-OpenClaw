'use strict';

class JobStoreError extends Error {}
class ValidationError extends JobStoreError {}
class UnknownStatusError extends JobStoreError {}
class JobNotFoundError extends JobStoreError {}
class InvalidTransitionError extends JobStoreError {}
class PersistenceError extends JobStoreError {}

module.exports = {
  ValidationError,
  UnknownStatusError,
  JobNotFoundError,
  InvalidTransitionError,
  PersistenceError
};
