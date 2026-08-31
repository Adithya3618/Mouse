// Formal contract every ResearchDatabase implementation must satisfy.
// This is a plain-JS/duck-typed contract, not an enforced base class -
// SQLiteResearchDatabase (database/researchDatabase.js, unchanged) predates
// this file and is a plain object literal, not a class instance; forcing it
// to extend something would mean touching a file this project deliberately
// keeps frozen. assertImplementsResearchDatabase() below is the actual
// enforcement mechanism: tests call it against any candidate (SQLite or
// Postgres) to verify it satisfies the shape everything else in the app is
// written against.
//
//   prepare(sql: string) -> Statement
//     Statement.run(...params) -> Promise<void> | void
//     Statement.get(...params) -> Promise<row|undefined> | row|undefined
//     Statement.all(...params) -> Promise<row[]> | row[]
//   exec(sql: string) -> Promise<void> | void
//   close() -> Promise<void> | void
//
// `sql` always uses '?' positional placeholders (SQLite style) - an
// implementation backed by a database that wants a different placeholder
// syntax (Postgres's $1, $2, ...) translates internally; repository SQL
// text itself never changes per backend (see repositories/*.js, which are
// 100% unaware of which implementation they're talking to).
//
// Methods may return either a plain value or a Promise - callers always
// `await` the result (see repositories/participantRepository.js's header
// comment), so a synchronous implementation (SQLiteResearchDatabase) and a
// genuinely asynchronous one (PostgresResearchDatabase) are both valid.

const REQUIRED_DB_METHODS = ['prepare', 'exec', 'close'];
const REQUIRED_STATEMENT_METHODS = ['run', 'get', 'all'];

// Throws a clear, specific error naming exactly what's missing, rather than
// letting a malformed implementation fail confusingly deep inside some
// repository at runtime. Call this once against any new ResearchDatabase
// implementation in its own test file.
function assertImplementsResearchDatabase(candidate, { sampleSql = 'SELECT 1' } = {}) {
    if (!candidate || typeof candidate !== 'object') {
        throw new Error('ResearchDatabase candidate must be an object.');
    }
    for (const method of REQUIRED_DB_METHODS) {
        if (typeof candidate[method] !== 'function') {
            throw new Error(`ResearchDatabase candidate is missing required method: ${method}()`);
        }
    }
    const statement = candidate.prepare(sampleSql);
    if (!statement || typeof statement !== 'object') {
        throw new Error('ResearchDatabase.prepare(sql) must return a Statement object.');
    }
    for (const method of REQUIRED_STATEMENT_METHODS) {
        if (typeof statement[method] !== 'function') {
            throw new Error(`ResearchDatabase.prepare(sql) result is missing required method: ${method}()`);
        }
    }
    return true;
}

module.exports = { assertImplementsResearchDatabase, REQUIRED_DB_METHODS, REQUIRED_STATEMENT_METHODS };
