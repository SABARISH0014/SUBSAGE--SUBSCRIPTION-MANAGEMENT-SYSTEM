const { Pool } = require('pg');

// Vercel automatically provides the DATABASE_URL environment variable 
const connectionString = process.env.DATABASE_URL;

// Create a connection pool to manage concurrent database interactions
// This does NOT run initialization logic; it only sets up the client.
const pool = new Pool({
  connectionString: connectionString,
  // CRITICAL: Ensure SSL is handled for Neon/Vercel environments
  ssl: {
    rejectUnauthorized: false 
    // If your connection string already has ?sslmode=require, this may be optional, 
    // but often helps ensure the connection works on Vercel's host.
  }
});


// ----------------------------------------------------------------------
// EXPORT FUNCTIONS: ASYNCHRONOUS wrappers for pg.Pool
// ----------------------------------------------------------------------

module.exports = {
  /**
   * Executes a query that expects multiple rows (replaces db.all)
   */
  async all(text, params) {
    const res = await pool.query(text, params);
    return res.rows;
  },

  /**
   * Executes a query that expects a single row (replaces db.get)
   */
  async get(text, params) {
    const res = await pool.query(text, params);
    return res.rows[0];
  },

  /**
   * Executes a query (INSERT, UPDATE, DELETE) that doesn't return data (replaces db.run)
   */
  async run(text, params) {
    const res = await pool.query(text, params);
    // Returns rowCount (affected rows)
    return res.rowCount; 
  },
  
  query: (text, params) => pool.query(text, params),
};