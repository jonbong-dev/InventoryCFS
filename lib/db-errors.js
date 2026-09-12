/**
 * Engine-agnostic database error helper.
 * Handles duplicate key / unique constraint violations across PostgreSQL, SQL Server, and SQLite.
 */

function isUniqueViolation(err) {
  if (!err) return false;

  // PostgreSQL error code for unique_violation
  if (err.code === '23505') {
    return true;
  }

  // Microsoft SQL Server error numbers for duplicate key / unique index violation
  // 2601: Cannot insert duplicate key row in object with unique index
  // 2627: Violation of %ls constraint '%.*ls'. Cannot insert duplicate key in object
  if (err.number === 2601 || err.number === 2627) {
    return true;
  }
  if (err.originalError && (err.originalError.number === 2601 || err.originalError.number === 2627)) {
    return true;
  }

  // SQLite constraint violations
  if (err.code === 'SQLITE_CONSTRAINT' || err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return true;
  }
  if (typeof err.message === 'string' && (
    err.message.includes('UNIQUE constraint failed') ||
    err.message.includes('duplicate key value') ||
    err.message.includes('Violation of PRIMARY KEY') ||
    err.message.includes('Violation of UNIQUE KEY')
  )) {
    return true;
  }

  return false;
}

module.exports = {
  isUniqueViolation,
};
