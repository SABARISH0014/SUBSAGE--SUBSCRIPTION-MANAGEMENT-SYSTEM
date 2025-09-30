const { Pool } = require('pg');

// Vercel automatically provides the DATABASE_URL environment variable 
// which contains the full connection string to Neon/Postgres.
const connectionString = process.env.DATABASE_URL;

// Create a connection pool to manage concurrent database interactions
const pool = new Pool({
  connectionString: connectionString,
});

// Optional: Test the connection once to ensure the connection string is valid
pool.connect((err, client, release) => {
    if (err) {
        console.error('Error acquiring client from pool:', err.stack);
        // It's crucial to throw an error here to catch deployment issues early
        throw new Error('Database connection failed to initialize!');
    }
    client.release();
    console.log('PostgreSQL Pool connected successfully!');
});


// ----------------------------------------------------------------------
// EXPORT FUNCTIONS: Must be ASYNCHRONOUS (async/await)
// These replace your old synchronous db.get, db.all, and db.run calls.
// ----------------------------------------------------------------------

module.exports = {
  /**
   * Executes a query that expects multiple rows (replaces db.all)
   * @param {string} text - The SQL query text.
   * @param {Array} params - The parameter values.
   */
  async all(text, params) {
    const res = await pool.query(text, params);
    return res.rows;
  },

  /**
   * Executes a query that expects a single row (replaces db.get)
   * @param {string} text - The SQL query text.
   * @param {Array} params - The parameter values.
   */
  async get(text, params) {
    const res = await pool.query(text, params);
    return res.rows[0];
  },

  /**
   * Executes a query (INSERT, UPDATE, DELETE) that doesn't return data (replaces db.run)
   * @param {string} text - The SQL query text.
   * @param {Array} params - The parameter values.
   */
  async run(text, params) {
    // Note: The 'pg' client does not have a direct '.run' equivalent. 
    // We use pool.query and check the result for changes.
    const res = await pool.query(text, params);
    // Return rowCount to mimic SQLite's affected rows count or success status
    return res.rowCount; 
  },
  
  // This is the raw query function, useful for complex transactions
  query: (text, params) => pool.query(text, params),
};
