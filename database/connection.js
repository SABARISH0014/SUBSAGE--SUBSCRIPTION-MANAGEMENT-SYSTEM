const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Specify the correct absolute path to your database file
const dbPath = 'C:/Users/sabar/OneDrive/Desktop/SubSage/database/database.sqlite';

// Create a new database connection
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
  }
});

// Ensure that the database is connected before running any queries
db.serialize(() => {
  console.log("Database connected");

  // Create Users table if it doesn't exist
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS Users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL
    );
`;



  db.run(createUsersTable, (err) => {
    if (err) {
      console.error('Error creating Users table:', err.message);
    } else {
      console.log('Users table created or already exists.');
    }
  });

  // Create the Subscriptions table if it doesn't already exist
  const createSubscriptionsTable = `
      CREATE TABLE IF NOT EXISTS "Subscriptions" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "user_id" INTEGER NOT NULL,         -- Add user_id field
        "name" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "start" TEXT NOT NULL,
        "expiry" TEXT NOT NULL,
        "amount" REAL NOT NULL,
        FOREIGN KEY (user_id) REFERENCES Users(id)  -- Foreign key reference to Users table
  )`;

  db.run(createSubscriptionsTable, (err) => {
    if (err) {
      console.error('Error creating Subscriptions table:', err.message);
    } else {
      console.log('Subscriptions table created or already exists.');
    }
  });
});

// Export the database connection for use in other parts of your application
module.exports = db;
